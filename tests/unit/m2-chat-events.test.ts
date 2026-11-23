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

function chapter(seq: number, scopeId = 'work'): EventEnvelope {
	return {
		...event(seq, '', scopeId),
		event: {
			type: 'production.chapterRecord',
			payload: {
				workId: scopeId,
				chapterId: 'ch1',
				step: 'write',
				status: 'done',
				message: '已完成',
			},
		},
	}
}

test('chapter backfill is filtered, sorted and deduplicated against live replay', () => {
	const replay = new EventReplay()
	const first = chapter(1)
	const second = chapter(3)
	replay.append(second)
	expect(
		replay.list('work', 0, 'work', [
			second,
			chapter(2, 'foreign'),
			first,
			first,
		]),
	).toEqual({ events: [first, second], gap: false })
	expect(replay.list('work', 1, 'work', [second, first])).toEqual({
		events: [second],
		gap: false,
	})
	expect(replay.list('work', 3, 'work', [second, first])).toEqual({
		events: [],
		gap: false,
	})
})

test('a new creator generation uses a fresh cursor for reconstructed records', () => {
	const before = new EventReplay(1)
	before.append(chapter(99))
	before.append(event(100))
	const restarted = new EventReplay(1)
	restarted.append(chapter(1))
	restarted.append(event(2, 'foreign', 'other'))
	expect(restarted.list('work', 0, 'work', [chapter(1)])).toEqual({
		events: [chapter(1)],
		gap: false,
	})
	expect(restarted.list('work', 100, 'work', [chapter(1)])).toEqual({
		events: [],
		gap: false,
	})
})

test('backfill repairs chapter eviction but cannot hide lost snapshots or chat events', () => {
	const replay = new EventReplay(1)
	replay.append(chapter(1))
	replay.append(chapter(2))
	replay.append(event(3, 'foreign', 'other'))
	expect(replay.list('work', 0).gap).toBe(true)
	expect(replay.list('work', 0, 'work', [chapter(1), chapter(2)])).toEqual({
		events: [chapter(1), chapter(2)],
		gap: false,
	})
	expect(replay.list('work', 0, 'work', [chapter(2)]).gap).toBe(true)
	expect(replay.list('work', 1, 'work', [chapter(2)]).gap).toBe(false)
	replay.append(event(4))
	replay.append(event(5))
	expect(replay.list('work', 0, 'work', [chapter(1), chapter(2)]).gap).toBe(
		true,
	)
	expect(replay.list('work', 4, 'work', [chapter(1), chapter(2)]).gap).toBe(
		false,
	)
})

test('app replay returns available queue events separately from work backfill', () => {
	const replay = new EventReplay()
	const queue = {
		...event(2),
		scope: 'app' as const,
		scopeId: 'app',
		event: {
			type: 'production.queue',
			payload: { active: null, queued: [], inactive: [] },
		},
	}
	replay.append(chapter(1, 'app'))
	replay.append(queue)
	expect(replay.list('app', 0, 'app', [chapter(1, 'app')])).toEqual({
		events: [queue],
		gap: false,
	})
})

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

test('eviction and oversized snapshots report gaps only for the affected scope', () => {
	const replay = new EventReplay(2, 1024)
	replay.append(event(1, 'first', 'a'))
	replay.append(event(2, 'second', 'b'))
	replay.append(event(3, 'third', 'a'))
	expect(replay.list('a', 0).gap).toBe(true)
	expect(replay.list('b', 0)).toEqual({
		events: [event(2, 'second', 'b')],
		gap: false,
	})
	expect(replay.list('unopened', 0)).toEqual({ events: [], gap: false })
	replay.append(event(4, 'x'.repeat(2048), 'a'))
	expect(replay.list('a', 3).gap).toBe(true)
	expect(replay.list('b', 0).gap).toBe(false)
	replay.append(event(5, 'fifth', 'a'))
	expect(replay.list('b', 0).gap).toBe(true)
	expect(replay.list('a', 4).gap).toBe(false)
})

test('app and work scopes with the same ID have separate dropped watermarks', () => {
	const replay = new EventReplay(1)
	replay.append(event(1))
	const appEvent = { ...event(2), scope: 'app' as const }
	replay.append(appEvent)
	expect(replay.list('work', 0)).toEqual({ events: [], gap: true })
	expect(replay.list('work', 0, 'app')).toEqual({
		events: [appEvent],
		gap: false,
	})
})
