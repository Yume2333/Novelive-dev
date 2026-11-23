import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { obj } from '@earendil-works/pi-schema'
import { afterEach, expect, test, vi } from 'vitest'
import {
	artJson,
	imageRenderer,
} from '../../packages/creator/src/pipeline/art/models'
import { createReplayFetch } from '../../packages/creator/src/replay'
import {
	projectSpend,
	quoteSpend,
} from '../../packages/creator/src/usage/spend'
import { configuration } from '../fixtures/cassettes/m1b-gate/fixture'

afterEach(() => vi.unstubAllEnvs())

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
	await expect(
		artJson(configuration.models.visual, 'review', obj({}), { replay }, [
			Buffer.from('fixture'),
		]),
	).rejects.toThrow('超出工程预算')
	expect(fetch).not.toHaveBeenCalled()
})

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
		vi.stubEnv('NL_RUN_TOKEN_CAP', '2000')
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
