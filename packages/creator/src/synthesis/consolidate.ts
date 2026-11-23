import type { BiblePatch, GlossaryPatch } from '@novelive/format/model'
import type { readBible } from './patch'

const nameKey = (name: string) =>
	name
		.normalize('NFKC')
		.toLowerCase()
		.replace(/[\p{P}\s]/gu, '')

export function reconcileNamedAdditions(
	patch: BiblePatch,
	bible: Awaited<ReturnType<typeof readBible>>,
): BiblePatch {
	const remap = {
		character: new Map<string, string>(),
		location: new Map<string, string>(),
	}
	const relations = patch.flatMap((item) =>
		item.kind === 'relation' && (item.op === 'add' || item.op === 'update')
			? [item.entry]
			: [],
	)
	for (const kind of ['character', 'location'] as const) {
		const protectedIds = new Set(bible[kind].map(({ id }) => id))
		for (const item of patch)
			if (item.kind === kind && item.op !== 'add')
				protectedIds.add(item.entry.id)
		const idsByName = new Map<string, Set<string>>()
		const namesById = new Map<string, Set<string>>()
		const explicitNames = new Map<string, Set<string>>()
		const signals = new Map<string, Set<string>>()
		for (const item of patch) {
			if (item.kind !== kind || item.op !== 'add') continue
			const { id, name, originalName } = item.entry
			const key = nameKey(name)
			if (!key) continue
			const ids = idsByName.get(key) ?? new Set<string>()
			ids.add(id)
			idsByName.set(key, ids)
			const names = namesById.get(id) ?? new Set<string>()
			names.add(key)
			namesById.set(id, names)
			if (originalName) {
				const originals = explicitNames.get(key) ?? new Set<string>()
				originals.add(nameKey(originalName))
				explicitNames.set(key, originals)
			}
			const evidence = signals.get(id) ?? new Set<string>()
			for (const alias of [
				originalName,
				...(item.kind === 'character' ? item.entry.aliases : []),
			]) {
				const label = alias && nameKey(alias)
				if (label && label !== key) evidence.add(`alias:${label}`)
			}
			const description =
				item.kind === 'location'
					? item.entry.description
					: item.kind === 'character'
						? item.entry.appearance?.description
						: undefined
			if (description && nameKey(description))
				evidence.add(`description:${nameKey(description)}`)
			signals.set(id, evidence)
		}
		for (const [key, group] of idsByName) {
			const ids = [...group]
			if (
				ids.length < 2 ||
				(explicitNames.get(key)?.size ?? 0) > 1 ||
				ids.some(
					(id) => protectedIds.has(id) || namesById.get(id)?.size !== 1,
				) ||
				![...(signals.get(ids[0]) ?? [])].some((signal) =>
					ids.every((id) => signals.get(id)?.has(signal)),
				) ||
				(kind === 'character' &&
					relations.some(
						({ from, to }) => from !== to && group.has(from) && group.has(to),
					))
			)
				continue
			for (const alias of ids.slice(1)) remap[kind].set(alias, ids[0])
		}
	}
	if (!remap.character.size && !remap.location.size) return patch
	const character = (id: string) => remap.character.get(id) ?? id
	return patch.map((item) => {
		const { entry } = item
		switch (item.kind) {
			case 'character': {
				const remapped = {
					...item.entry,
					id: character(entry.id),
					...(item.entry.addresses && {
						addresses: item.entry.addresses.map((address) => ({
							...address,
							speakerId: character(address.speakerId),
						})),
					}),
				}
				return item.op === 'add'
					? { ...item, entry: { ...remapped, aliases: item.entry.aliases } }
					: { ...item, entry: remapped }
			}
			case 'location':
				return {
					...item,
					entry: {
						...item.entry,
						id: remap.location.get(entry.id) ?? entry.id,
					},
				}
			case 'relation':
				return {
					...item,
					entry: {
						...item.entry,
						from: character(item.entry.from),
						to: character(item.entry.to),
					},
				}
			default:
				return item
		}
	})
}

const selectionKinds = [
	'character',
	'location',
	'relation',
	'timeline',
	'foreshadowing',
	'style',
] as const

function groupRelationAdditions(additions: BiblePatch) {
	const groups = new Map<string, BiblePatch>()
	for (const item of additions) {
		if (item.kind !== 'relation') continue
		const key = JSON.stringify([item.entry.from, item.entry.to].sort())
		const group = groups.get(key) ?? []
		group.push(item)
		groups.set(key, group)
	}
	return [...groups.values()].flat()
}

function selectionCandidates(proposals: BiblePatch, additions: BiblePatch) {
	const first = new Map<string, BiblePatch[number]>()
	for (const item of additions)
		if (!first.has(item.entry.id)) first.set(item.entry.id, item)

	const observations = new Map<
		string,
		Map<string, { chapterId?: string; fact: string }>
	>()
	for (const item of proposals) {
		const { entry, observedChapter } = item
		const initial = first.get(entry.id)
		if (!initial || (item.op !== 'add' && item.op !== 'update')) continue
		const evidence = observations.get(entry.id) ?? new Map()
		const note = (fact?: string, chapterId?: string) => {
			if (fact)
				evidence.set(JSON.stringify([chapterId, fact]), { chapterId, fact })
		}
		if (item !== initial) {
			const chapter = observedChapter ?? entry.firstSeenChapter
			switch (item.kind) {
				case 'character':
					note(item.entry.identity, chapter)
					break
				case 'location':
				case 'relation':
				case 'style':
					note(item.entry.description, chapter)
					break
				case 'timeline':
					note(item.entry.event, item.entry.chapterId)
					break
				case 'foreshadowing':
					note(item.entry.description, item.entry.plantedChapter)
					break
			}
		}
		if (item.kind === 'character')
			for (const { chapterId, fact } of item.entry.knows ?? [])
				note(fact, chapterId)
		if (
			item.kind === 'character' ||
			item.kind === 'location' ||
			item.kind === 'relation'
		)
			for (const { chapterId, field, value } of item.entry.changes ?? [])
				note(`${field}: ${value}`, chapterId)
		observations.set(entry.id, evidence)
	}
	return [...first.values()].map(({ entry, observedChapter }) => {
		const notes = [...(observations.get(entry.id)?.values() ?? [])]
		return {
			...(notes.length && {
				observations:
					notes.length <= 4
						? notes
						: [...notes.slice(0, 2), ...notes.slice(-2)],
			}),
			...entry,
			...(observedChapter && { observedChapter }),
		}
	})
}

export function deduplicateNewTerms(
	glossary: GlossaryPatch,
	existing: GlossaryPatch,
) {
	const key = ({ original, written, pronunciation }: GlossaryPatch[number]) =>
		JSON.stringify([
			original.normalize('NFKC').trim(),
			written.normalize('NFKC').trim(),
			pronunciation?.normalize('NFKC').trim() ?? '',
		])
	const existingIds = new Set(existing.map(({ id }) => id))
	const seen = new Set(existing.map(key))
	return glossary.filter((term) => {
		if (existingIds.has(term.id)) return true
		const name = key(term)
		if (seen.has(name)) return false
		seen.add(name)
		return true
	})
}

/**
 * Lets `choose` keep a subset of each kind's additions, then removes changes
 * and references that only pointed at a dropped addition.
 */
export async function selectAdditions(
	patch: BiblePatch,
	glossary: GlossaryPatch,
	bible: Awaited<ReturnType<typeof readBible>>,
	choose: (
		kind: string,
		candidates: readonly unknown[],
	) => Promise<Set<number>>,
) {
	let selected = patch
	for (const kind of selectionKinds) {
		const proposed = selected.filter((item) => item.kind === kind)
		const additions = proposed.filter(({ op }) => op === 'add')
		if (additions.length < 2) continue
		const candidates = selectionCandidates(
			proposed,
			kind === 'relation' ? groupRelationAdditions(additions) : additions,
		)
		const kept = await choose(kind, candidates)
		const dropped = new Set(
			candidates.flatMap(({ id }, i) => (kept.has(i) ? [] : [id])),
		)
		const existing = new Set(bible[kind].map(({ id }) => id))
		const gone = new Set([...dropped].filter((id) => !existing.has(id)))
		selected = selected.flatMap((item): BiblePatch => {
			if (item.kind === kind && item.op === 'add' && dropped.has(item.entry.id))
				return []
			if (item.kind === kind && gone.has(item.entry.id)) return []
			if (kind !== 'character') return [item]
			if (item.kind === 'relation')
				return gone.has(item.entry.from) || gone.has(item.entry.to)
					? []
					: [item]
			if (item.kind === 'character' && item.entry.addresses)
				return [
					{
						...item,
						entry: {
							...item.entry,
							addresses: item.entry.addresses.filter(
								({ speakerId }) => !gone.has(speakerId),
							),
						},
					} as typeof item,
				]
			return [item]
		})
	}
	const uniqueGlossary = deduplicateNewTerms(glossary, bible.glossary)
	const terms = uniqueGlossary.filter(
		({ id }) => !bible.glossary.some((term) => term.id === id),
	)
	if (terms.length < 2)
		return { biblePatch: selected, glossaryPatch: uniqueGlossary }
	const kept = await choose('glossary', terms)
	return {
		biblePatch: selected,
		glossaryPatch: uniqueGlossary.filter(
			(term) => !terms.includes(term) || kept.has(terms.indexOf(term)),
		),
	}
}
