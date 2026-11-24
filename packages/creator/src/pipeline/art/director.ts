import { arr, map, obj, oneOf, str } from '@earendil-works/pi-schema'
import { type AssetRegistry, assetId } from '@novelive/format/model'
import {
	compileScript,
	formatScene,
	parseScript,
} from '@novelive/format/script'
import { buildTextModel, type TextConnection } from '../../models/text'
import { ArtResponseFormatError, artJson, type ModelOptions } from './models'
import {
	type ArtBible,
	type ManifestItem,
	manifestIdShapes,
	planArt,
	validateManifestIds,
} from './plan'

const responseSchema = obj({
	patch: str(),
	items: arr(
		obj({
			id: assetId,
			kind: oneOf(['character', 'location', 'cg', 'expression', 'variant']),
			description: str({ minLength: 1 }),
		}),
	),
	merges: map(assetId),
})

const manifestIdGuidance = Object.entries(manifestIdShapes)
	.map(([kind, shape]) => `${kind}: ${shape}`)
	.join('; ')

function repairReply(phase: string, error: string, reply?: unknown) {
	return [
		`Repair the ${phase}: ${error}`,
		'Return only the corrected JSON object. Apply the asset ID contract above to every item, and update affected patch and merge references together. Preserve unchanged items and stage directions.',
		...(reply === undefined
			? []
			: [`Rejected response:\n${JSON.stringify(reply)}`]),
	].join('\n')
}

export type CgReferences = { costumes: readonly string[]; location?: string }
type ScriptOptions = NonNullable<Parameters<typeof parseScript>[1]>

function sceneReferences(
	script: string,
	registry: AssetRegistry,
	options: ScriptOptions,
) {
	const references = new Map<string, CgReferences>()
	const cast = new Map<string, string>()
	let location: string | undefined
	const baseFor = (id: string, kind: 'character' | 'location') => {
		const prefix = id.split('/').slice(0, -1).join('/')
		return registry.entries.find(
			(entry) => entry.type === kind && entry.id.startsWith(`${prefix}/`),
		)?.id
	}
	for (const scene of parseScript(script, options).scenes) {
		for (const line of scene.lines) {
			if (line.type !== 'action') continue
			const asset = String(line.args.asset)
			switch (line.name) {
				case 'bg':
					location = baseFor(asset, 'location')
					break
				case 'show': {
					const base = baseFor(asset, 'character')
					if (base) cast.set(String(line.args.slot), base)
					break
				}
				case 'hide': {
					const target = String(line.args.target)
					if (!cast.delete(target))
						for (const [slot, id] of cast)
							if (id.startsWith(`${target}/`)) cast.delete(slot)
					break
				}
				case 'costume':
				case 'face': {
					if (line.name === 'face' && asset.split('/').length !== 3) break
					const base = baseFor(
						line.name === 'costume' ? `${asset}/neutral` : asset,
						'character',
					)
					if (base)
						for (const [slot, id] of cast)
							if (id.split('/')[0] === asset.split('/')[0]) cast.set(slot, base)
					break
				}
				case 'cg':
					if (asset !== 'none')
						references.set(asset, {
							costumes: [
								...new Set([
									...(references.get(asset)?.costumes ?? []),
									...cast.values(),
								]),
							],
							location: references.get(asset)?.location ?? location,
						})
					break
			}
		}
	}
	return references
}

export function applyStagingPatch(
	script: string,
	patch: string,
	options?: ScriptOptions,
) {
	if (!patch.trim()) return script
	const lines = script.trimEnd().split('\n')
	const operations =
		/^(?:PUT ([<>]?)([1-9]\d*)(?:\.=([1-9]\d*))?:|CUT ([1-9]\d*))$/gm
	const commands = [...patch.matchAll(operations)]
	if (!commands.length || patch.slice(0, commands[0].index).trim())
		throw new Error('Use PUT <N:, PUT >N:, PUT N.=M:, or CUT N.')
	const changes = commands
		.map(([header, side, start, end, cut], index) => {
			const command = commands[index]
			const after = patch
				.slice(command.index + header.length, commands[index + 1]?.index)
				.trim()
			const line = Number(start ?? cut) - 1
			const last = end ? Number(end) - 1 : line
			const at = line + Number(side === '>')
			const count = side ? 0 : last - line + 1
			const inserted = after ? after.split('\n') : []
			const editable = (value: string) =>
				/^@(?!wait\b|caption\b)\w+/.test(value.trim())
			if (
				line >= lines.length ||
				last >= lines.length ||
				last < line ||
				(side && end) ||
				(!side && !end && !cut) ||
				(cut ? after : !after) ||
				inserted.some((value) => !editable(value)) ||
				lines.slice(at, at + count).some((value) => !editable(value))
			)
				throw new Error(`Invalid staging patch operation: ${header}`)
			return { at, count, inserted }
		})
		.sort((a, b) => a.at - b.at)
	let previousEnd = -1
	for (const { at, count } of changes) {
		if (at <= previousEnd)
			throw new Error('Overlapping staging patch operations')
		previousEnd = at + Math.max(0, count - 1)
	}
	for (const { at, count, inserted } of changes.reverse())
		lines.splice(at, count, ...inserted)
	const output = `${lines.join('\n')}\n`
	const parsed = parseScript(output, options)
	if (parsed.diagnostics.some((item) => item.code.startsWith('E_')))
		throw new Error(JSON.stringify(parsed.diagnostics))
	return output
}

export async function directChapterArt(
	script: string,
	bible: ArtBible,
	registry: AssetRegistry,
	options: ModelOptions & ScriptOptions & { main: TextConnection },
) {
	const scriptOptions = { customMarks: [...(options.customMarks ?? [])] }
	const parsed = parseScript(script, scriptOptions)
	if (parsed.diagnostics.some((item) => item.code.startsWith('E_')))
		throw new Error('The art director requires a valid chapter script')
	const context = JSON.stringify({ bible, registry })
	const assetContract = [
		`Asset ID contract — required items[].id shape by kind: ${manifestIdGuidance}.`,
		'Each segment starts with a lowercase ASCII letter or digit; the rest may also include underscores and hyphens. Slashes separate segments. Bare character and place IDs are not asset IDs.',
		'For kind "character" (a costume base) use all three segments, ending in neutral for a new default base (e.g. ada/uniform/neutral), never ada or ada/uniform. An expression uses the same character/costume prefix with its own expression ID.',
		'For kind "location" (a place base) use both segments, ending in day for a new default base (e.g. room/day), never room. A variant uses the same place prefix with its own variant ID.',
		'Build new asset IDs in the per-kind shape above using single-segment IDs from the bible. Reuse a full ID verbatim only from registry.entries. Keep patch and merge references consistent with the registered or declared asset IDs.',
	].join('\n')
	const scenes = parsed.scenes.map(formatScene)
	const budget =
		Math.floor((buildTextModel(options.main).contextWindow - 4096) / 4) -
		context.length -
		assetContract.length -
		1024
	const batches = script.length <= budget ? [script] : scenes
	const items: ManifestItem[] = []
	const merges: Record<string, string> = {}
	const staged: string[] = []
	for (const [i, batch] of batches.entries()) {
		const numbered = batch
			.trimEnd()
			.split('\n')
			.map((line, index) => `${index + 1}: ${line}`)
			.join('\n')
		const brief = [
			'You are the art director. Add stage directions to the numbered NVS script without changing dialogue, scene headings or source ranges.',
			'Reply with JSON {"patch":"...","items":[{"id":"asset-id","kind":"character|location|cg|expression|variant","description":"one visible description"}],"merges":{"synonymous-expression-id":"registered-expression-id"}}.',
			'Patch operations on original 1-based lines: PUT <N:, PUT >N:, PUT N.=M: followed by stage directions on new lines; CUT N deletes a stage direction. Do not label existing/pending or invent base links.',
			'Use @bg place/variant, @show character/costume/expression left|center|right, and @cg cg-name.',
			'Reuse matching backgrounds, costume bases and expressions from the registry or accumulated manifest. Only request a new expression or background variant for a meaningful visual change, and reserve CGs for pivotal moments that ordinary staging cannot show. List only assets used by stage directions.',
			assetContract,
			`Bible and registered assets: ${context}`,
			...(batches.length > 1
				? [
						`Previous scene (read only): ${scenes[i - 1] ?? ''}`,
						`Next scene (read only): ${scenes[i + 1] ?? ''}`,
						`Accumulated image manifest: ${JSON.stringify(items)}`,
					]
				: []),
			numbered,
		].join('\n')
		let repair: string | undefined
		let triedStagingRepair = false
		let triedFormatRepair = false
		for (;;) {
			const result = await artJson(
				options.main,
				repair ? `${brief}\n${repair}` : brief,
				responseSchema,
				options,
				[],
				'caller',
			).catch((error: unknown) => {
				if (!(error instanceof ArtResponseFormatError) || triedFormatRepair)
					throw error
				triedFormatRepair = true
				repair = repairReply('JSON manifest', error.message, error.rejected)
			})
			if (!result) continue
			try {
				validateManifestIds(result.items)
				const resultScript = applyStagingPatch(
					batch,
					result.patch,
					scriptOptions,
				)
				const plan = planArt([...items, ...result.items], bible, registry, {
					...merges,
					...result.merges,
				})
				const { diagnostics } = compileScript(
					[...staged, resultScript].join('\n'),
					{
						...scriptOptions,
						assets: plan.registry.entries,
						speakers: [],
						paragraphIds: [],
					},
				)
				// The writer owns dialogue and source validation; only check image references here.
				const missing = diagnostics.find(({ code }) => code === 'E_ASSET')
				if (missing) throw new Error(missing.message)
				staged.push(resultScript)
				items.push(...result.items)
				Object.assign(merges, result.merges)
				break
			} catch (error) {
				if (triedStagingRepair) throw error
				triedStagingRepair = true
				repair = repairReply(
					'staging patch and manifest',
					error instanceof Error ? error.message : String(error),
					result,
				)
			}
		}
	}
	const output = staged.join('\n')
	const plan = planArt(items, bible, registry, merges)
	return {
		script: output,
		items,
		merges,
		cgReferences: sceneReferences(output, plan.registry, scriptOptions),
	}
}
