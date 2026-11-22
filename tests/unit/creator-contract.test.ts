import { describe, expect, test } from 'vitest'
import {
	clientFrame,
	creatorCommandError,
	creatorFrame,
} from '../../packages/creator/src/contract'
import { ContextLimitError } from '../../packages/creator/src/pipeline/writing/budget'

describe('creator transport schemas', () => {
	test('call and cancel carry the current generation and request identity', () => {
		const call = {
			type: 'call',
			generation: 1,
			requestId: 1,
			command: 'events.list',
			payload: {},
		}
		expect(clientFrame.check(call)).toBe(true)
		expect(clientFrame.check({ ...call, generation: 0 })).toBe(false)
		expect(
			clientFrame.check({ type: 'cancel', generation: 1, requestId: 1 }),
		).toBe(true)
		expect(clientFrame.check({ type: 'cancel', requestId: 1 })).toBe(false)
	})

	test('event envelopes require scope-local sequence identity', () => {
		const frame = {
			type: 'event',
			generation: 2,
			envelope: {
				seq: 1,
				scope: 'app',
				scopeId: 'app',
				at: '2026-11-22T00:00:00Z',
				event: { type: 'example', payload: {} },
			},
		}
		expect(creatorFrame.check(frame)).toBe(true)
		expect(
			creatorFrame.check({
				...frame,
				envelope: { ...frame.envelope, scope: 'global' },
			}),
		).toBe(false)
	})

	test('preserves a context limit error through creator message serialization', () => {
		const failure = new ContextLimitError('Scene repair')
		const frame = structuredClone({
			type: 'error',
			generation: 1,
			requestId: 1,
			error: creatorCommandError(failure),
		})
		expect(creatorFrame.check(frame)).toBe(true)
		expect(frame.error).toEqual({
			code: 'context_limit',
			message: failure.message,
		})
	})
})
