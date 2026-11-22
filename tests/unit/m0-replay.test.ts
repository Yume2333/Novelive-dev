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
let directory: string

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'novelive-replay-'))
})
afterEach(async () => {
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
