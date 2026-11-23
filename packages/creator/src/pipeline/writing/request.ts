import type { Context } from '@earendil-works/pi-ai'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import {
	buildTextModel,
	createTextStream,
	outputTokenBudget,
	parseModelJson,
	type TextConnection,
	TextModelError,
	textResultError,
} from '../../models/text'
import { fitPrompt, promptFits } from './budget'

export type WritingTransport = {
	signal?: AbortSignal
	fetch?: typeof globalThis.fetch
}

export class TruncatedWritingError extends TextModelError {
	constructor(usage: TextModelError['usage']) {
		super('internal', 'Writing model output was truncated', usage)
	}
}

export function writingModel(
	connection: TextConnection,
	options: WritingTransport,
) {
	const model = buildTextModel(connection)
	const stream = createTextStream({
		fetch: options.fetch,
		...(process.env.NL_REPLAY === 'record'
			? { requestRetries: 0, streamRetries: 0 }
			: {}),
	})
	const outputLimit = outputTokenBudget(model)
	const outputTokens = Math.min(
		4096,
		Math.floor(model.contextWindow / 4),
		outputLimit,
	)
	const limits = {
		outputTokens,
		inputLimit: model.contextWindow - outputTokens - 256,
	}
	return {
		...limits,
		async request(
			context: Context,
			phase = 'Writing prompt',
			outputEstimate = 0,
		) {
			options.signal?.throwIfAborted()
			const normalized = normalizeContext(context)
			const result = await stream(
				model,
				fitPrompt(limits, normalized, phase, outputEstimate),
				{
					apiKey: connection.apiKey,
					signal: options.signal,
					cacheRetention: 'none',
					outputLimit,
					maxTokens: connection.maxOutputTokens ?? undefined,
				},
			).result()
			options.signal?.throwIfAborted()
			if (result.stopReason === 'error' || result.stopReason === 'aborted') {
				throw textResultError(result, 'Writing model failed')
			}
			if (result.stopReason === 'length')
				throw new TruncatedWritingError(result.usage)
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

export async function requestWritingJson<T>(
	model: ReturnType<typeof writingModel>,
	prompt: string,
	phase: string,
	validate: (value: unknown) => T | undefined,
	invalidShape: string,
): Promise<T> {
	const request = async (
		context: Context,
	): Promise<{ issue: string } | { value: T }> => {
		const result = await model.request(context, phase)
		let value: unknown
		try {
			value = parseModelJson(textOf(result))
		} catch (error) {
			if (!(error instanceof SyntaxError)) throw error
			return { issue: `${phase} returned invalid JSON` }
		}
		const checked = validate(value)
		return checked === undefined ? { issue: invalidShape } : { value: checked }
	}
	const first = await request({ messages: [userMessage(prompt)] })
	if ('value' in first) return first.value
	const repair = {
		messages: [
			userMessage(
				`${prompt}\n${first.issue}. Return only corrected JSON matching the requested format.`,
			),
		],
	}
	if (!promptFits(model, repair)) throw new Error(first.issue)
	const second = await request(repair)
	if ('value' in second) return second.value
	throw new Error(second.issue)
}
