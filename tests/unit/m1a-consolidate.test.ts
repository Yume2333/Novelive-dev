import { expect, test } from 'vitest'
import {
	reconcileNamedAdditions,
	selectAdditions,
} from '../../packages/creator/src/synthesis/consolidate'
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

test('selection drops unchosen additions with their updates and dangling references', async () => {
	const character = (id: string, name: string) => ({
		kind: 'character' as const,
		op: 'add' as const,
		entry: { id, name, aliases: [], status: 'candidate' as const },
	})
	const relation = (id: string, from: string, to: string) => ({
		kind: 'relation' as const,
		op: 'add' as const,
		entry: { id, from, to, description: id, status: 'candidate' as const },
	})
	const bible = {
		...emptyBible,
		character: [
			{ id: 'ada', name: 'Ada', aliases: [], status: 'confirmed' as const },
		],
	}
	const patch: BiblePatch = [
		character('lin', 'Lin'),
		character('lin-again', 'Lin'),
		{
			kind: 'character',
			op: 'update',
			entry: { id: 'lin-again', name: 'Lin', status: 'candidate' },
		},
		{
			kind: 'character',
			op: 'update',
			entry: { id: 'ada', name: 'Ada', status: 'confirmed' },
		},
		relation('guides', 'lin', 'ada'),
		relation('guides-again', 'lin-again', 'ada'),
	]
	const asked: string[] = []
	const { biblePatch, glossaryPatch } = await selectAdditions(
		patch,
		[
			{
				id: 'a',
				original: '甲',
				written: 'A',
				category: 'term',
				status: 'candidate',
			},
			{
				id: 'b',
				original: '乙',
				written: 'B',
				category: 'term',
				status: 'candidate',
			},
		],
		bible,
		async (kind, candidates) => {
			asked.push(`${kind}:${candidates.length}`)
			return new Set([0])
		},
	)
	expect(asked).toEqual(['character:2', 'glossary:2'])
	expect(biblePatch.map(({ op, entry }) => `${op}:${entry.id}`)).toEqual([
		'add:lin',
		'update:ada',
		'add:guides',
	])
	expect(glossaryPatch.map(({ original }) => original)).toEqual(['甲'])
})
