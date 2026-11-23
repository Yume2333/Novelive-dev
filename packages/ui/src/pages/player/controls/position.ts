import type { CompiledScene } from '@novelive/format/script'
import type { SentenceRef } from '../../../../../player/src/contract'

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
