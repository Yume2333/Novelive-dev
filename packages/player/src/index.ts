import type { AssetRegistry } from '@novelive/format/model'
import { Application, Sprite, Texture } from 'pixi.js'

export { mountMinimalPlayer } from './minimal'

type AssetId = AssetRegistry['entries'][number]['id']

export interface PlayerResources {
	resolveAsset(id: AssetId): string | Promise<string>
}

export interface FixedScene {
	background: AssetId
	sprite?: AssetId
}

export async function mountFixedScene(
	host: HTMLElement,
	scene: FixedScene,
	resources: PlayerResources,
): Promise<() => void> {
	const [background, portrait] = await Promise.all([
		loadPlayerImage(scene.background, resources),
		scene.sprite === undefined
			? undefined
			: loadPlayerImage(scene.sprite, resources),
	])
	const app = new Application()
	await app.init({ width: 960, height: 540, preference: 'webgl' })
	const backdrop = new Sprite(Texture.from(background, true))
	backdrop.width = app.screen.width
	backdrop.height = app.screen.height
	app.stage.addChild(backdrop)
	if (portrait) {
		const sprite = new Sprite(Texture.from(portrait, true))
		sprite.anchor.set(0.5, 1)
		sprite.scale.set(
			Math.min(
				app.screen.height / portrait.height,
				app.screen.width / portrait.width,
			),
		)
		sprite.position.set(app.screen.width / 2, app.screen.height)
		app.stage.addChild(sprite)
	}
	host.append(app.canvas)
	return () =>
		app.destroy(
			{ removeView: true },
			{ children: true, texture: true, textureSource: true },
		)
}

export async function loadPlayerImage(id: AssetId, resources: PlayerResources) {
	const image = new Image()
	image.crossOrigin = 'anonymous'
	image.src = await resources.resolveAsset(id)
	await image.decode()
	return image
}
