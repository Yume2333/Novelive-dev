import type { CompiledScene } from '@novelive/format/script'
import type {
	PlaybackMode,
	SentenceRef,
	WorkProgress,
} from '../../../../../player/src/contract'

export function restoredChapterMode(
	progress: WorkProgress,
	chapterId: string,
): PlaybackMode {
	return progress.mainline?.chapterId !== chapterId &&
		progress.read.some((position) => position.chapterId === chapterId)
		? 'reread'
		: 'main'
}

export function containsSentence(
	scenes: readonly CompiledScene[],
	position: SentenceRef,
) {
	return scenes.some(
		({ scene, beats }) =>
			scene.id === position.sceneId &&
			beats.some((beat) => beat.line?.id === position.sentenceId),
	)
}
