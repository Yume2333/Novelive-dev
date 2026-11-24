import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { setImmediate } from 'node:timers/promises'
import { obj } from '@earendil-works/pi-schema'
import sharp from 'sharp'
import { afterEach, expect, test, vi } from 'vitest'
import { testTextConnection } from '../../packages/creator/src/models/text'
import {
	artJson,
	imageRenderer,
} from '../../packages/creator/src/pipeline/art/models'
import { createReplayFetch } from '../../packages/creator/src/replay'
import {
	chapterImageBudget,
	projectSpend,
	quoteSpend,
} from '../../packages/creator/src/usage/spend'
import { configuration } from '../fixtures/cassettes/m1b-gate/fixture'

afterEach(() => vi.unstubAllEnvs())

test('admits the recorded-size vision payload and exposes a settled 2× overshoot', async () => {
	vi.stubEnv('NL_RUN_TOKEN_CAP', '2000000')
	vi.stubEnv('NL_RUN_IMAGE_CAP', '50')
	vi.stubEnv('NL_RUN_TOKEN_SOFT_FRACTION', '0.8')
	const pixels = Buffer.alloc(1536 * 864 * 3)
	let seed = 42
	for (let i = 0; i < Math.floor(1536 * 864 * 0.64); i++) {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
		pixels[i * 3] = seed >>> 24
		pixels[i * 3 + 1] = seed >>> 16
	}
	const png = await sharp(pixels, {
		raw: { width: 1536, height: 864, channels: 3 },
	})
		.png()
		.toBuffer()
	const url = `data:image/png;base64,${png.toString('base64')}`
	expect(url.length).toBeGreaterThan(2_600_000)
	expect(url.length).toBeLessThan(2_800_000)
	const request = (image: boolean, maxTokens = 64000) =>
		new Request('https://example.invalid/v1/chat/completions', {
			method: 'POST',
			body: JSON.stringify({
				model: 'gemini-3.8-flash',
				max_tokens: maxTokens,
				messages: [
					{
						role: 'user',
						content: [
							{ type: 'text', text: 'Audit this image.' },
							...(image ? [{ type: 'image_url', image_url: { url } }] : []),
						],
					},
				],
			}),
		})
	const quote = await quoteSpend(request(true))
	expect(quote.tokens - (await quoteSpend(request(false))).tokens).toBe(53248)
	expect(quote.tokens).toBeLessThan(120_000)
	using database = new DatabaseSync(':memory:')
	const spend = projectSpend(database)
	await spend(request(false, 100_000), async () =>
		Response.json({ usage: { total_tokens: 161247 } }),
	)
	const settled = 2 * quote.tokens + 1
	const send = vi.fn(async () =>
		Response.json({ usage: { total_tokens: settled } }),
	)
	await spend(request(true), send)
	expect(send).toHaveBeenCalledOnce()
	expect(
		database
			.prepare(
				'SELECT tokens, actual_tokens FROM spend_reservation WHERE actual_tokens > 2 * tokens',
			)
			.all(),
	).toEqual([{ tokens: quote.tokens, actual_tokens: settled }])
})

test.each([
	['responses', { type: 'input_image' }],
	['messages', { type: 'image' }],
] as const)('quotes inline vision parts on /%s', async (route, part) => {
	const data = (
		await sharp({
			create: { width: 1025, height: 12, channels: 3, background: '#fff' },
		})
			.png()
			.toBuffer()
	).toString('base64')
	const build = (withImage: boolean) => {
		const image =
			part.type === 'input_image'
				? { ...part, image_url: `data:image/png;base64,${data}` }
				: { ...part, source: { type: 'base64', media_type: 'image/png', data } }
		const messages = [
			{ role: 'user', content: withImage ? [image, image] : [] },
		]
		return new Request(`https://example.invalid/v1/${route}`, {
			method: 'POST',
			body: JSON.stringify(
				route === 'responses'
					? { input: messages, max_output_tokens: 32 }
					: { messages, max_tokens: 32 },
			),
		})
	}
	expect(
		(await quoteSpend(build(true))).tokens -
			(await quoteSpend(build(false))).tokens,
	).toBe(2 * 53248)
})

test('retains the byte quote for text including large fields and non-input metadata', async () => {
	const text = '字'.repeat(16_385)
	const body = {
		model: 'fixture',
		max_tokens: 32,
		messages: [{ role: 'user', content: text }],
		metadata: { content: [{ type: 'image_url', image_url: 'text' }] },
	}
	const quote = await quoteSpend(
		new Request('https://example.invalid/v1/chat/completions', {
			method: 'POST',
			body: JSON.stringify(body),
		}),
	)
	expect(quote).toEqual({
		tokens:
			1024 +
			32 +
			Buffer.byteLength(text) +
			Buffer.byteLength(
				'modelfixturemax_tokens32messagesroleusercontentmetadatacontenttypeimage_urlimage_urltext',
			),
		images: 0,
	})
})

test.each([
	'https://example.invalid/image.png',
	'data:image/png;base64,broken',
])('rejects a vision input with unknown dimensions: %s', async (url) => {
	await expect(
		quoteSpend(
			new Request('https://example.invalid/v1/chat/completions', {
				method: 'POST',
				body: JSON.stringify({
					max_tokens: 32,
					messages: [
						{
							role: 'user',
							content: [{ type: 'image_url', image_url: { url } }],
						},
					],
				}),
			}),
		),
	).rejects.toThrow('无法核算此模型请求的预算')
})

test('overshoot factors change the reserved output but not dispatch or actual settlement', async () => {
	vi.stubEnv('NL_RUN_TOKEN_CAP', '10000')
	vi.stubEnv('NL_RUN_IMAGE_CAP', '0')
	const body = {
		model: 'devin-swe-2',
		messages: [],
		max_completion_tokens: 128,
	}
	const request = () =>
		new Request('https://example.invalid/v1/chat/completions', {
			method: 'POST',
			body: JSON.stringify(body),
		})
	const quoted = await quoteSpend(request())
	vi.stubEnv('NL_RUN_OUTPUT_OVERSHOOT_FACTORS', '{"devin-swe-2":1}')
	const single = await quoteSpend(request())
	expect(quoted.tokens - single.tokens).toBe(4 * 128)
	vi.stubEnv('NL_RUN_OUTPUT_OVERSHOOT_FACTORS', '{"devin-swe-2":7}')
	expect((await quoteSpend(request())).tokens - single.tokens).toBe(6 * 128)
	vi.stubEnv('NL_RUN_OUTPUT_OVERSHOOT_FACTORS', '{"other":2}')
	using database = new DatabaseSync(':memory:')
	const spend = projectSpend(database)
	const send = vi.fn(async (admitted: Request, quote: typeof quoted) => {
		expect(await admitted.json()).toEqual(body)
		expect(quote).toEqual(quoted)
		return Response.json({
			usage: { prompt_tokens: 10, completion_tokens: 509 },
		})
	})
	vi.stubEnv('NL_RUN_TOKEN_CAP', String(quoted.tokens - 1))
	await expect(spend(request(), send)).rejects.toThrow('超出工程预算')
	expect(send).not.toHaveBeenCalled()
	vi.stubEnv('NL_RUN_TOKEN_CAP', '10000')
	await spend(request(), send)
	expect(
		database
			.prepare('SELECT tokens, actual_tokens FROM spend_reservation')
			.get(),
	).toEqual({
		tokens: quoted.tokens,
		actual_tokens: 519,
	})
	vi.stubEnv('NL_RUN_OUTPUT_OVERSHOOT_FACTORS', '{"devin-swe-2":0}')
	await expect(spend(request(), send)).rejects.toThrow(
		'NL_RUN_OUTPUT_OVERSHOOT_FACTORS',
	)
	expect(send).toHaveBeenCalledTimes(1)
})

test('soft cutoff stops new requests at settled plus unresolved usage across guard instances', async () => {
	vi.stubEnv('NL_RUN_TOKEN_CAP', '30000')
	vi.stubEnv('NL_RUN_IMAGE_CAP', '10')
	const request = () =>
		new Request('https://example.invalid/v1/images/generations', {
			method: 'POST',
			body: '{}',
		})
	using database = new DatabaseSync(':memory:')
	const send = vi
		.fn()
		.mockImplementationOnce(async () =>
			Response.json({
				data: [{ b64_json: 'fixture' }],
				usage: { total_tokens: 10000 },
			}),
		)
		.mockImplementation(async () => new Response(null, { status: 500 }))
	await projectSpend(database)(request(), send)
	await projectSpend(database)(request(), send)
	await projectSpend(database)(request(), send)
	expect(
		database
			.prepare(
				'SELECT tokens, actual_tokens FROM spend_reservation ORDER BY id',
			)
			.all(),
	).toEqual([
		{ tokens: 7000, actual_tokens: 10000 },
		{ tokens: 7000, actual_tokens: null },
		{ tokens: 7000, actual_tokens: null },
	])
	const text = new Request('https://example.invalid/v1/chat/completions', {
		method: 'POST',
		body: JSON.stringify({ messages: [], max_tokens: 32 }),
	})
	await expect(projectSpend(database)(text, send)).rejects.toThrow(
		'软停止线 24000 tokens',
	)
	expect(send).toHaveBeenCalledTimes(3)
	vi.stubEnv('NL_RUN_TOKEN_SOFT_FRACTION', '1')
	await projectSpend(database)(text, send)
	vi.stubEnv('NL_RUN_TOKEN_SOFT_FRACTION', 'NaN')
	await expect(projectSpend(database)(request(), send)).rejects.toThrow(
		'NL_RUN_TOKEN_SOFT_FRACTION',
	)
	expect(send).toHaveBeenCalledTimes(4)
})

test('a new usage window preserves unresolved history without charging it to new admissions', async () => {
	vi.stubEnv('NL_RUN_TOKEN_CAP', '2000000')
	vi.stubEnv('NL_RUN_TOKEN_SOFT_FRACTION', '0.8')
	vi.stubEnv('NL_RUN_IMAGE_CAP', '50')
	vi.stubEnv('NL_USAGE_CSV', '/offline/new-window/usage.csv')
	using database = new DatabaseSync(':memory:')
	database.exec(`
		CREATE TABLE spend_reservation (
			id INTEGER PRIMARY KEY, tokens INTEGER NOT NULL, images INTEGER NOT NULL,
			actual_tokens INTEGER, actual_images INTEGER
		) STRICT;
		INSERT INTO spend_reservation VALUES (1, 1083614, 3, 1083614, 3), (2, 724974, 0, NULL, NULL);
		CREATE TABLE chapter (work_id TEXT, user_state TEXT);
		INSERT INTO chapter VALUES ('w', 'producing'), ('w', 'waiting'), ('w', 'waiting'), ('w', 'waiting'), ('other', 'waiting');
	`)
	expect(chapterImageBudget(database, 'w')).toBe(11)
	const request = () =>
		new Request('https://example.invalid/v1/images/generations', {
			method: 'POST',
			body: JSON.stringify({ n: 6 }),
		})
	const send = vi.fn(async () => new Response(null, { status: 500 }))
	await projectSpend(database)(request(), send)
	expect(chapterImageBudget(database, 'w')).toBe(9)
	database.exec(
		"UPDATE chapter SET user_state = 'published' WHERE work_id = 'w' AND user_state = 'producing'",
	)
	expect(chapterImageBudget(database, 'w')).toBe(13)
	vi.stubEnv('NL_RUN_IMAGE_CAP', '10')
	await expect(projectSpend(database)(request(), send)).rejects.toThrow(
		'超出工程预算',
	)
	vi.stubEnv('NL_USAGE_CSV', '/offline/another-window/usage.csv')
	await projectSpend(database)(request(), send)
	expect(send).toHaveBeenCalledTimes(2)
	expect(
		database
			.prepare(
				'SELECT * FROM spend_reservation WHERE run_id IS NULL ORDER BY id',
			)
			.all(),
	).toEqual([
		{
			id: 1,
			tokens: 1083614,
			images: 3,
			actual_tokens: 1083614,
			actual_images: 3,
			run_id: null,
		},
		{
			id: 2,
			tokens: 724974,
			images: 0,
			actual_tokens: null,
			actual_images: null,
			run_id: null,
		},
	])
})

test('continuing an existing CSV conservatively counts legacy reservations without claiming quote matches', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'novelive-spend-window-'))
	try {
		const csv = join(dir, 'usage.csv')
		await writeFile(
			csv,
			'2026-01-01,image,1,16000,1,reservation\n2026-01-01,image,1,0,0,cassette recording (reserved output tokens)\n2026-01-01,image,1,7000,1,reservation\n',
		)
		vi.stubEnv('NL_USAGE_CSV', csv)
		vi.stubEnv('NL_RUN_ID', 'continuing')
		vi.stubEnv('NL_RUN_TOKEN_CAP', '30000')
		vi.stubEnv('NL_RUN_TOKEN_SOFT_FRACTION', '0.8')
		vi.stubEnv('NL_RUN_IMAGE_CAP', '10')
		using database = new DatabaseSync(':memory:')
		database.exec(`
			CREATE TABLE spend_reservation (
				id INTEGER PRIMARY KEY, tokens INTEGER NOT NULL, images INTEGER NOT NULL,
				actual_tokens INTEGER, actual_images INTEGER
			) STRICT;
			INSERT INTO spend_reservation VALUES (1, 99000, 3, NULL, NULL),
				(2, 16000, 1, 11000, 1), (3, 7000, 1, NULL, NULL),
				(4, 16000, 1, 15000, 1), (5, 7000, 1, 6000, 1);
			CREATE TABLE chapter (work_id TEXT, user_state TEXT);
			INSERT INTO chapter VALUES ('w', 'producing');
		`)
		expect(chapterImageBudget(database, 'w')).toBe(0)
		const send = vi.fn()
		await expect(
			projectSpend(database)(
				new Request('https://example.invalid/v1/images/generations', {
					method: 'POST',
					body: '{}',
				}),
				send,
			),
		).rejects.toThrow('超出工程预算')
		expect(send).not.toHaveBeenCalled()
		expect(
			database
				.prepare(
					'SELECT run_id, actual_tokens FROM spend_reservation ORDER BY id',
				)
				.all(),
		).toEqual([
			{ run_id: null, actual_tokens: null },
			{ run_id: null, actual_tokens: 11000 },
			{ run_id: null, actual_tokens: null },
			{ run_id: null, actual_tokens: 15000 },
			{ run_id: null, actual_tokens: 6000 },
		])
		await writeFile(
			csv,
			'2026-01-01,image,1,0,0,cassette recording (reserved output tokens)\n',
		)
		vi.stubEnv('NL_RUN_ID', 'fresh')
		expect(chapterImageBudget(database, 'w')).toBe(5)
		await writeFile(csv, '2026-01-01,image,1,7000,1,reservation\n')
		expect(chapterImageBudget(database, 'w')).toBe(5)
		vi.stubEnv('NL_USAGE_CSV', '')
		expect(chapterImageBudget(database, 'w')).toBe(5)
		vi.stubEnv('NL_RUN_ID', 'explicit-without-csv')
		expect(chapterImageBudget(database, 'w')).toBe(0)
	} finally {
		await rm(dir, { recursive: true, force: true })
	}
})

test('a settled one-image Sunburst response frees two slots but unresolved calls keep all three', async () => {
	vi.stubEnv('NL_RUN_ID', 'staging')
	vi.stubEnv('NL_RUN_TOKEN_CAP', '200000')
	vi.stubEnv('NL_RUN_IMAGE_CAP', '50')
	vi.stubEnv('NL_RUN_IMAGE_TOKEN_RESERVE', '7000')
	using database = new DatabaseSync(':memory:')
	database.exec(
		"CREATE TABLE chapter (work_id TEXT, user_state TEXT); INSERT INTO chapter VALUES ('w', 'producing')",
	)
	const request = () =>
		new Request('https://example.invalid/v1/images/generations', {
			method: 'POST',
			body: JSON.stringify({ model: 'gpt-image-2.6-sunburst', n: 1 }),
		})
	const budget = () => chapterImageBudget(database, 'w')
	const spend = projectSpend(database)
	expect(budget()).toBe(45)
	await spend(request(), async () => {
		expect(budget()).toBe(42)
		return Response.json({
			data: [{ b64_json: 'fixture' }],
			usage: { total_tokens: 7000 },
		})
	})
	expect(budget()).toBe(44)
	await spend(request(), async () => new Response(null, { status: 503 }))
	expect(budget()).toBe(41)
})

test.each([true, false])(
	'concurrent Sunburst admission waits for a live quote to settle (usable: %s)',
	async (usable) => {
		vi.stubEnv('NL_RUN_TOKEN_CAP', '200000')
		vi.stubEnv('NL_RUN_IMAGE_CAP', '4')
		using database = new DatabaseSync(':memory:')
		const spend = projectSpend(database)
		const request = () =>
			new Request('https://example.invalid/v1/images/generations', {
				method: 'POST',
				body: JSON.stringify({ model: 'gpt-image-2.6-sunburst', n: 1 }),
			})
		const entered = Promise.withResolvers<void>()
		const finish = Promise.withResolvers<void>()
		const success = () =>
			Response.json({
				data: [{ b64_json: 'fixture' }],
				usage: { total_tokens: 7000 },
			})
		const first = spend(request(), async () => {
			entered.resolve()
			await finish.promise
			return usable ? success() : new Response(null, { status: 503 })
		})
		await entered.promise
		const send = vi.fn(async () => success())
		const second = spend(request(), send).then(
			(response) => ({ response }),
			(error: unknown) => ({ error }),
		)
		await setImmediate()
		expect(send).not.toHaveBeenCalled()
		finish.resolve()
		await first
		if (usable) {
			expect(await second).toEqual({ response: expect.any(Response) })
			expect(send).toHaveBeenCalledOnce()
		} else {
			expect(await second).toEqual({ error: expect.any(Error) })
			expect(send).not.toHaveBeenCalled()
		}
	},
)

test('concurrent dispatch stops before the next reservation would cross the soft cutoff', async () => {
	vi.stubEnv('NL_RUN_TOKEN_CAP', '2000000')
	vi.stubEnv('NL_RUN_IMAGE_CAP', '50')
	vi.stubEnv('NL_RUN_TOKEN_SOFT_FRACTION', '0.8')
	vi.stubEnv('NL_RUN_OUTPUT_OVERSHOOT_FACTORS', '{}')
	const request = () =>
		new Request('https://example.invalid/v1/chat/completions', {
			method: 'POST',
			body: JSON.stringify({
				model: 'devin-swe-2',
				max_tokens: 48000,
				messages: [{ role: 'user', content: 'Rewrite a short image brief.' }],
			}),
		})
	using database = new DatabaseSync(':memory:')
	await projectSpend(database)(request(), async () =>
		Response.json({ usage: { total_tokens: 1083614 } }),
	)
	const send = vi.fn(async () => new Response(null, { status: 500 }))
	const outcomes = await Promise.allSettled(
		Array.from({ length: 3 }, () => projectSpend(database)(request(), send)),
	)
	expect(send).toHaveBeenCalledTimes(2)
	expect(outcomes.filter(({ status }) => status === 'rejected')).toEqual([
		{
			status: 'rejected',
			reason: expect.objectContaining({
				message: expect.stringContaining('软停止线 1600000 tokens'),
			}),
		},
	])
	expect(
		database
			.prepare(
				'SELECT COUNT(*) AS rows, SUM(COALESCE(actual_tokens, tokens)) AS exposure FROM spend_reservation',
			)
			.get(),
	).toEqual({
		rows: 3,
		exposure: 1083614 + 2 * (await quoteSpend(request())).tokens,
	})
})

test('Responses recording logs the full SQLite reservation before dispatch', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'novelive-spend-'))
	try {
		const usage = join(directory, 'usage.csv')
		vi.stubEnv('NL_USAGE_CSV', usage)
		vi.stubEnv('NL_RUN_TOKEN_CAP', '2000')
		vi.stubEnv('NL_RUN_IMAGE_CAP', '0')
		using database = new DatabaseSync(':memory:')
		const fetch = vi.fn(async () => {
			const row = database
				.prepare('SELECT tokens, images FROM spend_reservation')
				.get()
			expect(row?.tokens).toBeGreaterThan(512)
			expect(await readFile(usage, 'utf8')).toContain(
				`,fixture-responses,1,${row?.tokens},${row?.images},cassette recording (reserved tokens and images)\n`,
			)
			return Response.json({ usage: { input_tokens: 11, output_tokens: 19 } })
		})
		const dispatch = createReplayFetch({
			mode: 'record',
			directory,
			fetch,
			spend: projectSpend(database),
		})
		await (
			await dispatch('https://example.invalid/v1/responses', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					model: 'fixture-responses',
					max_output_tokens: 512,
					input: 'Hello',
				}),
			})
		).text()
		expect(fetch).toHaveBeenCalledOnce()
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})

test('each dispatch reserves again, failed attempts stay reserved, and terminal usage settles', async () => {
	vi.stubEnv('NL_REPLAY', '')
	vi.stubEnv('NL_RUN_TOKEN_CAP', '2000')
	vi.stubEnv('NL_RUN_IMAGE_CAP', '0')
	using database = new DatabaseSync(':memory:')
	const send = vi
		.fn<typeof globalThis.fetch>()
		.mockResolvedValueOnce(
			new Response('data: {"usage":{"total_tokens":50}}\n\ndata: [DONE]\n\n', {
				headers: { 'content-type': 'text/event-stream' },
			}),
		)
		.mockRejectedValueOnce(new Error('disconnected after dispatch'))
	const dispatch = () =>
		createReplayFetch({ fetch: send, spend: projectSpend(database) })(
			'https://example.invalid/v1/chat/completions',
			{
				method: 'POST',
				body: JSON.stringify({
					max_tokens: 300,
					messages: [
						{ role: 'user', content: 'Same request on each attempt.' },
					],
				}),
			},
		)
	await (await dispatch()).text()
	await expect(dispatch()).rejects.toThrow('disconnected after dispatch')
	await expect(dispatch()).rejects.toThrow('超出工程预算')
	expect(send).toHaveBeenCalledTimes(2)
	expect(
		database
			.prepare('SELECT actual_tokens FROM spend_reservation ORDER BY id')
			.all(),
	).toEqual([{ actual_tokens: 50 }, { actual_tokens: null }])
})

test.each([
	{ fault: 'no headers', status: undefined, reason: 'request timeout' },
	{ fault: 'upstream error', status: 503, reason: 'provider did not return' },
	{ fault: 'watchdog', status: 200, reason: 'stream idle timeout' },
	{
		fault: 'cut after usage',
		status: 200,
		reason: 'connection or stream interrupted',
		tokens: 27,
	},
	{
		fault: 'missing usage',
		status: 200,
		reason: 'successful response did not report billable usage',
	},
	{ fault: 'complete', status: 200, tokens: 27 },
])(
	'guarded recording does not redispatch after $fault',
	async ({ fault, status, reason, tokens }) => {
		vi.stubEnv('NL_RUN_TOKEN_CAP', '10000')
		vi.stubEnv('NL_RUN_IMAGE_CAP', '0')
		vi.stubEnv('NL_USAGE_CSV', '')
		const directory = await mkdtemp(join(tmpdir(), 'novelive-spend-'))
		try {
			using database = new DatabaseSync(':memory:')
			const frame = (data: unknown) =>
				new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)
			const usage = {
				prompt_tokens: 20,
				completion_tokens: 7,
				total_tokens: 27,
			}
			const send = vi.fn<typeof globalThis.fetch>(async (input, init) => {
				if (fault === 'no headers') throw new Error('Request timed out')
				if (fault === 'upstream error') return Response.json({}, { status })
				const { signal } = new Request(input, init)
				let first = true
				return new Response(
					new ReadableStream<Uint8Array>(
						{
							pull(controller) {
								if (!first) {
									if (fault === 'cut after usage')
										controller.error(new TypeError('Connection terminated'))
									return
								}
								first = false
								if (fault === 'watchdog') {
									controller.enqueue(
										frame({
											choices: [{ delta: { reasoning_content: 'thinking' } }],
										}),
									)
									return new Promise<void>((resolve) => {
										signal.addEventListener(
											'abort',
											() => {
												controller.error(signal.reason)
												resolve()
											},
											{ once: true },
										)
									})
								}
								if (fault === 'cut after usage') {
									controller.enqueue(frame({ choices: [], usage }))
									return
								}
								controller.enqueue(
									frame({
										choices: [
											{ delta: { content: 'OK' }, finish_reason: 'stop' },
										],
										...(tokens && { usage }),
									}),
								)
								controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
								controller.close()
							},
						},
						{ highWaterMark: 0 },
					),
					{ headers: { 'content-type': 'text/event-stream' } },
				)
			})
			const fetch = createReplayFetch({
				mode: 'record',
				directory,
				fetch: send,
				spend: projectSpend(database),
			})
			const result = testTextConnection(
				{ ...configuration.models.main, model: 'devin-swe-2' },
				{
					fetch,
					stopOnUnknownOutcome: true,
					...(fault === 'watchdog' && { idleMs: 25 }),
				},
			)
			if (reason) {
				await expect(result).rejects.toMatchObject({
					code: 'internal',
					message: expect.stringContaining(
						`not retried automatically (${status === undefined ? 'no HTTP status' : `HTTP ${status}`}: ${reason}`,
					),
				})
			} else {
				await expect(result).resolves.toMatchObject({
					usage: { totalTokens: 27 },
				})
			}
			expect(send).toHaveBeenCalledOnce()
			expect(
				database.prepare('SELECT actual_tokens FROM spend_reservation').all(),
			).toEqual([{ actual_tokens: tokens ?? null }])
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	},
)

test.each([false, true])(
	'the image timeout starts at dispatch, not while waiting for budget (times out: %s)',
	async (timesOut) => {
		vi.stubEnv('NL_REPLAY', '')
		vi.stubEnv('NL_RUN_TOKEN_CAP', '200000')
		vi.stubEnv('NL_RUN_IMAGE_CAP', '4')
		using database = new DatabaseSync(':memory:')
		const admit = projectSpend(database)
		const request = () =>
			new Request('https://example.invalid/v1/images/generations', {
				method: 'POST',
				body: JSON.stringify({ model: 'gpt-image-2.6-sunburst', n: 1 }),
			})
		const reply = () =>
			Response.json({
				data: [{ b64_json: Buffer.from('fixture').toString('base64') }],
				usage: { total_tokens: 7000 },
			})
		const held = Promise.withResolvers<void>()
		const release = Promise.withResolvers<void>()
		const first = admit(request(), async () => {
			held.resolve()
			await release.promise
			return reply()
		})
		await held.promise
		const admitted = Promise.withResolvers<void>()
		const dispatched = Promise.withResolvers<void>()
		const send = vi.fn(async (input: RequestInfo | URL) => {
			dispatched.resolve()
			if (!timesOut) return reply()
			const { signal } = input as Request
			return new Promise<Response>((_, reject) => {
				signal.addEventListener('abort', () => reject(signal.reason), {
					once: true,
				})
			})
		})
		const render = imageRenderer(
			{
				...configuration.models.image,
				model: 'gpt-image-2.6-sunburst',
				upscaleTier: 'anime',
			},
			{
				replay: {
					fetch: send,
					spend: (request, fetch) => {
						admitted.resolve()
						return admit(request, fetch)
					},
				},
			},
		)
		vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
		const deadline = vi
			.spyOn(AbortSignal, 'timeout')
			.mockImplementation((ms) => {
				const controller = new AbortController()
				setTimeout(
					() => controller.abort(new DOMException('Timed out', 'TimeoutError')),
					ms,
				)
				return controller.signal
			})
		try {
			const result = render('fixture', [], { width: 1024, height: 1024 }, false)
			await admitted.promise
			await setImmediate()
			await vi.advanceTimersByTimeAsync(90_001)
			expect(send).not.toHaveBeenCalled()
			expect(deadline).not.toHaveBeenCalled()
			release.resolve()
			await first
			await dispatched.promise
			expect(deadline).toHaveBeenCalledExactlyOnceWith(90_000)
			await vi.advanceTimersByTimeAsync(90_000)
			expect(await result).toEqual(
				timesOut
					? {
							error: expect.objectContaining({ code: 'network' }),
							doNotRegenerate: true,
						}
					: { bytes: Buffer.from('fixture') },
			)
			expect(
				database
					.prepare('SELECT actual_images FROM spend_reservation ORDER BY id')
					.all(),
			).toEqual([{ actual_images: 1 }, { actual_images: timesOut ? null : 1 }])
		} finally {
			release.resolve()
			deadline.mockRestore()
			vi.useRealTimers()
		}
	},
)

test('exhausted image and token caps block image edits, generation, and visual review', async () => {
	vi.stubEnv('NL_REPLAY', '')
	vi.stubEnv('NL_RUN_TOKEN_CAP', '0')
	vi.stubEnv('NL_RUN_IMAGE_CAP', '0')
	using database = new DatabaseSync(':memory:')
	const fetch = vi
		.fn<typeof globalThis.fetch>()
		.mockRejectedValue(new Error('The provider must not be called'))
	const replay = { fetch, spend: projectSpend(database) }
	const image = imageRenderer(
		{
			...configuration.models.image,
			baseUrl: 'https://api.openai.com/v1',
			apiKey: 'fixture',
			model: 'gpt-image-1',
			upscaleTier: 'anime',
		},
		{ replay },
	)
	const size = { width: 1024, height: 1024 }
	await expect(image('first', [], size, false)).rejects.toThrow('超出工程预算')
	await expect(
		image('edit', [Buffer.from('fixture')], size, false),
	).rejects.toThrow('超出工程预算')
	const review = await sharp({
		create: { width: 32, height: 32, channels: 3, background: '#fff' },
	})
		.png()
		.toBuffer()
	await expect(
		artJson(configuration.models.visual, 'review', obj({}), { replay }, [
			review,
		]),
	).rejects.toThrow('超出工程预算')
	expect(fetch).not.toHaveBeenCalled()
})

test.each(['generations', 'edits'])(
	'Sunburst %s reserve for three outputs per requested image',
	async (route) => {
		vi.stubEnv('NL_RUN_TOKEN_CAP', '200000')
		vi.stubEnv('NL_RUN_IMAGE_CAP', '2')
		vi.stubEnv('NL_RUN_IMAGE_TOKEN_RESERVE', '7000')
		const request = () => {
			const body = new FormData()
			body.set('model', 'gpt-image-2.6-sunburst')
			body.set('n', '1')
			body.append('image[]', new Blob(['first']), 'first.png')
			body.append('image[]', new Blob(['second']), 'second.png')
			return new Request(`https://example.invalid/v1/images/${route}`, {
				method: 'POST',
				body:
					route === 'edits'
						? body
						: JSON.stringify({ n: 1, model: 'gpt-image-2.6-sunburst' }),
			})
		}
		using database = new DatabaseSync(':memory:')
		const send = vi.fn(async () =>
			Response.json({
				data: Array.from({ length: 3 }, () => ({ b64_json: 'fixture' })),
				usage: { total_tokens: 30_509 },
			}),
		)
		await expect(projectSpend(database)(request(), send)).rejects.toThrow(
			'超出工程预算',
		)
		expect(send).not.toHaveBeenCalled()
		vi.stubEnv('NL_RUN_IMAGE_CAP', '3')
		await projectSpend(database)(request(), send)
		expect(send).toHaveBeenCalledOnce()
		expect(
			database
				.prepare(
					'SELECT tokens, images, actual_tokens, actual_images FROM spend_reservation',
				)
				.all(),
		).toEqual([
			{ tokens: 31_000, images: 3, actual_tokens: 30_509, actual_images: 3 },
		])
		vi.stubEnv('NL_RUN_IMAGE_TOKEN_RESERVE', '12000')
		expect(await quoteSpend(request())).toEqual({ tokens: 36_000, images: 3 })
	},
)

test('image reservations settle the returned image count and any measured token usage', async () => {
	vi.stubEnv('NL_REPLAY', '')
	vi.stubEnv('NL_RUN_TOKEN_CAP', '200000')
	vi.stubEnv('NL_RUN_IMAGE_CAP', '2')
	using database = new DatabaseSync(':memory:')
	const send = vi.fn<typeof globalThis.fetch>().mockImplementation(async () =>
		Response.json({
			data: [{ b64_json: 'fixture' }],
			usage: { input_tokens: 10, output_tokens: 20 },
		}),
	)
	const dispatch = (n: number) =>
		createReplayFetch({ fetch: send, spend: projectSpend(database) })(
			'https://example.invalid/v1/images/generations',
			{ method: 'POST', body: JSON.stringify({ n }) },
		)
	await dispatch(2)
	await dispatch(1)
	await expect(dispatch(1)).rejects.toThrow('超出工程预算')
	expect(send).toHaveBeenCalledTimes(2)
	expect(
		database
			.prepare('SELECT actual_tokens, actual_images FROM spend_reservation')
			.all(),
	).toEqual([
		{ actual_tokens: 30, actual_images: 1 },
		{ actual_tokens: 30, actual_images: 1 },
	])
})

test.each(['response.completed', 'response.incomplete'])(
	'quotes Responses requests and settles from terminal %s usage without a DONE marker',
	async (type) => {
		vi.stubEnv('NL_REPLAY', '')
		vi.stubEnv('NL_RUN_TOKEN_CAP', '2500')
		vi.stubEnv('NL_RUN_IMAGE_CAP', '0')
		using database = new DatabaseSync(':memory:')
		const send = vi
			.fn<typeof globalThis.fetch>()
			.mockImplementation(
				async () =>
					new Response(
						`data: ${JSON.stringify({ type, response: { usage: { input_tokens: 11, output_tokens: 19 } } })}\n\n`,
						{ headers: { 'content-type': 'text/event-stream' } },
					),
			)
		const dispatch = createReplayFetch({
			fetch: send,
			spend: projectSpend(database),
		})
		const request = (max_output_tokens: number) =>
			dispatch('https://example.invalid/v1/responses', {
				method: 'POST',
				body: JSON.stringify({
					max_output_tokens,
					input: [
						{ role: 'user', content: [{ type: 'input_text', text: 'Hello' }] },
					],
				}),
			})
		await expect(request(2000)).rejects.toThrow('超出工程预算')
		expect(send).not.toHaveBeenCalled()
		for (let i = 0; i < 2; i++) await (await request(500)).text()
		expect(send).toHaveBeenCalledTimes(2)
		expect(
			database.prepare('SELECT actual_tokens FROM spend_reservation').all(),
		).toEqual([{ actual_tokens: 30 }, { actual_tokens: 30 }])
	},
)
