import { expect, test } from 'vitest'
import { reconcileNamedAdditions } from '../../packages/creator/src/synthesis/consolidate'
import type { BiblePatch } from '../../packages/format/src/model'

const emptyBible = {
	character: [],
	relation: [],
	location: [],
	timeline: [],
	foreshadowing: [],
	style: [],
	glossary: [],
}

test.each([false, true])(
	'keeps distinct homonyms separate (same alias: %s)',
	(sameAlias) => {
		const characters: BiblePatch = ['lin-a', 'lin-b'].map((id) => ({
			kind: 'character',
			op: 'add',
			entry: {
				id,
				name: 'Lin',
				aliases: [sameAlias ? 'Guide' : id],
				status: 'candidate',
			},
		}))
		const patch: BiblePatch = sameAlias
			? [
					...characters,
					{
						kind: 'relation',
						op: 'add',
						entry: {
							id: 'siblings',
							from: 'lin-a',
							to: 'lin-b',
							description: 'Siblings',
							status: 'candidate',
						},
					},
				]
			: characters
		expect(reconcileNamedAdditions(patch, emptyBible)).toEqual(patch)
	},
)
