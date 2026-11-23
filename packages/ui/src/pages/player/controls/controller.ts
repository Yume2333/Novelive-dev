import type {
	PlayerSettings,
	SentenceRef,
} from '../../../../../player/src/contract/playback'
import type { PlaybackMode } from '../../../../../player/src/contract/progress'

export const defaultPlayerSettings: PlayerSettings = {
	textMillisecondsPerCharacter: 30,
	autoPlaySpeedMultiplier: 1,
	fontSize: 30,
	dialogueOpacity: 0.9,
	dialogueStyle: 'soft',
	skipRead: false,
	fullscreen: false,
}

export interface ControlFrame {
	position: SentenceRef | null
	characters: number
	read: boolean
	ready: boolean
	ended: boolean
}

export interface PlayerControlsController {
	frame(): ControlFrame
	subscribe(listener: () => void): () => void
	advance(skip: boolean): void
	applySettings(settings: PlayerSettings): void
	mode: PlaybackMode
}

export function dwellMilliseconds(characters: number, multiplier: number) {
	return (1200 + 80 * characters) * multiplier
}

export function schedulePlayback(
	controller: PlayerControlsController,
	settings: PlayerSettings,
	auto: boolean,
	paused: boolean,
) {
	const frame = controller.frame()
	if (paused || !frame.ready || frame.ended) return () => {}
	if (settings.skipRead && !frame.read) return () => {}
	const skip = settings.skipRead && frame.read
	if (!skip && !auto) return () => {}
	const timer = setTimeout(
		() => controller.advance(skip),
		skip
			? 0
			: dwellMilliseconds(frame.characters, settings.autoPlaySpeedMultiplier),
	)
	return () => clearTimeout(timer)
}
