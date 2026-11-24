import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { arr, compile, int, obj, opt, str } from '@earendil-works/pi-schema'
import {
	inheritTextSettlement,
	isResponsesTerminal,
	type projectSpend,
	quoteSpend,
	requestedOutputTokens,
	textSettlement,
} from '../usage/spend'

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
	normalizeIds?: boolean
	rebindIds?: boolean
	fallbackDirectory?: string
	reuseRecorded?: boolean
	reportMissing?: boolean
	ignoreRecordedFailures?: boolean
	spend?: ReturnType<typeof projectSpend>
	onReplay?: (request: Request, response: Response) => Promise<void>
	checkpointDirectory?: string
	onCheckpointReply?: (save: () => Promise<void>) => void
	checkpointAllowance?: { images?: number }
	onCheckpointHit?: (allowance: ReplayOptions['checkpointAllowance']) => void
}

const spendGuardedFetches = new WeakSet<typeof globalThis.fetch>()
const dispatchedRequests = new WeakSet<Request>()
const checkpointReplies = new WeakSet<Response>()

export function wasDispatched(request: Request) {
	return dispatchedRequests.has(request)
}

export function isCheckpointReply(response: Response) {
	return checkpointReplies.has(response)
}

export function isSpendGuardedFetch(fetch: typeof globalThis.fetch) {
	return spendGuardedFetches.has(fetch)
}

export function inheritSpendGuard(
	source: typeof globalThis.fetch,
	wrapper: typeof globalThis.fetch,
) {
	if (isSpendGuardedFetch(source)) spendGuardedFetches.add(wrapper)
	return wrapper
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
		checkpointAllowance: opt(obj({ images: opt(int({ minimum: 0 })) })),
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

async function requestIdentity(
	request: Request,
	normalizeIds = false,
	rebindIds = false,
) {
	const ids: string[] = []
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
		text = relayOrigin
			? text.replace(relayOrigin, 'https://relay.invalid')
			: text
		for (const [index, id] of ids.entries())
			text = text.replaceAll(id, `[replay-uuid-${index}]`)
		return text
	}
	const path = scrub(url.pathname + url.search)
	const method = request.method
	const imageRequest =
		method === 'POST' && /\/images\/(?:generations|edits)$/.test(url.pathname)
	let canonical: string | Uint8Array
	if (request.headers.get('content-type')?.startsWith('multipart/form-data;')) {
		const form = await request.clone().formData()
		const counts = imageRequest ? form.getAll('n') : []
		if (counts.length === 1 && counts[0] === '1') form.delete('n')
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
				const value = JSON.parse(text)
				if (imageRequest && value?.n === 1) delete value.n
				canonical = JSON.stringify(sortJson(value))
			} catch {
				canonical = text
			}
			canonical = scrub(canonical)
		} catch {
			// Non-text request bodies are hashed as bytes.
		}
	}
	if (normalizeIds && typeof canonical === 'string') {
		if (rebindIds)
			ids.push(
				...new Set(
					canonical.match(
						/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
					) ?? [],
				),
			)
		canonical = canonical
			.replace(
				/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
				'[uuid]',
			)
			.replace(/ #[0-9a-f]{4}\b/g, ' #[line]')
	}
	const key = createHash('sha256')
		.update(method)
		.update(path)
		.update(canonical)
		.digest('hex')
		.slice(0, 16)
	const restore = (text: string) =>
		text.replace(
			/\[replay-uuid-(\d+)\]/g,
			(token, index) => ids[Number(index)] ?? token,
		)
	return { key, method, path, reqHash: hash(canonical), scrub, restore }
}

function modeFromEnvironment() {
	const mode = process.env.NL_REPLAY
	if (!mode) return undefined
	if (mode === 'record' || mode === 'replay' || mode === 'strict') return mode
	throw new Error('Invalid NL_REPLAY mode')
}

export function usesReplyCheckpoint(options: ReplayOptions = {}) {
	const mode = options.mode ?? modeFromEnvironment()
	return mode !== 'strict'
}

function terminalSse(bytes: Buffer) {
	const lines = bytes.toString('utf8').split(/\r\n|[\r\n]/)
	let event = ''
	let data: string[] = []
	for (const line of lines.slice(0, -1)) {
		if (!line) {
			const payload = data.join('\n')
			if (
				payload === '[DONE]' ||
				(data.length > 0 &&
					(event === 'message_stop' || isResponsesTerminal(event)))
			)
				return true
			if (payload) {
				try {
					if (isResponsesTerminal(JSON.parse(payload)?.type)) return true
				} catch {
					// Only a complete SSE event can terminate a recording.
				}
			}
			event = ''
			data = []
		} else if (line.startsWith('event:')) {
			event = line.slice(6).replace(/^ /, '')
		} else if (line.startsWith('data:')) {
			data.push(line.slice(5).replace(/^ /, ''))
		}
	}
	return false
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

function corruptImage(bytes: Uint8Array): Uint8Array {
	const invalid = Buffer.from('invalid image data')
	let envelope: unknown
	try {
		envelope = JSON.parse(Buffer.from(bytes).toString('utf8'))
	} catch {
		return invalid
	}
	if (
		!envelope ||
		typeof envelope !== 'object' ||
		!('data' in envelope) ||
		!Array.isArray(envelope.data)
	)
		return bytes
	const corrupt = invalid.toString('base64')
	let changed = false
	for (const image of envelope.data) {
		if (image && typeof image.b64_json === 'string') {
			image.b64_json = corrupt
			changed = true
		}
	}
	return changed ? Buffer.from(JSON.stringify(envelope)) : bytes
}

export function createReplayFetch(
	options: ReplayOptions = {},
): typeof globalThis.fetch {
	const { checkpointDirectory, ...upstream } = options
	return checkpointDirectory && usesReplyCheckpoint(upstream)
		? replayFetch(
				{
					mode: 'record',
					directory: checkpointDirectory,
					reuseRecorded: true,
					fetch: replayFetch(upstream),
					onCheckpointReply: options.onCheckpointReply,
					checkpointAllowance: options.checkpointAllowance,
					onCheckpointHit: options.onCheckpointHit,
				},
				true,
			)
		: replayFetch(upstream)
}

function replayFetch(
	options: ReplayOptions,
	checkpoint = false,
): typeof globalThis.fetch {
	const mode = options.mode ?? modeFromEnvironment()
	const send = options.fetch ?? globalThis.fetch
	const spend = options.spend
	const sendAdmitted = (input: RequestInfo | URL, admitted: Request) => {
		admitted.signal.throwIfAborted()
		if (input instanceof Request) dispatchedRequests.add(input)
		return send(admitted)
	}
	const sendLive = (request: Request, original: RequestInfo | URL) =>
		spend
			? spend(request, (admitted) => sendAdmitted(original, admitted))
			: send(request)
	if (!mode) {
		if (!spend) return send
		const upstream: typeof fetch = (input, init) =>
			sendLive(new Request(input, init), input)
		spendGuardedFetches.add(upstream)
		return upstream
	}
	const directory =
		options.directory ??
		process.env.NL_CASSETTE_DIR ??
		'tests/fixtures/cassettes'
	const index = join(directory, 'cassette.jsonl')
	const bodies = join(directory, 'cassette-files')
	const positions = new Map<string, number>()
	const fallback = options.fallbackDirectory
		? createReplayFetch({
				mode: 'strict',
				directory: options.fallbackDirectory,
				reportMissing: false,
			})
		: undefined
	let pending: Promise<unknown> = Promise.resolve()

	async function store(
		identity: Awaited<ReturnType<typeof requestIdentity>>,
		response: Response,
		bytes: Buffer,
	) {
		const { scrub, restore: _restore, ...request } = identity
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
			...(checkpoint && { checkpointAllowance: options.checkpointAllowance }),
		}
		const write = pending.then(() =>
			appendFile(index, `${JSON.stringify(row)}\n`),
		)
		pending = write.catch(() => {})
		await write
	}

	const dispatch: typeof fetch = async (input, init) => {
		const request = new Request(
			checkpoint && input instanceof Request ? input.clone() : input,
			init,
		)
		const rebindIds =
			options.rebindIds ?? process.env.NL_REPLAY_REBIND_IDS === '1'
		const identity = await requestIdentity(
			request,
			options.normalizeIds,
			rebindIds,
		)
		request.signal.throwIfAborted()
		if (fallback) {
			try {
				return await fallback(request.clone())
			} catch (error) {
				if (
					!(error instanceof Error) ||
					!error.message.startsWith('Missing strict replay cassette:')
				)
					throw error
			}
		}
		if (mode === 'record') {
			if (options.reuseRecorded) {
				const text = await readFile(index, 'utf8').catch((error) => {
					if (!missing(error)) throw error
					return ''
				})
				const recorded = text
					.split('\n')
					.filter(Boolean)
					.map((line) => JSON.parse(line))
				const hit = recorded.find(
					(row) => row.key === identity.key && row.status < 300,
				)
				if (hit) {
					const response = await createReplayFetch({
						...options,
						mode: 'strict',
						fallbackDirectory: undefined,
					})(request)
					if (checkpoint) {
						checkpointReplies.add(response)
						options.onCheckpointHit?.(hit.checkpointAllowance)
					}
					return response
				}
			}
			const recordSend = async (
				admitted: Request,
				quote?: Awaited<ReturnType<typeof quoteSpend>>,
			) => {
				if (process.env.NL_USAGE_CSV && admitted.method === 'POST') {
					const reservation =
						quote ?? (await quoteSpend(admitted).catch(() => undefined))
					const body = admitted.headers
						.get('content-type')
						?.includes('application/json')
						? await admitted.clone().json()
						: {}
					await appendFile(
						process.env.NL_USAGE_CSV,
						`${new Date().toISOString().slice(0, 10)},${String(body.model ?? 'image').replaceAll(',', '')},1,${reservation?.tokens ?? requestedOutputTokens(admitted, body) ?? 0},${reservation?.images ?? 0},cassette recording (${reservation ? 'reserved tokens and images' : 'reserved output tokens'})\n`,
					)
				}
				return spend ? sendAdmitted(input, admitted) : send(admitted)
			}
			const response = await (checkpoint
				? send(input, init)
				: spend
					? spend(request, recordSend)
					: recordSend(request))
			if (!response.body) {
				if (!checkpoint) await store(identity, response, Buffer.alloc(0))
				return response
			}
			const isSse = /^text\/event-stream(?:[;\s]|$)/i.test(
				response.headers.get('content-type') ?? '',
			)
			const settled = textSettlement(response)
			if (checkpoint && (!response.ok || !settled)) return response
			const chunks: Buffer[] = []
			const reader = response.body.getReader()
			let cancelled = false
			let writing: Promise<void> | undefined
			const persist = (bytes: Buffer) =>
				(writing ??= (async () => {
					if (!checkpoint) return store(identity, response, bytes)
					if (settled?.() && (!isSse || terminalSse(bytes)))
						options.onCheckpointReply?.(() => store(identity, response, bytes))
				})())
			const stream = new ReadableStream<Uint8Array>(
				{
					async pull(controller) {
						const { done, value } = await reader.read()
						if (cancelled) return
						if (done) {
							await persist(Buffer.concat(chunks))
							if (!cancelled) controller.close()
							return
						}
						chunks.push(Buffer.from(value))
						controller.enqueue(value)
					},
					async cancel(reason) {
						cancelled = true
						const bytes = isSse ? Buffer.concat(chunks) : undefined
						await Promise.all([
							reader.cancel(reason),
							writing ??
								(bytes && terminalSse(bytes) ? persist(bytes) : undefined),
						])
					},
				},
				{ highWaterMark: 0 },
			)
			return inheritTextSettlement(
				response,
				new Response(stream, {
					status: response.status,
					headers: response.headers,
				}),
			)
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
			.filter(
				(row) =>
					row.key === identity.key &&
					(!options.reuseRecorded || row.status < 300) &&
					(mode !== 'replay' ||
						!options.ignoreRecordedFailures ||
						(row.status >= 200 && row.status < 300)),
			)
		if (rows.length === 0) {
			if (mode === 'strict') {
				const message = `Missing strict replay cassette: ${identity.method} ${identity.key} (${directory})`
				if (
					options.reportMissing !== false &&
					process.env.NL_REPLAY_MISSING_LOG
				)
					await appendFile(process.env.NL_REPLAY_MISSING_LOG, `${message}\n`)
				throw new Error(message)
			}
			return sendLive(request, input)
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
		if (
			rebindIds &&
			/^(?:text\/|application\/(?:[\w.+-]*json|xml))/i.test(
				row.headers['content-type'] ?? '',
			)
		)
			bytes = Buffer.from(identity.restore(Buffer.from(bytes).toString('utf8')))
		if (options.fault === 'bad-image') bytes = corruptImage(bytes)
		const stream =
			request.method === 'HEAD' || [204, 205, 304].includes(row.status)
				? null
				: replayBody(bytes, request.signal, options.fault, options.delayMs)
		const response = new Response(stream, {
			status: row.status,
			headers: row.headers,
		})
		await options.onReplay?.(request, response)
		return response
	}
	if (spend && mode !== 'strict') spendGuardedFetches.add(dispatch)
	return checkpoint ? inheritSpendGuard(send, dispatch) : dispatch
}
