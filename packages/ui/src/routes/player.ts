import type { SentenceRef } from '../../../player/src/contract'
import { workRoute } from './production'

export function playerEditorRoute(workId: string, position: SentenceRef) {
	const { chapterId, sceneId, sentenceId } = position
	const query = new URLSearchParams({ chapterId, sceneId, lineId: sentenceId })
	return `${workRoute('editor', workId)}?${query}`
}
