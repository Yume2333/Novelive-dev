import { expect, test, vi } from 'vitest'
import { observeOwnerBookUsage } from '../acceptance/owner-book-usage'

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
