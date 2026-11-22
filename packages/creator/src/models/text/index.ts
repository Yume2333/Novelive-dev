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
import { streamSimple } from '@earendil-works/pi-ai/compat'
import {
	type BuiltinProvider,
	getBuiltinModels,
	getBuiltinProviders,
} from '@earendil-works/pi-ai/providers/all'
import { isRetryableAssistantError } from '@earendil-works/pi-ai/utils/retry'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import type { MaskedConfig } from '../../config/index.js'
import type { CommandError } from '../../contract/index.js'
import { createReplayFetch } from '../../replay/index.js'

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
const watchdogMs = 90_000
const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
const noUsage: Usage = { ...cost, totalTokens: 0, cost: { ...cost, total: 0 } }
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
		reasoning: entry?.reasoning ?? false,
		thinkingLevelMap:
			entry?.api === config.format ? entry.thinkingLevelMap : undefined,
		contextWindow,
		maxTokens: Math.min(contextWindow, entry?.maxTokens ?? 4096),
		compat: nativeCompat ?? qwenCompat,
	}
}

const descriptions: Partial<Record<Code, string>> = {
	auth: 'Model authentication failed',
	not_found: 'Model or endpoint not found',
	network: 'Model connection interrupted or unavailable',
	moderation: 'Model declined the request due to content moderation',
	invalid_config: 'Model request configuration was rejected',
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
}

export function createTextStream(
	policy: StreamPolicy = {},
): StreamFunction<Api, SimpleStreamOptions> {
	const fetch = policy.fetch ?? createReplayFetch()
	return (model, context, options) => {
		const output = createAssistantMessageEventStream()
		const limit = policy.streamRetries ?? 2
		const fail = (code: Code, detail?: string, previous?: AssistantMessage) => {
			const error = failed(model, code, detail, previous)
			output.push({
				type: 'error',
				reason: code === 'cancelled' ? 'aborted' : 'error',
				error,
			})
		}
		async function run() {
			for (let attempt = 0; attempt <= limit; attempt++) {
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
				let result: AssistantMessage
				try {
					const stream = streamSimple(model, context, {
						...options,
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
					for await (const event of stream) buffered.push(event)
					result = await stream.result()
				} finally {
					clearTimeout(timer)
				}
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
					!empty &&
					result.stopReason !== 'error' &&
					result.stopReason !== 'aborted'
				) {
					for (const event of buffered) output.push(event)
					return output.end(result)
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
				if (code === 'network' && retryable && attempt < limit) continue
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
						{ type: 'text', text: 'Reply with just OK.' },
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
		const message = result.errorMessage ?? ''
		const match = descriptionsByPrefix.exec(message)
		throw new TextModelError(
			(match?.[1] as Code | undefined) ?? 'internal',
			message.replace(descriptionsByPrefix, ''),
			result.usage,
		)
	}
	return { usage: result.usage }
}
