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
		const additions = selected.filter(
			(item) => item.kind === kind && item.op === 'add',
		)
		if (additions.length < 2) continue
		const kept = await choose(
			kind,
			additions.map(({ entry, observedChapter }) =>
				observedChapter ? { ...entry, observedChapter } : entry,
			),
		)
		const dropped = new Set(additions.filter((_, i) => !kept.has(i)))
		const survivors = new Set(
			[
				...bible[kind].map(({ id }) => id),
				...selected.flatMap((item) =>
					item.kind === kind && !dropped.has(item) ? [item.entry.id] : [],
				),
			].filter(Boolean),
		)
		const gone = new Set(
			[...dropped]
				.map(({ entry }) => entry.id)
				.filter((id) => !survivors.has(id)),
		)
		selected = selected.flatMap((item): BiblePatch => {
			if (dropped.has(item)) return []
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
	const terms = glossary.filter(
		({ id }) => !bible.glossary.some((term) => term.id === id),
	)
	if (terms.length < 2) return { biblePatch: selected, glossaryPatch: glossary }
	const kept = await choose('glossary', terms)
	return {
		biblePatch: selected,
		glossaryPatch: glossary.filter(
			(term) => !terms.includes(term) || kept.has(terms.indexOf(term)),
		),
	}
}
