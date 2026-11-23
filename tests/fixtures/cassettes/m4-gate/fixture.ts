import type { CommandInput } from '../../../../packages/creator/src/contract'
import { configuration as base } from '../m1b-gate/fixture'

export const directory = import.meta.dirname
export const screeningDirectory = `${directory}/epub-screening`
export const first =
	'Chapter 1 Boat\nA paper boat drifted beneath the bridge.\nChapter 2 Light\nThe lamp lit the river and the boat sailed on.\n'
export const joined =
	'# 第二卷 远行\n\n## 第三章 海岸\n\nThe boat reached the quiet coast.\n'
export const other =
	'第一章 山路\n旅人走过山路。\n第二章 归家\n旅人终于回到家。\n'
export const configuration = {
	...base,
	models: {
		...base.models,
		writing: { ...base.models.writing, model: 'devin-swe-2' },
	},
} satisfies CommandInput<'config.update'>

export function completion(content: unknown, tool?: string) {
	const text = typeof content === 'string' ? content : JSON.stringify(content)
	const delta = tool
		? {
				tool_calls: [
					{
						index: 0,
						id: 'm4-review',
						type: 'function',
						function: { name: tool, arguments: text },
					},
				],
			}
		: { content: text }
	return new Response(
		`${[
			{
				choices: [
					{
						index: 0,
						delta: { role: 'assistant', ...delta },
						finish_reason: null,
					},
				],
			},
			{
				choices: [
					{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' },
				],
				usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 },
			},
		]
			.map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
			.join('')}data: [DONE]\n\n`,
		{ headers: { 'content-type': 'text/event-stream' } },
	)
}
