import { Agent } from '@earendil-works/pi-agent-core'
import { registerFauxProvider } from '@earendil-works/pi-ai/compat'
import {
	fauxAssistantMessage,
	fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import { obj } from '@earendil-works/pi-schema'
import { describe, expect, it, vi } from 'vitest'
import {
	buildTextModel,
	createTextStream,
	outputTokenBudget,
	parseModelJson,
	suggestContextWindow,
	testTextConnection,
	textResultError,
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
	it.each([
		'{"ok":true}',
		'```json\n{"ok":true}\n```',
		'```json{"ok":true}```',
		'```{"ok":true}```',
		'Before\n```JSON {"ok":true}\n```\nAfter\n```json\n{"ok":false}\n```',
		'Unexpected preamble\n```json\n{"ok":true}\n```',
		'```text\nIgnore this block.\n```\n```\n{"ok":true}\n```\n```json\n{"ok":false}\n```',
	])('decodes bare or fenced JSON: %s', (text) => {
		expect(parseModelJson(text)).toEqual({ ok: true })
	})

	it.each([
		'Unexpected preamble\n{"ok":true}',
		'```json\nInvalid JSON\n```\n```json\n{"ok":true}\n```',
	])(
		'rejects invalid JSON rather than looking for another object: %s',
		(text) => {
			expect(() => parseModelJson(text)).toThrow(SyntaxError)
		},
	)

	it('uses catalog output limits and bounds private-model slots by their configured cap', () => {
		const gemini = buildTextModel(configured)
		expect(gemini.maxTokens).toBe(64_000)
		expect(outputTokenBudget(gemini)).toBe(gemini.maxTokens)
		const privateModel = {
			...configured,
			model: 'devin-swe-2',
			contextWindow: 32_768,
		}
		expect(outputTokenBudget(buildTextModel(privateModel))).toBe(16_384)
		expect(
			outputTokenBudget(
				buildTextModel({ ...privateModel, maxOutputTokens: 12_000 }),
			),
		).toBe(12_000)
	})

	it.each([
		['length', false, 1_000_000],
		['stop', false, 1_000_000],
		['length', true, 4096],
	] as const)(
		'retries a reasoning-only %s once (answer on retry: %s, context: %d)',
		async (finish, succeeds, contextWindow) => {
			const model = buildTextModel({
				...configured,
				model: 'devin-swe-2',
				contextWindow,
				maxOutputTokens: 16_000,
			})
			const budgets: number[] = []
			const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
				const body = await new Request(input, init).json()
				budgets.push(body.max_completion_tokens)
				const answer = succeeds && budgets.length === 2
				const chunks = [
					{
						choices: [
							{
								index: 0,
								delta: answer
									? { content: 'OK' }
									: { reasoning_content: 'Thinking' },
							},
						],
					},
					{
						choices: [
							{ index: 0, delta: {}, finish_reason: answer ? 'stop' : finish },
						],
					},
					{
						choices: [],
						usage: {
							prompt_tokens: budgets.length === 1 ? 7 : 11,
							completion_tokens: budgets.length === 1 ? 5 : 3,
							completion_tokens_details: {
								reasoning_tokens: answer ? 0 : budgets.length === 1 ? 5 : 3,
							},
						},
					},
				]
				return new Response(
					`${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`,
					{ headers: { 'content-type': 'text/event-stream' } },
				)
			})
			const events: string[] = []
			const stream = createTextStream({ fetch, streaming: true })(
				model,
				normalizeContext({
					messages: [{ role: 'user', content: 'Reply OK', timestamp: 0 }],
				}),
				{ apiKey: 'offline-placeholder' },
			)
			for await (const event of stream) events.push(event.type)
			const result = await stream.result()
			expect(budgets).toEqual(
				contextWindow === 4096 ? [1536, 2048] : [12_000, 16_000],
			)
			expect(events).not.toContain('thinking_delta')
			expect(result.usage).toMatchObject({
				input: 18,
				output: 8,
				totalTokens: 26,
				reasoning: succeeds ? 5 : 8,
			})
			if (succeeds) {
				expect(events).toContain('text_delta')
				expect(result).toMatchObject({
					stopReason: 'stop',
					content: [{ type: 'text', text: 'OK' }],
				})
			} else {
				expect(events).toEqual(['error'])
				expect(textResultError(result, 'Model error').code).toBe(
					'reasoning_limit',
				)
			}
		},
	)

	it.each([true, false])(
		'counts empty and reasoning retries together (answer on final attempt: %s)',
		async (succeeds) => {
			const model = buildTextModel({
				...configured,
				model: 'devin-swe-2',
				contextWindow: 4096,
			})
			const attempts: number[] = []
			const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
				const request = await new Request(input, init).json()
				const attempt = attempts.push(request.max_completion_tokens)
				const delta =
					attempt === 2
						? { reasoning_content: 'Thinking' }
						: attempt === 4 && succeeds
							? { content: 'OK' }
							: {}
				const chunks = [
					{ choices: [{ index: 0, delta, finish_reason: 'stop' }] },
					{
						choices: [],
						usage: {
							prompt_tokens: 10,
							completion_tokens: attempt,
							completion_tokens_details: {
								reasoning_tokens: attempt === 2 ? 2 : 0,
							},
						},
					},
				]
				return new Response(
					`${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`,
					{ headers: { 'content-type': 'text/event-stream' } },
				)
			})
			const result = await createTextStream({ fetch })(
				model,
				normalizeContext({
					messages: [{ role: 'user', content: 'Reply OK', timestamp: 0 }],
				}),
				{ apiKey: 'offline-placeholder' },
			).result()
			expect(attempts).toEqual([1536, 1536, 2048, 2048])
			expect(result.stopReason).toBe(succeeds ? 'stop' : 'error')
			expect(result.usage).toMatchObject({
				input: 40,
				output: 10,
				totalTokens: 50,
				reasoning: 2,
			})
		},
	)

	it.each(smokeProfiles)(
		'runs the $format SDK against strict replay',
		async (profile) => {
			const underlying = format()
			const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
				if (profile.image) {
					const request = new Request(input, init)
					const payload = await request.clone().json()
					expect(payload.messages[0].content).toContainEqual({
						type: 'text',
						text: 'Briefly describe the attached image in one short sentence.',
					})
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

	it.each(['gpt-5', 'o3', 'o4-mini'])(
		'omits unsupported Responses reasoning effort for %s',
		async (model) => {
			const message = {
				id: 'msg_fixture',
				type: 'message',
				role: 'assistant',
				status: 'completed',
				content: [{ type: 'output_text', text: 'OK', annotations: [] }],
			}
			const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
				const body = await new Request(input, init).json()
				if (body.reasoning?.effort === 'none') {
					return Response.json(
						{ error: { code: 'invalid_value', message: 'Unsupported effort' } },
						{ status: 400 },
					)
				}
				const events = [
					{ type: 'response.output_item.done', item: message, output_index: 0 },
					{
						type: 'response.completed',
						response: {
							id: 'resp_fixture',
							status: 'completed',
							output: [message],
						},
					},
				]
				return new Response(
					events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
					{ headers: { 'content-type': 'text/event-stream' } },
				)
			})
			await expect(
				testTextConnection(
					{
						...configured,
						format: 'openai-responses',
						compat: 'openai',
						model,
					},
					{ fetch },
				),
			).resolves.toHaveProperty('usage')
			expect(fetch).toHaveBeenCalledOnce()
		},
	)

	it.each([
		['header-retry', 3, 13],
		['temporary', 2, 13],
		['empty', 2, 26],
	])('recovers the %s sequence', async (fixture, calls, totalTokens) => {
		const fetch = vi.fn(format())
		await expect(
			testTextConnection(
				{ ...configured, model: `fixture-${fixture}` },
				{ fetch, image: chat.image },
			),
		).resolves.toMatchObject({ usage: { totalTokens } })
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

	it.each([
		{ maxTokens: 32, delayMs: 120_000, stops: false },
		{ maxTokens: 16_000, delayMs: 120_000, stops: true },
		{ maxTokens: 32_000, delayMs: 601_000, stops: false },
		{
			maxTokens: 16_000,
			delayMs: 136_001,
			stops: false,
			content: 'A'.repeat(196_000),
			effectiveCap: 5_440,
			abortMs: 136_000,
		},
	])(
		'waits for delayed headers within the deadline for $maxTokens output tokens',
		async ({ maxTokens, delayMs, stops, content, effectiveCap, abortMs }) => {
			vi.useFakeTimers()
			try {
				const { promise: started, resolve: start } =
					Promise.withResolvers<void>()
				const chunk = {
					choices: [{ delta: { content: 'OK' }, finish_reason: 'stop' }],
				}
				let sentCap: number | undefined
				let abortedAfter: number | undefined
				const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
					const request = new Request(input, init)
					const { signal } = request
					const now = Date.now()
					const body = await request.json()
					sentCap = body.max_completion_tokens ?? body.max_tokens
					return new Promise((resolve, reject) => {
						const timer = setTimeout(() => {
							resolve(
								new Response(
									`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,
									{ headers: { 'content-type': 'text/event-stream' } },
								),
							)
						}, delayMs)
						signal.addEventListener(
							'abort',
							() => {
								abortedAfter = Date.now() - now
								clearTimeout(timer)
								reject(signal.reason)
							},
							{ once: true },
						)
						start()
					})
				})
				const model = buildTextModel({
					...configured,
					model: 'fixture-header-deadline',
					contextWindow: 65_536,
					maxOutputTokens: 32_000,
				})
				const result = createTextStream({ fetch, requestRetries: 0 })(
					model,
					normalizeContext({
						messages: [
							{
								role: 'user',
								content: content ?? 'Reply with OK.',
								timestamp: 0,
							},
						],
					}),
					{ apiKey: configured.apiKey, maxTokens },
				).result()
				await started
				await vi.advanceTimersByTimeAsync(delayMs)
				if (stops)
					expect(await result).toMatchObject({
						stopReason: 'stop',
						content: [{ type: 'text', text: 'OK' }],
					})
				else
					expect(await result).toMatchObject({
						stopReason: 'error',
						errorMessage: expect.stringMatching(/^\[network\]/),
					})
				expect(fetch).toHaveBeenCalledOnce()
				if (effectiveCap !== undefined) {
					expect(sentCap).toBe(effectiveCap)
					expect(abortedAfter).toBe(abortMs)
				}
			} finally {
				vi.useRealTimers()
			}
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

	it('maps an Anthropic sensitive stop to moderation without retrying', async () => {
		const events = [
			{
				type: 'message_start',
				message: {
					id: 'msg_fixture',
					role: 'assistant',
					content: [],
					usage: { input_tokens: 12 },
				},
			},
			{
				type: 'message_delta',
				delta: { stop_reason: 'sensitive' },
				usage: { output_tokens: 0 },
			},
			{ type: 'message_stop' },
		]
		const fetch = vi.fn<typeof globalThis.fetch>(
			async () =>
				new Response(
					events
						.map(
							(event) =>
								`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
						)
						.join(''),
					{ headers: { 'content-type': 'text/event-stream' } },
				),
		)
		await expect(
			testTextConnection(
				smokeConnection(smokeProfiles[2], baseUrl, 'offline-placeholder'),
				{ fetch },
			),
		).rejects.toMatchObject({ code: 'moderation' })
		expect(fetch).toHaveBeenCalledOnce()
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

	it('lets pi Agent reject a tool call truncated at the token limit', async () => {
		const provider = registerFauxProvider({
			api: 'm0-text-truncated',
			provider: 'm0-text-truncated',
		})
		const execute = vi.fn(async () => ({ content: [], details: undefined }))
		try {
			provider.setResponses([
				fauxAssistantMessage(fauxToolCall('check', {}), {
					stopReason: 'length',
				}),
				fauxAssistantMessage('OK'),
			])
			const agent = new Agent({
				streamFn: createTextStream({ streamRetries: 0 }),
				initialState: {
					model: provider.getModel(),
					tools: [
						{
							name: 'check',
							label: 'Check',
							description: 'Check the supplied arguments',
							parameters: obj({}),
							execute,
						},
					],
				},
			})
			await agent.prompt('Call the check tool')
			expect(execute).not.toHaveBeenCalled()
			expect(provider.state.callCount).toBe(2)
			expect(agent.state.messages).toContainEqual(
				expect.objectContaining({
					role: 'toolResult',
					isError: true,
					content: [
						expect.objectContaining({
							text: expect.stringContaining('may be truncated'),
						}),
					],
				}),
			)
		} finally {
			provider.unregister()
		}
	})
})
