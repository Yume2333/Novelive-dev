import type { Context } from '@earendil-works/pi-ai'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import {
	buildTextModel,
	createTextStream,
	type TextConnection,
	TextModelError,
} from '../../models/text'

export type WritingTransport = {
	signal?: AbortSignal
	fetch?: typeof globalThis.fetch
}

export function writingModel(
	connection: TextConnection,
	options: WritingTransport,
) {
	const model = buildTextModel(connection)
	const stream = createTextStream({
		fetch: options.fetch,
		requestRetries: 0,
		streamRetries: 0,
	})
	const outputTokens = Math.min(
		4096,
		model.maxTokens,
		Math.floor(model.contextWindow / 4),
	)
	return {
		inputLimit: model.contextWindow - outputTokens - 256,
		async request(context: Context) {
			options.signal?.throwIfAborted()
			const result = await stream(model, normalizeContext(context), {
				apiKey: connection.apiKey,
				signal: options.signal,
				cacheRetention: 'none',
				maxTokens: outputTokens,
			}).result()
			options.signal?.throwIfAborted()
			if (result.stopReason === 'error' || result.stopReason === 'aborted') {
				const message = result.errorMessage ?? 'Writing model failed'
				const code = message.match(/^\[([a-z_]+)\]/)?.[1] as
					| TextModelError['code']
					| undefined
				throw new TextModelError(code ?? 'internal', message, result.usage)
			}
			if (result.stopReason === 'length')
				throw new TextModelError(
					'internal',
					'Writing model output was truncated',
					result.usage,
				)
			return result
		},
	}
}

export const textOf = (
	result: Awaited<ReturnType<ReturnType<typeof writingModel>['request']>>,
) =>
	result.content
		.flatMap((part) => (part.type === 'text' ? [part.text] : []))
		.join('')

export const userMessage = (content: string) => ({
	role: 'user' as const,
	content,
	timestamp: 0,
})
