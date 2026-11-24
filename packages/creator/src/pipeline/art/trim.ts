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
const prefix = (id: string) => id.slice(0, id.lastIndexOf('/'))
const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const sceneActions = ({ beats }: CompiledScene) =>
	beats.flatMap(({ actions }) => actions)

function remapScript(
	script: readonly string[],
	actions: readonly CompiledAction[],
	replacements: ReadonlyMap<string, string | undefined>,
	lines: string[],
) {
	for (const { line, name, args, assets } of actions) {
		const changed = assets.find(({ id }) => replacements.has(id))
		if (!changed) continue
		const replacement = replacements.get(changed.id)
		const original = script[line - 1]
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
				id: replacements.get(asset.id) ?? asset.id,
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
		} else if (replacement && name === 'costume') {
			lines[line - 1] = withAsset(prefix(replacement))
		} else {
			lines[line - 1] = withAsset(replacement ?? 'none')
		}
	}
}

export function trimStagingToBudget(
	initial: Candidate,
	bible: ArtBible,
	registry: AssetRegistry,
	budget: TrimBudget,
	compile: Compile,
	onFailure?: (images: readonly string[], remainingBases: number) => void,
) {
	function evaluate(candidate: Candidate) {
		const plan = planArt(candidate.items, bible, registry, candidate.merges)
		const scenes = compile(candidate.script, plan.registry)
		if (!scenes) return
		const actions = scenes.flatMap(sceneActions)
		const counts = new Map<string, number>()
		for (const { assets } of actions)
			for (const { id } of assets) counts.set(id, (counts.get(id) ?? 0) + 1)
		const newImages = newPlaybackImages(plan, counts.keys(), budget)
		const entries = new Map(
			plan.registry.entries.map((entry) => [entry.id, entry]),
		)
		return { plan, scenes, actions, counts, newImages, entries }
	}

	const trimmed: StageTrim[] = []
	let candidate = initial
	let current = evaluate(candidate)
	if (!current) return
	function attempt(
		state: NonNullable<ReturnType<typeof evaluate>>,
		changes: StageTrim[],
		sceneReplacements?: readonly ReadonlyMap<string, string>[],
		openings?: ReadonlyMap<number, string>,
	) {
		const { plan, entries, scenes, actions, newImages } = state
		const replacements = new Map(
			changes.map(({ id, replacement }) => [id, replacement]),
		)
		const aliases = new Set(
			changes.flatMap(({ id }) => entries.get(id)?.aliases ?? []),
		)
		const removed = (id: string) =>
			replacements.has(id) || (!entries.has(id) && aliases.has(id))
		const items = candidate.items.filter((item) => !removed(item.id))
		const targets = sceneReplacements
			? sceneReplacements.flatMap((replacements) => [...replacements.values()])
			: [...replacements.values()]
		for (const id of new Set(targets)) {
			const base = id && entries.get(id)
			if (
				!base ||
				registry.entries.some(({ id }) => id === base.id) ||
				items.some(({ id }) => id === base.id)
			)
				continue
			const job = plan.jobs.find(({ assetId }) => assetId === base.id)
			if (!job) return
			items.push({ id: base.id, kind: base.type, description: job.description })
		}
		const original = candidate.script.split('\n')
		const lines = [...original]
		if (sceneReplacements)
			for (const [index, scene] of scenes.entries())
				remapScript(
					original,
					sceneActions(scene),
					sceneReplacements[index],
					lines,
				)
		else remapScript(original, actions, replacements, lines)
		if (openings)
			for (const [line, id] of openings)
				lines[line - 1] = `@bg ${id} none\n${lines[line - 1]}`
		const next = {
			script: lines.join('\n'),
			items,
			merges: Object.fromEntries(
				Object.entries(candidate.merges).filter(
					([from, to]) => !removed(from) && !removed(to),
				),
			),
		}
		const evaluated = evaluate(next)
		if (!evaluated || evaluated.newImages.length >= newImages.length) return
		candidate = next
		trimmed.push(...changes)
		return evaluated
	}
	for (const kind of order) {
		while (current.newImages.length > budget.limit) {
			const { plan, counts, newImages, entries } = current
			const choices = newImages
				.filter((id) => entries.get(id)?.type === kind && counts.has(id))
				.sort(
					(a, b) => (counts.get(a) ?? 0) - (counts.get(b) ?? 0) || byId(a, b),
				)
			let changed = false
			for (const id of choices) {
				const job = plan.jobs.find((job) => job.assetId === id)
				const replacement =
					job && 'baseAssetId' in job
						? job.baseAssetId
						: budget.previousBases.get(id)
				if (kind !== 'cg' && !replacement) continue
				const evaluated = attempt(current, [
					{ id, ...(replacement ? { replacement } : {}) },
				])
				if (!evaluated) continue
				current = evaluated
				changed = true
				break
			}
			if (!changed) break
		}
	}
	while (current.newImages.length > budget.limit) {
		const { counts, entries } = current
		const costumes = new Map<
			string,
			Map<string, { id: string; count: number }>
		>()
		const bases = new Map(
			[...entries.values()]
				.filter(({ type }) => type === 'character')
				.map(({ id }) => [prefix(id), id]),
		)
		for (const [id, count] of counts) {
			const type = entries.get(id)?.type
			if (type !== 'character' && type !== 'expression') continue
			const base = bases.get(prefix(id))
			if (!base) continue
			const character = id.split('/')[0]
			const group = costumes.get(character) ?? new Map()
			const costume = group.get(base) ?? { id: base, count: 0 }
			costume.count += count
			group.set(base, costume)
			costumes.set(character, group)
		}
		let folded = false
		foldCharacter: for (const [, group] of [...costumes].sort(([a], [b]) =>
			byId(a, b),
		)) {
			if (group.size < 2) continue
			const ranked = [...group.values()].sort(
				(a, b) => b.count - a.count || byId(a.id, b.id),
			)
			for (const keep of ranked) {
				const foldedPrefixes = new Set(
					ranked.filter((other) => other !== keep).map(({ id }) => prefix(id)),
				)
				const changes = [...entries.values()]
					.filter(
						({ id, type }) =>
							(type === 'character' || type === 'expression') &&
							foldedPrefixes.has(prefix(id)),
					)
					.map(({ id }) => ({ id, replacement: keep.id }))
				const next = attempt(current, changes)
				if (!next) continue
				current = next
				folded = true
				break foldCharacter
			}
		}
		if (!folded) break
	}
	while (current.newImages.length > budget.limit) {
		const { scenes, counts, entries, newImages } = current
		let activeBackground: string | undefined
		const backgrounds = scenes.map(({ beats }) => {
			const counts = new Map<string, number>()
			const inherited =
				beats[0] && !beats[0].actions.some(({ name }) => name === 'bg')
					? activeBackground
					: undefined
			function countBase(id: string | undefined) {
				if (id && entries.get(id)?.type === 'location')
					counts.set(id, (counts.get(id) ?? 0) + 1)
			}
			countBase(inherited)
			for (const { actions } of beats) {
				const cues = actions.filter(({ name }) => name === 'bg')
				for (const { assets } of cues) {
					activeBackground = assets[0]?.id
					countBase(activeBackground)
				}
			}
			return { counts, inherited }
		})
		const choices = newImages
			.filter((id) => entries.get(id)?.type === 'location')
			.sort((a, b) => (counts.get(a) ?? 0) - (counts.get(b) ?? 0) || byId(a, b))
		let folded = false
		for (const id of choices) {
			if (!backgrounds.some(({ counts }) => counts.has(id))) continue
			const replacements: Map<string, string>[] = []
			const openings = new Map<number, string>()
			let remappedBackground: string | undefined
			for (const [index, scene] of scenes.entries()) {
				const { counts: local, inherited } = backgrounds[index]
				const actions = sceneActions(scene)
				if (local.size === 1 && local.has(id)) break
				const remap = new Map<string, string>()
				if (
					inherited === id ||
					actions.some(({ assets }) => assets.some((asset) => asset.id === id))
				) {
					const replacement = [...local.keys()]
						.filter((other) => other !== id)
						.sort(
							(a, b) => (local.get(b) ?? 0) - (local.get(a) ?? 0) || byId(a, b),
						)[0]
					if (!replacement) break
					remap.set(id, replacement)
					if (inherited === id && replacement !== remappedBackground) {
						openings.set(scene.scene.lines[0].line, replacement)
						remappedBackground = replacement
					}
				}
				for (const { name, assets } of actions) {
					if (name === 'bg') {
						const asset = assets[0]?.id
						remappedBackground = asset === id ? remap.get(id) : asset
					}
				}
				replacements.push(remap)
			}
			if (replacements.length !== scenes.length) continue
			const changes = [
				...new Set(replacements.flatMap((map) => [...map.values()])),
			].map((replacement) => ({ id, replacement }))
			const next = attempt(current, changes, replacements, openings)
			if (!next) continue
			current = next
			folded = true
			break
		}
		if (!folded) break
	}
	const { newImages, entries } = current
	if (newImages.length <= budget.limit) return { ...candidate, trimmed }
	onFailure?.(
		newImages,
		newImages.filter((id) => {
			const type = entries.get(id)?.type
			return type === 'character' || type === 'location'
		}).length,
	)
}
