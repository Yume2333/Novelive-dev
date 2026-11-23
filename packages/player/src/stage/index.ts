import type { WorkSettings } from '@novelive/format/model'
import type {
	Beat,
	CompiledAction,
	CompiledScene,
} from '@novelive/format/script'
import { toPlaybackBeats } from '../contract/playback'
import type {
	ActivePerformance,
	PlayerResources,
	StageSnapshot,
	StageState,
} from '../contract/stage'
import {
	captureSnapshot,
	PlaybackProgress,
	restoreSnapshot,
	type SnapshotRenderer,
} from '../progress'
import { mountText } from '../text'
import { AssetWindow, lookahead } from './assets'
import { PixiStage } from './renderer'
import { direct, emptyStage, previewOpening, stageAssets } from './state'

export { AssetWindow, lookahead } from './assets'
export { PixiStage } from './renderer'
export { direct, emptyStage, stageAssets } from './state'

function samePosition(
	a: StageSnapshot['position'],
	b: StageSnapshot['position'],
) {
	return (
		a.chapterId === b.chapterId &&
		a.sceneId === b.sceneId &&
		a.sentenceId === b.sentenceId
	)
}

export async function mountStage(
	host: HTMLElement,
	resources: PlayerResources,
	restartText: SnapshotRenderer['restartText'] = () => {},
) {
	const renderer = new PixiStage()
	const assets = new AssetWindow(resources)
	await renderer.mount(host)
	let state = emptyStage()
	let disposed = false
	const controller = {
		get state() {
			return structuredClone(state)
		},
		async commit(
			next: typeof state,
			upcoming: readonly string[] = [],
			actions: Parameters<PixiStage['commit']>[2] = [],
			instant = false,
			onReady?: () => void,
		) {
			renderer.complete()
			await assets.sync([...stageAssets(state), ...stageAssets(next)], upcoming)
			if (disposed) return
			const animation = renderer.commit(next, assets, actions, instant)
			state = structuredClone(next)
			onReady?.()
			await animation
			await assets.sync(stageAssets(state), upcoming)
		},
		async restore(
			snapshot: StageSnapshot,
			upcoming: readonly string[] = [],
		): Promise<void> {
			await restoreSnapshot(snapshot, {
				setState: (next) => controller.commit(next, upcoming, [], true),
				replayState: (action) =>
					controller.commit(direct(state, action), upcoming, [action]),
				restartText,
			})
		},
		async setState(next: StageState): Promise<void> {
			await controller.commit(next, [], [], true)
		},
		async replayState(action: CompiledAction): Promise<void> {
			await controller.commit(direct(state, action), [], [action])
		},
		restartText,
		thumbnail: (visibleHeight = 1) => renderer.thumbnail(visibleHeight),
		complete: () => renderer.complete(),
		async destroy() {
			disposed = true
			renderer.destroy()
			await assets.destroy()
		},
	}
	return controller
}

export async function mountMinimalPlayer(
	host: HTMLElement,
	scenes: readonly CompiledScene[],
	resources: PlayerResources,
	signal: AbortSignal,
	onError: (error: unknown) => void,
	speakerNames: Readonly<Record<string, string>> = {},
	onBeat?: (beat: Beat | undefined) => void,
	options: {
		customMarks?: WorkSettings['customMarks']
		chapterId?: string
		restore?: StageSnapshot
		start?: StageSnapshot['position']
		onSnapshot?(snapshot: StageSnapshot): void
		progress?: PlaybackProgress
		initialActions?: readonly CompiledAction[]
	} = {},
) {
	const element = document.createElement('div')
	element.className = 'nl-player-stage'
	host.append(element)
	const viewport = document.createElement('div')
	Object.assign(viewport.style, {
		position: 'absolute',
		inset: '0',
		overflow: 'hidden',
	})
	element.append(viewport)
	const stage = await mountStage(viewport, resources, (text) =>
		renderText(text),
	)
	if (signal.aborted) {
		element.remove()
		await stage.destroy()
		return
	}
	const overlay = document.createElement('div')
	overlay.className = 'nl-player-overlay'
	overlay.style.fontFamily = 'var(--font-body)'
	element.append(overlay)
	const resizeObserver = new ResizeObserver(clipViewport)
	function clipViewport() {
		const box = overlay.querySelector<HTMLElement>('.nl-player-textbox')
		const bottom = box
			? Math.max(
					0,
					viewport.getBoundingClientRect().bottom -
						box.getBoundingClientRect().top,
				)
			: 0
		viewport.style.clipPath = `inset(0px 0px ${bottom}px 0px)`
	}
	function observeOverlay() {
		resizeObserver.disconnect()
		resizeObserver.observe(element)
		const box = overlay.querySelector<HTMLElement>('.nl-player-textbox')
		if (box) resizeObserver.observe(box)
		clipViewport()
	}
	const chapterId =
		options.chapterId ??
		options.restore?.position.chapterId ??
		options.start?.chapterId ??
		'local'
	const beats = toPlaybackBeats(chapterId, scenes, speakerNames)
	const sourceBeats = scenes.flatMap((scene) => scene.beats)
	const start = options.restore?.position ?? options.start
	const startIndex = start
		? beats.findIndex(
				(beat) =>
					beat.cue.kind === 'text' &&
					beat.cue.position.sceneId === start.sceneId &&
					beat.cue.position.sentenceId === start.sentenceId,
			)
		: 0
	if (startIndex < 0) {
		element.remove()
		resizeObserver.disconnect()
		await stage.destroy()
		throw new Error('存档中的句子已不存在')
	}
	const initialActions =
		options.initialActions ??
		(startIndex > 0
			? sourceBeats.slice(0, startIndex).flatMap((beat) => beat.actions)
			: undefined)
	let restoring = options.restore
	const positions = beats.flatMap((beat) =>
		beat.cue.kind === 'text' ? [beat.cue.position] : [],
	)
	const order = (position: StageSnapshot['position']) =>
		positions.findIndex((entry) => samePosition(entry, position))
	const progress =
		options.progress ?? new PlaybackProgress((a, b) => order(a) - order(b))
	progress.openChapter(chapterId)
	let snapshot: StageSnapshot | null = null
	let index = startIndex - 1
	let busy = false
	function setBusy(value: boolean) {
		busy = value
		element.ariaBusy = String(value)
	}
	let timer: ReturnType<typeof setTimeout> | undefined
	let scheduleId = 0
	let textRenderer: ReturnType<typeof mountText> | undefined
	let displayedText: StageState['text'] = null
	let displayedAuto = false
	let displayedSkip = false
	let textSpeed = 30
	function setting(name: string, fallback: number) {
		const value = Number.parseFloat(host.style.getPropertyValue(name))
		return Number.isFinite(value) ? value : fallback
	}
	async function schedule(beat: (typeof beats)[number]) {
		const id = ++scheduleId
		clearTimeout(timer)
		if (beat.advance.kind !== 'click' && !signal.aborted) {
			let current: typeof textRenderer
			do {
				current = textRenderer
				await current?.finished
			} while (current !== textRenderer && !signal.aborted && id === scheduleId)
			if (signal.aborted || id !== scheduleId) return
			timer = setTimeout(
				() => void advance(),
				beat.advance.kind === 'delay' ? beat.advance.seconds * 1000 : 0,
			)
		}
	}
	function renderText(
		text: StageState['text'],
		auto = beats[index]?.advance.kind !== 'click',
		skip = false,
	) {
		textRenderer?.dispose()
		textRenderer = undefined
		displayedText = text
		displayedAuto = auto
		displayedSkip = skip
		textSpeed = setting('--player-text-delay', 30)
		overlay.replaceChildren()
		if (text) {
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
			content.dataset.textFinished = 'false'
			box.append(content)
			overlay.append(box)
			textRenderer = mountText(content, text.content, {
				customMarks: options.customMarks,
				viewport: {
					element: overlay,
					textHeight() {
						const above =
							content.getBoundingClientRect().top -
							box.getBoundingClientRect().top
						const style = getComputedStyle(box)
						return (
							overlay.clientHeight -
							above -
							Number.parseFloat(style.paddingBottom) -
							Number.parseFloat(style.borderBottomWidth)
						)
					},
				},
				millisecondsPerCharacter: textSpeed,
				auto,
				continueImmediately: auto && text.kind !== 'caption',
				skip,
				get autoSpeedMultiplier() {
					return 1 / setting('--player-auto-multiplier', 1)
				},
			})
			const current = textRenderer
			void current.finished.then(() => {
				if (textRenderer === current && !signal.aborted)
					content.dataset.textFinished = 'true'
			})
		}
		observeOverlay()
	}
	async function advance() {
		if (busy || signal.aborted) return
		setBusy(true)
		try {
			const beat = beats[++index]
			if (!beat) {
				renderText(null)
				overlay.textContent = '本章结束'
				observeOverlay()
				onBeat?.(undefined)
				return
			}
			if (restoring) {
				const saved = restoring
				restoring = undefined
				await stage.restore(saved, lookahead(beats, index + 1))
			} else {
				let state = stage.state
				if (index === startIndex && initialActions?.length) {
					for (const action of initialActions) state = direct(state, action)
					state = previewOpening(state, beat.actions)
					await stage.commit(state, lookahead(beats, index + 1), [], true)
				}
				for (const action of beat.actions) state = direct(state, action)
				state.text = beat.cue.kind === 'text' ? beat.cue.text : null
				let incoming: StageSnapshot | null = null
				if (beat.cue.kind === 'text') {
					const active: ActivePerformance[] = beat.actions.map((action) =>
						['move', 'shake'].includes(action.name)
							? { restore: 'skip-relative' }
							: { restore: 'replay-state', action },
					)
					incoming = captureSnapshot(
						beat.cue.position,
						{ ...state, text: beat.cue.text },
						[...active, { restore: 'restart-text' }],
					)
				}
				await stage.commit(
					state,
					lookahead(beats, index + 1),
					beat.actions,
					false,
					() => {
						if (incoming) snapshot = incoming
						renderText(state.text)
					},
				)
			}
			if (signal.aborted) return
			onBeat?.(sourceBeats[index])
			if (beat.cue.kind === 'text') {
				snapshot = captureSnapshot(
					beat.cue.position,
					{ ...stage.state, text: stage.state.text ?? beat.cue.text },
					[{ restore: 'restart-text' }],
				)
				progress.record(snapshot)
				options.onSnapshot?.(structuredClone(snapshot))
			}
			void schedule(beat)
		} catch (error) {
			onError(error)
		} finally {
			setBusy(false)
		}
	}
	const click = () => {
		if (busy) stage.complete()
		else if (!textRenderer?.click() && beats[index]?.advance.kind === 'click')
			void advance()
	}
	const settingsChanged = () => {
		if (displayedText && textSpeed !== setting('--player-text-delay', 30))
			renderText(displayedText, displayedAuto, displayedSkip)
	}
	const skip = () => {
		if (displayedText && displayedAuto && !displayedSkip)
			renderText(displayedText, true, true)
	}
	host.addEventListener('click', click)
	host.addEventListener('novelive:player-settings', settingsChanged)
	host.addEventListener('novelive:player-skip', skip)
	signal.addEventListener(
		'abort',
		() => {
			++scheduleId
			clearTimeout(timer)
			textRenderer?.dispose()
			resizeObserver.disconnect()
			host.removeEventListener('click', click)
			host.removeEventListener('novelive:player-settings', settingsChanged)
			host.removeEventListener('novelive:player-skip', skip)
			element.remove()
			void stage.destroy()
		},
		{ once: true },
	)
	await advance()
	return {
		progress,
		get state() {
			return stage.state
		},
		get snapshot() {
			return structuredClone(snapshot)
		},
		thumbnail() {
			const box = overlay.querySelector<HTMLElement>('.nl-player-textbox')
			const bounds = viewport.getBoundingClientRect()
			return stage.thumbnail(
				box
					? Math.max(
							0,
							(box.getBoundingClientRect().top - bounds.top) / bounds.height,
						)
					: 1,
			)
		},
		async restore(saved: StageSnapshot) {
			const restoredIndex = beats.findIndex(
				(beat) =>
					beat.cue.kind === 'text' &&
					samePosition(beat.cue.position, saved.position),
			)
			if (restoredIndex < 0) throw new Error('存档句子不在当前章节')
			if (busy) throw new Error('舞台正在切换')
			setBusy(true)
			++scheduleId
			clearTimeout(timer)
			const previousIndex = index
			index = restoredIndex
			try {
				await stage.restore(saved, lookahead(beats, restoredIndex + 1))
				snapshot = captureSnapshot(
					saved.position,
					{ ...stage.state, text: saved.stage.text },
					[{ restore: 'restart-text' }],
				)
				onBeat?.(sourceBeats[index])
				options.onSnapshot?.(structuredClone(snapshot))
				void schedule(beats[index])
			} catch (error) {
				index = previousIndex
				throw error
			} finally {
				setBusy(false)
			}
		},
	}
}
