import type { Beat, CompiledScene } from '@novelive/format/script'
import type {
	PlayerSettings,
	SentenceRef,
} from '../../../../../player/src/contract/playback'
import type { PlaybackMode } from '../../../../../player/src/contract/progress'
import type { PlaybackProgress } from '../../../../../player/src/progress'
import type { ControlFrame, PlayerControlsController } from './controller'
import { textPage } from './text-page'

export function sentenceKey(position: SentenceRef) {
	return JSON.stringify([
		position.chapterId,
		position.sceneId,
		position.sentenceId,
	])
}

export function minimalControlsController(
	host: HTMLElement,
	chapterId: string,
	scenes: readonly CompiledScene[],
	mode: PlaybackMode,
	progress: PlaybackProgress,
	signal: AbortSignal,
): PlayerControlsController & { rendered(beat: Beat | undefined): void } {
	const beats = scenes.flatMap(({ scene, beats }) =>
		beats.map((beat) => ({ sceneId: scene.id, beat })),
	)
	let current: ControlFrame = {
		position: null,
		characters: 0,
		read: false,
		ready: false,
		ended: false,
	}
	const listeners = new Set<() => void>()
	function rendered(beat: Beat | undefined) {
		if (signal.aborted) return
		const index = beats.findIndex((item) => item.beat === beat)
		const item = beats[index]
		const line = item?.beat.line
		const position =
			line?.type === 'text' && line.id && item.sceneId
				? { chapterId, sceneId: item.sceneId, sentenceId: line.id }
				: null
		const read = position ? progress.isRead(position) : false
		current = {
			position,
			read,
			...textPage(host),
			ready: line?.type === 'text',
			scripted: item?.beat.advance.kind !== 'click',
			ended: !item,
		}
		for (const listener of listeners) listener()
	}
	const observer = new MutationObserver(() => {
		current = { ...current, ...textPage(host) }
		for (const listener of listeners) listener()
	})
	observer.observe(host, {
		subtree: true,
		childList: true,
		attributes: true,
		attributeFilter: [
			'data-page',
			'data-pages',
			'data-revealed',
			'data-text-finished',
		],
	})
	signal.addEventListener(
		'abort',
		() => {
			observer.disconnect()
			listeners.clear()
		},
		{ once: true },
	)
	return {
		rendered,
		mode,
		frame: () => current,
		subscribe(listener) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
		advance(skip) {
			if (skip && current.scripted)
				host.dispatchEvent(new Event('novelive:player-skip'))
			else host.dispatchEvent(new MouseEvent('click', { bubbles: true }))
		},
		applySettings(settings: PlayerSettings) {
			host.style.setProperty('--player-font-size', `${settings.fontSize}px`)
			host.style.setProperty(
				'--player-dialogue-opacity',
				String(settings.dialogueOpacity),
			)
			host.style.setProperty(
				'--player-text-delay',
				`${settings.textMillisecondsPerCharacter}ms`,
			)
			host.dataset.dialogueStyle = settings.dialogueStyle
			host.style.setProperty(
				'--player-auto-multiplier',
				String(settings.autoPlaySpeedMultiplier),
			)
			host.dispatchEvent(new Event('novelive:player-settings'))
		},
	}
}
