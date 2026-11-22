import { describe, expect, test } from 'vitest'
import {
	reviewChapter,
	ScriptDiagnosticsError,
	writeChapter,
} from '../../packages/creator/src/pipeline/writing'
import { createReplayFetch } from '../../packages/creator/src/replay'
import { defaultWorkSettings } from '../../packages/format/src/model'
import {
	chapter,
	fixtureOptions,
	runRecording,
} from '../fixtures/cassettes/m1b-writer/fixture'

type Reply =
	| string
	| { tool: string; arguments: object }
	| { truncated: string }
function responses(...replies: Reply[]) {
	const requests: string[] = []
	const fetch: typeof globalThis.fetch = async (input, init) => {
		const body = await new Request(input, init).json()
		requests.push(JSON.stringify(body.messages))
		const reply = replies.shift()
		if (reply === undefined) throw new Error('Unexpected model request')
		const tool = typeof reply !== 'string' && 'tool' in reply
		const truncated = typeof reply !== 'string' && 'truncated' in reply
		const delta = tool
			? {
					tool_calls: [
						{
							index: 0,
							id: `call_${requests.length}`,
							type: 'function',
							function: {
								name: reply.tool,
								arguments: JSON.stringify(reply.arguments),
							},
						},
					],
				}
			: { content: truncated ? reply.truncated : reply }
		const events = [
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
					{
						index: 0,
						delta: {},
						finish_reason: tool ? 'tool_calls' : truncated ? 'length' : 'stop',
					},
				],
			},
		]
		return new Response(
			events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') +
				'data: [DONE]\n\n',
			{ headers: { 'content-type': 'text/event-stream' } },
		)
	}
	return { requests, options: fixtureOptions(fetch) }
}

const scene =
	'scene Bridge\nsource p0001\n: A paper boat drifted under the bridge.'
const issue = {
	category: 'omission',
	paragraphId: 'p0001',
	quote: 'At dusk',
	issue: 'Keep the time of day.',
}

describe('M1b writer', () => {
	test('replays the recorded writer and fidelity reviewer without network', async () => {
		const replay = createReplayFetch({
			mode: 'strict',
			directory: new URL('../fixtures/cassettes/m1b-writer', import.meta.url)
				.pathname,
			fetch: async () => {
				throw new Error('Network forbidden')
			},
		})
		const result = await runRecording(fixtureOptions(replay))
		expect(result.scenes).toHaveLength(1)
		expect(result.scenes[0].scene.source).toMatchObject({
			from: 'p0001',
			to: 'p0001',
		})
	})

	test('rejects unverified source quotes, revises once, and preserves the IDs', async () => {
		const { options, requests } = responses(
			scene,
			{ tool: 'read_source_range', arguments: { from: 'p0001', to: 'p0001' } },
			{
				tool: 'submit_review',
				arguments: { issues: [{ ...issue, quote: 'At midday' }] },
			},
			{ tool: 'submit_review', arguments: { issues: [issue] } },
			'scene Bridge\nsource p0001\n: At dusk, a paper boat drifted under the bridge.',
		)
		const draft = await writeChapter(chapter, options)
		const result = await reviewChapter(chapter, draft, options)
		expect(requests).toHaveLength(5)
		expect(requests[2]).toContain(chapter.paragraphs[0].text)
		expect(requests[3]).toContain('Quote not found')
		expect(result.fidelity).toEqual([issue])
		expect(result.style).toEqual([])
		expect(result.revised).toBe(true)
		expect(result.scenes[0].beats[0].line).toMatchObject({
			id: draft.scenes[0].beats[0].line?.id,
		})
	})

	test('separates style-only review and carries the priority preview and chapter constraints', async () => {
		const { options, requests } = responses(
			scene,
			'{"issues":["Sharpen the rhythm."]}',
			scene,
		)
		const input = {
			...chapter,
			continuity: {
				kind: 'preview-summary' as const,
				summary: 'The bridge was deserted.',
			},
			settings: {
				...defaultWorkSettings(),
				adaptation: 'condensed' as const,
				stagingDensity: 'aggressive' as const,
				styleReview: true,
				fidelityReview: false,
			},
			redLines: ['No invented dialogue.'],
		}
		const result = await reviewChapter(
			input,
			await writeChapter(input, options),
			options,
		)
		expect(result.fidelity).toEqual([])
		expect(result.style).toEqual(['Sharpen the rhythm.'])
		expect(requests).toHaveLength(3)
		expect(requests[0]).toContain("Previous chapter's preview summary")
		expect(requests[0]).toContain('15–45')
		expect(requests[0]).toContain('frequent text-compatible')
		expect(requests[0].match(/No invented dialogue\./g)).toHaveLength(2)
		expect(requests[1]).toContain('Review prose style only')
	})

	test('segments long inputs at paragraph boundaries and keeps completed scenes', async () => {
		const second = 'scene Shore\nsource p0002\n: The boat reached the shore.'
		const { options, requests } = responses(scene, second)
		const result = await writeChapter(
			{
				...chapter,
				paragraphs: [
					{ id: 'p0001', text: 'A boat floated. '.repeat(85) },
					{ id: 'p0002', text: 'The shore appeared. '.repeat(75) },
				],
			},
			{ ...options, writer: { ...options.writer, contextWindow: 4096 } },
		)
		expect(requests).toHaveLength(2)
		expect(requests[1]).toContain('Previous segment ending')
		expect(result.scenes.map(({ scene }) => scene.source.from)).toEqual([
			'p0001',
			'p0002',
		])
	})

	test('repairs only the invalid scene and surfaces exhausted compiler diagnostics', async () => {
		const second = 'scene Shore\nsource p0002\n: The boat reached the shore.'
		const bad = second.replace('source p0002', 'source p9999')
		const input = {
			...chapter,
			paragraphs: [
				...chapter.paragraphs,
				{ id: 'p0002', text: 'The boat reached shore.' },
			],
		}
		const repaired = responses(`${scene}\n${bad}`, second)
		const result = await writeChapter(input, repaired.options)
		expect(result.scenes).toHaveLength(2)
		expect(repaired.requests[1]).toContain('E_SOURCE_RANGE')
		expect(repaired.requests[1]).not.toContain('scene Bridge')
		const exhausted = responses(`${scene}\n${bad}`, bad, bad, bad)
		await expect(writeChapter(input, exhausted.options)).rejects.toBeInstanceOf(
			ScriptDiagnosticsError,
		)
		expect(exhausted.requests).toHaveLength(4)
	})

	test('sizes faithful writes from the output budget and splits a truncated response', async () => {
		const second = 'scene Shore\nsource p0002\n: The boat reached shore.'
		const input = {
			...chapter,
			settings: { ...defaultWorkSettings(), adaptation: 'faithful' as const },
			paragraphs: [
				{ id: 'p0001', text: 'a'.repeat(1050) },
				{ id: 'p0002', text: 'b'.repeat(1050) },
			],
		}
		const sized = responses(scene, second)
		await writeChapter(input, {
			...sized.options,
			writer: { ...sized.options.writer, contextWindow: 4096 },
		})
		expect(sized.requests).toHaveLength(2)
		expect(sized.requests[0]).not.toContain('p0002:')
		const split = responses({ truncated: scene }, scene, second)
		const result = await writeChapter(input, split.options)
		expect(split.requests).toHaveLength(3)
		expect(split.requests[0]).toContain('p0002:')
		expect(split.requests[1]).not.toContain('p0002:')
		expect(result.scenes.map(({ scene }) => scene.source.from)).toEqual([
			'p0001',
			'p0002',
		])
	})
})
