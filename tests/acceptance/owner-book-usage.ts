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
