import { expect, test } from 'vitest'
import { canonicalizeAdditions } from '../../packages/creator/src/synthesis/canonicalize'
import {
	deduplicateNewTerms,
	reconcileNamedAdditions,
	selectAdditions,
} from '../../packages/creator/src/synthesis/consolidate'
import type { BiblePatch, GlossaryPatch } from '../../packages/format/src/model'

const emptyBible = {
	character: [],
	relation: [],
	location: [],
	timeline: [],
	foreshadowing: [],
	style: [],
	glossary: [],
}

test('canonicalizes owner-named settings and groups standing relations without merging another type', () => {
	const ada = {
		id: 'ada',
		name: 'Ada Lin',
		aliases: ['Captain Lin'],
		status: 'confirmed',
	} as const
	const location = {
		id: 'bakery',
		name: 'Ada Lin Bakery',
		description: 'Brick ovens',
		status: 'confirmed',
	} as const
	const bible = {
		...emptyBible,
		character: [{ ...ada, aliases: [...ada.aliases] }],
		location: [location],
	}
	const relation = (
		id: string,
		from: string,
		to: string,
		description: string,
		firstSeenChapter: string,
	) =>
		({
			kind: 'relation',
			op: 'add',
			entry: {
				id,
				from,
				to,
				description,
				firstSeenChapter,
				status: 'candidate',
			},
		}) as const
	const patch: BiblePatch = [
		{
			kind: 'character',
			op: 'add',
			entry: {
				id: 'captain',
				name: 'Captain Lin',
				aliases: [],
				status: 'candidate',
			},
		},
		{
			kind: 'location',
			op: 'add',
			entry: {
				...location,
				id: 'captains-bakery',
				name: 'Captain Lin Bakery',
				status: 'candidate',
			},
		},
		relation(
			'spouse',
			'captain',
			'mei',
			'Spouse: Captain Lin is married to Mei',
			'c2',
		),
		relation('marriage', 'mei', 'ada', 'Wife: Captain Lin marries Mei', 'c1'),
		relation('mentor', 'ada', 'mei', 'Mentor: Ada Lin teaches Mei', 'c2'),
	]
	expect(canonicalizeAdditions(patch, bible, ['c1', 'c2'])).toMatchObject([
		{ entry: { id: 'ada', name: 'Ada Lin' } },
		{ entry: { id: 'bakery', name: 'Ada Lin Bakery' } },
		{
			entry: {
				id: 'spouse',
				from: 'mei',
				to: 'ada',
				description: 'Wife: Ada Lin marries Mei',
				firstSeenChapter: 'c1',
			},
		},
		patch[4],
	])
	expect(bible.character).toEqual([ada])
	expect(bible.location).toEqual([location])
})

test('resolves only unique aliases and retains an owner-normalized setting ID for later proposals', () => {
	const character = (id: string, name: string, aliases: string[]) =>
		({ id, name, aliases, status: 'confirmed' }) as const
	const bible = {
		...emptyBible,
		character: [
			character('ada', 'Ada Lin', ['Captain Lin', 'Captain']),
			character('mei', 'Mei Chen', ['Captain']),
		],
	}
	const location = (id: string, name: string, op: 'add' | 'update' = 'add') =>
		({
			kind: 'location',
			op,
			entry: { id, name, description: 'An old mill', status: 'candidate' },
		}) as const
	const patch: BiblePatch = [
		location('lin-mill', 'Ada Lin Mill'),
		location('captain-lin-mill', 'Captain Lin Mill'),
		location('captain-lin-mill', 'Captain Lin Mill', 'update'),
		location('captain-mill', 'Captain Mill'),
	]
	expect(
		canonicalizeAdditions(patch, bible, ['c1']).map(({ op, entry }) => ({
			op,
			...entry,
		})),
	).toMatchObject([
		{
			op: 'add',
			id: 'lin-mill',
			name: 'Ada Lin Mill',
			aliases: ['Captain Lin Mill'],
		},
		{
			op: 'add',
			id: 'lin-mill',
			name: 'Ada Lin Mill',
			aliases: ['Captain Lin Mill'],
		},
		{
			op: 'update',
			id: 'lin-mill',
			name: 'Ada Lin Mill',
			aliases: ['Captain Lin Mill'],
		},
		{ op: 'add', id: 'captain-mill', name: 'Captain Mill' },
	])
})

test('keeps existing and proposed homonyms with conflicting original names separate', () => {
	const character = {
		id: 'old-lin',
		name: 'Lin',
		originalName: '林',
		aliases: [],
		status: 'confirmed' as const,
	}
	const location = {
		id: 'old-mill',
		name: 'River Mill',
		originalName: '河坊',
		description: 'A mill',
		status: 'confirmed' as const,
	}
	const patch: BiblePatch = [
		{
			kind: 'character',
			op: 'add',
			entry: {
				...character,
				id: 'new-lin',
				originalName: '藺',
				status: 'candidate',
			},
		},
		{
			kind: 'location',
			op: 'add',
			entry: {
				...location,
				id: 'new-mill',
				originalName: '川廠',
				status: 'candidate',
			},
		},
	]
	const bible = { ...emptyBible, character: [character], location: [location] }
	expect(canonicalizeAdditions(patch, bible, ['c1'])).toEqual(patch)
})

test('groups beats only within a chapter and preserves conflicting payoff or time', () => {
	const bible = {
		...emptyBible,
		character: [
			{
				id: 'ada',
				name: 'Ada Lin',
				aliases: ['Captain Lin'],
				status: 'confirmed' as const,
			},
			{
				id: 'mei',
				name: 'Mei Chen',
				aliases: ['Pilot Mei'],
				status: 'candidate' as const,
			},
		],
	}
	const timeline = (
		id: string,
		event: string,
		chapterId: string,
		storyTime?: string,
	) =>
		({
			kind: 'timeline',
			op: 'add',
			entry: { id, event, chapterId, storyTime, status: 'candidate' },
		}) as const
	const hint = (id: string, description: string, resolvedChapter?: string) =>
		({
			kind: 'foreshadowing',
			op: 'add',
			entry: {
				id,
				description,
				plantedChapter: 'c1',
				resolvedChapter,
				status: 'candidate',
			},
		}) as const
	const event =
		'Ada Lin escorts Mei Chen across the wooden bridge before the flood'
	const echo =
		'Captain Lin escorts Pilot Mei across the wooden bridge before the flood arrives'
	const setup = 'Captain Lin hides the coded seal beneath the broken floorboard'
	const patch: BiblePatch = [
		timeline('crossing', event, 'c1'),
		timeline('echo', echo, 'c1', 'dawn'),
		timeline('night', echo, 'c1', 'night'),
		timeline('another-chapter', echo, 'c2'),
		timeline(
			'reversed-roles',
			'Pilot Mei escorts Captain Lin across the wooden bridge before the flood arrives',
			'c1',
		),
		timeline(
			'one-participant',
			'Captain Lin crosses the wooden bridge before the flood arrives',
			'c1',
		),
		hint('hidden-seal', setup),
		hint(
			'seal',
			'Ada Lin hides the coded seal beneath the broken floorboard',
			'c2',
		),
		hint('later-payoff', setup, 'c3'),
	]
	const result = canonicalizeAdditions(patch, bible, ['c1', 'c2', 'c3'])
	expect(result.map(({ entry }) => entry.id)).toEqual([
		'crossing',
		'night',
		'another-chapter',
		'reversed-roles',
		'one-participant',
		'hidden-seal',
		'later-payoff',
	])
	expect(result[0]).toMatchObject({
		entry: { event: `${event} arrives`, chapterId: 'c1', storyTime: 'dawn' },
	})
	expect(result[5]).toMatchObject({
		entry: {
			description: setup.replace('Captain Lin', 'Ada Lin'),
			plantedChapter: 'c1',
			resolvedChapter: 'c2',
		},
	})
})

test('does not merge similar same-chapter timeline actions with different outcomes', () => {
	const bible = {
		...emptyBible,
		character: [
			{
				id: 'ada',
				name: 'Ada Lin',
				aliases: ['Captain Lin'],
				status: 'confirmed' as const,
			},
			{
				id: 'mei',
				name: 'Mei Chen',
				aliases: [],
				status: 'confirmed' as const,
			},
		],
	}
	const patch: BiblePatch = ['saves', 'loses'].map((outcome) => ({
		kind: 'timeline',
		op: 'add',
		entry: {
			id: outcome,
			chapterId: 'c1',
			event: `Ada Lin carries Mei Chen through the flooded underground passage to the old wooden bridge and ${outcome} her.`,
			status: 'candidate',
		},
	}))
	expect(canonicalizeAdditions(patch, bible, ['c1'])).toEqual(patch)
})

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
		async (groups) => {
			asked.push(
				...groups.map(({ kind, entries }) => `${kind}:${entries.length}`),
			)
			return new Set([1, 3, 4, 5])
		},
	)
	expect(asked).toEqual(['character:2', 'relation:2', 'glossary:2'])
	expect(biblePatch.map(({ op, entry }) => `${op}:${entry.id}`)).toEqual([
		'add:lin',
		'update:ada',
		'add:guides',
	])
	expect(glossaryPatch.map(({ original }) => original)).toEqual(['甲'])
})

test('selection compares alternate relation IDs and directions together without equating distinct relationships', async () => {
	const relation = (id: string, from: string, to: string) => ({
		kind: 'relation' as const,
		op: 'add' as const,
		entry: { id, from, to, description: id, status: 'candidate' as const },
	})
	const patch = [
		relation('guardian', 'ada', 'lin'),
		relation('rivals', 'ada', 'mei'),
		relation('ward', 'lin', 'ada'),
		relation('rivals-later', 'ada', 'lin'),
	]
	const result = await selectAdditions(
		patch,
		[],
		emptyBible,
		async ([{ kind, entries }]) => {
			expect(kind).toBe('relation')
			expect(entries).toEqual([
				patch[0].entry,
				patch[2].entry,
				patch[3].entry,
				patch[1].entry,
			])
			return new Set([1, 3, 4])
		},
	)
	expect(result.biblePatch).toEqual([patch[0], patch[1], patch[3]])
})

test('selection decides once per ID with later evidence and preserves the complete kept proposal history', async () => {
	const character = (id: string, identity: string): BiblePatch[number] => ({
		kind: 'character',
		op: 'add',
		entry: { id, name: id, aliases: [], identity, status: 'candidate' },
	})
	const first = character('lin', 'An apprentice')
	const restated = {
		...character('lin', 'A novice mapmaker'),
		observedChapter: 'c2',
	}
	const ongoing: BiblePatch[number] = {
		kind: 'character',
		op: 'update',
		entry: {
			id: 'lin',
			name: 'lin',
			status: 'candidate',
			changes: [
				{ chapterId: 'c9', field: 'identity', value: 'Leads the crossing' },
			],
		},
	}
	const dropped = character('crowd', 'A spectator')
	const patch = [first, dropped, restated, { ...dropped }, ongoing]
	const result = await selectAdditions(
		patch,
		[],
		emptyBible,
		async ([{ kind, entries: candidates }]) => {
			expect(kind).toBe('character')
			expect(candidates).toEqual([
				{
					...first.entry,
					observations: [
						{ chapterId: 'c2', fact: 'A novice mapmaker' },
						{ chapterId: 'c9', fact: 'identity: Leads the crossing' },
					],
				},
				{
					...dropped.entry,
					observations: [{ chapterId: undefined, fact: 'A spectator' }],
				},
			])
			return new Set([1])
		},
	)
	expect(result.biblePatch).toEqual([first, restated, ongoing])
})

test('selection deduplicates identical glossary spellings across new IDs without discarding existing updates or different translations', async () => {
	const term = (
		id: string,
		original: string,
		written = original,
	): GlossaryPatch[number] => ({
		id,
		original,
		written,
		category: 'item',
		status: 'candidate',
	})
	const existing = [term('bell', 'Bell')]
	const update = { ...existing[0], note: 'It opens the gate' }
	const lantern = term('lantern', '燈', 'Lantern')
	const otherReading = term('lantern-title', '燈', 'Beacon')
	const differentPronunciation = {
		...lantern,
		id: 'lantern-surname',
		pronunciation: 'tēng',
	}
	const glossary = [
		term('bell-again', 'Bell'),
		lantern,
		term('lantern-again', '燈', 'Ｌａｎｔｅｒｎ'),
		update,
		otherReading,
		differentPronunciation,
	]
	expect(deduplicateNewTerms(glossary, existing)).toEqual([
		lantern,
		update,
		otherReading,
		differentPronunciation,
	])
	const result = await selectAdditions(
		[],
		glossary,
		{ ...emptyBible, glossary: existing },
		async ([{ kind, entries }]) => {
			expect(kind).toBe('glossary')
			expect(entries).toEqual([lantern, otherReading, differentPronunciation])
			return new Set([1])
		},
	)
	expect(result.glossaryPatch).toEqual([lantern, update])
})
