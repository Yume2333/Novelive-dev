import { Agent } from '@earendil-works/pi-agent-core'
import { registerFauxProvider } from '@earendil-works/pi-ai/compat'
import {
	fauxAssistantMessage,
	fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import { obj } from '@earendil-works/pi-schema'
import { describe, expect, it, vi } from 'vitest'
import {
	buildTextModel,
	createTextStream,
	suggestContextWindow,
	testTextConnection,
} from '../../packages/creator/src/models/text/index.js'
import { createReplayFetch } from '../../packages/creator/src/replay/index.js'
import {
	smokeConnection,
	smokeProfiles,
} from '../fixtures/text-models/smoke-config.js'

const baseUrl = 'https://relay.invalid'
const directory =
	process.env.NL_CASSETTE_DIR ?? 'tests/fixtures/text-models/synthetic'
const [chat] = smokeProfiles
const configured = smokeConnection(chat, baseUrl, 'offline-placeholder')
const format = (options: Parameters<typeof createReplayFetch>[0] = {}) =>
	createReplayFetch({
		mode: 'strict',
		directory,
		fetch: async () => {
			throw new Error('Network must not run')
		},
		...options,
	})

describe('M0 text model adapter', () => {
	it.each(smokeProfiles)(
		'runs the $format SDK against strict replay',
		async (profile) => {
			const underlying = format()
			const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
				if (profile.image) {
					const request = new Request(input, init)
					const payload = await request.clone().json()
					expect(payload.messages[0].content).toContainEqual({
						type: 'image_url',
						image_url: { url: `data:image/png;base64,${profile.image.data}` },
					})
					return underlying(request)
				}
				return underlying(input, init)
			})
			await expect(
				testTextConnection(
					smokeConnection(profile, baseUrl, 'offline-placeholder'),
					{
						image: profile.image,
						fetch,
					},
				),
			).resolves.toMatchObject({ usage: { totalTokens: 13 } })
			expect(fetch).toHaveBeenCalledTimes(1)
		},
	)

	it('suggests catalog context without overriding manual context or disabling unknown models', () => {
		const options = {
			...configured,
			compat: 'openai' as const,
			model: 'gpt-4o',
			contextWindow: null,
		}
		expect(suggestContextWindow(options)).toBeGreaterThan(4096)
		expect(buildTextModel(options)).toMatchObject({
			provider: 'openai',
			baseUrl: 'https://relay.invalid/v1',
			contextWindow: suggestContextWindow(options),
		})
		expect(
			buildTextModel({ ...options, contextWindow: 8192 }).contextWindow,
		).toBe(8192)
		expect(
			suggestContextWindow({ ...options, model: 'fixture-private' }),
		).toBeNull()
		expect(() =>
			buildTextModel({ ...options, model: 'fixture-private' }),
		).toThrow(/4096/)
		expect(() => buildTextModel({ ...options, contextWindow: 4095 })).toThrow(
			/4096/,
		)
		expect(() =>
			buildTextModel({ ...options, baseUrl: 'file:///tmp/key' }),
		).toThrow(/endpoint/)
		expect(buildTextModel({ ...options, compat: 'qwen' }).compat).toMatchObject(
			{ maxTokensField: 'max_tokens' },
		)
	})

	it.each([
		['auth', 'auth'],
		['missing', 'not_found'],
		['moderation', 'moderation'],
	])('maps %s without retry', async (fixture, code) => {
		const fetch = vi.fn(format())
		await expect(
			testTextConnection(
				{ ...configured, model: `fixture-${fixture}` },
				{ fetch, image: chat.image },
			),
		).rejects.toMatchObject({ code })
		expect(fetch).toHaveBeenCalledTimes(1)
	})

	it.each([
		['header-retry', 3],
		['temporary', 2],
		['empty', 2],
	])('recovers the %s sequence', async (fixture, calls) => {
		const fetch = vi.fn(format())
		await expect(
			testTextConnection(
				{ ...configured, model: `fixture-${fixture}` },
				{ fetch, image: chat.image },
			),
		).resolves.toMatchObject({ usage: { totalTokens: 13 } })
		expect(fetch).toHaveBeenCalledTimes(calls)
	})

	it.each(['midcut', 'disconnect'] as const)(
		'restarts a stream once after %s',
		async (fault) => {
			const fetch = vi.fn(format()).mockImplementationOnce(format({ fault }))
			await expect(
				testTextConnection(configured, { fetch, image: chat.image }),
			).resolves.toMatchObject({ usage: { totalTokens: 13 } })
			expect(fetch).toHaveBeenCalledTimes(2)
		},
	)

	it('reports exhausted disconnects as network errors after two retries', async () => {
		const fetch = vi.fn(format({ fault: 'disconnect' }))
		await expect(
			testTextConnection(configured, { fetch, image: chat.image }),
		).rejects.toMatchObject({ code: 'network' })
		expect(fetch).toHaveBeenCalledTimes(3)
	})

	it('attributes idle aborts to the watchdog and retries twice', async () => {
		const fetch = vi.fn(format({ delayMs: 100 }))
		await expect(
			testTextConnection(configured, { fetch, image: chat.image, idleMs: 5 }),
		).rejects.toMatchObject({
			code: 'network',
			message: expect.stringContaining('watchdog'),
		})
		expect(fetch).toHaveBeenCalledTimes(3)
	})

	it('does not send an already-cancelled request', async () => {
		const fetch = vi.fn(format())
		await expect(
			testTextConnection(configured, {
				fetch,
				signal: AbortSignal.abort(),
				image: chat.image,
			}),
		).rejects.toMatchObject({ code: 'cancelled' })
		expect(fetch).not.toHaveBeenCalled()
	})

	it('does not retry user cancellation during a slow stream', async () => {
		const controller = new AbortController()
		const replay = format({ delayMs: 100 })
		const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
			const response = await replay(input, init)
			setTimeout(() => controller.abort(), 5)
			return response
		})
		await expect(
			testTextConnection(configured, {
				fetch,
				signal: controller.signal,
				image: chat.image,
			}),
		).rejects.toMatchObject({ code: 'cancelled' })
		expect(fetch).toHaveBeenCalledTimes(1)
	})

	it('cancels during a real pi agent tool loop without another provider turn', async () => {
		const provider = registerFauxProvider({
			api: 'm0-text-faux',
			provider: 'm0-text-faux',
		})
		const entered = Promise.withResolvers<void>()
		const cancelled = vi.fn()
		try {
			provider.setResponses([
				fauxAssistantMessage(fauxToolCall('wait', {}), {
					stopReason: 'toolUse',
				}),
			])
			const agent = new Agent({
				streamFn: createTextStream(),
				initialState: {
					model: provider.getModel(),
					tools: [
						{
							name: 'wait',
							label: 'Wait',
							description: 'Wait inside the tool loop',
							parameters: obj({}),
							async execute(_id, _args, signal) {
								entered.resolve()
								await new Promise<void>((resolve) =>
									signal?.addEventListener(
										'abort',
										() => {
											cancelled()
											resolve()
										},
										{ once: true },
									),
								)
								signal?.throwIfAborted()
								return { content: [], details: undefined }
							},
						},
					],
				},
			})
			const done = agent.prompt('Call the wait tool')
			expect(
				await Promise.race([
					entered.promise.then(() => true),
					done.then(() => false),
				]),
			).toBe(true)
			agent.abort()
			await done
			expect(cancelled).toHaveBeenCalledOnce()
			expect(provider.state.callCount).toBe(1)
		} finally {
			provider.unregister()
		}
	})
})
