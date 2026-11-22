import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { arr, compile, int, obj, opt, str } from '@earendil-works/pi-schema'

export type ReplayMode = 'record' | 'replay' | 'strict'
export type ReplayFault =
	| 'midcut'
	| 'disconnect'
	| 'cancel'
	| 'http500'
	| 'bad-image'
export interface ReplayOptions {
	mode?: ReplayMode
	directory?: string
	fetch?: typeof globalThis.fetch
	case?: string
	tags?: readonly string[]
	fault?: ReplayFault
	delayMs?: number
}

const bodyLimit = 256 * 1024
const allowedHeaders = ['content-type', 'retry-after'] as const
const sha = str({ pattern: '^[a-f0-9]{64}$' })
const cassette = compile(
	obj({
		key: str({ pattern: '^[a-f0-9]{16}$' }),
		method: str(),
		path: str(),
		reqHash: sha,
		status: int({ minimum: 200, maximum: 599 }),
		headers: obj({ 'content-type': opt(str()), 'retry-after': opt(str()) }),
		body: obj({ b64: opt(str()), sha: opt(sha) }),
		recordedAt: str(),
		case: str(),
		tags: arr(str()),
	}),
)

function hash(value: string | Uint8Array) {
	return createHash('sha256').update(value).digest('hex')
}

function sortJson(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortJson)
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value)
				.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
				.map(([key, nested]) => [key, sortJson(nested)]),
		)
	}
	return value
}

function missing(error: unknown) {
	return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function encodedOrigin(origin: string) {
	const pattern = Array.from(origin, (character) => {
		const hex = character.charCodeAt(0).toString(16).padStart(2, '0')
		const literal = character.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&')
		const slash = character === '/' ? '|\\\\/' : ''
		return `(?:${literal}${slash}|\\\\u00${hex}|%${hex})`
	}).join('')
	return new RegExp(pattern, 'gi')
}

async function requestIdentity(request: Request) {
	const url = new URL(request.url)
	const secrets = [
		request.headers.get('authorization')?.replace(/^\S+\s+/, ''),
		request.headers.get('x-api-key'),
		request.headers.get('api-key'),
	]
	const query = Array.from(url.searchParams.entries())
	url.search = ''
	for (const [name, value] of query) {
		const secret =
			/^(?:api[-_]?key|key|token|access_token|authorization)$/i.test(name)
		if (secret) secrets.push(value)
		url.searchParams.append(name, secret ? '[redacted]' : value)
	}
	url.searchParams.sort()
	const relayOrigin =
		url.origin === 'null' ? undefined : encodedOrigin(url.origin)
	function scrub(text: string) {
		for (const secret of secrets) {
			if (secret) text = text.replaceAll(secret, '[redacted]')
		}
		return relayOrigin
			? text.replace(relayOrigin, 'https://relay.invalid')
			: text
	}
	const path = scrub(url.pathname + url.search)
	const method = request.method
	let canonical: string | Uint8Array
	if (request.headers.get('content-type')?.startsWith('multipart/form-data;')) {
		const form = await request.clone().formData()
		const parts = await Promise.all(
			Array.from(form, async ([name, value]) => [
				name,
				typeof value === 'string'
					? value
					: {
							name: value.name,
							type: value.type,
							sha: hash(new Uint8Array(await value.arrayBuffer())),
						},
			]),
		)
		canonical = scrub(JSON.stringify(parts))
	} else {
		const body = Buffer.from(await request.clone().arrayBuffer())
		canonical = body
		try {
			const text = new TextDecoder('utf-8', { fatal: true }).decode(body)
			try {
				canonical = JSON.stringify(sortJson(JSON.parse(text)))
			} catch {
				canonical = text
			}
			canonical = scrub(canonical)
		} catch {
			// Non-text request bodies are hashed as bytes.
		}
	}
	const key = createHash('sha256')
		.update(method)
		.update(path)
		.update(canonical)
		.digest('hex')
		.slice(0, 16)
	return { key, method, path, reqHash: hash(canonical), scrub }
}

function modeFromEnvironment() {
	const mode = process.env.NL_REPLAY
	if (!mode) return undefined
	if (mode === 'record' || mode === 'replay' || mode === 'strict') return mode
	throw new Error('Invalid NL_REPLAY mode')
}

function replayBody(
	bytes: Uint8Array,
	signal: AbortSignal,
	fault?: ReplayFault,
	delayMs = 0,
) {
	const cutoff = Math.max(1, Math.floor(bytes.length / 2))
	const end =
		fault === 'midcut' || fault === 'disconnect' ? cutoff : bytes.length
	let offset = 0
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			signal.throwIfAborted()
			if (delayMs) await setTimeout(delayMs, undefined, { signal })
			if (fault === 'cancel')
				throw new DOMException('Replay cancelled', 'AbortError')
			if (offset >= Math.min(end, bytes.length)) {
				if (fault === 'disconnect')
					throw new TypeError('Replay connection dropped')
				controller.close()
				return
			}
			const line = bytes.indexOf(10, offset)
			const next = Math.min(
				end,
				offset + 1024,
				line === -1 ? bytes.length : line + 1,
			)
			controller.enqueue(bytes.slice(offset, next))
			offset = next
		},
	})
}

export function createReplayFetch(
	options: ReplayOptions = {},
): typeof globalThis.fetch {
	const mode = options.mode ?? modeFromEnvironment()
	const upstream = options.fetch ?? globalThis.fetch
	if (!mode) return upstream
	const directory =
		options.directory ??
		process.env.NL_CASSETTE_DIR ??
		'tests/fixtures/cassettes'
	const index = join(directory, 'cassette.jsonl')
	const bodies = join(directory, 'cassette-files')
	const positions = new Map<string, number>()
	let pending: Promise<unknown> = Promise.resolve()

	async function store(
		identity: Awaited<ReturnType<typeof requestIdentity>>,
		response: Response,
		bytes: Buffer,
	) {
		const { scrub, ...request } = identity
		const headers: Record<string, string> = {}
		for (const name of allowedHeaders) {
			const value = response.headers.get(name)
			if (value !== null) headers[name] = scrub(value)
		}
		const contentType = headers['content-type'] ?? ''
		if (
			!contentType ||
			/^(?:text\/|application\/(?:[\w.+-]*json|xml))/i.test(contentType)
		) {
			try {
				bytes = Buffer.from(
					scrub(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
				)
			} catch {
				// Keep opaque bytes unchanged.
			}
		}
		await mkdir(directory, { recursive: true })
		let body: { b64: string } | { sha: string }
		if (bytes.length > bodyLimit) {
			const sha = hash(bytes)
			await mkdir(bodies, { recursive: true })
			try {
				await writeFile(join(bodies, sha), bytes, { flag: 'wx' })
			} catch (error) {
				if (
					!(
						error instanceof Error &&
						'code' in error &&
						error.code === 'EEXIST'
					)
				)
					throw error
			}
			body = { sha }
		} else {
			body = { b64: bytes.toString('base64') }
		}
		const row = {
			...request,
			status: response.status,
			headers,
			body,
			recordedAt: new Date().toISOString(),
			case: options.case ?? '',
			tags: options.tags ?? [],
		}
		const write = pending.then(() =>
			appendFile(index, `${JSON.stringify(row)}\n`),
		)
		pending = write.catch(() => {})
		await write
	}

	return async (input, init) => {
		const request = new Request(input, init)
		const identity = await requestIdentity(request)
		request.signal.throwIfAborted()
		if (mode === 'record') {
			const response = await upstream(request)
			if (!response.body) {
				await store(identity, response, Buffer.alloc(0))
				return response
			}
			const chunks: Buffer[] = []
			const stream = response.body.pipeThrough(
				new TransformStream<Uint8Array, Uint8Array>({
					transform(chunk, controller) {
						chunks.push(Buffer.from(chunk))
						controller.enqueue(chunk)
					},
					async flush() {
						await store(identity, response, Buffer.concat(chunks))
					},
				}),
			)
			return new Response(stream, {
				status: response.status,
				headers: response.headers,
			})
		}
		let text = ''
		try {
			text = await readFile(index, 'utf8')
		} catch (error) {
			if (!missing(error)) throw error
		}
		const rows = text
			.split('\n')
			.filter((line) => line.trim())
			.map((line) => {
				const row: unknown = JSON.parse(line)
				if (
					!cassette.check(row) ||
					(row.body.b64 === undefined) === (row.body.sha === undefined)
				) {
					throw new Error('Invalid cassette entry')
				}
				return row
			})
			.filter((row) => row.key === identity.key)
		if (rows.length === 0) {
			if (mode === 'strict')
				throw new Error(
					`Missing strict replay cassette: ${identity.method} ${identity.key}`,
				)
			return upstream(request)
		}
		const position = positions.get(identity.key) ?? 0
		const row = rows[Math.min(position, rows.length - 1)]
		positions.set(identity.key, position + 1)
		if (options.fault === 'http500')
			return new Response('Replay HTTP 500', { status: 500 })
		let bytes: Uint8Array
		if (row.body.sha !== undefined) {
			bytes = await readFile(join(bodies, row.body.sha))
			if (hash(bytes) !== row.body.sha)
				throw new Error('Invalid cassette body checksum')
		} else {
			bytes = Buffer.from(row.body.b64 ?? '', 'base64')
		}
		if (options.fault === 'bad-image') bytes = Buffer.from('invalid image data')
		const stream =
			request.method === 'HEAD' || [204, 205, 304].includes(row.status)
				? null
				: replayBody(bytes, request.signal, options.fault, options.delayMs)
		return new Response(stream, { status: row.status, headers: row.headers })
	}
}
