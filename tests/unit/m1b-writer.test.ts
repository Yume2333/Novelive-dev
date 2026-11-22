import { describe, expect, test, vi } from 'vitest'
import {
	ContextLimitError,
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
	return { requests, options: fixtureOptions(fetch), fetch }
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

	test('reviews each scene separately and rejects source requests outside its scene', async () => {
		const second = 'scene Shore\nsource p0002\n: A bell rang.'
		const input = {
			...chapter,
			paragraphs: [
				...chapter.paragraphs,
				{ id: 'p0002', text: 'A bell rang at noon.' },
			],
		}
		const { options, requests } = responses(
			`${scene}\n${second}`,
			{ tool: 'read_source_range', arguments: { from: 'p0001', to: 'p0002' } },
			{ tool: 'submit_review', arguments: { issues: [] } },
			{ tool: 'read_source_range', arguments: { from: 'p0002', to: 'p0002' } },
			{ tool: 'submit_review', arguments: { issues: [] } },
		)
		const result = await reviewChapter(
			input,
			await writeChapter(input, options),
			options,
		)
		expect(result.revised).toBe(false)
		expect(requests).toHaveLength(5)
		expect(requests[1]).not.toContain('scene Shore')
		expect(requests[2]).toContain('Invalid source range')
		expect(requests[3]).not.toContain('scene Bridge')
		expect(requests[4]).toContain('A bell rang at noon.')
	})

	test('chunks an oversized flagged scene without attaching unrelated writer context', async () => {
		const draftText = [
			'scene Bridge',
			'source p0001',
			...Array.from(
				{ length: 4 },
				(_, i) => `: Draft ${i} ${'a'.repeat(1400)}`,
			),
		].join('\n')
		const input = {
			...chapter,
			bible: 'Excluded Bible background',
			settings: {
				...defaultWorkSettings(),
				adaptation: 'faithful' as const,
				requirements: 'Keep the setting intact.',
				rules: ['Outdoor scenes use narration.'],
				chapterRules: { [chapter.chapterId]: ['Keep the time of day.'] },
				fidelityReview: false,
				styleReview: true,
			},
		}
		const { options, requests } = responses(
			draftText,
			'{"issues":["Shorten the prose."]}',
			': One.',
			': Two.',
			': Three.',
			': Four.',
		)
		const draft = await writeChapter(input, options)
		const result = await reviewChapter(input, draft, {
			...options,
			writer: { ...options.writer, contextWindow: 4096 },
		})
		expect(result.scenes[0].beats).toHaveLength(4)
		expect(requests.slice(2)).toHaveLength(4)
		for (const request of requests.slice(2)) {
			expect(request).toContain('Return only its body lines')
			expect(request).not.toContain('Excluded Bible background')
			expect(request).toContain('Preserve sentence order')
			expect(request).toContain('Keep the setting intact.')
			expect(request).toContain('Outdoor scenes use narration.')
			expect(request).toContain('Keep the time of day.')
			expect(Buffer.byteLength(request)).toBeLessThan(2816)
		}
	})

	test('does not revise a scene for style findings from another scene', async () => {
		const second = 'scene Shore\nsource p0002\n: A bell rang.'
		const input = {
			...chapter,
			settings: {
				...defaultWorkSettings(),
				fidelityReview: false,
				styleReview: true,
			},
			paragraphs: [
				...chapter.paragraphs,
				{ id: 'p0002', text: 'A bell rang.' },
			],
		}
		const { options, requests } = responses(
			`${scene}\n${second}`,
			'{"issues":[]}',
			'{"issues":["Sharpen the rhythm."]}',
			second,
		)
		const draft = await writeChapter(input, options)
		const result = await reviewChapter(input, draft, options)
		expect(result.scenes[0].scene).toEqual(draft.scenes[0].scene)
		expect(requests).toHaveLength(4)
		expect(requests[3]).toContain('Sharpen the rhythm.')
		expect(requests[3]).not.toContain('p0001')
	})

	test('keeps the first split scene and later draft scene IDs', async () => {
		const input = {
			...chapter,
			paragraphs: [
				...chapter.paragraphs,
				{ id: 'p0002', text: 'The water was calm.' },
				{ id: 'p0003', text: 'A bell rang.' },
			],
		}
		const first = scene.replace('p0001', 'p0001-p0002')
		const next = 'scene Shore\nsource p0003\n: A bell rang.'
		const split = 'scene Shore\nsource p0002\n: The water was calm.'
		const { options } = responses(
			`${first}\n${next}`,
			{ tool: 'submit_review', arguments: { issues: [issue] } },
			{ tool: 'submit_review', arguments: { issues: [] } },
			`${scene.replace('scene Bridge', 'scene Dusk')}\n${split}`,
		)
		const draft = await writeChapter(input, options)
		const result = await reviewChapter(input, draft, options)
		expect(result.scenes).toHaveLength(3)
		const ids = result.scenes.map(({ scene }) => scene.id)
		expect(ids[0]).toBe(draft.scenes[0].scene.id)
		expect(ids[2]).toBe(draft.scenes[1].scene.id)
		expect(new Set(ids).size).toBe(3)
	})

	test('includes the actual missing source before and after the final scene', async () => {
		const input = {
			...chapter,
			paragraphs: [
				...chapter.paragraphs,
				{ id: 'p0002', text: 'A lantern went out.' },
				{ id: 'p0003', text: 'An owl called.' },
				{ id: 'p0004', text: 'Morning arrived.' },
			],
		}
		const gap = 'scene Night\nsource p0003\n: An owl called.'
		const fixed =
			'scene Night\nsource p0002-p0004\n: A lantern went out, an owl called, and morning arrived.'
		const { options, requests } = responses(`${scene}\n${gap}`, fixed)
		const result = await writeChapter(input, options)
		expect(result.scenes[1].scene.source).toMatchObject({
			from: 'p0002',
			to: 'p0004',
		})
		expect(requests[1]).toContain('p0002: A lantern went out.')
		expect(requests[1]).toContain('p0004: Morning arrived.')
		expect(requests[1]).not.toContain('p0001: At dusk')
	})

	test('retries an empty stream in strict mode but not in record mode', async () => {
		try {
			vi.stubEnv('NL_REPLAY', 'strict')
			const strict = responses('', scene)
			await expect(
				writeChapter(chapter, strict.options),
			).resolves.toMatchObject({ ok: true })
			expect(strict.requests).toHaveLength(2)

			vi.stubEnv('NL_REPLAY', 'record')
			const record = responses('', scene)
			await expect(writeChapter(chapter, record.options)).rejects.toThrow(
				'empty response',
			)
			expect(record.requests).toHaveLength(1)
		} finally {
			vi.unstubAllEnvs()
		}
	})

	test.each([
		{
			phase: 'Scene repair',
			replies: [`scene Bridge\nsource p9999\n: ${'x'.repeat(3200)}`],
			count: 1,
		},
		{
			phase: 'Source paragraph adaptation',
			replies: [
				{ truncated: scene },
				`scene Bridge\nsource p0001\n: ${'x'.repeat(2700)}`,
			],
			count: 2,
		},
	] as const)(
		'surfaces context_limit for $phase before an oversized call',
		async ({ phase, replies, count }) => {
			const { options, requests } = responses(...replies)
			const input =
				phase === 'Scene repair'
					? chapter
					: {
							...chapter,
							paragraphs: [
								...chapter.paragraphs,
								{ id: 'p0002', text: 'A bell rang.' },
							],
						}
			await expect(
				writeChapter(input, {
					...options,
					writer: { ...options.writer, contextWindow: 4096 },
				}),
			).rejects.toMatchObject({ code: 'context_limit', phase })
			expect(requests).toHaveLength(count)
		},
	)

	test.each(['revision', 'fidelity'] as const)(
		'does not split an indivisible %s line',
		async (phase) => {
			const draftText = `scene Bridge\nsource p0001\nchar001: ${'Dialogue '.repeat(450)}`
			const input = {
				...chapter,
				settings: {
					...defaultWorkSettings(),
					fidelityReview: phase === 'fidelity',
					styleReview: phase === 'revision',
				},
			}
			const { options: original, requests } = responses(
				draftText,
				'{"issues":["Shorten this line."]}',
			)
			const options = {
				...original,
				script: { ...original.script, speakers: ['char001'] },
			}
			const draft = await writeChapter(input, options)
			await expect(
				reviewChapter(input, draft, {
					...options,
					[phase === 'fidelity' ? 'reviewer' : 'writer']: {
						...options.writer,
						contextWindow: 4096,
					},
				}),
			).rejects.toBeInstanceOf(ContextLimitError)
			expect(requests).toHaveLength(phase === 'fidelity' ? 1 : 2)
		},
	)

	test('validates a quote in a full cited paragraph when the scene is excerpted', async () => {
		const quote = 'A paper boat drifted towards the bridge. '.repeat(5).trim()
		const input = { ...chapter, paragraphs: [{ id: 'p0001', text: quote }] }
		const script = [
			'scene Bridge',
			'source p0001',
			...Array.from({ length: 8 }, (_, i) => `: Line ${i} ${'x'.repeat(410)}`),
		].join('\n')
		const submit = { tool: 'submit_review', arguments: { issues: [] } }
		const { options, requests } = responses(script)
		const draft = await writeChapter(input, options)
		const revision = responses(script)
		const review = responses(
			{ tool: 'read_source_range', arguments: { from: 'p0001', to: 'p0001' } },
			{ tool: 'submit_review', arguments: { issues: [{ ...issue, quote }] } },
			...Array.from({ length: 16 }, () => submit),
		)
		const result = await reviewChapter(input, draft, {
			...review.options,
			reviewer: { ...options.reviewer, contextWindow: 4096 },
			fetch: async (request, init) => {
				const body = await new Request(request, init).json()
				return body.model === options.writer.model
					? revision.fetch(request, init)
					: review.fetch(request, init)
			},
		})
		expect(requests).toHaveLength(1)
		expect(review.requests[1]).toContain(quote)
		expect(review.requests[1]).not.toContain('Quote not found')
		expect(result.fidelity).toEqual([{ ...issue, quote }])
	})

	test('repairs only the invalid body line when the full scene does not fit', async () => {
		const valid = `: ${'An unchanged beat. '.repeat(35)}`
		const draft = [
			'scene Bridge',
			'source p0001',
			valid,
			'unknown: Fix this line.',
			valid,
			valid,
			valid,
		].join('\n')
		const { options, requests } = responses(draft, ': Fixed.')
		const result = await writeChapter(chapter, {
			...options,
			writer: { ...options.writer, contextWindow: 4096 },
		})
		expect(result.scenes[0].beats).toHaveLength(5)
		expect(requests[1]).toContain('unknown: Fix this line.')
		expect(requests[1]).not.toContain('An unchanged beat.')
	})

	test('splits a revision at cited paragraph boundaries before splitting body lines', async () => {
		const second = 'scene Shore\nsource p0002\n: A bell rang.'
		const firstSource = `A boat drifted. ${'water '.repeat(240)}`
		const secondSource = `A bell rang. ${'bell '.repeat(280)}`
		const input = {
			...chapter,
			paragraphs: [
				{ id: 'p0001', text: firstSource },
				{ id: 'p0002', text: secondSource },
			],
			settings: {
				...defaultWorkSettings(),
				fidelityReview: false,
				styleReview: true,
			},
		}
		const { options, requests } = responses(
			scene.replace('p0001', 'p0001-p0002'),
			'{"issues":["Sharpen the rhythm."]}',
			scene,
			second,
		)
		const draft = await writeChapter(input, options)
		const result = await reviewChapter(input, draft, {
			...options,
			writer: { ...options.writer, contextWindow: 4096 },
		})
		expect(requests).toHaveLength(4)
		expect(requests[2]).toContain(firstSource)
		expect(requests[2]).not.toContain(secondSource)
		expect(requests[3]).toContain(secondSource)
		expect(result.scenes.map(({ scene }) => scene.source.from)).toEqual([
			'p0001',
			'p0002',
		])
	})

	test.each([
		{
			args: { section: 'Characters', entry: 'ch001' },
			matching: 'Boatkeeper',
			unrelated: 'Night Watch',
		},
		{
			args: { section: 'glossary', from: 'Boat', to: 'Bridge' },
			matching: 'Stone crossing',
			unrelated: 'Night Watch',
		},
	])(
		'offers Bible selectors after an overflow and reads $args.section',
		async ({ args, matching, unrelated }) => {
			const { options, requests } = responses(
				scene,
				{ tool: 'read_bible', arguments: {} },
				{ tool: 'read_bible', arguments: args },
				{ tool: 'submit_review', arguments: { issues: [] } },
			)
			const draft = await writeChapter(chapter, options)
			await reviewChapter(
				{
					...chapter,
					bible: `# Background\n${'x'.repeat(14000)}\n# Characters\n## ch001\nBoatkeeper\n## ch002\nNight Watch`,
					terms: {
						Boat: 'Small vessel',
						Bridge: 'Stone crossing',
						Night: 'Night Watch',
					},
				},
				draft,
				options,
			)
			expect(requests[2]).toContain(
				'Use read_bible with a section, entry, or glossary range.',
			)
			expect(requests[3]).toContain(matching)
			expect(requests[3]).not.toContain(unrelated)
		},
	)
})
