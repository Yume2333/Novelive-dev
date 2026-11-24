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
import type { CompiledScene } from '@novelive/format/script'

type Entry = AssetRegistry['entries'][number]
type Kind = Entry['type']
export type ManifestItem = { id: string; kind: Kind; description: string }
export type ArtJob = ImageQueueItem & { description: string }
type PlanBudget = {
	limit: number
	references: (registry: AssetRegistry) => Iterable<string>
	previousBases: ReadonlyMap<string, string>
	reusedImages?: ReadonlySet<string>
}

export function playbackAssetIds(scenes: readonly CompiledScene[]) {
	return new Set(
		scenes.flatMap(({ beats }) =>
			beats.flatMap(({ actions }) =>
				actions.flatMap(({ assets }) => assets.map(({ id }) => id)),
			),
		),
	)
}
export type ArtBible = {
	style: Style
	characters: readonly (Character & { major?: boolean })[]
	locations: readonly Location[]
}

export const manifestIdShapes = {
	character: 'character/costume/expression',
	expression: 'character/costume/expression',
	location: 'place/variant',
	variant: 'place/variant',
	cg: 'cg-name',
} satisfies Record<Kind, string>

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

function manifestIdError(id: string, kind: Kind) {
	const shape = manifestIdShapes[kind]
	if (!validId(id) || id.split('/').length !== shape.split('/').length)
		return `Invalid ${kind} asset ${JSON.stringify(id)}; expected ${shape}`
}

export function validateManifestIds(items: readonly ManifestItem[]) {
	const errors = items.flatMap(({ id, kind }, i) => {
		const error = manifestIdError(id, kind)
		return error ? [`/items/${i}/id: ${error}`] : []
	})
	if (errors.length) throw new Error(errors.join('\n'))
}

// The director supplies semantic merges; identical registered descriptions
// also resolve without another model decision.
export function planArt(
	items: readonly ManifestItem[],
	bible: ArtBible,
	previous: AssetRegistry,
	merges: Readonly<Record<string, string>> = {},
	budget?: PlanBudget,
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
	validateManifestIds(items)
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
			const error = manifestIdError(canonical, 'expression')
			if (error) throw new Error(error)
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
	if (budget) {
		const needed = new Set(budget.references(registry))
		for (const id of needed) {
			if (entries.get(id)?.status === 'drawn') continue
			const job = jobs.get(id)
			const baseId =
				job && 'baseAssetId' in job
					? job.baseAssetId
					: budget.previousBases.get(id)
			if (baseId) needed.add(baseId)
		}
		const newImages = [...needed].filter(
			(id) =>
				entries.get(id)?.status !== 'drawn' && !budget.reusedImages?.has(id),
		)
		if (newImages.length > budget.limit)
			throw new Error(
				`Chapter needs ${newImages.length} new provider images; budget is ${budget.limit}. Over-budget assets: ${newImages.slice(budget.limit).join(', ')}`,
			)
	}
	return {
		registry,
		jobs: [...jobs.values()],
		cg,
	}
}
