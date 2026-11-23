import { expect, test } from 'vitest'
import { sceneAssets } from '../../packages/ui/src/pages/editor/scene-assets'
import { context } from '../fixtures/script/context'

const options = {
	...context,
	paragraphIds: ['p0001'],
	assets: [
		...context.assets.map((asset) => ({ ...asset, status: 'drawn' as const })),
		{
			id: 'room/nigh',
			type: 'location' as const,
			aliases: [],
			path: 'unused.webp',
			status: 'drawn' as const,
		},
	],
}
const script =
	'scene 窗边\nsource p0001\n@bg room/night\n@show traveler/coat/sly center\n@face traveler/calm\n: 风声。 #0001\n'

test('scene image picker resolves aliases and short faces without including ID prefixes', () => {
	expect(sceneAssets(script, options, 0).map((asset) => asset.id)).toEqual([
		'room/night',
		'traveler/coat/calm',
		'traveler/coat/smile',
	])
})

test('scene image picker is empty for text-only, unavailable and invalid scripts', () => {
	expect(
		sceneAssets('scene 窗边\nsource p0001\n: 风声。 #0001\n', options, 0),
	).toEqual([])
	expect(
		sceneAssets(
			script,
			{
				...options,
				assets: options.assets.map((asset) => ({
					...asset,
					status: 'pending',
				})),
			},
			0,
		),
	).toEqual([])
	expect(
		sceneAssets('scene 窗边\nsource p0001\n@show missing center\n', options, 0),
	).toEqual([])
})
