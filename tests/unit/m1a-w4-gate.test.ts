import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { scoreAgainstConsensus } from '../acceptance/bible-patch-score'

const fixtures = join(import.meta.dirname, '../fixtures/m1a-owner-book')
const read = (name: string) =>
	JSON.parse(readFileSync(join(fixtures, name), 'utf8'))
const confirmed = { id: 'wen-suchen', name: '文素臣', aliases: ['文白'] }

test('M1a/07 W4 replays the recorded 《野叟曝言》 volume against the whole-run consensus', () => {
	const whole = read('whole-runs.json')
	const chunked = read('chunked-run.json')
	expect(whole.runs).toHaveLength(3)
	expect(chunked.volumeId).toBe(whole.volumeId)
	const ids = chunked.biblePatch.map(
		({ kind, entry }: { kind: string; entry: { id: string } }) =>
			`${kind}:${entry.id}`,
	)
	expect(new Set(ids).size).toBe(ids.length)
	const score = scoreAgainstConsensus(whole.runs, chunked, [confirmed])
	expect(score.reference).toBe(37)
	expect(score.baseline).toBeCloseTo(0.6499, 4)
	expect(score.normalized).toBeGreaterThanOrEqual(0.9)
})
