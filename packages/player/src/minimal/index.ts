import type { Beat, CompiledScene, TextLine } from '@novelive/format/script'
import { Application, Sprite, Texture } from 'pixi.js'
import { loadPlayerImage, type PlayerResources } from '../index'
import { mountText } from '../text'
import { createPlayback } from './playback'

export async function mountMinimalPlayer(
	host: HTMLElement,
	scenes: readonly CompiledScene[],
	resources: PlayerResources,
	signal: AbortSignal,
	onError: (error: unknown) => void,
	speakerNames: Readonly<Record<string, string>> = {},
): Promise<void> {
	const app = new Application()
	await app.init({ width: 960, height: 540, preference: 'webgl' })
	if (signal.aborted) {
		app.destroy(true)
		return
	}
	const stage = document.createElement('div')
	stage.className = 'nl-player-stage'
	stage.append(app.canvas)
	const overlay = document.createElement('div')
	overlay.className = 'nl-player-overlay'
	stage.append(overlay)
	host.append(stage)
	const textures = new Map<string, Texture>()
	const cast = new Map<string, { id: string; sprite: Sprite }>()
	let background: Sprite | undefined
	let textRenderer: ReturnType<typeof mountText> | undefined
	const texture = async (id: string) => {
		let result = textures.get(id)
		if (!result) {
			const image = await loadPlayerImage(id, resources)
			if (signal.aborted) return undefined
			result = Texture.from(image, true)
			textures.set(id, result)
		}
		return result
	}
	function showText(line: TextLine, auto: boolean) {
		const box = document.createElement('div')
		box.className =
			line.kind === 'caption' ? 'nl-player-caption' : 'nl-player-textbox'
		box.dataset.kind = line.kind
		if (line.kind === 'dialogue' || line.kind === 'inner') {
			const name = document.createElement('div')
			name.className = 'nl-player-name'
			name.textContent =
				line.alias ?? speakerNames[line.speaker ?? ''] ?? line.speaker ?? ''
			box.append(name)
		}
		const text = document.createElement('div')
		text.className = 'nl-player-text'
		box.append(text)
		overlay.replaceChildren(box)
		textRenderer = mountText(text, line.content, {
			auto,
			continueImmediately: auto && line.kind !== 'caption',
		})
	}
	async function render(current: Beat | undefined) {
		textRenderer?.dispose()
		textRenderer = undefined
		if (!current) {
			overlay.textContent = '本章结束'
			return
		}
		for (const action of current.actions) {
			if (action.name === 'hide') {
				const target = String(action.args.target)
				const isSlot =
					target === 'left' || target === 'center' || target === 'right'
				for (const [slot, item] of cast) {
					if (isSlot ? slot === target : item.id.split('/')[0] === target) {
						item.sprite.destroy()
						cast.delete(slot)
					}
				}
			}
			if (action.name !== 'bg' && action.name !== 'show') continue
			for (const asset of action.assets) {
				const image = await texture(asset.id)
				if (!image) return
				const sprite = new Sprite(image)
				if (action.name === 'bg') {
					background?.destroy()
					background = sprite
					sprite.width = app.screen.width
					sprite.height = app.screen.height
					app.stage.addChildAt(sprite, 0)
				} else {
					const slot = asset.slot ?? 'center'
					cast.get(slot)?.sprite.destroy()
					sprite.anchor.set(0.5, 1)
					sprite.scale.set(Math.min(540 / image.height, 960 / image.width))
					sprite.position.set(
						slot === 'left' ? 240 : slot === 'right' ? 720 : 480,
						540,
					)
					cast.set(slot, { id: asset.id, sprite })
					app.stage.addChild(sprite)
				}
			}
		}
		if (current.line?.type === 'text')
			showText(current.line, current.advance.kind !== 'click')
		else overlay.replaceChildren()
	}
	const playback = createPlayback(
		scenes,
		render,
		signal,
		onError,
		() => textRenderer?.finished ?? Promise.resolve(),
	)
	const click = () => {
		if (!textRenderer?.click()) playback.click()
	}
	host.addEventListener('click', click)
	signal.addEventListener(
		'abort',
		() => {
			textRenderer?.dispose()
			host.removeEventListener('click', click)
			stage.remove()
			app.destroy(false, { children: true })
			for (const item of textures.values()) item.destroy(true)
		},
		{ once: true },
	)
	await playback.start()
}
