import { workRoute } from './production'

export function playerEditorRoute(
	workId: string,
	{
		chapterId,
		sceneId,
		sentenceId,
	}: {
		chapterId: string
		sceneId: string
		sentenceId: string
	},
) {
	const query = new URLSearchParams({ chapterId, sceneId, lineId: sentenceId })
	return `${workRoute('editor', workId)}?${query}`
}
