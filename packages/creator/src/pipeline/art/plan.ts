import { compile } from '@earendil-works/pi-schema'
import {
	type AssetRegistry,
	assetId,
	type Character,
	formatVersion,
	type ImageQueueItem,
	type Location,
	type Style,
} from '@novelive/format/model'

type Entry = AssetRegistry['entries'][number]
type Kind = Entry['type']
export type ManifestItem = { id: string; kind: Kind; description: string }
export type ArtJob = ImageQueueItem & { description: string }
export type ArtBible = {
	style: Style
	characters: readonly (Character & { major?: boolean })[]
	locations: readonly Location[]
}

export function assetPath(id: string, kind: Kind) {
	const folder =
		kind === 'cg'
			? 'cg'
			: kind === 'character' || kind === 'expression'
				? 'characters'
				: 'locations'
	return `assets/${folder}/${id}.webp`
}

const validId = compile(assetId).check
const normalize = (value: string) =>
	value.normalize('NFKC').trim().toLowerCase()

// The director supplies semantic merges; identical registered descriptions
// also resolve without another model decision.
export function planArt(
	items: readonly ManifestItem[],
	bible: ArtBible,
	previous: AssetRegistry,
	merges: Readonly<Record<string, string>> = {},
) {
	const entries = new Map(
		previous.entries.map((entry) => [
			entry.id,
			{ ...entry, aliases: [...entry.aliases] },
		]),
	)
	const jobs = new Map<string, ArtJob>()
	const cg: { id: string; description: string }[] = []
	const prefix = (id: string) => id.slice(0, id.lastIndexOf('/'))
	const leaf = (id: string) => id.slice(id.lastIndexOf('/') + 1)
	function check(id: string, kind: Kind) {
		const parts = id.split('/').length
		if (
			!validId(id) ||
			parts !==
				(kind === 'cg'
					? 1
					: kind === 'character' || kind === 'expression'
						? 3
						: 2)
		)
			throw new Error(`Invalid ${kind} asset: ${id}`)
	}
	for (const item of items) check(item.id, item.kind)
	const declared = new Map(items.map((item) => [item.id, item]))
	function add(
		id: string,
		kind: Kind,
		description: string,
		baseAssetId?: string,
	) {
		const entry = entries.get(id)
		if (entry && entry.type !== kind)
			throw new Error(`Conflicting type for ${id}`)
		if (!entry)
			entries.set(id, {
				id,
				type: kind,
				path: assetPath(id, kind),
				status: 'pending',
				aliases: [],
			})
		if (jobs.has(id)) return
		if (kind === 'expression' || kind === 'variant') {
			if (!baseAssetId) throw new Error(`Missing base for ${id}`)
			jobs.set(id, { assetId: id, kind, description, baseAssetId })
		} else jobs.set(id, { assetId: id, kind, description })
	}
	function base(
		id: string,
		kind: 'character' | 'location',
		description: string,
	) {
		const registered = [...entries.values()].find(
			(entry) => entry.type === kind && prefix(entry.id) === prefix(id),
		)
		const requested = items.find(
			(item) => item.kind === kind && prefix(item.id) === prefix(id),
		)
		const baseId =
			registered?.id ??
			requested?.id ??
			`${prefix(id)}/${kind === 'character' ? 'neutral' : 'day'}`
		add(baseId, kind, declared.get(baseId)?.description ?? description)
		return baseId
	}
	for (const item of items) {
		const [entity, costume] = item.id.split('/')
		const character = bible.characters.find((entry) => entry.id === entity)
		const location = bible.locations.find((entry) => entry.id === entity)
		if (item.kind === 'expression') {
			const expressions = character?.expressions ?? []
			const registered = [...entries.values()].find((entry) =>
				entry.aliases.includes(item.id),
			)
			const exact = expressions.find((entry) => entry.id === leaf(item.id))
			const equivalent = exact
				? undefined
				: expressions.find(
						(entry) =>
							normalize(entry.description) === normalize(item.description),
					)
			const canonical =
				registered?.id ??
				(exact ? item.id : merges[item.id]) ??
				(equivalent ? `${prefix(item.id)}/${equivalent.id}` : item.id)
			check(canonical, 'expression')
			if (prefix(canonical) !== prefix(item.id))
				throw new Error(`Expression synonym crosses costumes: ${item.id}`)
			const baseId = base(
				item.id,
				'character',
				character?.costumes?.find((entry) => entry.id === costume)
					?.description ?? '',
			)
			if (canonical !== baseId)
				add(
					canonical,
					'expression',
					expressions.find((entry) => entry.id === leaf(canonical))
						?.description ??
						declared.get(canonical)?.description ??
						item.description,
					baseId,
				)
			const entry = entries.get(canonical)
			if (entry && canonical !== item.id && !entry.aliases.includes(item.id))
				entry.aliases.push(item.id)
		} else if (item.kind === 'variant') {
			add(
				item.id,
				item.kind,
				item.description,
				base(item.id, 'location', location?.description ?? ''),
			)
		} else {
			if (item.kind === 'cg' && !jobs.has(item.id))
				cg.push({ id: item.id, description: item.description })
			add(item.id, item.kind, item.description)
		}
	}
	const registry: AssetRegistry = {
		formatVersion,
		entries: [...entries.values()],
	}
	return {
		registry,
		jobs: [...jobs.values()],
		cg,
	}
}
