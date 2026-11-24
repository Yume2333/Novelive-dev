import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createReplayFetch } from '../../packages/creator/src/replay'

const origin = 'https://relay.example.test'
const path = '/v1/chat/completions'
const rowFile = 'cassette.jsonl'
const stream =
	'data: {"delta":"first"}\n\ndata: {"delta":"second"}\n\ndata: [DONE]\n\n'

test('normalized replay rebinds UUID-bearing chapter IDs in authored responses', async () => {
	const oldId = '11111111-1111-4111-8111-111111111111'
	const newId = '22222222-2222-4222-8222-222222222222'
	const upstream = vi.fn(async () =>
		Response.json({ chapterId: `joined-${oldId}-ch1` }),
	)
	const request = (id: string) =>
		new Request(origin + path, {
			method: 'POST',
			body: JSON.stringify({ chapterId: `joined-${id}-ch1` }),
		})
	const record = createReplayFetch({
		mode: 'record',
		directory,
		normalizeIds: true,
		rebindIds: true,
		fetch: upstream,
	})
	await (await record(request(oldId))).text()
	const replay = createReplayFetch({
		mode: 'strict',
		directory,
		normalizeIds: true,
		rebindIds: true,
		fetch: upstream,
	})
	expect(await (await replay(request(newId))).json()).toEqual({
		chapterId: `joined-${newId}-ch1`,
	})
	expect(upstream).toHaveBeenCalledTimes(1)
})

test('strict replay keeps staging identity stable across live image allowances', async () => {
	const upstream = vi.fn(async () => Response.json({ patch: '' }))
	const request = (limit: number, script = 'scene first') =>
		new Request(origin + path, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				messages: [
					{
						role: 'user',
						content: `Hard limit for this whole chapter: ${limit} new provider images, including edits.\n${script}`,
					},
				],
			}),
		})
	const record = createReplayFetch({
		mode: 'record',
		directory,
		fetch: upstream,
	})
	await (await record(request(9))).text()
	const replay = createReplayFetch({
		mode: 'strict',
		directory,
		fetch: upstream,
	})
	expect(await (await replay(request(11))).json()).toEqual({ patch: '' })
	await expect(replay(request(11, 'scene second'))).rejects.toThrow(
		'Missing strict replay cassette:',
	)
	expect(upstream).toHaveBeenCalledTimes(1)
})

test('response rebinding preserves empty responses and strict misses never call upstream', async () => {
	const upstream = vi.fn(async () => new Response(null, { status: 204 }))
	const options = {
		directory,
		normalizeIds: true,
		rebindIds: true,
		fetch: upstream,
	}
	await (await createReplayFetch({ ...options, mode: 'record' })(origin)).text()
	const replay = createReplayFetch({ ...options, mode: 'strict' })
	const response = await replay(origin)
	expect(response.status).toBe(204)
	expect(await response.text()).toBe('')
	await expect(replay(`${origin}/missing`)).rejects.toThrow(
		'Missing strict replay cassette:',
	)
	expect(upstream).toHaveBeenCalledTimes(1)
})

test('resuming a gate recording reuses successful identities and records only missing requests', async () => {
	const upstream = vi.fn(async () => new Response('response'))
	const options = {
		mode: 'record' as const,
		directory,
		reuseRecorded: true,
		fetch: upstream,
	}
	const first = createReplayFetch(options)
	expect(await (await first(origin)).text()).toBe('response')
	const resumed = createReplayFetch(options)
	expect(await (await resumed(origin)).text()).toBe('response')
	expect(upstream).toHaveBeenCalledTimes(1)
	expect(await (await resumed(`${origin}/next`)).text()).toBe('response')
	expect(upstream).toHaveBeenCalledTimes(2)
	expect(
		(await readFile(join(directory, rowFile), 'utf8')).trim().split('\n'),
	).toHaveLength(2)
	upstream.mockResolvedValueOnce(new Response('temporary', { status: 503 }))
	const failed = await resumed(`${origin}/retry`)
	expect(failed.status).toBe(503)
	await failed.text()
	await (await resumed(`${origin}/retry`)).text()
	expect((await resumed(`${origin}/retry`)).status).toBe(200)
	expect(upstream).toHaveBeenCalledTimes(4)
})

test('successful recording reuse composes with replay failure filtering without strict upstream calls', async () => {
	const fetch = vi
		.fn<typeof globalThis.fetch>()
		.mockResolvedValueOnce(new Response('temporary', { status: 503 }))
		.mockResolvedValueOnce(new Response('recovered'))
	const record = createReplayFetch({ mode: 'record', directory, fetch })
	await (await record(origin)).text()
	await (await record(origin)).text()
	for (const { mode, reuseRecorded, ignoreRecordedFailures, expected } of [
		{
			mode: 'replay',
			reuseRecorded: false,
			ignoreRecordedFailures: false,
			expected: 'temporary',
		},
		{
			mode: 'replay',
			reuseRecorded: false,
			ignoreRecordedFailures: true,
			expected: 'recovered',
		},
		{
			mode: 'strict',
			reuseRecorded: true,
			ignoreRecordedFailures: false,
			expected: 'recovered',
		},
		{
			mode: 'strict',
			reuseRecorded: true,
			ignoreRecordedFailures: true,
			expected: 'recovered',
		},
	] as const) {
		const replay = createReplayFetch({
			mode,
			directory,
			fetch,
			reuseRecorded,
			ignoreRecordedFailures,
		})
		expect(await (await replay(origin)).text()).toBe(expected)
		if (mode === 'strict')
			await expect(replay(`${origin}/missing`)).rejects.toThrow(
				'Missing strict replay cassette:',
			)
	}
	expect(fetch).toHaveBeenCalledTimes(2)
})

test('gate recording reserves private usage and strict misses retain only the request identity', async () => {
	const usage = join(directory, 'usage.csv')
	const missing = join(directory, 'missing.txt')
	vi.stubEnv('NL_USAGE_CSV', usage)
	vi.stubEnv('NL_REPLAY_MISSING_LOG', missing)
	const upstream = vi.fn(async () => new Response('recorded'))
	const request = {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: 'Bearer private-key',
		},
		body: JSON.stringify({ model: 'gate-model', max_tokens: 512 }),
	}
	await (
		await createReplayFetch({ mode: 'record', directory, fetch: upstream })(
			`${origin}${path}`,
			request,
		)
	).text()
	expect(await readFile(usage, 'utf8')).toMatch(
		/,gate-model,1,512,0,cassette recording/,
	)
	expect(await readdir(directory)).not.toContain('missing.txt')
	await expect(
		createReplayFetch({ mode: 'strict', directory, fetch: upstream })(
			`${origin}/missing`,
			request,
		),
	).rejects.toThrow('Missing strict replay cassette:')
	const diagnostic = await readFile(missing, 'utf8')
	expect(diagnostic).toMatch(
		/^Missing strict replay cassette: POST [a-f0-9]{16} /,
	)
	expect(diagnostic).not.toContain('private-key')
	expect(diagnostic).not.toContain(origin)
	expect(upstream).toHaveBeenCalledTimes(1)
})

test('gate request identities normalize generated IDs without changing recorded responses', async () => {
	const upstream = vi.fn(
		async () => new Response('aabbccdd-1111-2222-3333-aabbccddeeff'),
	)
	const body = (id: string, line: string) =>
		JSON.stringify({ text: `Proposal ${id}; : 中文 #${line}` })
	const first = 'aabbccdd-1111-2222-3333-aabbccddeeff'
	const second = 'aabbccdd-4444-5555-6666-aabbccddeeff'
	const record = createReplayFetch({
		mode: 'record',
		directory,
		normalizeIds: true,
		fetch: upstream,
	})
	await (
		await record(`${origin}${path}`, {
			method: 'POST',
			body: body(first, 'abcd'),
		})
	).text()
	const strict = createReplayFetch({
		mode: 'strict',
		directory,
		normalizeIds: true,
		fetch: upstream,
	})
	expect(
		await (
			await strict(`${origin}${path}`, {
				method: 'POST',
				body: body(second, 'ef01'),
			})
		).text(),
	).toBe(first)
	await expect(
		strict(`${origin}${path}`, {
			method: 'POST',
			body: JSON.stringify({ text: 'different content' }),
		}),
	).rejects.toThrow('Missing strict replay cassette:')
	expect(upstream).toHaveBeenCalledTimes(1)
})

test('fallback misses are silent when the primary cassette answers and final misses log once', async () => {
	const missingLog = join(directory, 'missing.txt')
	vi.stubEnv('NL_REPLAY_MISSING_LOG', missingLog)
	await (
		await createReplayFetch({
			mode: 'record',
			directory,
			fetch: async () => new Response('primary'),
		})(origin)
	).text()
	const replay = createReplayFetch({
		mode: 'strict',
		directory,
		fallbackDirectory: join(directory, 'empty'),
	})
	expect(await (await replay(origin)).text()).toBe('primary')
	expect(await readdir(directory)).not.toContain('missing.txt')
	await expect(replay(`${origin}/missing`)).rejects.toThrow(
		'Missing strict replay cassette:',
	)
	const diagnostics = (await readFile(missingLog, 'utf8')).trim().split('\n')
	expect(diagnostics).toHaveLength(1)
	expect(diagnostics[0]).not.toContain('/empty')
})

test('gate fallback reuses existing cassettes before recording and a missing fallback stays offline in strict mode', async () => {
	const upstream = vi.fn(async () => new Response('existing'))
	const record = createReplayFetch({
		mode: 'record',
		directory,
		fetch: upstream,
	})
	await (await record(origin)).text()
	const privateDirectory = join(directory, 'private')
	const reuse = createReplayFetch({
		mode: 'record',
		directory: privateDirectory,
		fallbackDirectory: directory,
		fetch: upstream,
	})
	expect(await (await reuse(origin)).text()).toBe('existing')
	expect(upstream).toHaveBeenCalledTimes(1)
	const strict = createReplayFetch({
		mode: 'strict',
		directory: privateDirectory,
		fallbackDirectory: directory,
		fetch: upstream,
	})
	await expect(strict(`${origin}/missing`)).rejects.toThrow(privateDirectory)
	expect(upstream).toHaveBeenCalledTimes(1)
})
let directory: string

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'novelive-replay-'))
})
afterEach(async () => {
	vi.unstubAllEnvs()
	await rm(directory, { recursive: true, force: true })
})

test('records only allowlisted headers and redacts relay and credential values, then replays canonical JSON', async () => {
	const fetch = vi.fn(
		async () =>
			new Response(
				JSON.stringify({ endpoint: origin, echoed: 'offline-credential' }),
				{
					status: 429,
					headers: {
						'content-type': 'application/json',
						'retry-after': '2',
						'set-cookie': 'private',
					},
				},
			),
	)
	const record = createReplayFetch({
		mode: 'record',
		directory,
		fetch,
		case: 'rate-limit',
		tags: ['offline'],
	})
	const response = await record(
		`${origin}${path}?token=offline-credential&z=1`,
		{
			method: 'POST',
			headers: { Authorization: 'Bearer offline-credential' },
			body: '{"b":2,"a":{"x":1,"y":2}}',
		},
	)
	expect(await response.json()).toMatchObject({ endpoint: origin })
	const stored = await readFile(join(directory, rowFile), 'utf8')
	expect(stored).not.toContain(origin)
	expect(stored).not.toContain('offline-credential')
	expect(stored).not.toContain('set-cookie')
	const row = JSON.parse(stored)
	expect(row).toMatchObject({
		method: 'POST',
		status: 429,
		reqHash: expect.stringMatching(/^[a-f0-9]{64}$/),
		key: expect.stringMatching(/^[a-f0-9]{16}$/),
		case: 'rate-limit',
		tags: ['offline'],
		headers: { 'content-type': 'application/json', 'retry-after': '2' },
	})
	const strict = createReplayFetch({ mode: 'strict', directory, fetch })
	const replayed = await strict(
		`https://elsewhere.example${path}?z=1&token=another-credential`,
		{
			method: 'POST',
			body: '{ "a": { "y": 2, "x": 1 }, "b": 2 }',
		},
	)
	expect(replayed.status).toBe(429)
	expect(await replayed.json()).toEqual({
		endpoint: 'https://relay.invalid',
		echoed: '[redacted]',
	})
	expect(fetch).toHaveBeenCalledTimes(1)
})

test('redacts escaped and percent-encoded relay origins in recorded JSON', async () => {
	const body =
		'{"escaped":"https:\\/\\/relay.example.test","unicode":"https\\u003a\\u002F/relay\\u002eexample.test","encoded":"https%3A%2F%2Frelay%2eexample.test"}'
	const fetch = vi.fn(
		async () =>
			new Response(body, {
				headers: { 'content-type': 'application/json' },
			}),
	)
	const record = createReplayFetch({ mode: 'record', directory, fetch })
	expect(await (await record(origin)).text()).toBe(body)
	const row = JSON.parse(await readFile(join(directory, rowFile), 'utf8'))
	const sanitized = Buffer.from(row.body.b64, 'base64').toString()
	expect(sanitized).not.toMatch(/relay(?:\.|%2e|\\u002e)example/i)
	expect(JSON.parse(sanitized)).toEqual({
		escaped: 'https://relay.invalid',
		unicode: 'https://relay.invalid',
		encoded: 'https://relay.invalid',
	})
})

test('replays image generation with an explicit default count without changing other counts', async () => {
	const fetch = vi.fn(async () => new Response('image'))
	const url = `${origin}/v1/images/generations`
	const record = createReplayFetch({ mode: 'record', directory, fetch })
	const strict = createReplayFetch({ mode: 'strict', directory, fetch })
	await (
		await record(url, { method: 'POST', body: '{"model":"fixture"}' })
	).text()
	expect(
		await (
			await strict(url, { method: 'POST', body: '{"model":"fixture","n":1}' })
		).text(),
	).toBe('image')
	await expect(
		strict(url, { method: 'POST', body: '{"model":"fixture","n":2}' }),
	).rejects.toThrow('Missing strict replay cassette')
	expect(fetch).toHaveBeenCalledTimes(1)
})

test('matches image-edit multipart requests across boundaries and externally stores raw large bodies', async () => {
	const body = Buffer.alloc(256 * 1024 + 1, 0xab)
	const fetch = vi.fn(
		async () =>
			new Response(new Uint8Array(body), {
				headers: { 'content-type': 'image/png' },
			}),
	)
	function imageForm() {
		const form = new FormData()
		form.append('model', 'fixture')
		form.append(
			'image',
			new Blob(['example'], { type: 'image/png' }),
			'image.png',
		)
		return form
	}
	const url = `${origin}/v1/images/edits`
	const record = createReplayFetch({ mode: 'record', directory, fetch })
	await (await record(url, { method: 'POST', body: imageForm() })).arrayBuffer()
	const row = JSON.parse(await readFile(join(directory, rowFile), 'utf8'))
	expect(row.body).toEqual({ sha: expect.stringMatching(/^[a-f0-9]{64}$/) })
	expect(await readdir(join(directory, 'cassette-files'))).toEqual([
		row.body.sha,
	])
	expect(
		await readFile(join(directory, 'cassette-files', row.body.sha)),
	).toEqual(body)
	const strict = createReplayFetch({ mode: 'strict', directory, fetch })
	expect(
		Buffer.from(
			await (
				await strict(url, { method: 'POST', body: imageForm() })
			).arrayBuffer(),
		),
	).toEqual(body)
	expect(fetch).toHaveBeenCalledTimes(1)
	const explicit = imageForm()
	explicit.append('n', '1')
	expect(
		Buffer.from(
			await (
				await strict(url, { method: 'POST', body: explicit })
			).arrayBuffer(),
		),
	).toEqual(body)
	explicit.set('n', '2')
	await expect(strict(url, { method: 'POST', body: explicit })).rejects.toThrow(
		'Missing strict replay cassette',
	)
	expect(fetch).toHaveBeenCalledTimes(1)
})

test('strict misses fail closed; replay misses and the unset mode use the injected fetch', async () => {
	vi.stubEnv('NL_REPLAY', '')
	try {
		const fetch = vi.fn(async () => new Response('upstream'))
		const strict = createReplayFetch({ mode: 'strict', directory, fetch })
		await expect(strict(origin)).rejects.toThrow(
			'Missing strict replay cassette',
		)
		expect(fetch).not.toHaveBeenCalled()
		const replay = createReplayFetch({ mode: 'replay', directory, fetch })
		expect(await (await replay(origin)).text()).toBe('upstream')
		expect(createReplayFetch({ fetch })).toBe(fetch)
	} finally {
		vi.unstubAllEnvs()
	}
})

test.each([
	['OpenAI Chat Completions', 'data: [DONE]\n\n'],
	['OpenAI Responses', 'event: response.completed\r\ndata: {}\r\n\r\n'],
	['Anthropic Messages', 'event: message_stop\ndata: {}\n\n'],
	['partial event', 'data: [DONE]\n'],
])(
	'records %s SSE on reader cancellation only after a complete terminal event',
	async (format, event) => {
		const cancel = vi.fn()
		const source = new ReadableStream<Uint8Array>({
			start(controller) {
				const encoder = new TextEncoder()
				controller.enqueue(encoder.encode(event.slice(0, 10)))
				controller.enqueue(encoder.encode(event.slice(10)))
			},
			cancel,
		})
		const fetch = vi.fn(
			async () =>
				new Response(source, {
					headers: { 'content-type': 'text/event-stream; charset=utf-8' },
				}),
		)
		const record = createReplayFetch({ mode: 'record', directory, fetch })
		const reader = (await record(origin)).body?.getReader()
		if (!reader) throw new Error('Expected a streaming recording')
		await reader.read()
		await reader.read()
		const pending = format === 'partial event' ? reader.read() : undefined
		await reader.cancel('consumer finished')
		if (pending) await expect(pending).resolves.toMatchObject({ done: true })
		expect(cancel).toHaveBeenCalledWith('consumer finished')
		const strict = createReplayFetch({ mode: 'strict', directory, fetch })
		if (format === 'partial event') {
			await expect(strict(origin)).rejects.toThrow(
				'Missing strict replay cassette',
			)
		} else {
			expect(await (await strict(origin)).text()).toBe(event)
			const rows = (await readFile(join(directory, rowFile), 'utf8'))
				.trim()
				.split('\n')
			expect(rows).toHaveLength(1)
		}
		expect(fetch).toHaveBeenCalledTimes(1)
	},
)

test('can skip a recorded HTTP failure in replay mode without changing strict replay', async () => {
	const url = origin + path
	const failed = createReplayFetch({
		mode: 'record',
		directory,
		fetch: async () => new Response('temporarily unavailable', { status: 500 }),
	})
	await (await failed(url)).text()
	const fetch = vi.fn<typeof globalThis.fetch>(
		async () => new Response('recovered'),
	)
	const record = createReplayFetch({ mode: 'record', directory, fetch })
	const replay = createReplayFetch({
		mode: 'replay',
		directory,
		fetch: record,
		ignoreRecordedFailures: true,
	})
	const strict = createReplayFetch({
		mode: 'strict',
		directory,
		ignoreRecordedFailures: true,
		fetch,
	})
	expect((await strict(url)).status).toBe(500)
	expect(fetch).not.toHaveBeenCalled()
	expect(await (await replay(url)).text()).toBe('recovered')
	expect(await (await replay(url)).text()).toBe('recovered')
	expect(fetch).toHaveBeenCalledOnce()
})

test('stream faults and abort during a delayed pull do not change the recording', async () => {
	const fetch = vi.fn(
		async () =>
			new Response(stream, {
				headers: { 'content-type': 'text/event-stream' },
			}),
	)
	const record = createReplayFetch({ mode: 'record', directory, fetch })
	expect(await (await record(origin)).text()).toBe(stream)
	const disk = await readFile(join(directory, rowFile), 'utf8')
	const replay = (
		fault?: 'midcut' | 'disconnect' | 'cancel' | 'http500' | 'bad-image',
		delayMs?: number,
	) => createReplayFetch({ mode: 'strict', directory, fetch, fault, delayMs })
	expect(await (await replay('midcut')(origin)).text()).toBe(
		stream.slice(0, Math.floor(stream.length / 2)),
	)
	expect((await replay('http500')(origin)).status).toBe(500)
	expect(await (await replay('bad-image')(origin)).text()).toBe(
		'invalid image data',
	)
	const disconnected = (await replay('disconnect')(origin)).body?.getReader()
	expect(await disconnected?.read()).toMatchObject({ done: false })
	await expect((await replay('disconnect')(origin)).text()).rejects.toThrow(
		'Replay connection dropped',
	)
	await expect((await replay('cancel')(origin)).text()).rejects.toMatchObject({
		name: 'AbortError',
	})
	const controller = new AbortController()
	const response = await replay(undefined, 1000)(origin, {
		signal: controller.signal,
	})
	const pending = response.text()
	controller.abort()
	await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
	expect(await readFile(join(directory, rowFile), 'utf8')).toBe(disk)
	expect(fetch).toHaveBeenCalledTimes(1)
})

test('bad-image keeps JSON metadata and corrupts only the encoded image payload', async () => {
	const envelope = {
		created: 1,
		data: [{ b64_json: 'iVBORw0KGgo=', revised_prompt: 'fixture' }],
	}
	const fetch = vi.fn(async () => Response.json(envelope))
	const record = createReplayFetch({ mode: 'record', directory, fetch })
	const url = `${origin}/v1/images/generations`
	expect(await (await record(url)).json()).toEqual(envelope)
	const strict = createReplayFetch({
		mode: 'strict',
		directory,
		fetch,
		fault: 'bad-image',
	})
	const response = await strict(url)
	expect(response.headers.get('content-type')).toBe('application/json')
	const replay = await response.json()
	expect(replay).toEqual({
		created: 1,
		data: [{ b64_json: expect.any(String), revised_prompt: 'fixture' }],
	})
	expect(Buffer.from(replay.data[0].b64_json, 'base64').toString()).toBe(
		'invalid image data',
	)
	expect(
		await (
			await createReplayFetch({ mode: 'strict', directory, fetch })(url)
		).json(),
	).toEqual(envelope)
	expect(fetch).toHaveBeenCalledTimes(1)
})
