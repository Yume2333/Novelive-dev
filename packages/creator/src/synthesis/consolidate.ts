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
			if (item.kind === kind && (item.op === 'delete' || item.op === 'none'))
				protectedIds.add(item.entry.id)
		const idsByName = new Map<string, Set<string>>()
		const namesById = new Map<string, Set<string>>()
		const explicitNames = new Map<string, Set<string>>()
		const signals = new Map<string, Set<string>>()
		const labelsById = new Map<string, Set<string>>()
		const rawLabelsById = new Map<string, string[]>()
		const firstEntryById = new Map<
			string,
			{ name: string; originalName?: string }
		>()
		for (const item of patch) {
			if (item.kind !== kind || item.op !== 'add') continue
			const { id, name, originalName } = item.entry
			const key = nameKey(name)
			if (!key) continue
			if (!firstEntryById.has(id))
				firstEntryById.set(id, { name, originalName })
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
			const allLabels = labelsById.get(id) ?? new Set<string>()
			allLabels.add(key)
			const rawLabels = rawLabelsById.get(id) ?? []
			rawLabels.push(name)
			if (originalName && nameKey(originalName)) {
				allLabels.add(nameKey(originalName))
				rawLabels.push(originalName)
			}
			const evidence = signals.get(id) ?? new Set<string>()
			const aliases =
				'aliases' in item.entry && Array.isArray(item.entry.aliases)
					? item.entry.aliases.filter(
							(alias): alias is string => typeof alias === 'string',
						)
					: []
			for (const alias of [originalName, ...aliases]) {
				const label = alias && nameKey(alias)
				if (label) {
					allLabels.add(label)
					if (alias) rawLabels.push(alias)
				}
				if (label && label !== key) evidence.add(`alias:${label}`)
			}
			labelsById.set(id, allLabels)
			rawLabelsById.set(id, rawLabels)
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
			for (const alias of ids.slice(1)) {
				remap[kind].set(alias, ids[0])
				const targetLabels = labelsById.get(ids[0])
				for (const label of labelsById.get(alias) ?? [])
					targetLabels?.add(label)
				rawLabelsById.get(ids[0])?.push(...(rawLabelsById.get(alias) ?? []))
			}
		}
		const labelOwners = new Map<string, Set<string>>()
		for (const [id, labels] of labelsById) {
			if (remap[kind].has(id)) continue
			for (const label of labels) {
				const owners = labelOwners.get(label) ?? new Set<string>()
				owners.add(id)
				labelOwners.set(label, owners)
			}
		}
		const sharesChar = (a: string, b: string) =>
			[...a].some((char) => b.includes(char))
		const orderedIds = [...firstEntryById.keys()]
		for (let i = 0; i < orderedIds.length; i++) {
			const id = orderedIds[i]
			if (
				remap[kind].has(id) ||
				protectedIds.has(id) ||
				namesById.get(id)?.size !== 1
			)
				continue
			const base = firstEntryById.get(id)
			const baseLabels = labelsById.get(id)
			if (!base || !baseLabels) continue
			const baseKey = nameKey(base.name)
			for (let j = i + 1; j < orderedIds.length; j++) {
				const otherId = orderedIds[j]
				if (
					remap[kind].has(otherId) ||
					protectedIds.has(otherId) ||
					namesById.get(otherId)?.size !== 1
				)
					continue
				const other = firstEntryById.get(otherId)
				const otherLabels = labelsById.get(otherId)
				if (!other || !otherLabels) continue
				const otherKey = nameKey(other.name)
				if (otherKey === baseKey) continue
				const mutual = baseLabels.has(otherKey) && otherLabels.has(baseKey)
				const uniqueOneWay =
					sharesChar(baseKey, otherKey) &&
					((baseLabels.has(otherKey) &&
						labelOwners.get(otherKey)?.size === 2) ||
						(otherLabels.has(baseKey) && labelOwners.get(baseKey)?.size === 2))
				if (!mutual && !uniqueOneWay) continue
				if (
					base.originalName &&
					other.originalName &&
					nameKey(base.originalName) !== nameKey(other.originalName)
				)
					continue
				if (
					kind === 'character' &&
					relations.some(
						({ from, to }) =>
							(from === id && to === otherId) ||
							(from === otherId && to === id),
					)
				)
					continue
				remap[kind].set(otherId, id)
				for (const label of otherLabels) baseLabels.add(label)
				rawLabelsById.get(id)?.push(...(rawLabelsById.get(otherId) ?? []))
			}
		}
	}
	if (!remap.character.size && !remap.location.size) return patch
	const character = (id: string) => remap.character.get(id) ?? id
	const mergedAliases = new Map<string, string[]>()
	for (const [aliasId, targetId] of remap.character) {
		const extra = mergedAliases.get(targetId) ?? []
		for (const item of patch) {
			if (
				item.kind !== 'character' ||
				(item.op !== 'add' && item.op !== 'update')
			)
				continue
			if (item.entry.id === aliasId || item.entry.id === targetId) {
				extra.push(
					item.entry.name,
					...(item.entry.originalName ? [item.entry.originalName] : []),
					...(item.entry.aliases ?? []),
				)
			}
		}
		mergedAliases.set(targetId, extra)
	}
	return patch.map((item) => {
		const { entry } = item
		switch (item.kind) {
			case 'character': {
				const targetId = character(entry.id)
				const remapped = {
					...item.entry,
					id: targetId,
					...(item.entry.addresses && {
						addresses: item.entry.addresses.map((address) => ({
							...address,
							speakerId: character(address.speakerId),
						})),
					}),
				}
				if (item.op !== 'add') return { ...item, entry: remapped }
				const extra = mergedAliases.get(targetId)
				const aliases = extra
					? [...new Set([...item.entry.aliases, ...extra])].filter(
							(label) =>
								nameKey(label) && nameKey(label) !== nameKey(item.entry.name),
						)
					: item.entry.aliases
				return { ...item, entry: { ...remapped, aliases } }
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

export type SelectionGroup = {
	kind: (typeof selectionKinds)[number] | 'glossary'
	entries: readonly { id: string }[]
}

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
	const existingSpellings = new Set(existing.map(key))
	const result: GlossaryPatch = []
	const grouped = new Map<string, { index: number; notes: Set<string> }>()
	for (const term of glossary) {
		if (existingIds.has(term.id)) {
			result.push(term)
			continue
		}
		const name = key(term)
		if (existingSpellings.has(name)) continue
		const prior = grouped.get(name)
		if (!prior) {
			grouped.set(name, {
				index: result.length,
				notes: new Set(term.note ? [term.note] : []),
			})
			result.push(term)
		} else if (term.note && !prior.notes.has(term.note)) {
			prior.notes.add(term.note)
			result[prior.index] = {
				...result[prior.index],
				note: [...prior.notes].join('\n\n'),
			}
		}
	}
	return result
}

/**
 * Lets `choose` compare all additions, then removes changes
 * and references that only pointed at a dropped addition.
 */
export async function selectAdditions(
	patch: BiblePatch,
	glossary: GlossaryPatch,
	bible: Awaited<ReturnType<typeof readBible>>,
	choose: (groups: readonly SelectionGroup[]) => Promise<Set<number>>,
) {
	const groups: SelectionGroup[] = []
	for (const kind of selectionKinds) {
		const proposed = patch.filter((item) => item.kind === kind)
		const additions = proposed.filter(({ op }) => op === 'add')
		if (!additions.length) continue
		groups.push({
			kind,
			entries: selectionCandidates(
				proposed,
				kind === 'relation' ? groupRelationAdditions(additions) : additions,
			),
		})
	}
	const uniqueGlossary = deduplicateNewTerms(glossary, bible.glossary)
	const existingTerms = new Set(bible.glossary.map(({ id }) => id))
	const terms = uniqueGlossary.filter(({ id }) => !existingTerms.has(id))
	if (terms.length) groups.push({ kind: 'glossary', entries: terms })
	if (!groups.length)
		return { biblePatch: patch, glossaryPatch: uniqueGlossary }
	const kept = await choose(groups)
	const dropped = new Map<SelectionGroup['kind'], Set<string>>()
	const gone = new Map<SelectionGroup['kind'], Set<string>>()
	const keptTerms = new Set<(typeof terms)[number]>()
	let position = 0
	for (const { kind, entries } of groups) {
		if (kind === 'glossary') {
			for (const term of terms) if (kept.has(++position)) keptTerms.add(term)
			continue
		}
		const rejected = new Set(
			entries.flatMap(({ id }) => (kept.has(++position) ? [] : [id])),
		)
		const existing = new Set(bible[kind].map(({ id }) => id))
		dropped.set(kind, rejected)
		gone.set(kind, new Set([...rejected].filter((id) => !existing.has(id))))
	}
	const missingCharacters = gone.get('character')
	return {
		biblePatch: patch.flatMap((item): BiblePatch => {
			const { kind, op, entry } = item
			if (
				(op === 'add' && dropped.get(kind)?.has(entry.id)) ||
				gone.get(kind)?.has(entry.id)
			)
				return []
			if (
				item.kind === 'relation' &&
				(missingCharacters?.has(item.entry.from) ||
					missingCharacters?.has(item.entry.to))
			)
				return []
			if (
				item.kind === 'character' &&
				item.entry.addresses &&
				missingCharacters?.size
			)
				return [
					{
						...item,
						entry: {
							...item.entry,
							addresses: item.entry.addresses.filter(
								({ speakerId }) => !missingCharacters.has(speakerId),
							),
						},
					} as typeof item,
				]
			return [item]
		}),
		glossaryPatch: uniqueGlossary.filter(
			(term) => existingTerms.has(term.id) || keptTerms.has(term),
		),
	}
}
