import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { wholeBookSelectionTargets } from '../acceptance/owner-book-targets'

test('selection size targets are the per-kind medians of the whole-run output rows', () => {
	const { runs } = JSON.parse(
		readFileSync(
			new URL('../fixtures/m1a-owner-book/whole-runs.json', import.meta.url),
			'utf8',
		),
	)
	expect(wholeBookSelectionTargets(runs)).toEqual({
		character: 23,
		location: 5,
		relation: 7,
		timeline: 7,
		foreshadowing: 5,
		style: 1,
		glossary: 4,
	})
})
