import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Context } from '@earendil-works/pi-ai'
import { paragraphIdPattern } from '@novelive/format/model'
import { describe, expect, test, vi } from 'vitest'
import {
	ContextLimitError,
	reviewChapter,
	ScriptDiagnosticsError,
	type WritingProgress,
	writeChapter,
} from '../../packages/creator/src/pipeline/writing'
import { promptFits } from '../../packages/creator/src/pipeline/writing/budget'
import { writingModel } from '../../packages/creator/src/pipeline/writing/request'
import {
	reviewFidelity,
	reviewStyle,
} from '../../packages/creator/src/pipeline/writing/review'
import { scopeScene } from '../../packages/creator/src/pipeline/writing/scope'
import { createReplayFetch } from '../../packages/creator/src/replay'
import { projectSpend } from '../../packages/creator/src/usage/spend'
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
	const toolSchemas: unknown[] = []
	const fetch: typeof globalThis.fetch = async (input, init) => {
		const body = await new Request(input, init).json()
		requests.push(JSON.stringify(body.messages))
		toolSchemas.push(body.tools)
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
	return { requests, toolSchemas, options: fixtureOptions(fetch), fetch }
}

const scene =
	'scene Bridge\nsource p0001\n: A paper boat drifted under the bridge.'

test.each([true, false])(
	'bounds style review JSON repair (valid repair: %s)',
	async (valid) => {
		const malformed = '{"issues":["tone" "rhythm"]}'
		const { options, requests } = responses(
			malformed,
			valid ? '{"issues":[]}' : malformed,
		)
		const result = reviewStyle(writingModel(options.writer, options), scene)
		if (valid) await expect(result).resolves.toEqual([])
		else
			await expect(result).rejects.toThrow('Style review returned invalid JSON')
		expect(requests).toHaveLength(2)
		expect(requests[1]).toContain('Return only corrected JSON')
	},
)

test('repairs source alignment JSON before validating ranges', async () => {
	const { options, requests } = responses(
		'[{"paragraphCount":1 "lineCount":1,"targets":[]}]',
		'[{"paragraphCount":2,"lineCount":1,"targets":[]}]',
	)
	const model = writingModel(options.writer, options)
	const paragraphs = [
		{ id: 'p0001', text: 'A boat drifted.' },
		{ id: 'p0002', text: 'A bell rang.' },
	]
	await expect(
		scopeScene(() => model, scene.replace('\n:', '\n\n:'), paragraphs),
	).resolves.toMatchObject([{ paragraphs }])
	expect(requests).toHaveLength(2)
	expect(requests[1]).toContain('Return only corrected JSON')
})

test('leaves room to repair a style review split near the model limit', async () => {
	const { options, requests } = responses(
		'{"issues":["tone" "rhythm"]}',
		'{"issues":[]}',
		'{"issues":[]}',
	)
	const model = writingModel(
		{ ...options.writer, contextWindow: 4096 },
		options,
	)
	const draft = [
		'scene Bridge',
		'source p0001-p0001',
		'',
		`: first ${'a'.repeat(1260)}`,
		`: second ${'b'.repeat(1260)}`,
	].join('\n')
	await expect(reviewStyle(model, draft)).resolves.toEqual([])
	expect(requests).toHaveLength(3)
	expect(requests[0]).toContain(': first')
	expect(requests[0]).not.toContain(': second')
	expect(requests[1]).toContain(': first')
	expect(requests[1]).toContain('Return only corrected JSON')
	expect(requests[2]).toContain(': second')
})

test('stops without a style repair when the malformed reply did not settle', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'novelive-style-usage-'))
	using db = new DatabaseSync(':memory:')
	const provider = responses('{"issues":["tone" "rhythm"]}')
	const fetch = createReplayFetch({
		mode: 'record',
		directory,
		fetch: provider.fetch,
		spend: projectSpend(db),
	})
	try {
		await expect(
			reviewStyle(writingModel(provider.options.writer, { fetch }), scene),
		).rejects.toThrow(
			'Model request outcome unknown; not retried automatically',
		)
		expect(provider.requests).toHaveLength(1)
		expect(
			db.prepare('SELECT actual_tokens FROM spend_reservation').all(),
		).toEqual([{ actual_tokens: null }])
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})

test('separates new mark proposals from NVS and skips unsafe or registered marks', async () => {
	const { options, requests } = responses(
		[
			scene,
			'@propose-mark {"name":"shiver","css":" color: #99f; ","perChar":true}',
			'@propose-mark {"name":"shiver","css":"color: red;","perChar":false}',
			'@propose-mark {"name":"em","css":"opacity: 0.5;","perChar":false}',
			'@propose-mark {"name":"ruby","css":"opacity: 0.5;","perChar":false}',
			'@propose-mark {"name":"ripple","css":"opacity: 0.5;","perChar":false}',
			'@propose-mark {"name":"leak","css":"background: image-set(\\"https://invalid.test/x\\" 1x);","perChar":false}',
			'@propose-mark {"name":"escape","css":"} body { opacity: 0;","perChar":false}',
			'@propose-mark malformed',
		].join('\n'),
	)
	const draft = await writeChapter(chapter, {
		...options,
		proposeMarks: true,
		script: { ...options.script, customMarks: ['ripple'] },
	})
	expect(requests).toHaveLength(1)
	expect(requests[0]).toContain(
		'Registered custom marks you may use in NVS: ripple.',
	)
	expect(draft.scenes).toHaveLength(1)
	expect(draft.scenes[0].scene.lines).toHaveLength(1)
	expect(draft.markSuggestions).toEqual([
		{ name: 'shiver', css: 'color: #99f;', perChar: true },
	])
})

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
		const result = await runRecording(fixtureOptions(replay, undefined, 4096))
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

	test('restricts fidelity citations to the scene source and corrects a draft-line citation', async () => {
		const cited = { ...issue, paragraphId: 'p0020', quote: '窗外下着雨' }
		const draftQuote = '屋里彻夜点着灯'
		const input = {
			paragraphs: [
				{ id: 'p0019', text: '他推开窗。' },
				{ id: 'p0020', text: '窗外下着雨。' },
			],
		}
		const { options, requests, toolSchemas } = responses(
			{
				tool: 'submit_review',
				arguments: {
					issues: [{ ...cited, paragraphId: '#0002', quote: draftQuote }],
				},
			},
			{
				tool: 'submit_review',
				arguments: {
					issues: [{ ...cited, paragraphId: 'p0018', quote: '船靠在桥边' }],
				},
			},
			{ tool: 'submit_review', arguments: { issues: [cited] } },
		)
		const model = writingModel(options.reviewer, options)
		const result = await reviewFidelity(
			model,
			input,
			`scene Window\nsource p0019-p0020\n: 他推开窗。 #0001\n: ${draftQuote}。 #0002`,
			() => model,
		)
		expect(toolSchemas[0]).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					function: expect.objectContaining({
						name: 'submit_review',
						parameters: expect.objectContaining({
							properties: expect.objectContaining({
								issues: expect.objectContaining({
									items: expect.objectContaining({
										properties: expect.objectContaining({
											paragraphId: expect.objectContaining({
												enum: ['p0019', 'p0020'],
											}),
										}),
									}),
								}),
							}),
						}),
					}),
				}),
			]),
		)
		expect(requests[0]).toContain('Source text (via read_source_range)')
		expect(requests[0]).toContain('Draft script (comparison only)')
		expect(requests[1]).toContain(
			'You cited draft line #0002; cite source paragraph IDs (p0019, p0020) with text quoted verbatim from the source.',
		)
		expect(requests[2]).toContain('Quote not found in p0018')
		expect(result).toEqual([cited])
	})

	test('uses a fixed citation pattern when a single line cannot fit the paragraph enum', async () => {
		const paragraphs = Array.from({ length: 30 }, (_, i) => ({
			id: `p${String(i + 1).padStart(4, '0')}`,
			text: 'At dusk',
		}))
		const aligner = responses(
			JSON.stringify([
				{ paragraphCount: paragraphs.length, lineCount: 1, targets: [] },
			]),
		)
		const { options, requests, toolSchemas } = responses(
			{
				tool: 'submit_review',
				arguments: { issues: [{ ...issue, paragraphId: 'p0031' }] },
			},
			{ tool: 'submit_review', arguments: { issues: [issue] } },
		)
		const model = writingModel(
			{ ...options.reviewer, contextWindow: 5250 },
			options,
		)
		const result = await reviewFidelity(
			model,
			{ paragraphs },
			`scene Bridge\nsource p0001-p0030\n\n: ${'x'.repeat(220)}`,
			() => writingModel(aligner.options.writer, aligner.options),
		)
		for (const schema of toolSchemas) {
			const json = JSON.stringify(schema)
			expect(json).toContain(
				JSON.stringify({ type: 'string', pattern: paragraphIdPattern }),
			)
			expect(json).not.toContain('"enum":["p0001"')
		}
		expect(requests[1]).toContain('Quote not found in p0031')
		expect(result).toEqual([issue])
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

	test('resumes completed writing batches from saved progress without replaying a cassette', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'novelive-writing-resume-'))
		using db = new DatabaseSync(':memory:')
		const second = 'scene Shore\nsource p0002\n: The boat reached the shore.'
		const input = {
			...chapter,
			settings: { ...defaultWorkSettings(), adaptation: 'faithful' as const },
			paragraphs: [
				{ id: 'p0001', text: 'a'.repeat(1050) },
				{ id: 'p0002', text: 'b'.repeat(1050) },
			],
		}
		const provider = responses(scene, second)
		let firstReserve = 0
		const fetch = () =>
			createReplayFetch({
				mode: 'record',
				directory,
				fetch: provider.fetch,
				spend: (request, send) =>
					projectSpend(db)(request, async (admitted, quote) => {
						if (!firstReserve) {
							firstReserve = quote.tokens
							vi.stubEnv('NL_RUN_TOKEN_CAP', String(firstReserve))
						}
						return send(admitted, quote)
					}),
			})
		const options = () => ({
			...provider.options,
			fetch: fetch(),
			writer: { ...provider.options.writer, contextWindow: 4096 },
		})
		vi.stubEnv('NL_RUN_TOKEN_CAP', '100000')
		vi.stubEnv('NL_RUN_IMAGE_CAP', '0')
		vi.stubEnv('NL_RUN_TOKEN_SOFT_FRACTION', '1')
		const progress: WritingProgress = []
		try {
			await expect(writeChapter(input, options(), progress)).rejects.toThrow(
				'超出工程预算',
			)
			expect(provider.requests).toHaveLength(1)
			vi.stubEnv('NL_RUN_TOKEN_CAP', '100000')
			const { scenes } = await writeChapter(
				input,
				options(),
				JSON.parse(JSON.stringify(progress)),
			)
			expect(scenes.map(({ scene }) => scene.source.from)).toEqual([
				'p0001',
				'p0002',
			])
			expect(provider.requests).toHaveLength(2)
			expect(provider.requests[1]).toContain('p0002:')
			expect(provider.requests[1]).toContain('A paper boat drifted')
			expect(
				db.prepare('SELECT COUNT(*) AS count FROM spend_reservation').get(),
			).toEqual({ count: 2 })
		} finally {
			vi.unstubAllEnvs()
			await rm(directory, { recursive: true, force: true })
		}
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
			'{"issues":["Shorten draft 0.","Shorten draft 1.","Shorten draft 2.","Shorten draft 3."]}',
			JSON.stringify([
				{
					paragraphCount: 1,
					lineCount: 4,
					targets: [0, 1, 2, 3].map((line) => ({ finding: line, line })),
				},
			]),
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
		expect(requests.slice(3)).toHaveLength(4)
		for (const [line, request] of requests.slice(3).entries()) {
			expect(request).toContain('Return only its body lines')
			expect(request).not.toContain('Excluded Bible background')
			expect(request).toContain('Preserve sentence order')
			expect(request).toContain('Keep the setting intact.')
			expect(request).toContain('Outdoor scenes use narration.')
			expect(request).toContain('Keep the time of day.')
			expect(request).toContain(`Shorten draft ${line}.`)
			expect(request).not.toContain(`Shorten draft ${(line + 1) % 4}.`)
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
			`${scene.replace('p0001', 'p0001-p0002')}\n: A bell rang.`,
			'{"issues":["Sharpen the boat line.","Sharpen the bell line."]}',
			JSON.stringify([
				{ paragraphCount: 1, lineCount: 1, targets: [{ finding: 0, line: 0 }] },
				{ paragraphCount: 1, lineCount: 1, targets: [{ finding: 1, line: 0 }] },
			]),
			scene,
			second,
		)
		const draft = await writeChapter(input, options)
		const result = await reviewChapter(input, draft, {
			...options,
			writer: { ...options.writer, contextWindow: 4096 },
		})
		expect(requests).toHaveLength(5)
		expect(requests[3]).toContain(firstSource)
		expect(requests[3]).not.toContain(secondSource)
		expect(requests[3]).not.toContain(': A bell rang.')
		expect(requests[3]).not.toContain('Sharpen the bell line.')
		expect(requests[4]).toContain(secondSource)
		expect(requests[4]).not.toContain('paper boat')
		expect(requests[4]).not.toContain('Sharpen the boat line.')
		expect(result.scenes.map(({ scene }) => scene.source.from)).toEqual([
			'p0001',
			'p0002',
		])
	})

	test('re-fits the right half with the ending generated by the left half', async () => {
		const ending = `The left half ended here. ${'water '.repeat(220)}`
		const first = `scene Bridge\nsource p0001-p0002\n: ${ending}`
		const third = 'scene Shore\nsource p0003\n: The boat reached shore.'
		const fourth = 'scene Bell\nsource p0004\n: A bell rang.'
		const paragraphs = Array.from({ length: 4 }, (_, i) => ({
			id: `p000${i + 1}`,
			text: `${i + 1}: ${'text '.repeat(70)}`,
		}))
		const { options, requests } = responses(
			{ truncated: scene },
			first,
			third,
			fourth,
		)
		const result = await writeChapter(
			{ ...chapter, paragraphs },
			{ ...options, writer: { ...options.writer, contextWindow: 4096 } },
		)
		expect(requests).toHaveLength(4)
		expect(requests[0]).toContain('p0004:')
		expect(requests[2]).toContain(ending.trimEnd())
		expect(requests[2]).toContain('p0003:')
		expect(requests[2]).not.toContain('p0004:')
		expect(result.scenes.map(({ scene }) => scene.source.from)).toEqual([
			'p0001',
			'p0003',
			'p0004',
		])
	})

	test('reviews each aligned draft excerpt only against the paragraphs it cites', async () => {
		const paragraphs = [
			{ id: 'p0001', text: `Water source. ${'water '.repeat(75)}` },
			{ id: 'p0002', text: `Bell source. ${'bell '.repeat(90)}` },
		]
		const draftText = `scene Bridge\nsource p0001-p0002\n: Water line ${'w'.repeat(455)}\n: Bell line ${'b'.repeat(455)}`
		const read = (id: string) => ({
			tool: 'read_source_range',
			arguments: { from: id, to: id },
		})
		const submit = { tool: 'submit_review', arguments: { issues: [] } }
		const { options, requests } = responses(
			draftText,
			JSON.stringify([
				{ paragraphCount: 1, lineCount: 1, targets: [] },
				{ paragraphCount: 1, lineCount: 1, targets: [] },
			]),
			read('p0001'),
			submit,
			read('p0002'),
			submit,
		)
		const input = { ...chapter, paragraphs }
		const draft = await writeChapter(input, options)
		const result = await reviewChapter(input, draft, {
			...options,
			reviewer: { ...options.reviewer, contextWindow: 5000 },
		})
		expect(result.revised).toBe(false)
		expect(requests).toHaveLength(6)
		expect(requests[2]).toContain('source p0001-p0001')
		expect(requests[2]).not.toContain('Bell line')
		expect(requests[3]).toContain('Water source.')
		expect(requests[4]).toContain('source p0002-p0002')
		expect(requests[4]).not.toContain('Water line')
		expect(requests[5]).toContain('Bell source.')
		expect(requests[5]).not.toContain('Tool result exceeds')
	})

	test('finds bounded paragraph groups when the whole alignment request does not fit', async () => {
		const paragraphs = ['Water', 'Bell', 'Shore'].map((word, i) => ({
			id: `p000${i + 1}`,
			text: `${word} source. ${word.repeat(145)}`,
		}))
		const lines = ['Water', 'Bell', 'Shore'].map(
			(word) => `: ${word} line. ${word.repeat(145)}`,
		)
		const script = ['scene Bridge', 'source p0001-p0003', '', ...lines].join(
			'\n',
		)
		const { options, requests } = responses(
			'{"lineCount":1,"complete":true}',
			'{"lineCount":1,"complete":true}',
		)
		const model = writingModel(
			{ ...options.writer, contextWindow: 4096 },
			options,
		)
		const groups = await scopeScene(() => model, script, paragraphs)
		expect(
			groups.map(({ paragraphs, lines }) => [
				paragraphs.map(({ id }) => id),
				lines,
			]),
		).toEqual(lines.map((line, i) => [[paragraphs[i].id], [line]]))
		expect(requests).toHaveLength(2)
		expect(requests[0]).toContain('Water source.')
		expect(requests[0]).not.toContain('Bell source.')
		expect(requests[1]).toContain('Bell source.')
		expect(requests[1]).not.toContain('Water line.')
	})

	test('keeps the typed limit when one paragraph with its draft lines is oversized', async () => {
		const paragraphs = [
			{ id: 'p0001', text: 'water '.repeat(800) },
			{ id: 'p0002', text: 'A bell rang.' },
		]
		const { options, requests } = responses()
		const model = writingModel(
			{ ...options.writer, contextWindow: 4096 },
			options,
		)
		await expect(
			scopeScene(
				() => model,
				'scene Bridge\nsource p0001-p0002\n\n: A boat drifted.',
				paragraphs,
			),
		).rejects.toMatchObject({
			code: 'context_limit',
			phase: 'Scene source alignment',
		})
		expect(requests).toHaveLength(0)
	})

	test('revises all oversized draft lines covered by one cited finding', async () => {
		const original = [
			'scene Bridge',
			'source p0001',
			...Array.from(
				{ length: 3 },
				(_, i) => `: Draft ${i} ${'water '.repeat(230)}`,
			),
		].join('\n')
		const { options, requests } = responses(
			original,
			{ tool: 'submit_review', arguments: { issues: [issue] } },
			'[{"paragraphCount":1,"lineCount":3,"targets":[{"finding":0,"line":0}]}]',
			': First fixed.',
			': Second fixed.',
			': Third fixed.',
		)
		const draft = await writeChapter(chapter, options)
		const result = await reviewChapter(chapter, draft, {
			...options,
			writer: { ...options.writer, contextWindow: 4096 },
		})
		expect(result.revised).toBe(true)
		expect(result.scenes[0].beats).toHaveLength(3)
		expect(requests.slice(3)).toHaveLength(3)
		for (const [i, request] of requests.slice(3).entries()) {
			expect(request).toContain(issue.issue)
			expect(request).toContain(`Draft ${i}`)
			expect(request).not.toContain(`Draft ${(i + 1) % 3}`)
		}
	})

	test.each([{ reported: [0] }, { reported: [0, 1] }])(
		'maps every line a quote crosses (reported lines: $reported)',
		async ({ reported }) => {
			const quote = 'The bell rang at dusk'
			const paragraphs = [
				{ id: 'p0001', text: quote },
				{ id: 'p0002', text: 'A boat drifted.' },
			]
			const { options } = responses(
				JSON.stringify([
					{
						paragraphCount: 2,
						lineCount: 3,
						targets: reported.map((line) => ({ finding: 0, line })),
					},
				]),
			)
			const model = writingModel(options.writer, options)
			const script =
				'scene Bridge\nsource p0001-p0002\n\n: The bell #0001\n: rang at dusk #0002\n: A boat drifted. #0003'
			const [group] = await scopeScene(() => model, script, paragraphs, [
				{ paragraphId: 'p0001', quote, text: 'Keep the sound.' },
			])
			expect(group.targets).toEqual([
				{ finding: 0, line: 0 },
				{ finding: 0, line: 1 },
			])
		},
	)

	test.each(['short source', 'A source paragraph '.repeat(20)])(
		'preflights both the source tool call and its reply before the first fidelity request (%s)',
		async (text) => {
			const input = { paragraphs: [{ id: 'p0001', text }] }
			const script = 'scene Bridge\nsource p0001-p0001\n\n: A boat drifted.'
			const firstCall = new Error('first provider request')
			const request = vi.fn(async (_context: Context) => {
				throw firstCall
			})
			const model = { inputLimit: 4096, outputTokens: 1024, request }
			await expect(
				reviewFidelity(model, input, script, () => model),
			).rejects.toBe(firstCall)
			const prompt = request.mock.calls[0][0]
			const replyOnly: Context = {
				...prompt,
				messages: [
					...prompt.messages,
					{
						role: 'toolResult',
						toolCallId: 'source',
						toolName: 'read_source_range',
						isError: false,
						content: [{ type: 'text', text: JSON.stringify(input.paragraphs) }],
						timestamp: 0,
					},
				],
			}
			const replyOnlyLimit = Array.from(
				{ length: model.inputLimit },
				(_, inputLimit) => inputLimit,
			).find((inputLimit) => promptFits({ ...model, inputLimit }, replyOnly))
			if (replyOnlyLimit === undefined)
				throw new Error('Fixture exceeds its context')
			request.mockClear()
			const tight = { ...model, inputLimit: replyOnlyLimit }
			await expect(
				reviewFidelity(tight, input, script, () => tight),
			).rejects.toBeInstanceOf(ContextLimitError)
			expect(request).not.toHaveBeenCalled()
		},
	)

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
