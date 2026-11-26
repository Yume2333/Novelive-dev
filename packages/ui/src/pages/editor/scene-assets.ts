import {
	type CompileOptions,
	compileScript,
	portraitsAt,
} from '@novelive/format/script'

export function sceneAssets(
	script: string,
	options: CompileOptions,
	sceneIndex: number,
) {
	const result = compileScript(script, options)
	if (!result.ok) return []
	const ids = new Set<string>()
	let background: string | undefined
	let cg: string | undefined
	let foreground: string | undefined
	const sprites = new Map<string, string>()
	for (const [index, scene] of result.scenes.entries()) {
		for (const [beatIndex, beat] of scene.beats.entries()) {
			for (const action of beat.actions) {
				if (index === sceneIndex)
					for (const asset of action.assets) ids.add(asset.id)
				const asset = action.assets[0]?.id
				switch (action.name) {
					case 'bg':
						background = asset
						break
					case 'cg':
						cg = action.args.asset === 'none' ? undefined : asset
						break
					case 'fg':
						foreground = action.args.asset === 'none' ? undefined : asset
						break
					case 'show': {
						const slot = String(action.args.slot)
						if (asset) sprites.set(slot, asset)
						break
					}
					case 'hide': {
						const target = String(action.args.target)
						// Match the compiler: a slot name always clears that slot, even
						// when empty; otherwise the target is a character id prefix.
						if (target === 'left' || target === 'center' || target === 'right')
							sprites.delete(target)
						else
							for (const [slot, id] of sprites)
								if (id.split('/')[0] === target) sprites.delete(slot)
						break
					}
					case 'face':
					case 'costume':
						for (const item of action.assets) {
							for (const [slot, id] of sprites)
								if (
									item.slot
										? slot === item.slot
										: id.split('/')[0] === item.id.split('/')[0]
								)
									sprites.set(slot, item.id)
						}
						break
				}
			}
			if (index === sceneIndex && beatIndex === 0) {
				if (background) ids.add(background)
				if (cg) ids.add(cg)
				if (foreground) ids.add(foreground)
				for (const assetId of sprites.values()) ids.add(assetId)
			}
		}
		if (index === sceneIndex) break
	}
	return options.assets.filter(
		(asset) => ids.has(asset.id) && asset.status !== 'pending',
	)
}

export function lineExpression(
	scenes: readonly { sceneId: string; nvs: string }[],
	sceneIndex: number,
	line: number,
	options: Omit<CompileOptions, 'sceneIds' | 'previous' | 'makeId'>,
) {
	const target = scenes[sceneIndex]
	if (!target) return undefined
	const lineId = target.nvs
		.split(/\r\n?|\n/)
		[line - 1]?.match(/ #([0-9a-f]{4})\s*$/)?.[1]
	if (!lineId) return undefined
	const result = compileScript(
		scenes.map((item) => item.nvs.replace(/\r\n?|\n/g, '\n')).join('\n'),
		{ ...options, sceneIds: scenes.map((item) => item.sceneId) },
	)
	if (!result.ok) return undefined
	const beat = result.scenes[sceneIndex]?.beats.find(
		(item) => item.line?.id === lineId,
	)
	if (!beat?.line) return undefined
	const speaker = beat.line.type === 'text' ? beat.line.speaker : undefined
	// Match the backend's uniqueness rule: exactly one visible portrait may
	// carry the current expression, counting occupied slots (not unique ids).
	const portraits = [...portraitsAt(result.scenes, beat).values()]
		.map(({ id }) => id)
		.filter((id) => speaker === undefined || id.split('/')[0] === speaker)
	const active = [...new Set(portraits)]
	if (
		active.length !== 1 ||
		portraits.length !== 1 ||
		active[0].split('/').length !== 3
	)
		return undefined
	const current = active[0]
	const base = current.split('/').slice(0, -1).join('/')
	const choices = options.assets
		.filter(
			(asset) =>
				(asset.type === 'expression' || asset.type === 'character') &&
				asset.status !== 'pending' &&
				asset.id.split('/').length === 3 &&
				asset.id.split('/').slice(0, -1).join('/') === base,
		)
		.map((asset) => asset.id)
	if (choices.length < 2) return undefined
	return { lineId, current, choices }
}

export interface StageCastMember {
	slot: 'left' | 'center' | 'right'
	assetId: string
	path?: string
	charId: string
	outfit?: string
	expression?: string
}

export interface StageSnapshot {
	sceneTitle: string
	background?: { id: string; path?: string }
	cg?: { id: string; path?: string }
	foreground?: { id: string; path?: string }
	cast: StageCastMember[]
	paragraphFirstLine: Record<string, number>
}

type SlotName = 'left' | 'center' | 'right'
const slotOrder: readonly SlotName[] = ['left', 'center', 'right']

function expandSourceIds(raw: string): string[] {
	const ids: string[] = []
	for (const token of raw.split(/[\s,]+/).filter(Boolean)) {
		const rangeMatch = token.match(/^(p\d+)-(p\d+)$/)
		if (rangeMatch) {
			const start = Number(rangeMatch[1].slice(1))
			const end = Number(rangeMatch[2].slice(1))
			const width = rangeMatch[1].length - 1
			for (let i = start; i <= end; i++)
				ids.push(`p${String(i).padStart(width, '0')}`)
		} else {
			ids.push(token)
		}
	}
	return ids
}

const sentenceLinePattern =
	/^(?:@caption\b|(?:[a-z0-9][a-z0-9_-]*(?:\s+\(inner\))?(?:\s+as\s+[^:]+)?)?:)/

export function buildParagraphFirstLine(
	nvs: string,
	sceneSourceIds: readonly string[] | undefined,
): Record<string, number> {
	const map: Record<string, number> = {}
	const lines = nvs.split(/\r\n?|\n/)
	let pendingSources: string[] = []
	let firstSentenceLine = 0
	for (const [index, raw] of lines.entries()) {
		const lineNumber = index + 1
		const sourceMatch = raw.match(/^source\s+(.+)/)
		if (sourceMatch) {
			pendingSources = expandSourceIds(sourceMatch[1])
			continue
		}
		if (!sentenceLinePattern.test(raw.trimStart())) continue
		if (!firstSentenceLine) firstSentenceLine = lineNumber
		for (const id of pendingSources) {
			if (!(id in map)) map[id] = lineNumber
		}
		pendingSources = []
	}
	// Fallback: any scene.sourceIds not yet mapped point to the first sentence line.
	if (sceneSourceIds && firstSentenceLine) {
		for (const id of sceneSourceIds) {
			if (!(id in map)) map[id] = firstSentenceLine
		}
	}
	return map
}

function resolveAssetPath(
	id: string,
	assets: readonly { id: string; path: string; status: string }[],
): string | undefined {
	const asset = assets.find((a) => a.id === id && a.status !== 'pending')
	return asset?.path
}

function buildCastMember(
	slot: SlotName,
	assetId: string,
	assets: readonly { id: string; path: string; status: string }[],
): StageCastMember {
	const parts = assetId.split('/')
	return {
		slot,
		assetId,
		path: resolveAssetPath(assetId, assets),
		charId: parts[0],
		outfit: parts.length >= 2 ? parts[1] : undefined,
		expression: parts.length >= 3 ? parts[2] : undefined,
	}
}

export function stageSnapshotAtLine(
	scenes: readonly {
		sceneId: string
		nvs: string
		sourceIds?: readonly string[]
	}[],
	sceneIndex: number,
	lineNumber: number,
	options: Omit<CompileOptions, 'sceneIds' | 'previous' | 'makeId'>,
): StageSnapshot {
	const target = scenes[sceneIndex]
	const sceneTitle = target?.nvs.match(/^scene\s+(.+)/m)?.[1]?.trim() ?? ''
	const paragraphFirstLine = buildParagraphFirstLine(
		target?.nvs ?? '',
		target?.sourceIds,
	)
	const empty: StageSnapshot = {
		sceneTitle,
		cast: [],
		paragraphFirstLine,
	}
	if (!target) return empty

	// Try compileScript first for accurate stage state.
	let background: string | undefined
	let cg: string | undefined
	let foreground: string | undefined
	const sprites = new Map<SlotName, string>()

	const compiled = compileScript(
		scenes.map((s) => s.nvs.replace(/\r\n?|\n/g, '\n')).join('\n'),
		{ ...options, sceneIds: scenes.map((s) => s.sceneId) },
	)

	if (compiled.ok) {
		// Compute the global line offset for the target scene.
		let offset = 0
		for (let k = 0; k < sceneIndex; k++)
			offset += scenes[k].nvs.split(/\r\n?|\n/).length
		const targetGlobalLine = offset + lineNumber

		for (const [index, scene] of compiled.scenes.entries()) {
			if (index > sceneIndex) break
			for (const beat of scene.beats) {
				// In the target scene, stop after the beat at or past the target line.
				if (
					index === sceneIndex &&
					beat.line &&
					'line' in beat.line &&
					typeof beat.line.line === 'number' &&
					beat.line.line >= targetGlobalLine
				) {
					// Apply this beat's actions then stop.
					for (const action of beat.actions) {
						applyAction(action, {
							sprites,
							setBg: (v) => {
								background = v
							},
							setCg: (v) => {
								cg = v
							},
							setFg: (v) => {
								foreground = v
							},
						})
					}
					break
				}
				for (const action of beat.actions) {
					applyAction(action, {
						sprites,
						setBg: (v) => {
							background = v
						},
						setCg: (v) => {
							cg = v
						},
						setFg: (v) => {
							foreground = v
						},
					})
				}
			}
			if (index === sceneIndex) break
		}
	} else {
		// Fallback: scan directives in the target scene up to lineNumber.
		const lines = target.nvs.split(/\r\n?|\n/)
		for (let i = 0; i < Math.min(lineNumber, lines.length); i++) {
			const raw = lines[i].trim()
			const bgMatch = raw.match(/^@bg\s+(\S+)/)
			if (bgMatch) {
				background = bgMatch[1]
				continue
			}
			const cgMatch = raw.match(/^@cg\s+(\S+)/)
			if (cgMatch) {
				cg = cgMatch[1] === 'none' ? undefined : cgMatch[1]
				continue
			}
			const fgMatch = raw.match(/^@fg\s+(\S+)/)
			if (fgMatch) {
				foreground = fgMatch[1] === 'none' ? undefined : fgMatch[1]
				continue
			}
			const showMatch = raw.match(/^@show\s+(\S+)\s+(left|center|right)/)
			if (showMatch) {
				sprites.set(showMatch[2] as SlotName, showMatch[1])
				continue
			}
			const hideMatch = raw.match(/^@hide\s+(\S+)/)
			if (hideMatch) {
				const t = hideMatch[1]
				if (t === 'left' || t === 'center' || t === 'right') sprites.delete(t)
				else
					for (const [slot, id] of sprites)
						if (id.split('/')[0] === t) sprites.delete(slot)
			}
		}
	}

	const assets = options.assets
	const cast: StageCastMember[] = []
	for (const slot of slotOrder) {
		const assetId = sprites.get(slot)
		if (assetId) cast.push(buildCastMember(slot, assetId, assets))
	}

	return {
		sceneTitle,
		background: background
			? { id: background, path: resolveAssetPath(background, assets) }
			: undefined,
		cg: cg ? { id: cg, path: resolveAssetPath(cg, assets) } : undefined,
		foreground: foreground
			? { id: foreground, path: resolveAssetPath(foreground, assets) }
			: undefined,
		cast,
		paragraphFirstLine,
	}
}

function applyAction(
	action: {
		name: string
		args: Record<string, string | number>
		assets: Array<{ id: string; slot?: string }>
	},
	state: {
		sprites: Map<SlotName, string>
		setBg(v: string | undefined): void
		setCg(v: string | undefined): void
		setFg(v: string | undefined): void
	},
) {
	const asset = action.assets[0]?.id
	switch (action.name) {
		case 'bg':
			state.setBg(asset)
			break
		case 'cg':
			state.setCg(action.args.asset === 'none' ? undefined : asset)
			break
		case 'fg':
			state.setFg(action.args.asset === 'none' ? undefined : asset)
			break
		case 'show': {
			const slot = String(action.args.slot)
			if (asset && (slot === 'left' || slot === 'center' || slot === 'right'))
				state.sprites.set(slot, asset)
			break
		}
		case 'hide': {
			const target = String(action.args.target)
			if (target === 'left' || target === 'center' || target === 'right')
				state.sprites.delete(target)
			else
				for (const [slot, id] of state.sprites)
					if (id.split('/')[0] === target) state.sprites.delete(slot)
			break
		}
		case 'move': {
			const from = String(action.args.slot)
			const to = String(action.args.target)
			if (
				(from === 'left' || from === 'center' || from === 'right') &&
				(to === 'left' || to === 'center' || to === 'right')
			) {
				const id = state.sprites.get(from)
				if (id) {
					state.sprites.delete(from)
					state.sprites.set(to, id)
				}
			}
			break
		}
		case 'face':
		case 'costume':
			for (const item of action.assets) {
				for (const [slot, id] of state.sprites)
					if (
						item.slot
							? slot === item.slot
							: id.split('/')[0] === item.id.split('/')[0]
					)
						state.sprites.set(slot, item.id)
			}
			break
	}
}
