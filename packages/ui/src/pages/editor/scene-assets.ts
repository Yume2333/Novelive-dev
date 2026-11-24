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
