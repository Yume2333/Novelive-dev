import { expect, test } from 'vitest'
import {
	lineExpression,
	sceneAssets,
} from '../../packages/ui/src/pages/editor/scene-assets'
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

test('scene image picker includes stage assets carried over from earlier scenes until hidden', () => {
	const multi = [
		'scene 第一场',
		'source p0001',
		'@bg room/night',
		'@show traveler/coat/calm center',
		'@show right/coat/calm right',
		': 第一场。 #0001',
		'',
		'scene 第二场',
		'source p0002',
		'@hide right',
		': 第二场没有新贴图。 #0002',
	].join('\n')
	const multiOptions = {
		...options,
		paragraphIds: ['p0001', 'p0002'],
		assets: [
			...options.assets,
			{
				id: 'right/coat/calm',
				type: 'character' as const,
				aliases: [],
				path: 'unused-right.webp',
				status: 'drawn' as const,
			},
		],
	}
	expect(sceneAssets(multi, multiOptions, 1).map((asset) => asset.id)).toEqual([
		'room/night',
		'traveler/coat/calm',
	])
})

test('scene image picker keeps a character whose prefix collides with an empty slot hide', () => {
	const multi = [
		'scene 第一场',
		'source p0001',
		'@bg room/night',
		'@show right/coat/calm center',
		': 第一场。 #0001',
		'',
		'scene 第二场',
		'source p0002',
		'@hide right',
		': 第二场没有新贴图。 #0002',
	].join('\n')
	const multiOptions = {
		...options,
		paragraphIds: ['p0001', 'p0002'],
		assets: [
			...options.assets,
			{
				id: 'right/coat/calm',
				type: 'character' as const,
				aliases: [],
				path: 'right-center.webp',
				status: 'drawn' as const,
			},
		],
	}
	// `right` is a slot name, so the empty right slot is cleared and the
	// `right/...` portrait in `center` must remain available.
	expect(sceneAssets(multi, multiOptions, 1).map((asset) => asset.id)).toEqual([
		'room/night',
		'right/coat/calm',
	])
})

test('lineExpression finds active character expression choices for the cursor sentence', () => {
	const multi = [
		'scene 窗边',
		'source p0001',
		'@show traveler/coat/calm center',
		': 第一句。 #0001',
	].join('\n')
	expect(
		lineExpression([{ sceneId: 'aabbccdd', nvs: multi }], 0, 4, options),
	).toEqual({
		lineId: '0001',
		current: 'traveler/coat/calm',
		choices: ['traveler/coat/calm', 'traveler/coat/smile'],
	})
})
