import { reserveTokenFields } from '../../packages/creator/src/usage/reservation'

export const ownerBookSelectionCap = 700_000
export const ownerBookSelectionBatchCap = 300_000

export function reserveOwnerBookSelection(
	used: number,
	messages: unknown,
	outputCap: number,
	cap = ownerBookSelectionCap,
) {
	if (!Array.isArray(messages) || !messages.length)
		throw new Error('Selection reservation requires plain text chat messages')
	const fields = messages.flatMap((message): string[] => {
		if (
			!message ||
			!['system', 'developer', 'user', 'assistant'].includes(message.role) ||
			typeof message.content !== 'string' ||
			Object.keys(message).length !== 2
		)
			throw new Error('Selection reservation requires plain text chat messages')
		return [message.role, message.content]
	})
	const reservation = reserveTokenFields(fields, outputCap)
	return used + reservation.reserved <= cap ? reservation : undefined
}

async function readResponseUsage(response: Response) {
	const body = await response.text()
	const rows = response.headers
		.get('content-type')
		?.includes('text/event-stream')
		? body
				.split('\n')
				.flatMap((line) =>
					line.startsWith('data:') && line.slice(5).trim() !== '[DONE]'
						? [JSON.parse(line.slice(5))]
						: [],
				)
		: [JSON.parse(body)]
	const usage = rows.findLast((row) => row?.usage)?.usage
	const total =
		usage?.total_tokens ?? usage?.prompt_tokens + usage?.completion_tokens
	return Number.isSafeInteger(total) && total > 0 ? total : undefined
}

export function observeOwnerBookUsage(
	response: Response,
	settle: (tokens?: number) => Promise<void>,
	onReadError: (error: unknown) => void,
) {
	const usage = response.ok
		? readResponseUsage(response.clone())
		: Promise.resolve(undefined)
	return usage.then(settle, (error) => {
		onReadError(error)
		return settle()
	})
}
