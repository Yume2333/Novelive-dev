import { expect, test } from 'vitest'
import type { BiblePatch, GlossaryPatch } from '../../packages/format/src/model'
import {
	scoreAgainstConsensus,
	scoreBiblePatches,
} from '../acceptance/bible-patch-score'

const patch = (biblePatch: BiblePatch, glossaryPatch: GlossaryPatch = []) => ({
	biblePatch,
	glossaryPatch,
})

const location = (
	id: string,
	name: string,
	originalName?: string,
): BiblePatch[number] => ({
	kind: 'location',
	op: 'add',
	entry: { id, name, originalName, description: 'Temple', status: 'candidate' },
})

test('matches 昭慶寺 by normalized name or an overlapping alias, not its ID', () => {
	const whole = patch([location('loc-zhaoqingsi', '昭慶寺')])
	const conflictingId = location('loc-zhaoqingsi', '另一座寺')
	const alias = location('zhaoqing-si', '西湖古寺', ' 昭・慶　寺 ')
	expect(scoreBiblePatches(whole, patch([conflictingId, alias]))).toEqual({
		whole: 1,
		chunked: 2,
		shared: 1,
		wholeOnly: 0,
		chunkedOnly: 1,
		f1: 2 / 3,
	})
	expect(scoreBiblePatches(whole, patch([conflictingId])).shared).toBe(0)
})

test('a rescue cannot match a later sworn-sibling relationship with the same ID', () => {
	const character = (id: string, name: string): BiblePatch[number] => ({
		kind: 'character',
		op: 'add',
		entry: { id, name, aliases: [], status: 'candidate' },
	})
	const relation = (
		id: string,
		from: string,
		to: string,
		firstSeenChapter: string,
		description: string,
	): BiblePatch[number] => ({
		kind: 'relation',
		op: 'add',
		entry: { id, from, to, firstSeenChapter, description, status: 'candidate' },
	})
	const whole = patch([
		character('wen', '文素臣'),
		character('wei', '未鸞吹'),
		relation('shared', 'wen', 'wei', 'ch0004', '水仙王廟神前結拜為兄妹'),
	])
	const chunkedCast = [character('a', '文素臣'), character('b', '未鸞吹')]
	const rescue = relation(
		'shared',
		'a',
		'b',
		'ch0003',
		'湖堤擊退惡僕，救下未鸞吹',
	)
	expect(scoreBiblePatches(whole, patch([...chunkedCast, rescue])).shared).toBe(
		2,
	)
	const siblings = relation(
		'different',
		'a',
		'b',
		'ch0004',
		'兩人在水仙王廟神前結拜為兄妹',
	)
	expect(
		scoreBiblePatches(whole, patch([...chunkedCast, rescue, siblings])).shared,
	).toBe(3)
})

test('uses a maximum one-to-one assignment when candidate aliases overlap', () => {
	const a = patch([location('1', 'Ａ', 'Ｂ'), location('2', 'A')])
	const b = patch([location('3', 'A'), location('4', 'B')])
	expect(scoreBiblePatches(a, b).f1).toBe(1)
	expect(scoreBiblePatches(a, patch(b.biblePatch.slice(0, 1))).shared).toBe(1)
})

test('timeline matching requires the same chapter, overlapping participant identities, and a shared key action', () => {
	const cast = [
		{ id: 'wen', name: '文素臣', aliases: ['文白'] },
		{ id: 'wei', name: '未鸞吹', aliases: [] },
		{ id: 'lu', name: '陸海', aliases: [] },
		{ id: 'bao', name: '鮑同', aliases: [] },
	]
	const timeline = (event: string, chapterId = 'ch0003') =>
		patch([
			{
				kind: 'timeline',
				op: 'add',
				entry: { id: 'event', event, chapterId, status: 'candidate' },
			},
		])
	const rescue = timeline('文素臣在湖堤擊退惡僕，救下未鸞吹')
	const arrest = timeline('文素臣在湖堤擊退惡僕，逮捕未鸞吹')
	const paraphrase = '文白在湖堤擊退惡僕，救下未鸞吹後離開'
	expect(scoreBiblePatches(rescue, arrest, cast).shared).toBe(0)
	expect(scoreBiblePatches(rescue, timeline(paraphrase), cast).shared).toBe(1)
	expect(
		scoreBiblePatches(rescue, timeline(paraphrase, 'ch0004'), cast).shared,
	).toBe(0)
	expect(
		scoreBiblePatches(rescue, timeline('陸海在湖堤擊退惡僕，救下鮑同'), cast)
			.shared,
	).toBe(0)
	expect(
		scoreBiblePatches(rescue, timeline('文素臣在湖堤擊退惡僕，救下鮑同'), cast)
			.shared,
	).toBe(0)
	const flood = timeline('湖堤潰決')
	expect(scoreBiblePatches(flood, flood, cast).shared).toBe(0)
})

test('matches relations whose participants include an existing character absent from both patches', () => {
	const relation = (to: string): BiblePatch[number] => ({
		kind: 'relation',
		op: 'add',
		entry: {
			id: 'alliance',
			from: 'wen',
			to,
			firstSeenChapter: 'ch0004',
			description: '結拜為兄妹',
			status: 'candidate',
		},
	})
	const cast = (id: string): BiblePatch[number] => ({
		kind: 'character',
		op: 'add',
		entry: { id, name: '未鸞吹', aliases: [], status: 'candidate' },
	})
	const existing = [{ id: 'wen', name: '文素臣', aliases: ['文白'] }]
	const whole = patch([cast('wei'), relation('wei')])
	const chunked = patch([cast('wei-2'), relation('wei-2')])
	expect(scoreBiblePatches(whole, chunked, existing)).toMatchObject({
		whole: 2,
		chunked: 2,
		shared: 2,
	})
	expect(
		scoreBiblePatches(
			whole,
			patch([cast('wei-2'), relation('unresolved')]),
			existing,
		).shared,
	).toBe(1)
	expect(
		scoreBiblePatches(patch([relation('wei-2')]), chunked, existing).shared,
	).toBe(0)
})

test('consensus keeps entries two of three whole runs share and normalizes by leave-one-out agreement', () => {
	const run = (...names: string[]) =>
		patch(names.map((name) => location(name, name)))
	const runs = [
		run('甲', '乙', '丙'),
		run('甲', '乙', '丁'),
		run('甲', '丙', '戊'),
	]
	const score = scoreAgainstConsensus(runs, run('甲', '乙', '丙', '己'))
	expect(score.reference).toBe(3)
	expect(score.leaveOneOut).toEqual([2 / 4, 2 / 5, 2 / 5])
	expect(score.baseline).toBeCloseTo(1.3 / 3)
	expect(score.f1).toBeCloseTo(6 / 7)
	expect(score.normalized).toBeCloseTo(6 / 7 / (1.3 / 3))
	expect(() => scoreAgainstConsensus(runs.slice(0, 2), run('甲'))).toThrow()
})
