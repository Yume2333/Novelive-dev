import type { AssetRegistry } from '@novelive/format/model'
import type { CompiledAction, CompiledScene } from '@novelive/format/script'
import {
	type ArtBible,
	type ManifestItem,
	newPlaybackImages,
	planArt,
} from './plan'

export type StageTrim = { id: string; replacement?: string }
type Candidate = {
	script: string
	items: ManifestItem[]
	merges: Record<string, string>
}
type TrimBudget = {
	limit: number
	previousBases: ReadonlyMap<string, string>
	reusedImages: ReadonlySet<string>
}
type Compile = (
	script: string,
	registry: AssetRegistry,
) => readonly CompiledScene[] | undefined
const order = ['cg', 'variant', 'expression'] as const
const leaf = (id: string) => id.slice(id.lastIndexOf('/') + 1)

function remapScript(
	script: string,
	actions: readonly CompiledAction[],
	{ id, replacement }: StageTrim,
) {
	const lines = script.split('\n')
	for (const { line, name, args, assets } of actions) {
		if (!assets.some((asset) => asset.id === id)) continue
		const original = lines[line - 1]
		const withAsset = (asset: string) =>
			original.replace(/\S+/g, (token) =>
				token === args.asset ? asset : token,
			)
		if (
			replacement &&
			name === 'face' &&
			String(args.asset).split('/').length === 2
		) {
			const remapped = assets.map((asset) => ({
				...asset,
				id: asset.id === id ? replacement : asset.id,
			}))
			const expressions = new Set(remapped.map((asset) => leaf(asset.id)))
			lines[line - 1] =
				expressions.size === 1
					? withAsset(
							`${String(args.asset).split('/')[0]}/${leaf(remapped[0].id)}`,
						)
					: remapped
							.map(
								({ id, slot }) => `@show ${id} ${slot} none ${args.duration}`,
							)
							.join('\n')
		} else {
			lines[line - 1] = withAsset(replacement ?? 'none')
		}
	}
	return lines.join('\n')
}

export function trimStagingToBudget(
	initial: Candidate,
	bible: ArtBible,
	registry: AssetRegistry,
	budget: TrimBudget,
	compile: Compile,
) {
	function evaluate(candidate: Candidate) {
		const plan = planArt(candidate.items, bible, registry, candidate.merges)
		const scenes = compile(candidate.script, plan.registry)
		if (!scenes) return
		const actions = scenes.flatMap(({ beats }) =>
			beats.flatMap(({ actions }) => actions),
		)
		const counts = new Map<string, number>()
		for (const { assets } of actions)
			for (const { id } of assets) counts.set(id, (counts.get(id) ?? 0) + 1)
		const newImages = newPlaybackImages(plan, counts.keys(), budget)
		return { plan, actions, counts, newImages }
	}

	const trimmed: StageTrim[] = []
	let candidate = initial
	let current = evaluate(candidate)
	if (!current) return
	for (const kind of order) {
		while (current.newImages.length > budget.limit) {
			const { plan, actions, counts, newImages } = current
			const entries = new Map(
				plan.registry.entries.map((entry) => [entry.id, entry]),
			)
			const choices = newImages
				.filter((id) => entries.get(id)?.type === kind && counts.has(id))
				.sort(
					(a, b) =>
						(counts.get(a) ?? 0) - (counts.get(b) ?? 0) ||
						(a < b ? -1 : a > b ? 1 : 0),
				)
			let changed = false
			for (const id of choices) {
				const job = plan.jobs.find((job) => job.assetId === id)
				const replacement =
					job && 'baseAssetId' in job
						? job.baseAssetId
						: budget.previousBases.get(id)
				if (kind !== 'cg' && !replacement) continue
				const trim = { id, ...(replacement ? { replacement } : {}) }
				const aliases = new Set(entries.get(id)?.aliases)
				const removed = (asset: string) =>
					asset === id || (!entries.has(asset) && aliases.has(asset))
				const items = candidate.items.filter((item) => !removed(item.id))
				const base = replacement && entries.get(replacement)
				if (
					base &&
					!registry.entries.some(({ id }) => id === base.id) &&
					!items.some(({ id }) => id === base.id)
				) {
					const job = plan.jobs.find(({ assetId }) => assetId === base.id)
					if (!job) continue
					items.push({
						id: base.id,
						kind: base.type,
						description: job.description,
					})
				}
				const next = {
					script: remapScript(candidate.script, actions, trim),
					items,
					merges: Object.fromEntries(
						Object.entries(candidate.merges).filter(
							([from, to]) => !removed(from) && !removed(to),
						),
					),
				}
				const evaluated = evaluate(next)
				if (!evaluated || evaluated.newImages.length >= newImages.length)
					continue
				candidate = next
				current = evaluated
				trimmed.push(trim)
				changed = true
				break
			}
			if (!changed) break
		}
	}
	if (current.newImages.length <= budget.limit) return { ...candidate, trimmed }
}
