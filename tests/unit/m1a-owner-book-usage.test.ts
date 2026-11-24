import { expect, test, vi } from 'vitest'
import {
	observeOwnerBookUsage,
	ownerBookSelectionBatchCap,
	ownerBookSelectionCap,
	reserveOwnerBookSelection,
	retryOwnerBookUnavailable,
} from '../acceptance/owner-book-usage'

test.each([
	[200, [true, true]],
	[503, [true, true, false]],
] as const)(
	'backs off only after HTTP 503 and stops after at most three devin attempts (last HTTP %s)',
	async (status, canRetry) => {
		const responses = status === 200 ? [503, 200] : [503, 503, 503]
		const send = vi.fn(
			async (_canRetry: boolean) =>
				new Response(null, { status: responses.shift() }),
		)
		const pause = vi.fn(async (_ms: number) => {})
		const result = await retryOwnerBookUnavailable(
			'devin-swe-2',
			new AbortController().signal,
			send,
			pause,
		)
		expect(result.status).toBe(status)
		expect(send.mock.calls.flat()).toEqual(canRetry)
		expect(pause.mock.calls.flat()).toEqual(
			status === 200 ? [5_000] : [5_000, 15_000],
		)
	},
)

test.each([
	['gemini-3.8-flash', 503],
	['devin-swe-2', 429],
] as const)('does not retry %s on HTTP %s', async (model, status) => {
	const send = vi.fn(
		async (_canRetry: boolean) => new Response(null, { status }),
	)
	const pause = vi.fn(async (_ms: number) => {})
	const result = await retryOwnerBookUnavailable(
		model,
		new AbortController().signal,
		send,
		pause,
	)
	expect(result.status).toBe(status)
	expect(send).toHaveBeenCalledTimes(1)
	expect(pause).not.toHaveBeenCalled()
})

test('selection reserves decoded input and maximum output before spending the last tokens', () => {
	const messages = [{ role: 'user', content: '小說' }]
	const output = 8_192
	const reserve = Buffer.byteLength('user小說') + output + 1024
	const used = ownerBookSelectionCap - reserve
	expect(reserveOwnerBookSelection(used, messages, output)?.reserved).toBe(
		reserve,
	)
	expect(reserveOwnerBookSelection(used + 1, messages, output)).toBeUndefined()
})

test('uses the larger tokenizer estimate with 15% margin and rejects unknown message framing', () => {
	const messages = [{ role: 'user', content: '小說' }]
	expect(reserveOwnerBookSelection(0, messages, 100)).toEqual({
		estimatedInput: 1029,
		estimate: 1129,
		reserved: 1134,
	})
	expect(() =>
		reserveOwnerBookSelection(0, [{ ...messages[0], name: 'extra' }], 100),
	).toThrow('Selection reservation requires plain text chat messages')
})

test('the selection batch uses decoded text rather than JSON escapes, but enforces the ceiling', () => {
	const messages = [{ role: 'user', content: '"a\n'.repeat(60_000) }]
	const output = 24_576
	const second = reserveOwnerBookSelection(
		80_047,
		messages,
		output,
		ownerBookSelectionBatchCap,
	)
	expect(second?.reserved).toBe(205_604)
	expect(second?.estimate).toBeLessThan(second?.reserved ?? 0)
	expect(
		reserveOwnerBookSelection(
			160_094,
			messages,
			output,
			ownerBookSelectionBatchCap,
		),
	).toBeUndefined()
})

test('owner-book usage accounting leaves the first SSE frame available before the stream finishes', async () => {
	const encoder = new TextEncoder()
	let stream!: ReadableStreamDefaultController<Uint8Array>
	const response = new Response(
		new ReadableStream({
			start: (controller) => {
				stream = controller
			},
		}),
		{
			headers: { 'content-type': 'text/event-stream' },
		},
	)
	const settle = vi.fn(async (_tokens?: number) => {})
	const failed = vi.fn()
	const accounting = observeOwnerBookUsage(response, settle, failed)
	const reader = response.body?.getReader()
	const first = encoder.encode('data: {"choices":[]}\n\n')
	stream.enqueue(first)
	expect(await reader?.read()).toEqual({ done: false, value: first })
	expect(settle).not.toHaveBeenCalled()
	stream.enqueue(
		encoder.encode('data: {"usage":{"total_tokens":123}}\n\ndata: [DONE]\n\n'),
	)
	stream.close()
	await accounting
	expect(settle).toHaveBeenCalledExactlyOnceWith(123)
	expect(failed).not.toHaveBeenCalled()
})

test('owner-book accounting reserves an interrupted request and reports the read failure', async () => {
	const error = new DOMException('Local test deadline', 'TimeoutError')
	const response = new Response(
		new ReadableStream({ start: (controller) => controller.error(error) }),
	)
	const settle = vi.fn(async (_tokens?: number) => {})
	const failed = vi.fn()
	await observeOwnerBookUsage(response, settle, failed)
	expect(settle).toHaveBeenCalledExactlyOnceWith()
	expect(failed).toHaveBeenCalledExactlyOnceWith(error)
})
