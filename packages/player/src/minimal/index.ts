import type { Beat, CompiledScene, TextLine } from '@novelive/format/script'
import { Application, Sprite, Texture } from 'pixi.js'
import type { SentenceRef, StageSlot, StageSnapshot } from '../contract'
import { loadPlayerImage, type PlayerResources } from '../index'
import {
	captureSnapshot,
	restoreSnapshot,
	type SnapshotRenderer,
} from '../progress'
import { mountText } from '../text'
import { createPlayback } from './playback'

export async function mountMinimalPlayer(
	host: HTMLElement,
	scenes: readonly CompiledScene[],
	resources: PlayerResources,
	signal: AbortSignal,
	onError: (error: unknown) => void,
	speakerNames: Readonly<Record<string, string>> = {},
	onBeat?: (beat: Beat | undefined) => void,
	options: {
		chapterId?: string
		restore?: StageSnapshot
		start?: SentenceRef
		onSnapshot?(snapshot: StageSnapshot): void
	} = {},
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
	let backgroundId: string | undefined
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
	let displayedText: StageSnapshot['stage']['text'] = {
		kind: 'narration',
		content: [],
	}
	let displayedLine: TextLine | undefined
	let displayedAuto = false
	let displayedSkip = false
	let textSpeed = 30
	function setting(name: string, fallback: number) {
		const value = Number.parseFloat(host.style.getPropertyValue(name))
		return Number.isFinite(value) ? value : fallback
	}
	function showText(line: TextLine, auto: boolean, skip = false) {
		textRenderer?.dispose()
		displayedLine = line
		displayedAuto = auto
		displayedSkip = skip
		textSpeed = setting('--player-text-delay', 30)
		displayedText = {
			kind: line.kind,
			speaker: line.speaker,
			displayName:
				line.alias ?? speakerNames[line.speaker ?? ''] ?? line.speaker,
			content: line.content,
		}
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
		text.dataset.textFinished = 'false'
		box.append(text)
		overlay.replaceChildren(box)
		textRenderer = mountText(text, line.content, {
			millisecondsPerCharacter: textSpeed,
			auto,
			continueImmediately: auto && line.kind !== 'caption',
			skip,
			get autoSpeedMultiplier() {
				return 1 / setting('--player-auto-multiplier', 1)
			},
		})
		const current = textRenderer
		void current.finished.then(() => {
			if (textRenderer === current && !signal.aborted)
				text.dataset.textFinished = 'true'
		})
	}
	async function render(current: Beat | undefined) {
		textRenderer?.dispose()
		textRenderer = undefined
		displayedLine = undefined
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
					backgroundId = asset.id
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
	let click = () => {}
	const settingsChanged = () => {
		if (displayedLine && textSpeed !== setting('--player-text-delay', 30))
			showText(displayedLine, displayedAuto, displayedSkip)
	}
	const skip = () => {
		if (displayedLine && displayedAuto && !displayedSkip)
			showText(displayedLine, true, true)
	}
	host.addEventListener('novelive:player-settings', settingsChanged)
	host.addEventListener('novelive:player-skip', skip)
	signal.addEventListener(
		'abort',
		() => {
			textRenderer?.dispose()
			host.removeEventListener('click', click)
			host.removeEventListener('novelive:player-settings', settingsChanged)
			host.removeEventListener('novelive:player-skip', skip)
			stage.remove()
			app.destroy(false, { children: true })
			for (const item of textures.values()) item.destroy(true)
		},
		{ once: true },
	)
	const renderer: SnapshotRenderer = {
		async setState(saved) {
			background?.destroy()
			background = undefined
			backgroundId = undefined
			for (const item of cast.values()) item.sprite.destroy()
			cast.clear()
			const actions: Beat['actions'] = []
			if (saved.background)
				actions.push({
					type: 'action',
					line: 1,
					col: 1,
					name: 'bg',
					args: {},
					assets: [{ id: saved.background.assetId }],
				})
			for (const item of Object.values(saved.sprites).sort(
				(a, b) => (a?.layer ?? 0) - (b?.layer ?? 0),
			))
				if (item)
					actions.push({
						type: 'action',
						line: 1,
						col: 1,
						name: 'show',
						args: {},
						assets: [{ id: item.assetId, slot: item.position }],
					})
			await render({ actions, advance: { kind: 'click' } })
			for (const [slot, item] of Object.entries(saved.sprites)) {
				const sprite = cast.get(slot)?.sprite
				if (!sprite || !item) continue
				sprite.position.set(item.transform.x, item.transform.y)
				sprite.scale.set(item.transform.scaleX, item.transform.scaleY)
				sprite.rotation = item.transform.rotation
			}
		},
		replayState: (action) =>
			render({ actions: [action], advance: { kind: 'click' } }),
		restartText: (text) =>
			showText(
				{
					type: 'text',
					line: 1,
					col: 1,
					kind: text.kind,
					speaker: text.speaker,
					alias: text.displayName,
					content: [...text.content],
					click: true,
				},
				ordered[startIndex]?.beat.advance.kind !== 'click',
			),
	}
	const ordered = scenes.flatMap(({ scene, beats }) =>
		beats.map((beat) => ({ sceneId: scene.id, beat })),
	)
	const start = options.restore?.position ?? options.start
	const startIndex = start
		? ordered.findIndex(
				({ sceneId, beat }) =>
					sceneId === start.sceneId && beat.line?.id === start.sentenceId,
			)
		: 0
	if (startIndex < 0) throw new Error('存档中的句子已不存在')
	let restored = !!options.restore
	if (options.restore) await restoreSnapshot(options.restore, renderer)
	else
		for (const { beat } of ordered.slice(0, startIndex))
			await render({ actions: beat.actions, advance: { kind: 'click' } })
	if (signal.aborted) return
	const playback = createPlayback(
		scenes,
		async (beat) => {
			if (restored) restored = false
			else await render(beat)
			if (!signal.aborted) onBeat?.(beat)
			const item = ordered.find((item) => item.beat === beat)
			const line = beat?.line
			if (
				!signal.aborted &&
				line?.type === 'text' &&
				line.id &&
				item?.sceneId
			) {
				const sprites: StageSnapshot['stage']['sprites'] = {}
				for (const [slot, { id, sprite }] of cast)
					sprites[slot as StageSlot] = {
						assetId: id,
						position: slot as StageSlot,
						layer: app.stage.getChildIndex(sprite),
						transform: {
							x: sprite.x,
							y: sprite.y,
							scaleX: sprite.scale.x,
							scaleY: sprite.scale.y,
							rotation: sprite.rotation,
						},
					}
				options.onSnapshot?.(
					captureSnapshot(
						{
							chapterId: options.chapterId ?? start?.chapterId ?? '',
							sceneId: item.sceneId,
							sentenceId: line.id,
						},
						{
							background: backgroundId
								? { assetId: backgroundId, transition: null }
								: null,
							sprites,
							cg: null,
							foreground: null,
							camera: {
								motion: 'reset',
								zoom: { scale: 1, target: 'stage' },
								shake: null,
							},
							particle: null,
							mask: null,
							filter: null,
							text: displayedText,
						},
						[],
					),
				)
			}
		},
		signal,
		onError,
		async () => {
			let current: typeof textRenderer
			do {
				current = textRenderer
				await current?.finished
			} while (current !== textRenderer && !signal.aborted)
		},
		{ startIndex },
	)
	click = () => {
		if (!textRenderer?.click()) playback.click()
	}
	host.addEventListener('click', click)
	await playback.start()
}
