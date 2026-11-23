import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CommandInput } from '../../../../packages/creator/src/contract'

export const original = [
	'第一章 纸船',
	'暮色中，一只纸船从桥下漂过。',
	'第二章 灯火',
	'桥边的灯亮了，纸船继续向前漂。',
	'',
].join('\n')

export const rejectedWriter = 'gate-writer-rejected'
export const recoveredWriter = 'gate-writer-recovered'

const text = {
	baseUrl: 'https://relay.invalid/v1',
	apiKey: 'offline-placeholder',
	format: 'openai-completions',
	contextWindow: 12_000,
	maxOutputTokens: 4096,
	compat: 'auto',
} as const
export const configuration = {
	models: {
		fast: { ...text, model: 'fixture-art-fast' },
		main: { ...text, model: 'fixture-art-main', inheritFast: false },
		writing: {
			...text,
			model: 'devin-swe-2',
			maxOutputTokens: 3000,
			inheritFast: false,
		},
		visual: { ...text, model: 'fixture-art-visual', inheritFast: false },
		image: {
			baseUrl: text.baseUrl,
			apiKey: text.apiKey,
			model: 'fixture-art-image',
			nativeMaxEdge: 1536,
			concurrency: 1,
			retries: 0,
			quality: 'medium',
			postProcess: 'off',
		},
	},
} satisfies CommandInput<'config.update'>

export const gateDirectory = import.meta.dirname
export const artDirectory = join(gateDirectory, '../m1b-art')

export async function combineCassettes(target: string) {
	const indexes = await Promise.all(
		[gateDirectory, artDirectory].map((dir) =>
			readFile(join(dir, 'cassette.jsonl'), 'utf8'),
		),
	)
	await writeFile(join(target, 'cassette.jsonl'), indexes.join('\n'))
}
