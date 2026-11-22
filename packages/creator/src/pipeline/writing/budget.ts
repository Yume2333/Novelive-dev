import type { Context, Message } from '@earendil-works/pi-ai'
import { TextModelError } from '../../models/text'

type Limits = { inputLimit: number; outputTokens: number }

export class ContextLimitError extends TextModelError {
	constructor(readonly phase: string) {
		super(
			'context_limit',
			`${phase} does not fit the configured model context or output limit`,
		)
	}
}

function promptMessage(message: Message) {
	const { role, content } = message
	switch (message.role) {
		case 'toolResult':
			return { role, content, id: message.toolCallId, name: message.toolName }
		default:
			return { role, content }
	}
}

export function fitPrompt<T extends Context>(
	limits: Limits,
	context: T,
	phase: string,
	outputEstimate = 0,
) {
	const input = Buffer.byteLength(
		JSON.stringify({
			system: context.systemPrompt,
			messages: context.messages.map(promptMessage),
			tools: context.tools,
		}),
	)
	if (input > limits.inputLimit || outputEstimate > limits.outputTokens)
		throw new ContextLimitError(phase)
	return context
}

export function promptFits(
	limits: Limits,
	context: Context,
	outputEstimate = 0,
) {
	try {
		fitPrompt(limits, context, 'Prompt', outputEstimate)
		return true
	} catch (error) {
		if (error instanceof ContextLimitError) return false
		throw error
	}
}

export function* fitUnits<T>(
	units: readonly T[],
	fits: (batch: readonly T[]) => boolean,
	phase: string,
) {
	for (let from = 0; from < units.length; ) {
		let to = from + 1
		if (!fits(units.slice(from, to))) throw new ContextLimitError(phase)
		while (to < units.length && fits(units.slice(from, to + 1))) to++
		yield units.slice(from, to)
		from = to
	}
}
