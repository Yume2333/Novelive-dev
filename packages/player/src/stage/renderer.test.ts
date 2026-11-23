import type { CompiledAction } from '@novelive/format/script'
import { type Container, Texture } from 'pixi.js'
import { expect, it } from 'vitest'
import type { AssetWindow } from './assets'
import { PixiStage } from './renderer'
import { direct, emptyStage } from './state'

const action = (
	name: CompiledAction['name'],
	args: CompiledAction['args'],
	id?: string,
): CompiledAction => ({
	type: 'action',
	name,
	args,
	assets: id ? [{ id }] : [],
	line: 1,
	col: 1,
})
const assets = { get: () => Texture.EMPTY } as unknown as AssetWindow
const internals = (stage: PixiStage) =>
	stage as unknown as {
		pictures: Container
		world: Container
		tick(seconds: number): void
	}

it('composites incoming dissolves above the opaque outgoing background', async () => {
	const stage = new PixiStage()
	const first = direct(
		emptyStage(),
		action('bg', { transition: 'none' }, 'first'),
	)
	await stage.commit(first, assets, [], true)
	const previous = internals(stage).pictures
	const change = action('bg', { transition: 'dissolve', duration: 1 }, 'second')
	const finished = stage.commit(direct(first, change), assets, [change])
	const { world, pictures } = internals(stage)
	expect(world.getChildIndex(pictures)).toBeGreaterThan(
		world.getChildIndex(previous),
	)
	internals(stage).tick(0.5)
	expect(pictures.alpha).toBe(0.5)
	stage.complete()
	await finished
})

it('crossfades only the changed portrait while leaving background and other portraits opaque', async () => {
	const stage = new PixiStage()
	const first = direct(
		direct(emptyStage(), action('bg', { transition: 'none' }, 'room')),
		action('show', { slot: 'center' }, 'hero/coat/calm'),
	)
	await stage.commit(first, assets, [], true)
	const change = action('face', { duration: 1 }, 'hero/coat/smile')
	const finished = stage.commit(direct(first, change), assets, [change])
	internals(stage).tick(0.5)
	const { pictures } = internals(stage)
	expect(pictures.alpha).toBe(1)
	expect(pictures.children[0].alpha).toBe(1)
	expect(pictures.children.slice(1).map((child) => child.alpha)).toEqual([
		0.5, 0.5,
	])
	stage.complete()
	await finished
})

it('finishes concurrent shake and zoom at the focused camera position', async () => {
	const stage = new PixiStage()
	await stage.commit(emptyStage(), assets, [], true)
	const zoom = action('zoom', { scale: 1.5, target: 'left', duration: 0.2 })
	const shake = action('shake', { strength: 1, duration: 0.4 })
	const finished = stage.commit(
		direct(direct(emptyStage(), zoom), shake),
		assets,
		[zoom, shake],
	)
	internals(stage).tick(0.4)
	await finished
	expect(internals(stage).world.scale.x).toBe(1.5)
	expect(internals(stage).world.x).toBe(-120)
})
