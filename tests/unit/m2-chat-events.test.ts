import { expect, test } from 'vitest'
import { EventReplay } from '../../packages/creator/src/chat/events'
import type { EventEnvelope } from '../../packages/creator/src/contract'

function event(seq: number, text = 'text', scopeId = 'work'): EventEnvelope {
	return {
		scope: 'work',
		scopeId,
		seq,
		at: new Date(0).toISOString(),
		event: {
			type: 'chat.message',
			payload: { message: { parts: [{ type: 'text', text }] } },
		},
	}
}

test('event replay is initially empty and filters work and sequence', () => {
	const replay = new EventReplay()
	expect(replay.list('work', 0)).toEqual({ events: [], gap: false })
	replay.append(event(1))
	replay.append(event(2, 'foreign', 'other'))
	replay.append(event(3))
	expect(replay.list('work', 1)).toEqual({ events: [event(3)], gap: false })
})

test('streaming snapshots are bounded by both entry count and bytes with a replay gap on eviction', () => {
	const countBound = new EventReplay(2)
	for (let seq = 1; seq <= 1000; seq++) countBound.append(event(seq))
	expect(countBound.list('work', 0)).toEqual({
		events: [event(999), event(1000)],
		gap: true,
	})
	expect(countBound.list('work', 999).gap).toBe(false)
	const byteBound = new EventReplay(256, 1024)
	for (let seq = 1; seq <= 1000; seq++)
		byteBound.append(event(seq, 'x'.repeat(256)))
	const replay = byteBound.list('work', 0)
	expect(replay.gap).toBe(true)
	expect(replay.events.length).toBeGreaterThan(0)
	expect(
		replay.events.reduce(
			(bytes, entry) => bytes + Buffer.byteLength(JSON.stringify(entry)),
			0,
		),
	).toBeLessThanOrEqual(1024)
	expect(replay.events.at(-1)?.seq).toBe(1000)
})

test('an oversized snapshot is not retained and tells reconnecting consumers to reload chat.get', () => {
	const replay = new EventReplay(256, 1024)
	replay.append(event(1, 'x'.repeat(2048)))
	expect(replay.list('work', 0)).toEqual({ events: [], gap: true })
	replay.append(event(2))
	expect(replay.list('work', 1)).toEqual({ events: [event(2)], gap: false })
})
