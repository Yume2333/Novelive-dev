import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEvent,
	createAssistantMessageEventStream,
	type ImageContent,
	type Model,
	type SimpleStreamOptions,
	type StreamFunction,
	type Usage,
} from '@earendil-works/pi-ai'
import { clampMaxTokensToContext } from '@earendil-works/pi-ai/api/simple-options'
import { streamSimple } from '@earendil-works/pi-ai/compat'
import {
	type BuiltinProvider,
	getBuiltinModels,
	getBuiltinProviders,
} from '@earendil-works/pi-ai/providers/all'
import { estimateContextTokens } from '@earendil-works/pi-ai/utils/estimate'
import { isRetryableAssistantError } from '@earendil-works/pi-ai/utils/retry'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import type { MaskedConfig } from '../../config/index.js'
import type { CommandError } from '../../contract/index.js'
import { createReplayFetch } from '../../replay/index.js'
import { recordTextUsage } from '../../usage'

type Settings = MaskedConfig['models']['fast']
type Format = Settings['format']
type Code = CommandError['code']
export type TextConnection = Omit<Settings, 'apiKeyMasked'> & {
	apiKey: string
}

const vendors: Record<Exclude<Settings['compat'], 'auto'>, BuiltinProvider> = {
	openai: 'openai',
	deepseek: 'deepseek',
	qwen: 'qwen-token-plan',
	zhipu: 'zai',
	openrouter: 'openrouter',
	'anthropic-compat': 'anthropic',
}
const minimumContext = 4096
const relayReasoningModels = new Set(['devin-swe-2'])
const watchdogMs = 90_000
const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
const noUsage: Usage = { ...cost, totalTokens: 0, cost: { ...cost, total: 0 } }

function sumUsage(first: Usage, last: Usage): Usage {
	return {
		input: first.input + last.input,
		output: first.output + last.output,
		cacheRead: first.cacheRead + last.cacheRead,
		cacheWrite: first.cacheWrite + last.cacheWrite,
		...(first.cacheWrite1h !== undefined || last.cacheWrite1h !== undefined
			? { cacheWrite1h: (first.cacheWrite1h ?? 0) + (last.cacheWrite1h ?? 0) }
			: {}),
		...(first.reasoning !== undefined || last.reasoning !== undefined
			? { reasoning: (first.reasoning ?? 0) + (last.reasoning ?? 0) }
			: {}),
		totalTokens: first.totalTokens + last.totalTokens,
		cost: {
			input: first.cost.input + last.cost.input,
			output: first.cost.output + last.cost.output,
			cacheRead: first.cost.cacheRead + last.cost.cacheRead,
			cacheWrite: first.cost.cacheWrite + last.cost.cacheWrite,
			total: first.cost.total + last.cost.total,
			totalFromProvider:
				first.cost.totalFromProvider === true &&
				last.cost.totalFromProvider === true,
		},
	}
}

export const textConnectionImage: ImageContent = {
	type: 'image',
	mimeType: 'image/png',
	data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
}

function vendor(config: Pick<Settings, 'format' | 'compat'>) {
	return config.compat === 'auto'
		? config.format === 'anthropic-messages'
			? 'anthropic'
			: 'openai'
		: vendors[config.compat]
}

function catalogModel(config: Pick<Settings, 'model' | 'format' | 'compat'>) {
	const preferred = vendor(config)
	const matches = [
		preferred,
		...getBuiltinProviders().filter((id) => id !== preferred),
	].flatMap((id) =>
		getBuiltinModels(id).filter((model) => model.id === config.model),
	)
	return (
		matches.find(
			(model) => model.provider === preferred && model.api === config.format,
		) ??
		matches.find((model) => model.provider === preferred) ??
		matches.find((model) => model.api === config.format) ??
		matches[0]
	)
}

export function suggestContextWindow(
	config: Pick<Settings, 'model' | 'format' | 'compat'>,
) {
	const context = catalogModel(config)?.contextWindow
	return context !== undefined && context >= minimumContext ? context : null
}

export class TextModelError extends Error {
	constructor(
		readonly code: Code,
		message: string,
		readonly usage?: Usage,
	) {
		super(message)
	}
}

export function buildTextModel(
	config: TextConnection,
	image = false,
): Model<Format> {
	let url: URL
	try {
		url = new URL(config.baseUrl)
	} catch {
		throw new TextModelError(
			'invalid_config',
			'Enter a valid model endpoint URL',
		)
	}
	if (
		!['http:', 'https:'].includes(url.protocol) ||
		url.username ||
		url.password ||
		!config.model.trim() ||
		!config.apiKey.trim()
	) {
		throw new TextModelError(
			'invalid_config',
			'Enter a model, API key, and HTTP(S) endpoint',
		)
	}
	const entry = catalogModel(config)
	const contextWindow = config.contextWindow ?? entry?.contextWindow
	if (
		contextWindow === undefined ||
		!Number.isSafeInteger(contextWindow) ||
		contextWindow < minimumContext
	) {
		throw new TextModelError(
			'invalid_config',
			'Enter a context window of at least 4096 tokens',
		)
	}
	const provider = config.compat === 'auto' ? 'custom' : vendor(config)
	const relayReasoning = relayReasoningModels.has(config.model)
	const nativeCompat =
		entry?.provider === provider && entry.api === config.format
			? entry.compat
			: undefined
	const qwenCompat =
		config.compat === 'qwen' && config.format === 'openai-completions'
			? {
					supportsStore: false,
					supportsDeveloperRole: false,
					maxTokensField: 'max_tokens' as const,
				}
			: undefined
	return {
		id: config.model,
		name: entry?.name ?? config.model,
		api: config.format,
		provider,
		baseUrl: url.href.replace(/\/$/, ''),
		input: image ? ['text', 'image'] : (entry?.input ?? ['text']),
		cost: entry?.cost ?? cost,
		reasoning: entry?.reasoning ?? relayReasoning,
		thinkingLevelMap: relayReasoning
			? { off: null }
			: entry?.api === config.format
				? entry.thinkingLevelMap
				: undefined,
		contextWindow,
		maxTokens: Math.min(
			contextWindow,
			config.maxOutputTokens ??
				entry?.maxTokens ??
				Math.floor(contextWindow / 2),
			entry?.maxTokens ?? contextWindow,
		),
		compat: nativeCompat ?? qwenCompat,
	}
}

export function outputTokenBudget(
	model: Pick<Model<Api>, 'reasoning' | 'contextWindow' | 'maxTokens'>,
) {
	return Math.min(
		model.maxTokens,
		Math.floor(model.contextWindow / (model.reasoning ? 2 : 4)),
	)
}

const descriptions: Partial<Record<Code, string>> = {
	auth: 'Model authentication failed',
	not_found: 'Model or endpoint not found',
	network: 'Model connection interrupted or unavailable',
	moderation: 'Model declined the request due to content moderation',
	invalid_config: 'Model request configuration was rejected',
	reasoning_limit: 'Model generated reasoning but no answer',
	cancelled: 'Model request cancelled',
	internal: 'Model returned an unexpected response',
}
const moderation =
	/(?:content[_ -]filter|moderation|content[_ -]policy|safety|refusal)/i
const temporary =
	/(?:service[_ -]unavailable|overload|rate[_ -]limit|temporar(?:y|ily))/i
const interruption =
	/(?:stream ended|connection|socket|terminated|fetch failed|network[_ -]error|timed? ?out|unexpected eof|malformed server-sent event)/i

function errorFields(value: unknown): string {
	if (typeof value !== 'object' || value === null) return ''
	return Object.entries(value)
		.map(([key, item]) => {
			if (['error', 'response', 'incomplete_details'].includes(key))
				return errorFields(item)
			return [
				'code',
				'type',
				'reason',
				'stop_reason',
				'finish_reason',
			].includes(key) && typeof item === 'string'
				? item
				: ''
		})
		.join(' ')
}

function classify(
	message: AssistantMessage,
	status: number | undefined,
	fields: string,
): Code {
	const reason = `${fields} ${message.rawStopReason ?? ''}`
	if (
		message.rawStopReason === 'sensitive' ||
		moderation.test(reason) ||
		moderation.test(message.errorMessage ?? '')
	)
		return 'moderation'
	if (temporary.test(reason)) return 'network'
	if (/(?:model_not_found|not_found_error)/i.test(reason) || status === 404)
		return 'not_found'
	if (status === 401 || status === 403) return 'auth'
	if (status === 400 || status === 422) return 'invalid_config'
	if (
		status === 408 ||
		status === 409 ||
		status === 429 ||
		(status !== undefined && status >= 500) ||
		interruption.test(message.errorMessage ?? '') ||
		isRetryableAssistantError(message)
	)
		return 'network'
	return 'internal'
}

function failed(
	model: Model<Api>,
	code: Code,
	detail?: string,
	previous?: AssistantMessage,
): AssistantMessage {
	return {
		role: 'assistant',
		api: model.api,
		model: model.id,
		provider: model.provider,
		timestamp: previous?.timestamp ?? Date.now(),
		content: [],
		usage: previous?.usage ?? noUsage,
		stopReason: code === 'cancelled' ? 'aborted' : 'error',
		errorMessage: `[${code}] ${detail ?? descriptions[code]}`,
	}
}

type StreamPolicy = {
	fetch?: typeof globalThis.fetch
	idleMs?: number
	requestRetries?: number
	streamRetries?: number
	streaming?: boolean
}

type TextStreamOptions = SimpleStreamOptions & { outputLimit?: number }

export function createTextStream(
	policy: StreamPolicy = {},
): StreamFunction<Api, TextStreamOptions> {
	const fetch = policy.fetch ?? createReplayFetch()
	return (model, context, options) => {
		const output = createAssistantMessageEventStream()
		const limit = policy.streamRetries ?? 2
		const smallCompletionsWindow =
			model.reasoning &&
			model.api === 'openai-completions' &&
			model.contextWindow <= 8192
		const input = smallCompletionsWindow
			? estimateContextTokens(context).tokens
			: 0
		const smallWindowRoom = smallCompletionsWindow
			? Math.max(
					1,
					model.contextWindow - input - Math.max(256, Math.ceil(input * 0.15)),
				)
			: Infinity
		const outputLimit = Math.min(
			model.maxTokens,
			smallWindowRoom,
			options?.outputLimit ??
				(model.reasoning ? outputTokenBudget(model) : model.maxTokens),
		)
		let maxTokens = Math.min(
			outputLimit,
			options?.maxTokens ??
				(model.reasoning
					? Math.max(1, Math.floor(outputLimit * 0.75))
					: outputLimit),
		)
		let usage: Usage | undefined
		let reasoningRetried = false
		const fail = (code: Code, detail?: string, previous?: AssistantMessage) => {
			const error = failed(model, code, detail, previous)
			if (usage) error.usage = usage
			output.push({
				type: 'error',
				reason: code === 'cancelled' ? 'aborted' : 'error',
				error,
			})
		}
		async function run() {
			for (let attempt = 0; ; ) {
				if (options?.signal?.aborted) return fail('cancelled')
				const idle = new AbortController()
				const signal = options?.signal
					? AbortSignal.any([options.signal, idle.signal])
					: idle.signal
				let timer: ReturnType<typeof setTimeout> | undefined
				let status: number | undefined
				let fields = ''
				let headersReceived = false
				const resetWatchdog = () => {
					clearTimeout(timer)
					timer = setTimeout(() => idle.abort(), policy.idleMs ?? watchdogMs)
				}
				const buffered: AssistantMessageEvent[] = []
				let live = false
				let result: AssistantMessage
				try {
					const stream = streamSimple(model, context, {
						...options,
						maxTokens,
						async onPayload(payload, currentModel) {
							// pi reserves 4096 tokens even on a 4096-token model.
							if (
								smallCompletionsWindow &&
								typeof payload === 'object' &&
								payload !== null
							) {
								const key = Object.hasOwn(payload, 'max_completion_tokens')
									? 'max_completion_tokens'
									: 'max_tokens'
								payload = { ...payload, [key]: maxTokens }
							}
							return (
								(await options?.onPayload?.(payload, currentModel)) ?? payload
							)
						},
						signal,
						timeoutMs: options?.timeoutMs ?? watchdogMs,
						maxRetries: policy.requestRetries ?? 2,
						fetch: async (input, init) => {
							status = undefined
							fields = ''
							const response = await fetch(input, init)
							status = response.status
							if (
								!response.ok &&
								response.headers.get('content-type')?.includes('json')
							) {
								fields = await response
									.clone()
									.json()
									.then(errorFields, () => '')
							}
							return response
						},
						async onResponse(response, currentModel) {
							headersReceived = true
							resetWatchdog()
							await options?.onResponse?.(response, currentModel)
						},
						async onProviderStreamEvent(event, currentModel) {
							resetWatchdog()
							const codes = errorFields(event)
							if (codes) fields = codes
							await options?.onProviderStreamEvent?.(event, currentModel)
						},
					})
					for await (const event of stream) {
						if (event.type === 'done' || event.type === 'error') continue
						if (
							!live &&
							policy.streaming &&
							((event.type === 'text_delta' && event.delta.trim()) ||
								event.type === 'toolcall_start')
						) {
							live = true
							for (const pending of buffered) output.push(pending)
							buffered.length = 0
						}
						if (live) output.push(event)
						else buffered.push(event)
					}
					result = await stream.result()
				} finally {
					clearTimeout(timer)
				}
				recordTextUsage(model.id, result.usage)
				usage = usage ? sumUsage(usage, result.usage) : result.usage
				if (options?.signal?.aborted)
					return fail('cancelled', undefined, result)
				const empty =
					(result.stopReason === 'stop' || result.stopReason === 'length') &&
					!result.content.some(
						(part) =>
							(part.type === 'text' && part.text.trim()) ||
							(result.stopReason === 'length' && part.type === 'toolCall'),
					)
				const watchdog = idle.signal.aborted
				if (
					!watchdog &&
					empty &&
					result.content.some(
						(part) => part.type === 'thinking' && part.thinking.trim(),
					)
				) {
					const raised = Math.min(maxTokens * 2, outputLimit)
					const canRaise = smallCompletionsWindow
						? raised > maxTokens
						: clampMaxTokensToContext(model, context, raised) >
							clampMaxTokensToContext(model, context, maxTokens)
					if (!reasoningRetried && !live && canRaise) {
						reasoningRetried = true
						maxTokens = raised
						continue
					}
					return fail('reasoning_limit', undefined, result)
				}
				if (
					!watchdog &&
					!empty &&
					result.stopReason !== 'error' &&
					result.stopReason !== 'aborted' &&
					result.stopReason !== 'pending'
				) {
					const message = { ...result, usage }
					for (const event of buffered) output.push(event)
					output.push({
						type: 'done',
						reason: result.stopReason,
						message,
					})
					return output.end(message)
				}
				const code =
					watchdog || empty ? 'network' : classify(result, status, fields)
				const retryable =
					watchdog ||
					empty ||
					headersReceived ||
					(status !== undefined &&
						status >= 400 &&
						status < 500 &&
						temporary.test(fields) &&
						![408, 409, 429].includes(status))
				if (code === 'network' && retryable && !live && attempt < limit) {
					attempt++
					continue
				}
				return fail(
					code,
					watchdog
						? 'Model stream idle timeout (watchdog)'
						: empty
							? 'Model returned an empty response'
							: undefined,
					result,
				)
			}
		}
		void run().catch(() =>
			fail(options?.signal?.aborted ? 'cancelled' : 'internal'),
		)
		return output
	}
}

const descriptionsByPrefix = /^\[([a-z_]+)\] /

export function textResultError(result: AssistantMessage, fallback: string) {
	const message = result.errorMessage ?? fallback
	const match = descriptionsByPrefix.exec(message)
	return new TextModelError(
		(match?.[1] as Code | undefined) ?? 'internal',
		message,
		result.usage,
	)
}

export async function testTextConnection(
	config: TextConnection,
	options: StreamPolicy & { signal?: AbortSignal; image?: ImageContent } = {},
) {
	const model = buildTextModel(config, options.image !== undefined)
	const stream = createTextStream(options)(
		model,
		normalizeContext({
			messages: [
				{
					role: 'user',
					content: [
						{
							type: 'text',
							text: options.image
								? 'Briefly describe the attached image in one short sentence.'
								: 'Reply with just OK.',
						},
						...(options.image ? [options.image] : []),
					],
					timestamp: Date.now(),
				},
			],
		}),
		{
			apiKey: config.apiKey,
			signal: options.signal,
			maxTokens: 32,
			cacheRetention: 'none',
		},
	)
	const result = await stream.result()
	if (result.stopReason === 'error' || result.stopReason === 'aborted') {
		throw textResultError(result, 'Model connection test failed')
	}
	return { usage: result.usage }
}
