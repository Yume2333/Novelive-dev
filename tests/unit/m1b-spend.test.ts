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
import { projectSpend } from '../../packages/creator/src/usage/spend'
import { configuration } from '../fixtures/cassettes/m1b-gate/fixture'

afterEach(() => vi.unstubAllEnvs())

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
