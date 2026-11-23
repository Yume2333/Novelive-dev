import type { BiblePatch } from '@novelive/format/model'
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
	for (const kind of ['character', 'location'] as const) {
		const protectedIds = new Set(bible[kind].map(({ id }) => id))
		for (const item of patch)
			if (item.kind === kind && item.op !== 'add')
				protectedIds.add(item.entry.id)
		const idsByName = new Map<string, Set<string>>()
		const namesById = new Map<string, Set<string>>()
		const explicitNames = new Map<string, Set<string>>()
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
		}
		for (const [key, group] of idsByName) {
			const ids = [...group]
			if (
				ids.length < 2 ||
				(explicitNames.get(key)?.size ?? 0) > 1 ||
				ids.some((id) => protectedIds.has(id) || namesById.get(id)?.size !== 1)
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
			case 'character':
				return {
					...item,
					entry: {
						...item.entry,
						id: character(entry.id),
						...(item.entry.addresses && {
							addresses: item.entry.addresses.map((address) => ({
								...address,
								speakerId: character(address.speakerId),
							})),
						}),
					},
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
