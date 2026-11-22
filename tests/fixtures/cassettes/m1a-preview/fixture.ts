import type { TextConnection } from '../../../../packages/creator/src/models/text'
import type { PreviewChapter } from '../../../../packages/creator/src/preview'

export const connection: TextConnection = {
	format: 'openai-completions',
	model: 'fixture-preview',
	contextWindow: 4096,
	baseUrl: 'https://relay.invalid/v1',
	compat: 'auto',
	apiKey: 'offline-placeholder',
}
export const chapters: PreviewChapter[] = [
	{
		chapterId: 'c1',
		volumeId: 'v1',
		paragraphs: [
			'Ada entered Paper Harbor on day one. She found a blue key. '.repeat(8),
			'Bo met Ada at Paper Harbor on day two. The locked tower hummed. '.repeat(
				8,
			),
		],
	},
	{
		chapterId: 'c2',
		volumeId: 'v1',
		paragraphs: [
			'Ada sailed to Ink Island on day three. The key warmed beside the tower map.',
		],
	},
	{
		chapterId: 'c3',
		volumeId: 'v2',
		paragraphs: [
			'Cy waited on Ink Island on day four. A bell rang below the sea.',
		],
	},
]

export const editedChapter: PreviewChapter = {
	...chapters[1],
	paragraphs: ['Cy met Ada on Ink Island on day four. The bell hid the key.'],
}
export const addedChapter: PreviewChapter = {
	chapterId: 'c4',
	volumeId: 'v1',
	paragraphs: [
		'Cy reached Paper Harbor on day four. The bell answered the tower.',
	],
}
