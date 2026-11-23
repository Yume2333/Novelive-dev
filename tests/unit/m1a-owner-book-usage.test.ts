import { expect, test, vi } from 'vitest'
import {
	observeOwnerBookUsage,
	ownerBookSelectionBatchCap,
	ownerBookSelectionCap,
	reserveOwnerBookSelection,
} from '../acceptance/owner-book-usage'

test('selection reserves input bytes and maximum output before spending the last tokens', () => {
	const text = '小說'
	const output = 8_192
	const reserve = Buffer.byteLength(text) + output + 1024
	const used = ownerBookSelectionCap - reserve
	expect(reserveOwnerBookSelection(used, text, output)).toBe(reserve)
	expect(reserveOwnerBookSelection(used + 1, text, output)).toBeUndefined()
})

test('the selection batch reserves within one 300k limit across fresh attempts', () => {
	const body = 'a'.repeat(198_000)
	const output = 24_576
	expect(
		reserveOwnerBookSelection(0, body, output, ownerBookSelectionBatchCap),
	).toBe(223_600)
	expect(
		reserveOwnerBookSelection(70_000, body, output, ownerBookSelectionBatchCap),
	).toBe(223_600)
	expect(
		reserveOwnerBookSelection(
			140_000,
			body,
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
