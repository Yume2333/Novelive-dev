import type { TextConnection } from '../../../../packages/creator/src/models/text'
import {
	reviewChapter,
	type WriterOptions,
	type WritingChapter,
	writeChapter,
} from '../../../../packages/creator/src/pipeline/writing'
import { defaultWorkSettings } from '../../../../packages/format/src/model'

export const chapter: WritingChapter = {
	chapterId: 'ch0001',
	language: 'en',
	continuity: { kind: 'none' },
	paragraphs: [
		{ id: 'p0001', text: 'At dusk, a paper boat drifted under the bridge.' },
	],
	settings: defaultWorkSettings(),
}
export const writer = 'devin-swe-2'
export const reviewer = 'deepseek-v4.1-flash'
export const contextWindow = 16384

export function fixtureOptions(
	fetch: typeof globalThis.fetch,
	endpoint: Pick<TextConnection, 'baseUrl' | 'apiKey'> = {
		baseUrl: 'https://relay.invalid/v1',
		apiKey: 'offline-placeholder',
	},
): WriterOptions {
	const connection = {
		...endpoint,
		format: 'openai-completions',
		contextWindow,
		compat: 'auto',
	} as const
	let id = 0
	return {
		fetch,
		writer: { ...connection, model: writer },
		reviewer: { ...connection, model: reviewer },
		script: {
			assets: [],
			speakers: [],
			makeId: (size) => (++id).toString(16).padStart(size, '0'),
		},
	}
}

export async function runRecording(options: WriterOptions) {
	const draft = await writeChapter(chapter, options)
	return reviewChapter(chapter, draft, options)
}
