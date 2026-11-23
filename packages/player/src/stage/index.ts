import type { CompiledScene } from '@novelive/format/script'
import { toPlaybackBeats } from '../contract/playback'
import type {
	PlayerResources,
	StageSnapshot,
	StageState,
} from '../contract/stage'
import { AssetWindow, lookahead } from './assets'
import { PixiStage } from './renderer'
import { direct, emptyStage, stageAssets } from './state'

export { AssetWindow, lookahead } from './assets'
export { PixiStage } from './renderer'
export { direct, emptyStage, stageAssets } from './state'

export async function mountStage(
	host: HTMLElement,
	resources: PlayerResources,
) {
	const renderer = new PixiStage()
	const assets = new AssetWindow(resources)
	await renderer.mount(host)
	let state = emptyStage()
	let disposed = false
	return {
		get state() {
			return structuredClone(state)
		},
		async commit(
			next: typeof state,
			upcoming: readonly string[] = [],
			actions: Parameters<PixiStage['commit']>[2] = [],
			instant = false,
		) {
			renderer.complete()
			await assets.sync([...stageAssets(state), ...stageAssets(next)], upcoming)
			if (disposed) return
			await renderer.commit(next, assets, actions, instant)
			state = structuredClone(next)
			await assets.sync(stageAssets(state), upcoming)
		},
		async restore(snapshot: StageSnapshot, upcoming: readonly string[] = []) {
			let next: StageState = structuredClone(snapshot.stage)
			for (const active of snapshot.active)
				if (active.restore === 'replay-state')
					next = direct(next, active.action)
			renderer.complete()
			await assets.sync(stageAssets(next), upcoming)
			if (disposed) return
			await renderer.commit(next, assets, [], true)
			state = next
		},
		complete: () => renderer.complete(),
		async destroy() {
			disposed = true
			renderer.destroy()
			await assets.destroy()
		},
	}
}

export async function mountMinimalPlayer(
	host: HTMLElement,
	scenes: readonly CompiledScene[],
	resources: PlayerResources,
	signal: AbortSignal,
	onError: (error: unknown) => void,
	speakerNames: Readonly<Record<string, string>> = {},
) {
	const element = document.createElement('div')
	element.className = 'nl-player-stage'
	host.append(element)
	const stage = await mountStage(element, resources)
	if (signal.aborted) {
		element.remove()
		await stage.destroy()
		return
	}
	const overlay = document.createElement('div')
	overlay.className = 'nl-player-overlay'
	overlay.style.fontFamily = 'var(--font-body)'
	element.append(overlay)
	const beats = toPlaybackBeats('local', scenes, speakerNames)
	let index = -1
	let busy = false
	let timer: ReturnType<typeof setTimeout> | undefined
	async function advance() {
		if (busy || signal.aborted) return
		busy = true
		try {
			const beat = beats[++index]
			if (!beat) {
				overlay.textContent = '本章结束'
				return
			}
			let state = stage.state
			for (const action of beat.actions) state = direct(state, action)
			state.text = beat.cue.kind === 'text' ? beat.cue.text : null
			await stage.commit(state, lookahead(beats, index + 1), beat.actions)
			if (signal.aborted) return
			overlay.replaceChildren()
			if (state.text) {
				const text = state.text
				const box = document.createElement('div')
				box.className =
					text.kind === 'caption' ? 'nl-player-caption' : 'nl-player-textbox'
				box.dataset.kind = text.kind
				if (text.kind === 'dialogue' || text.kind === 'inner') {
					const name = document.createElement('div')
					name.className = 'nl-player-name'
					name.textContent = text.displayName ?? ''
					box.append(name)
				}
				const content = document.createElement('div')
				content.className = 'nl-player-text'
				content.textContent = text.content
					.map((part) => (part.type === 'text' ? part.text : ''))
					.join('')
				box.append(content)
				overlay.append(box)
			}
			if (beat.advance.kind !== 'click')
				timer = setTimeout(
					() => void advance(),
					beat.advance.kind === 'delay'
						? beat.advance.seconds * 1000
						: beat.cue.kind === 'text'
							? 2000
							: 0,
				)
		} catch (error) {
			onError(error)
		} finally {
			busy = false
		}
	}
	const click = () => {
		if (busy) stage.complete()
		else if (beats[index]?.advance.kind === 'click') void advance()
	}
	host.addEventListener('click', click)
	signal.addEventListener(
		'abort',
		() => {
			clearTimeout(timer)
			host.removeEventListener('click', click)
			element.remove()
			void stage.destroy()
		},
		{ once: true },
	)
	await advance()
}
