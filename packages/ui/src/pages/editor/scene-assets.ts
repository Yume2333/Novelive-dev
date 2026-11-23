import { type CompileOptions, compileScript } from '@novelive/format/script'

export function sceneAssets(
	script: string,
	options: CompileOptions,
	sceneIndex: number,
) {
	const result = compileScript(script, options)
	if (!result.ok) return []
	const ids = new Set(
		result.scenes[sceneIndex]?.beats.flatMap((beat) =>
			beat.actions.flatMap((action) => action.assets.map((asset) => asset.id)),
		),
	)
	return options.assets.filter(
		(asset) => ids.has(asset.id) && asset.status !== 'pending',
	)
}
