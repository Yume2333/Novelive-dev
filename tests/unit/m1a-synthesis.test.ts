import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { Project } from '../../packages/creator/src/project'
import { createReplayFetch } from '../../packages/creator/src/replay'
import {
	synthesisFiles,
	synthesizeVolume,
} from '../../packages/creator/src/synthesis'
import {
	applyPatches,
	bibleEntryBases,
	readBible,
	validatePatch,
} from '../../packages/creator/src/synthesis/patch'
import { type BiblePatch, projectFiles } from '../../packages/format/src/model'
import {
	candidateTower,
	chapters,
	confirmed,
	connection,
	planted,
	previews,
	scope,
	seed,
	term,
} from '../fixtures/cassettes/m1a-synthesis/fixture'

let directory: string
let root: string
const packetFetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
	const body = await new Request(input, init).json()
	const prompt: string = body.messages[0].content
	const packet = /Extract only the next event in packet (\d+)\/(\d+)/.exec(
		prompt,
	)
	if (!packet) throw new Error('Expected a packet prompt')
	const previews = prompt.split('Chapter previews:\n')[1]
	const chapterIds = new Set(
		Array.from(previews.matchAll(/^Chapter ([\w-]+):$/gm), ([, id]) => id),
	)
	const firstLongEvent =
		body.model === 'fixture-long-event' && packet[1] === '1'
	const events = Number(/^Events already extracted: (\d+)$/m.exec(prompt)?.[1])
	const repeated = body.model === 'fixture-repeated-proposal'
	const returning = body.model === 'fixture-returning-proposal'
	const aliasUpdates = body.model === 'fixture-alias-updates'
	const emissionOrder = body.model === 'fixture-emission-order'
	const guide = {
		id: 'guide',
		name: 'Guide',
		aliases: [],
		status: 'candidate',
	} as const
	const oversized = '🦊'.repeat(160)
	if (firstLongEvent && events === 1) {
		const encoded = /^Recent event summaries: (.+)$/m.exec(prompt)?.[1] ?? ''
		const history: string[] = JSON.parse(encoded)
		expect(history[0]).not.toBe('')
		expect(oversized.startsWith(history[0])).toBe(true)
		expect(Buffer.byteLength(encoded)).toBeLessThanOrEqual(256)
	}
	const result = {
		overview: 'A long journey.',
		chapters: Array.from(
			returning
				? [`c${events + 1}`]
				: aliasUpdates || emissionOrder
					? [events === 0 ? 'c1' : 'c2']
					: repeated && events > 0
						? ['c2']
						: chapterIds,
			(chapterId) => ({
				chapterId,
				progress: 'The journey continues.',
			}),
		),
		event:
			firstLongEvent && events === 0
				? oversized
				: `Event ${packet[1]}:${events}`,
		is_last: emissionOrder
			? events === 3
			: returning || aliasUpdates
				? events === 2
				: !(firstLongEvent || repeated) || events > 0,
		biblePatch: emissionOrder
			? events === 0
				? []
				: [
						events === 2
							? {
									kind: 'character',
									op: 'update',
									entry: { ...guide, aliases: ['Navigator'] },
								}
							: { kind: 'character', op: 'add', entry: guide },
						{
							kind: 'character',
							op: 'update',
							entry: {
								...confirmed,
								identity: events === 2 ? 'Admiral' : 'Captain',
							},
						},
					]
			: aliasUpdates
				? events === 0
					? []
					: [
							{
								kind: 'character',
								op: 'update',
								entry: {
									...confirmed,
									identity: undefined,
									aliases: [events === 1 ? 'Zulu' : 'Alpha'],
								},
							},
						]
				: repeated || returning
					? [
							{
								kind: 'character',
								op: 'update',
								entry: {
									...confirmed,
									identity:
										returning && events !== 1 ? 'Cartographer' : 'Captain',
								},
							},
						]
					: [],
		glossaryPatch: [],
	}
	return new Response(
		`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: JSON.stringify(result) }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
		{
			headers: { 'content-type': 'text/event-stream' },
		},
	)
})
const network = vi.fn<typeof globalThis.fetch>(async () => {
	throw new Error('Network forbidden')
})
const strict = createReplayFetch({
	mode: 'strict',
	directory: 'tests/fixtures/cassettes/m1a-synthesis',
	fetch: network,
})
const options = { connection, language: 'en', fetch: strict }
const files = synthesisFiles('v1')

test.each([false, true])(
	'reopens a completed synthesis across packet format changes (legacy: %s)',
	async (legacy) => {
		await seed(root)
		using project = await Project.open(root)
		const args = { ...options, strategy: 'whole' as const }
		const result = await synthesizeVolume(project, 'v1', chapters, args)
		const checkpoint = await project.read(files.checkpoint)
		const inputs = {
			previews: await Promise.all(
				chapters.map((id) => project.read(projectFiles.preview(id))),
			),
			language: args.language,
			strategy: args.strategy,
			incremental: false,
			model: connection.model,
			context: connection.contextWindow,
		}
		await project.write(
			files.checkpoint,
			legacy
				? {
						...checkpoint,
						inputFingerprint: undefined,
						fingerprint: createHash('sha256')
							.update(JSON.stringify({ packetFormat: 2, ...inputs }))
							.digest('hex'),
					}
				: { ...checkpoint, fingerprint: 'old-packet-format' },
		)
		const fetch = vi.fn<typeof globalThis.fetch>(async () => {
			throw new Error('Completed synthesis should be reused')
		})
		expect(
			await synthesizeVolume(project, 'v1', chapters, { ...args, fetch }),
		).toEqual(result)
		expect(fetch).not.toHaveBeenCalled()
	},
)

test('whole synthesis requests a complete chapter-by-chapter patch, not a shortlist', async () => {
	await seed(root)
	using project = await Project.open(root)
	const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
		const request = new Request(input, init)
		const body = await request.clone().json()
		expect(body.messages[0].content).toContain(
			'Return their union across all chapters',
		)
		expect(body.messages[0].content).toContain('Summarize only the overview')
		return strict(request)
	})
	await synthesizeVolume(project, 'v1', chapters, {
		...options,
		strategy: 'whole',
		fetch,
	})
	expect(fetch).toHaveBeenCalledOnce()
})

test('consolidates repeated candidate additions across events and remaps references', async () => {
	await seed(root)
	using project = await Project.open(root)
	const guide = {
		id: 'guide',
		name: 'Lin',
		aliases: ['Guide'],
		costumes: [{ id: 'travel', description: 'Travel clothes' }],
		status: 'candidate',
	} as const
	let calls = 0
	const fetch: typeof globalThis.fetch = async (input, init) => {
		const request = new Request(input, init)
		const body = await request.json()
		expect(body.messages[0].content).toContain(
			'qualifying new facts, not repeated background',
		)
		const first = calls++ === 0
		const candidate = first
			? guide
			: {
					...guide,
					id: 'lin',
					name: 'Ｌｉｎ',
					aliases: ['Guide', 'Navigator'],
					costumes: [{ id: 'formal', description: 'Formal robes' }],
				}
		const result = {
			overview: 'A journey',
			chapters: [
				{ chapterId: first ? 'c1' : 'c2', progress: 'The guide helps.' },
			],
			event: first ? 'Meeting Lin' : 'Following Lin',
			is_last: !first,
			biblePatch: [
				{ op: 'add', kind: 'character', entry: candidate },
				...(first
					? []
					: [
							{
								op: 'add',
								kind: 'relation',
								entry: {
									id: 'guiding',
									from: 'lin',
									to: 'ada',
									description: 'Guides Ada',
									status: 'candidate',
								},
							},
						]),
			],
			glossaryPatch: [],
		}
		return new Response(
			`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: JSON.stringify(result) }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
			{ headers: { 'content-type': 'text/event-stream' } },
		)
	}
	const result = await synthesizeVolume(project, 'v1', chapters, {
		...options,
		strategy: 'events',
		fetch,
	})
	expect(calls).toBe(2)
	expect(result.conflicts).toEqual([])
	expect(result.biblePatch).toMatchObject([
		{
			kind: 'character',
			entry: {
				id: 'guide',
				aliases: ['Guide', 'Navigator'],
				costumes: [{ id: 'travel' }, { id: 'formal' }],
			},
		},
		{ kind: 'relation', entry: { from: 'guide', to: 'ada' } },
	])
	const bible = await readBible(project)
	expect(bible.character.filter(({ id }) => id !== 'ada')).toMatchObject([
		{
			id: 'guide',
			aliases: ['Guide', 'Navigator'],
			costumes: [{ id: 'travel' }, { id: 'formal' }],
		},
	])
	expect(bible.relation).toContainEqual(
		expect.objectContaining({ from: 'guide', to: 'ada' }),
	)
	expect(result.bibleBase).toEqual(bibleEntryBases(bible))
	expect(await project.read(files.result)).toEqual(result)
})

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'novelive-synthesis-test-'))
	root = join(directory, 'project')
	network.mockClear()
	packetFetch.mockClear()
})

afterEach(async () => {
	expect(network).not.toHaveBeenCalled()
	await rm(directory, { recursive: true, force: true })
})

const repairedEvent = {
	overview: 'A key opens a tower.',
	chapters: [
		{ chapterId: 'c1', progress: 'Ada finds a key.' },
		{ chapterId: 'c2', progress: 'Ada opens the tower.' },
	],
	event: 'Ada finds and uses a key.',
	is_last: true,
	biblePatch: [],
	glossaryPatch: [],
}

test.each([
	{
		response: {
			overview: { summary: 'A key opens a tower.' },
			chapters: [{ chapterId: 'c1', progress: ['Ada finds a key.'] }],
			biblePatch: [{ kind: 'location', op: 'upsert', entry: candidateTower }],
			glossaryPatch: [],
		},
		errors: [
			'/event [required]: missing',
			'/is_last [required]: missing',
			'/overview [type]: expected string, got object',
			'/chapters/0/progress [type]: expected string, got array',
			'/biblePatch/0/op [enum]:',
		],
	},
	{
		response: {
			...repairedEvent,
			glossaryPatch: [
				{ id: 'key', original: 'Key', written: 'Key', category: 'object' },
			],
			changes: [],
		},
		errors: [
			'/glossaryPatch/0/status [required]: missing',
			'/changes [additionalProperties]: unknown field',
			'declared keys: id, status,',
			'required fields: id, status, original, written, category',
		],
	},
	{
		response: { ...repairedEvent, overview: false, ['章'.repeat(8192)]: true },
		errors: ['/overview [type]: expected string, got boolean'],
	},
] as const)(
	'repairs a redacted invalid event against the same contract',
	async ({ response, errors }) => {
		await seed(root)
		using project = await Project.open(root)
		const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
			const { messages } = await new Request(input, init).json()
			const prompt = messages[0].content as string
			expect(prompt).toContain('is_last:b')
			expect(prompt).toMatch(
				/glossaryPatch:\[\{id:[^,]+,status:(?:\$\d+|"candidate"\|"confirmed")/,
			)
			expect(prompt).toContain('"candidate"|"confirmed"')
			let output: unknown = response
			if (messages.length === 2) {
				for (const expected of errors)
					expect(messages[1].content).toContain(expected)
				if (
					Buffer.byteLength(JSON.stringify(response)) > connection.contextWindow
				) {
					expect(
						Buffer.byteLength(prompt + messages[1].content),
					).toBeLessThanOrEqual(connection.contextWindow - 4096)
					expect(messages[1].content).not.toContain('\uFFFD')
				} else {
					expect(messages[1].content).toContain(
						'allowed keys: overview, chapters, biblePatch, glossaryPatch, event, is_last',
					)
				}
				output = repairedEvent
			}
			const data = [
				{
					choices: [
						{
							index: 0,
							delta: { role: 'assistant', content: JSON.stringify(output) },
						},
					],
				},
				{ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
			]
			return new Response(
				`${data.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`,
				{ headers: { 'content-type': 'text/event-stream' } },
			)
		})
		await expect(
			synthesizeVolume(project, 'v1', chapters, {
				...options,
				strategy: 'events',
				fetch,
			}),
		).resolves.toMatchObject({ chapters: repairedEvent.chapters })
		expect(fetch).toHaveBeenCalledTimes(2)
	},
)

test('whole-volume replay persists a skeleton, candidates and conflicts without replacing confirmed content', async () => {
	await seed(root)
	using project = await Project.open(root)
	const digest = {
		formatVersion: 1,
		volumeId: 'v1',
		summary: 'Preview digest',
	} as const
	await project.write(projectFiles.digest('v1'), digest)
	const glossary = {
		formatVersion: 1 as const,
		entries: [term],
		editorNote: 'Keep this note',
	}
	await project.write(projectFiles.glossary(scope), glossary)
	const result = await synthesizeVolume(project, 'v1', chapters, {
		...options,
		strategy: 'whole',
	})
	expect(result.chapters.map(({ chapterId }) => chapterId)).toEqual(chapters)
	expect(await project.read(projectFiles.skeleton('v1'))).toMatchObject({
		chapters: result.chapters,
	})
	expect(await project.read(projectFiles.digest('v1'))).toEqual(digest)
	expect(await project.read(files.result)).toEqual(result)
	expect(result.conflicts).toMatchObject([
		{
			entry: {
				id: 'ada',
				name: 'Ava',
				status: 'candidate',
				conflict: expect.any(String),
			},
		},
	])
	expect(result.glossaryConflicts).toMatchObject([
		{ id: 'tower', written: 'Ink Tower', status: 'candidate' },
	])
	expect(
		await project.read(projectFiles.character(scope, 'ada')),
	).toMatchObject({
		entries: [
			{
				...confirmed,
				changes: [{ chapterId: 'c2', field: 'identity', value: 'Captain' }],
			},
		],
	})
	expect(
		await project.read(projectFiles.location(scope, 'tower')),
	).toMatchObject({ entries: [{ status: 'candidate' }] })
	expect(await project.read(projectFiles.glossary(scope))).toMatchObject({
		editorNote: glossary.editorNote,
		entries: [term, { id: 'key', status: 'candidate' }],
	})
})

test('only an explicit rerun re-synthesizes a completed volume with the same inputs', async () => {
	await seed(root)
	using project = await Project.open(root)
	const fetch = vi.fn<typeof globalThis.fetch>(strict)
	const whole = { ...options, strategy: 'whole' as const, fetch }
	await synthesizeVolume(project, 'v1', chapters, whole)
	expect(fetch).toHaveBeenCalledTimes(1)
	await synthesizeVolume(project, 'v1', chapters, whole)
	expect(fetch).toHaveBeenCalledTimes(1)
	await synthesizeVolume(project, 'v1', chapters, { ...whole, rerun: true })
	expect(fetch).toHaveBeenCalledTimes(2)
	await synthesizeVolume(project, 'v1', chapters, whole)
	expect(fetch).toHaveBeenCalledTimes(2)
	expect(
		await project.read(projectFiles.character(scope, 'ada')),
	).toMatchObject({ entries: [confirmed] })
})

test('a hard stop persists exactly one event and resumes after reopening without replaying it', async () => {
	await seed(root)
	const fetch = vi.fn<typeof globalThis.fetch>(strict)
	{
		using project = await Project.open(root)
		await expect(
			synthesizeVolume(project, 'v1', chapters, {
				...options,
				strategy: 'events',
				maxEvents: 1,
				fetch,
			}),
		).rejects.toThrow('Synthesis reached its event limit (1)')
		expect(fetch).toHaveBeenCalledTimes(1)
		expect(await project.read(files.checkpoint)).toMatchObject({
			applied: false,
			events: [{ event: 'Synthetic event 1', is_last: false }],
		})
		await expect(
			project.read(projectFiles.skeleton('v1')),
		).rejects.toMatchObject({ code: 'ENOENT' })
		expect(
			await project.read(projectFiles.character(scope, 'ada')),
		).toMatchObject({ entries: [confirmed] })
	}
	{
		using project = await Project.open(root)
		const result = await synthesizeVolume(project, 'v1', chapters, {
			...options,
			strategy: 'events',
			fetch,
		})
		expect(fetch).toHaveBeenCalledTimes(2)
		expect(result.biblePatch).toHaveLength(3)
		expect(result.conflicts).toHaveLength(1)
		expect(
			await project.read(projectFiles.character(scope, 'ada')),
		).toMatchObject({
			entries: [
				{
					...confirmed,
					changes: [{ chapterId: 'c2', field: 'identity', value: 'Captain' }],
				},
			],
		})
		expect(await project.read(files.checkpoint)).toMatchObject({
			applied: true,
			events: [{ is_last: false }, { is_last: true }],
		})
		expect(
			await synthesizeVolume(project, 'v1', chapters, {
				...options,
				strategy: 'events',
				fetch,
			}),
		).toEqual(result)
		expect(fetch).toHaveBeenCalledTimes(2)
	}
})

test('resumes the same synthesis packet after changing the model output cap', async () => {
	await seed(root)
	const prompts: string[] = []
	const fetch: typeof globalThis.fetch = async (input, init) => {
		const request = new Request(input, init)
		const body = await request.clone().json()
		prompts.push(body.messages[0].content)
		return packetFetch(request)
	}
	const packetOptions = {
		...options,
		connection: {
			...connection,
			contextWindow: 4096,
			model: 'fixture-long-event',
		},
		strategy: 'events' as const,
		fetch,
	}
	{
		using project = await Project.open(root)
		await project.write(projectFiles.preview(chapters[0]), {
			...previews[0],
			summary: 'A'.repeat(1600),
		})
		await expect(
			synthesizeVolume(project, 'v1', chapters, {
				...packetOptions,
				maxEvents: 1,
			}),
		).rejects.toThrow('Synthesis reached its event limit (1)')
	}
	{
		using project = await Project.open(root)
		await expect(
			synthesizeVolume(project, 'v1', chapters, {
				...packetOptions,
				connection: { ...packetOptions.connection, maxOutputTokens: 256 },
				maxEvents: 2,
			}),
		).rejects.toThrow('Synthesis reached its event limit (2)')
	}
	expect(prompts).toHaveLength(2)
	expect(prompts[1]).toContain('Events already extracted: 1')
	expect(prompts[1].split('Chapter previews:\n')[1]).toBe(
		prompts[0].split('Chapter previews:\n')[1],
	)
})

test('the default event cap can cover a volume with more than 128 packets', async () => {
	await seed(root)
	using project = await Project.open(root)
	const ids = Array.from({ length: 130 }, (_, i) => `long-${i}`)
	await Promise.all(
		ids.map((chapterId) =>
			project.write(projectFiles.preview(chapterId), {
				...previews[0],
				chapterId,
				summary: 'A'.repeat(7200),
			}),
		),
	)
	const result = await synthesizeVolume(project, 'v1', ids, {
		...options,
		fetch: packetFetch,
	})
	expect(packetFetch.mock.calls.length).toBeGreaterThan(128)
	expect(result.chapters.map(({ chapterId }) => chapterId)).toEqual(ids)
})

test('automatic fallback also works at the minimum 4096-token context', async () => {
	await seed(root)
	using project = await Project.open(root)
	for (const preview of previews)
		await project.write(projectFiles.preview(preview.chapterId), {
			...preview,
			summary: preview.summary.repeat(70),
		})
	const result = await synthesizeVolume(project, 'v1', chapters, {
		...options,
		connection: { ...connection, contextWindow: 4096 },
		fetch: packetFetch,
	})
	expect(packetFetch.mock.calls.length).toBeGreaterThan(1)
	expect(result.chapters.map(({ chapterId }) => chapterId)).toEqual(chapters)
})

test('a minimum-context continuation retains a truncated newest event in the same packet', async () => {
	await seed(root)
	using project = await Project.open(root)
	const result = await synthesizeVolume(project, 'v1', chapters, {
		...options,
		connection: {
			...connection,
			contextWindow: 4096,
			model: 'fixture-long-event',
		},
		strategy: 'events',
		fetch: packetFetch,
	})
	expect(packetFetch.mock.calls.length).toBeGreaterThan(1)
	expect(result.chapters.map(({ chapterId }) => chapterId)).toEqual(chapters)
})

test.each([
	{
		model: 'fixture-repeated-proposal',
		count: 1,
		chapters: ['c2'],
		expected: [{ chapterId: 'c2', field: 'identity', value: 'Captain' }],
	},
	{
		model: 'fixture-returning-proposal',
		count: 3,
		chapters: ['c1', 'c2', 'c3'],
		expected: [
			{ chapterId: 'c2', field: 'identity', value: 'Captain' },
			{ chapterId: 'c3', field: 'identity', value: 'Cartographer' },
		],
	},
])(
	'proposal deduplication retains required chapter evidence: $model',
	async ({ model, count, expected, chapters: observed }) => {
		await seed(root)
		using project = await Project.open(root)
		const ids =
			model === 'fixture-returning-proposal' ? [...chapters, 'c3'] : chapters
		if (ids.length === 3)
			await project.write(projectFiles.preview('c3'), {
				...previews[0],
				chapterId: 'c3',
			})
		const result = await synthesizeVolume(project, 'v1', ids, {
			...options,
			connection: { ...connection, model },
			strategy: 'events',
			fetch: packetFetch,
		})
		expect(result.biblePatch).toHaveLength(count)
		expect(
			(await project.read(files.result)).biblePatch.map(
				({ observedChapter }) => observedChapter,
			),
		).toEqual(observed)
		expect(result.conflicts).toEqual([])
		expect(
			await project.read(projectFiles.character(scope, 'ada')),
		).toMatchObject({
			entries: [
				{
					...confirmed,
					changes: expected,
				},
			],
		})
	},
)

test('the later same-chapter candidate alias update wins', async () => {
	await seed(root)
	using project = await Project.open(root)
	const file = projectFiles.character(scope, 'ada')
	await project.write(file, {
		formatVersion: 1,
		entries: [{ ...confirmed, status: 'candidate', aliases: [] }],
	})
	const result = await synthesizeVolume(project, 'v1', chapters, {
		...options,
		connection: { ...connection, model: 'fixture-alias-updates' },
		strategy: 'events',
		fetch: packetFetch,
	})
	expect(result.conflicts).toEqual([])
	expect(
		result.biblePatch.map(({ entry, observedChapter }) => [
			entry,
			observedChapter,
		]),
	).toMatchObject([
		[{ aliases: ['Zulu'] }, 'c2'],
		[{ aliases: ['Alpha'] }, 'c2'],
	])
	expect((await project.read(file)).entries[0].aliases).toEqual(['Alpha'])
})

test('deduplication retains the first addition and the first competing identity claim', async () => {
	await seed(root)
	using project = await Project.open(root)
	const result = await synthesizeVolume(project, 'v1', chapters, {
		...options,
		connection: { ...connection, model: 'fixture-emission-order' },
		strategy: 'events',
		fetch: packetFetch,
	})
	expect(result.biblePatch.map(({ entry, op }) => [entry.id, op])).toEqual([
		['guide', 'add'],
		['ada', 'update'],
		['guide', 'update'],
		['ada', 'update'],
	])
	expect(result.conflicts).toMatchObject([
		{ entry: { id: 'ada', identity: 'Admiral' } },
	])
	const { character } = await readBible(project)
	expect(character).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ id: 'guide', aliases: ['Navigator'] }),
			expect.objectContaining({
				id: 'ada',
				changes: [{ chapterId: 'c2', field: 'identity', value: 'Captain' }],
			}),
		]),
	)
})

test('an undated update follows the dated addition it depends on', async () => {
	await seed(root)
	using project = await Project.open(root)
	const entry = {
		id: 'guide',
		name: 'Guide',
		aliases: [],
		status: 'candidate' as const,
	}
	const result = await applyPatches(
		project,
		await readBible(project),
		[
			{ kind: 'character', op: 'add', entry, observedChapter: 'c2' },
			{
				kind: 'character',
				op: 'update',
				entry: { ...entry, aliases: ['Navigator'] },
			},
		],
		[],
		new Set(chapters),
	)
	expect(result.conflicts).toEqual([])
	expect((await readBible(project)).character).toContainEqual({
		...entry,
		aliases: ['Navigator'],
	})
})

test('whole-volume dated updates apply after their new entry and keep their emission order', async () => {
	await seed(root)
	using project = await Project.open(root)
	const entry = {
		id: 'guide',
		name: 'Guide',
		aliases: [],
		status: 'candidate' as const,
		firstSeenChapter: 'c1',
		identity: 'Guide',
	}
	const changes = [{ chapterId: 'c2', field: 'identity', value: 'Navigator' }]
	const result = await applyPatches(
		project,
		await readBible(project),
		[
			{
				kind: 'character',
				op: 'update',
				entry: { ...entry, changes, aliases: ['Zulu'] },
			},
			{
				kind: 'character',
				op: 'update',
				entry: { ...entry, changes, aliases: ['Alpha'] },
			},
			{ kind: 'character', op: 'add', entry },
		],
		[],
		new Set(chapters),
	)
	expect(result.conflicts).toEqual([])
	expect((await readBible(project)).character).toContainEqual({
		...entry,
		aliases: ['Alpha'],
		changes,
	})
})

test('a candidate can be deleted and then re-added in emission order', async () => {
	await seed(root)
	using project = await Project.open(root)
	const entry = {
		id: 'guide',
		name: 'Guide',
		aliases: [],
		status: 'candidate' as const,
		firstSeenChapter: 'c1',
	}
	const replacement = { ...entry, name: 'Navigator', firstSeenChapter: 'c2' }
	await project.write(projectFiles.character(scope, entry.id), {
		formatVersion: 1,
		entries: [entry],
	})
	const result = await applyPatches(
		project,
		await readBible(project),
		[
			{ kind: 'character', op: 'delete', entry },
			{ kind: 'character', op: 'add', entry: replacement },
		],
		[],
		new Set(chapters),
	)
	expect(result.conflicts).toEqual([])
	expect((await readBible(project)).character).toContainEqual(replacement)
})

test('a later addition does not displace a same-chapter update to an existing character', async () => {
	await seed(root)
	using project = await Project.open(root)
	const entry = { ...confirmed, aliases: [] }
	const result = await applyPatches(
		project,
		await readBible(project),
		[
			{
				kind: 'character',
				op: 'update',
				entry: { ...entry, identity: 'Captain' },
				observedChapter: 'c2',
			},
			{
				kind: 'character',
				op: 'add',
				entry: { ...entry, identity: 'Admiral' },
				observedChapter: 'c2',
			},
		],
		[],
		new Set(chapters),
	)
	expect(result.conflicts).toMatchObject([
		{ op: 'add', entry: { identity: 'Admiral' } },
	])
	expect((await readBible(project)).character).toContainEqual({
		...entry,
		changes: [{ chapterId: 'c2', field: 'identity', value: 'Captain' }],
	})
})

test('an update still waiting for an addition at the end goes to conflict review', async () => {
	await seed(root)
	using project = await Project.open(root)
	const entry = {
		id: 'guide',
		name: 'Guide',
		aliases: [],
		status: 'candidate' as const,
	}
	const bible = await readBible(project)
	const result = await applyPatches(
		project,
		bible,
		[{ kind: 'character', op: 'update', entry }],
		[],
		new Set(chapters),
	)
	expect(result.conflicts).toEqual([
		{
			kind: 'character',
			op: 'update',
			entry: { ...entry, conflict: 'Entry to update is not published' },
		},
	])
	expect(await readBible(project)).toEqual(bible)
})

test('a deletion sends deferred updates to review instead of applying them to a later re-add', async () => {
	await seed(root)
	using project = await Project.open(root)
	const entry = {
		id: 'guide',
		name: 'Guide',
		aliases: [],
		status: 'candidate' as const,
		firstSeenChapter: 'c1',
	}
	const update = {
		kind: 'character',
		op: 'update',
		entry: { ...entry, aliases: ['Old guide'] },
	} satisfies BiblePatch[number]
	const replacement = { ...entry, name: 'Replacement', firstSeenChapter: 'c2' }
	const result = await applyPatches(
		project,
		await readBible(project),
		[
			update,
			{ kind: 'character', op: 'delete', entry },
			{ kind: 'character', op: 'add', entry: replacement },
		],
		[],
		new Set(chapters),
	)
	expect(result.conflicts).toEqual([
		{
			...update,
			entry: {
				...update.entry,
				conflict: 'Entry was deleted before its update could be applied',
			},
		},
	])
	expect((await readBible(project)).character).toContainEqual(replacement)
})

test('automatic fallback streams all preview packets without truncation', async () => {
	await seed(root, true)
	using project = await Project.open(root)
	const segments: string[] = []
	const fetch: typeof globalThis.fetch = async (input, init) => {
		const request = new Request(input, init)
		const body = await request.clone().json()
		const history = /^Recent event summaries: (.+)$/m.exec(
			body.messages[0].content,
		)?.[1]
		expect(history).toBeDefined()
		expect(Buffer.byteLength(history ?? '')).toBeLessThanOrEqual(1024)
		segments.push(body.messages[0].content.split('Chapter previews:\n')[1])
		return strict(request)
	}
	const result = await synthesizeVolume(project, 'v1', chapters, {
		...options,
		fetch,
	})
	expect(segments.length).toBeGreaterThan(2)
	const stored = await Promise.all(
		chapters.map((id) => project.read(projectFiles.preview(id))),
	)
	const fragments = segments.flatMap((packet) => [
		...packet.matchAll(/^Chapter (\w+):\n([^\n]+)/gm),
	])
	for (const preview of stored) {
		const parts = fragments.filter(([, id]) => id === preview.chapterId)
		expect(parts.length).toBeGreaterThan(1)
		expect(parts.map(([, , text]) => text).join('')).toBe(
			JSON.stringify(preview),
		)
	}
	expect(segments.at(-1)).toMatch(/^Chapter c2:\n(?!\{)/)
	expect(result.chapters[1]).toEqual({
		chapterId: 'c2',
		progress: 'Ada opens the tower.',
	})
})

test('incremental synthesis can resolve foreshadowing planted in an earlier volume', async () => {
	await seed(root, false, true)
	using project = await Project.open(root)
	await synthesizeVolume(project, 'v1', chapters, {
		...options,
		connection: { ...connection, model: 'fixture-synthesis-cross-volume' },
		incremental: true,
		strategy: 'whole',
	})
	expect(await project.read(projectFiles.foreshadowing(scope))).toMatchObject({
		entries: [{ ...planted, resolvedChapter: 'c2' }],
	})
})

test('a new timeline event cannot cite a chapter from an earlier volume', async () => {
	await seed(root, false, true)
	using project = await Project.open(root)
	const bible = await readBible(project)
	const currentVolume = new Set(chapters)
	const series = new Set([...chapters, 'earlier'])
	const fetch = vi.fn<typeof globalThis.fetch>(strict)
	await expect(
		synthesizeVolume(project, 'v1', ['earlier'], { ...options, fetch }),
	).rejects.toThrow('Synthesis chapter IDs must belong to this volume')
	expect(fetch).not.toHaveBeenCalled()
	const event = {
		id: 'old-event',
		chapterId: 'earlier',
		event: 'An invented event.',
		status: 'candidate',
	} as const
	expect(() =>
		validatePatch(
			bible,
			[{ kind: 'timeline', op: 'add', entry: event }],
			[],
			currentVolume,
			series,
			true,
		),
	).toThrow('Unknown chapter reference: earlier')
	expect(() =>
		validatePatch(
			bible,
			[{ kind: 'timeline', op: 'add', entry: { ...event, chapterId: 'c1' } }],
			[],
			currentVolume,
			series,
			true,
		),
	).not.toThrow()
})

test('character deletion becomes a conflict if a surviving relation references it', async () => {
	await seed(root)
	using project = await Project.open(root)
	const candidate = {
		id: 'guide',
		name: 'Guide',
		aliases: [],
		status: 'candidate',
		firstSeenChapter: 'c1',
	} as const
	const relation = {
		id: 'guide-ada',
		from: 'guide',
		to: 'ada',
		description: 'Friends',
		status: 'candidate',
		firstSeenChapter: 'c1',
	} as const
	await project.write(projectFiles.character(scope, 'guide'), {
		formatVersion: 1,
		entries: [{ ...candidate, aliases: [] }],
	})
	await project.write(projectFiles.relations(scope), {
		formatVersion: 1,
		entries: [relation],
	})
	const bible = await readBible(project)
	const patch = {
		kind: 'character',
		op: 'delete',
		entry: { ...candidate, aliases: [] },
	} satisfies BiblePatch[number]
	const retained = await applyPatches(
		project,
		bible,
		[patch],
		[],
		new Set(chapters),
	)
	expect(retained.conflicts).toMatchObject([
		{
			...patch,
			entry: {
				id: 'guide',
				conflict: expect.stringContaining('still referenced'),
			},
		},
	])
	expect(await readBible(project)).toEqual(bible)
	await applyPatches(
		project,
		bible,
		[patch, { kind: 'relation', op: 'delete', entry: relation }],
		[],
		new Set(chapters),
	)
	const updated = await readBible(project)
	expect(updated.character.map(({ id }) => id)).toEqual(['ada'])
	expect(updated.relation).toEqual([])
	const added = await applyPatches(
		project,
		updated,
		[
			{ ...patch, op: 'add' },
			patch,
			{ kind: 'relation', op: 'add', entry: relation },
		],
		[],
		new Set(chapters),
	)
	expect(added.conflicts).toHaveLength(1)
	expect((await readBible(project)).relation).toEqual([])
	expect((await readBible(project)).character.map(({ id }) => id)).toEqual([
		'ada',
	])
})

test('a proposal cannot smuggle fixed facts onto confirmed characters as temporal changes', async () => {
	await seed(root)
	using project = await Project.open(root)
	const bible = await readBible(project)
	const fixed = { chapterId: 'c2', field: 'birthName', value: 'Ava' }
	const temporal = { chapterId: 'c2', field: 'identity', value: 'Captain' }
	const result = await applyPatches(
		project,
		bible,
		[
			{
				kind: 'character',
				op: 'update',
				entry: { ...confirmed, aliases: [], changes: [fixed] },
			},
			{
				kind: 'character',
				op: 'update',
				entry: { ...confirmed, aliases: [], changes: [temporal] },
			},
		],
		[],
		new Set(chapters),
	)
	expect(result.conflicts).toMatchObject([
		{ entry: { status: 'candidate', changes: [fixed] } },
	])
	expect((await readBible(project)).character).toMatchObject([
		{ ...confirmed, changes: [temporal] },
	])
})

test.each(['explicit', 'observed'])(
	'location normalization accepts %s descriptions, but renaming is a conflict',
	async (source) => {
		await seed(root)
		using project = await Project.open(root)
		const tower = {
			id: 'tower',
			name: 'Paper Tower',
			description: 'Intact',
			status: 'confirmed',
			firstSeenChapter: 'c1',
		} as const
		const file = projectFiles.location(scope, 'tower')
		await project.write(file, { formatVersion: 1, entries: [tower] })
		const temporal = { chapterId: 'c2', field: 'description', value: 'Ruined' }
		const update = {
			kind: 'location',
			op: 'update',
			observedChapter: source === 'observed' ? 'c2' : undefined,
			entry:
				source === 'explicit'
					? { ...tower, changes: [temporal] }
					: { ...tower, description: 'Ruined' },
		} satisfies BiblePatch[number]
		const result = await applyPatches(
			project,
			await readBible(project),
			[
				update,
				{
					kind: 'location',
					op: 'update',
					entry: {
						...tower,
						changes: [{ ...temporal, field: 'name', value: 'Other Tower' }],
					},
				},
			],
			[],
			new Set(chapters),
		)
		expect(result.conflicts).toHaveLength(1)
		expect(await project.read(file)).toMatchObject({
			entries: [{ ...tower, changes: [temporal] }],
		})
	},
)

test.each([
	{
		name: 'an observation of the state already in effect does not reverse a later explicit change',
		history: [['c1', 'Captain']],
		proposals: [
			{ observed: 'c2', value: 'Captain', history: [['c3', 'Admiral']] },
		],
		expected: [
			['c1', 'Captain'],
			['c3', 'Admiral'],
		],
	},
	{
		name: 'an observation that seemed redundant survives history arriving out of order',
		history: [],
		proposals: [
			{ observed: 'c3', value: 'Cartographer', history: [] },
			{ history: [['c2', 'Captain']] },
		],
		expected: [
			['c2', 'Captain'],
			['c3', 'Cartographer'],
		],
	},
	{
		name: 'returning to an old value is a new transition even with copied history',
		history: [['c1', 'Captain']],
		proposals: [
			{
				observed: 'c2',
				value: 'Cartographer',
				history: [['earlier', 'Cartographer']],
			},
		],
		expected: [
			['c1', 'Captain'],
			['c2', 'Cartographer'],
		],
	},
	{
		name: 'the observation does not inherit the original first-seen chapter',
		history: [],
		proposals: [{ observed: 'c2', value: 'Captain', history: [] }],
		expected: [['c2', 'Captain']],
	},
	{
		name: 'two different temporal claims for the same chapter conflict',
		history: [['c1', 'Captain']],
		proposals: [{ observed: 'c1', value: 'Admiral', history: [] }],
		expected: [['c1', 'Captain']],
		conflict: true,
	},
	{
		name: 'a different observation at the confirmed first chapter conflicts without existing changes',
		firstSeen: 'c1',
		history: [],
		proposals: [{ observed: 'c1', value: 'Captain', history: [] }],
		expected: [],
		conflict: true,
	},
	{
		name: 'a stored first-chapter change wins over the confirmed base and can be repeated',
		firstSeen: 'c1',
		history: [['c1', 'Captain']],
		proposals: [
			{ observed: 'c1', value: 'Captain', history: [['c1', 'Captain']] },
		],
		expected: [['c1', 'Captain']],
	},
	{
		name: 'an earlier observation cannot move a confirmed base',
		firstSeen: 'c2',
		history: [],
		proposals: [{ observed: 'c1', value: 'Captain', history: [] }],
		expected: [],
		conflict: true,
	},
	{
		name: 'an undated different value conflicts',
		history: [],
		proposals: [{ observed: undefined, value: 'Captain', history: [] }],
		expected: [],
		conflict: true,
	},
	{
		name: 'an explicit change wins over a base echo in the same proposal',
		history: [],
		proposals: [
			{ observed: 'c2', value: 'Cartographer', history: [['c2', 'Captain']] },
		],
		expected: [['c2', 'Captain']],
	},
	{
		name: 'an explicit change wins over a previously collected base echo',
		history: [],
		proposals: [
			{ observed: 'c2', value: 'Cartographer', history: [] },
			{ history: [['c2', 'Captain']] },
		],
		expected: [['c2', 'Captain']],
	},
])(
	'temporal normalization: $name',
	async ({ history, proposals, expected, conflict, firstSeen }) => {
		await seed(root)
		using project = await Project.open(root)
		const entry = {
			...confirmed,
			aliases: [],
			firstSeenChapter: firstSeen ?? 'earlier',
		}
		const points = (rows: string[][]) =>
			rows.map(([chapterId, value]) => ({
				chapterId,
				field: 'identity',
				value,
			}))
		const file = projectFiles.character(scope, 'ada')
		await project.write(file, {
			formatVersion: 1,
			entries: [{ ...entry, changes: points(history) }],
		})
		const patch = proposals.map((proposal) => {
			const item = {
				kind: 'character',
				op: 'update',
				observedChapter: proposal.observed,
				entry: {
					...entry,
					identity: proposal.value,
					changes: points(proposal.history),
				},
			} satisfies BiblePatch[number]
			return item
		})
		const result = await applyPatches(
			project,
			await readBible(project),
			patch,
			[],
			new Set(chapters),
			new Set(['earlier', ...chapters, 'c3']),
		)
		expect(result.conflicts).toHaveLength(conflict ? 1 : 0)
		expect(await project.read(file)).toMatchObject({
			entries: [
				{
					...entry,
					changes: points(expected),
				},
			],
		})
	},
)

test.each(['character', 'location'] as const)(
	'a dated %s value is never promoted to the base',
	async (kind) => {
		await seed(root)
		using project = await Project.open(root)
		const item: BiblePatch[number] =
			kind === 'character'
				? {
						kind,
						op: 'add',
						observedChapter: 'c2',
						entry: {
							...confirmed,
							aliases: [],
							status: 'candidate',
							id: 'new',
							identity: 'Captain',
						},
					}
				: {
						kind,
						op: 'add',
						entry: {
							id: 'new',
							status: 'candidate',
							name: 'New',
							description: 'Ruined',
							changes: [
								{ chapterId: 'c2', field: 'description', value: 'Ruined' },
							],
						},
					}
		const result = await applyPatches(
			project,
			await readBible(project),
			[item],
			[],
			new Set(chapters),
		)
		expect(result.conflicts).toEqual([])
		const entries = (await readBible(project))[kind]
		const entry = entries.find(({ id }) => id === 'new')
		expect(entry).toMatchObject({
			changes: [
				kind === 'character'
					? { chapterId: 'c2', field: 'identity', value: 'Captain' }
					: { chapterId: 'c2', field: 'description', value: 'Ruined' },
			],
		})
		if (kind === 'character') expect(entry).not.toHaveProperty('identity')
		else expect(entry).toHaveProperty('description', '')
	},
)

test('an undated whole-volume proposal retains its base through a later return', async () => {
	await seed(root)
	using project = await Project.open(root)
	const history = [
		{ chapterId: 'c2', field: 'identity', value: 'Captain' },
		{ chapterId: 'c3', field: 'identity', value: 'Cartographer' },
	]
	const entry = {
		...confirmed,
		status: 'candidate' as const,
		id: 'new',
		aliases: [],
		changes: history,
	}
	const result = await applyPatches(
		project,
		await readBible(project),
		[{ kind: 'character', op: 'add', entry }],
		[],
		new Set(['c1', 'c2', 'c3']),
	)
	expect(result.conflicts).toEqual([])
	expect((await readBible(project)).character).toContainEqual(entry)
})

test('an undated addition that repeats the first dated identity does not backdate it', async () => {
	await seed(root)
	using project = await Project.open(root)
	const changes = [
		{ chapterId: 'c3', field: 'identity', value: 'Admiral' },
		{ chapterId: 'c2', field: 'identity', value: 'Captain' },
	]
	const item = {
		kind: 'character',
		op: 'add',
		entry: {
			...confirmed,
			id: 'new',
			aliases: [],
			identity: 'Captain',
			changes,
		},
	} satisfies BiblePatch[number]
	const result = await applyPatches(
		project,
		await readBible(project),
		[item],
		[],
		new Set(['c1', 'c2', 'c3']),
	)
	expect(result.conflicts).toEqual([])
	const published = (await readBible(project)).character.find(
		({ id }) => id === 'new',
	)
	expect(published).toMatchObject({
		firstSeenChapter: 'c1',
		changes: [...changes].reverse(),
	})
	expect(published).not.toHaveProperty('identity')
})

test.each(['relation', 'character'] as const)(
	'a %s referencing a rejected character goes to review',
	async (kind) => {
		await seed(root)
		using project = await Project.open(root)
		const missing = {
			kind: 'character',
			op: 'add',
			observedChapter: 'c1',
			entry: {
				...confirmed,
				aliases: [],
				id: 'missing',
				identity: 'Captain',
				changes: [{ chapterId: 'c1', field: 'identity', value: 'Admiral' }],
			},
		} satisfies BiblePatch[number]
		const dependent =
			kind === 'relation'
				? ({
						kind,
						op: 'add',
						entry: {
							id: 'dependent',
							status: 'candidate',
							from: 'ada',
							to: 'missing',
							description: 'Guide',
						},
					} satisfies BiblePatch[number])
				: ({
						kind,
						op: 'add',
						entry: {
							...confirmed,
							aliases: [],
							id: 'dependent',
							addresses: [{ speakerId: 'missing', name: 'Friend' }],
						},
					} satisfies BiblePatch[number])
		const result = await applyPatches(
			project,
			await readBible(project),
			[missing, dependent],
			[],
			new Set(chapters),
		)
		expect(result.conflicts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					entry: expect.objectContaining({ id: 'missing' }),
				}),
				expect.objectContaining({
					entry: expect.objectContaining({
						id: 'dependent',
						conflict: 'Referenced character is not published: missing',
					}),
				}),
			]),
		)
		const bible = await readBible(project)
		expect(bible.character.map(({ id }) => id)).toEqual(['ada'])
		expect(bible.relation).toEqual([])
	},
)

test('a later dangling reference does not reject an earlier valid proposal for the same entry', async () => {
	await seed(root)
	using project = await Project.open(root)
	const relation = {
		id: 'connection',
		status: 'candidate',
		from: 'ada',
		to: 'ada',
		description: 'Trusts',
	} as const
	const valid = {
		kind: 'relation',
		op: 'add',
		entry: relation,
	} satisfies BiblePatch[number]
	const invalid = {
		kind: 'relation',
		op: 'update',
		entry: { ...relation, to: 'missing' },
	} satisfies BiblePatch[number]
	const result = await applyPatches(
		project,
		await readBible(project),
		[valid, invalid],
		[],
		new Set(chapters),
	)
	expect(result.conflicts).toMatchObject([
		{
			...invalid,
			entry: {
				...invalid.entry,
				conflict: 'Referenced character is not published: missing',
			},
		},
	])
	expect((await readBible(project)).relation).toEqual([relation])
})

test('seeded timeline merges preserve confirmed facts, chapter values and published references across permutations', async () => {
	let state = 0x4e4c
	const next = (limit: number) => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0
		return state % limit
	}
	const ids = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6']
	const order = new Set(ids)
	const values = [confirmed.identity, 'Captain', 'Admiral']
	const base = { ...confirmed, aliases: [] }
	const file = projectFiles.character(scope, base.id)
	const observe = (chapter: string, value: string) =>
		({
			kind: 'character',
			op: 'update',
			observedChapter: chapter,
			entry: { ...base, identity: value },
		}) satisfies BiblePatch[number]
	const validRelation = {
		id: 'connection',
		status: 'candidate',
		from: 'ada',
		to: 'ada',
		description: 'Trusts',
	} as const
	const valid = {
		kind: 'relation',
		op: 'add',
		entry: validRelation,
	} satisfies BiblePatch[number]
	const dangling = {
		kind: 'relation',
		op: 'update',
		entry: { ...validRelation, to: 'missing' },
	} satisfies BiblePatch[number]
	for (let trial = 0; trial < 20; trial++) {
		const competing: ReturnType<typeof observe>[] = []
		const observations = ids.slice(2).flatMap((id) => {
			if (id === 'c3' && trial % 2 === 0) {
				competing.push(observe(id, 'Admiral'))
				return [observe(id, 'Captain')]
			}
			if (id === 'c4' && trial % 3 === 0) {
				competing.push(observe(id, 'Cafe\u0301'))
				return [observe(id, 'Café')]
			}
			return next(3) === 0 ? [] : [observe(id, values[next(values.length)])]
		})
		const earlier = observe('c0', 'Impostor')
		const atStart = observe('c1', 'Impostor')
		const moved = {
			...observe('c2', 'Impostor'),
			entry: { ...base, firstSeenChapter: 'c0', identity: 'Impostor' },
		} satisfies BiblePatch[number]
		const fixed = {
			...observe('c2', 'Impostor'),
			entry: { ...base, name: 'Impostor' },
		} satisfies BiblePatch[number]
		const proposals: BiblePatch = [
			...observations,
			...competing,
			earlier,
			atStart,
			moved,
			fixed,
			valid,
			dangling,
		]
		const groups = [...ids, undefined].map((chapter) =>
			proposals.filter(({ observedChapter }) => observedChapter === chapter),
		)
		for (let index = groups.length - 1; index > 0; index--) {
			const other = next(index + 1)
			;[groups[index], groups[other]] = [groups[other], groups[index]]
		}
		const outcomes = []
		for (const [permutation, patch] of [proposals, groups.flat()].entries()) {
			const path = join(directory, `timeline-${trial}-${permutation}`)
			await seed(path)
			using project = await Project.open(path)
			const { conflicts } = await applyPatches(
				project,
				await readBible(project),
				patch,
				[],
				order,
			)
			const [published] = (await project.read(file)).entries
			expect(published).toMatchObject(base)
			for (const rejected of [
				earlier,
				atStart,
				moved,
				fixed,
				dangling,
				...competing,
			]) {
				const { entry, ...proposal } = rejected
				expect(conflicts).toContainEqual(
					expect.objectContaining({
						...proposal,
						entry: expect.objectContaining({
							...entry,
							status: 'candidate',
							conflict: expect.any(String),
						}),
					}),
				)
			}
			for (const { entry, ...proposal } of observations)
				expect(conflicts).not.toContainEqual(
					expect.objectContaining({
						...proposal,
						entry: expect.objectContaining({ ...entry, status: 'candidate' }),
					}),
				)
			for (const [index, id] of ids.entries()) {
				const before = ids.slice(0, index + 1)
				const expected =
					before
						.flatMap((chapter) =>
							observations.filter(
								({ observedChapter }) => observedChapter === chapter,
							),
						)
						.at(-1)?.entry.identity ?? base.identity
				const actual =
					published.changes
						?.filter(({ chapterId }) => before.includes(chapterId))
						.at(-1)?.value ?? published.identity
				if (id !== 'c0')
					expect(actual, `trial ${trial}, chapter ${id}`).toBe(expected)
			}
			const { character, relation } = await readBible(project)
			const publishedIds = new Set(character.map(({ id }) => id))
			expect(relation).toEqual([validRelation])
			for (const id of [
				...relation.flatMap(({ from, to }) => [from, to]),
				...character.flatMap(
					({ addresses }) => addresses?.map(({ speakerId }) => speakerId) ?? [],
				),
			]) {
				expect(publishedIds.has(id)).toBe(true)
			}
			outcomes.push({
				published,
				conflicts: conflicts.map((conflict) => JSON.stringify(conflict)).sort(),
			})
		}
		expect(outcomes[0], `trial ${trial}`).toEqual(outcomes[1])
	}
}, 15_000)

test('unresolved references trigger one repair and are never published', async () => {
	await seed(root)
	using project = await Project.open(root)
	const fetch = vi.fn<typeof globalThis.fetch>(strict)
	await expect(
		synthesizeVolume(project, 'v1', chapters, {
			...options,
			strategy: 'whole',
			connection: { ...connection, model: 'fixture-synthesis-invalid' },
			fetch,
		}),
	).rejects.toThrow('Unknown character reference: missing')
	expect(fetch).toHaveBeenCalledTimes(2)
	await expect(project.read(files.result)).rejects.toMatchObject({
		code: 'ENOENT',
	})
})

test.each([false, true])(
	'a ready checkpoint protects edits to a candidate (partial publication: %s)',
	async (partial) => {
		await seed(root)
		const tower = projectFiles.location(scope, 'tower')
		{
			using project = await Project.open(root)
			if (!partial)
				await project.write(tower, {
					formatVersion: 1,
					entries: [candidateTower],
				})
			const write = project.write.bind(project)
			const interrupted = vi
				.spyOn(project, 'write')
				.mockImplementation(async (file, value) => {
					if (partial && file.path === tower.path)
						throw new Error('Publication interrupted')
					if (
						!partial &&
						file.path === files.checkpoint.path &&
						(value as { ready: boolean }).ready
					) {
						await write(file, value)
						throw new Error('Publication interrupted')
					}
					return write(file, value)
				})
			await expect(
				synthesizeVolume(project, 'v1', chapters, {
					...options,
					strategy: 'whole',
				}),
			).rejects.toThrow('Publication interrupted')
			interrupted.mockRestore()
			expect(await project.read(files.checkpoint)).toMatchObject({
				ready: true,
				applied: false,
			})
			await project.write(tower, {
				formatVersion: 1,
				entries: [
					{
						id: 'tower',
						name: 'Edited tower',
						description: 'Creator edit',
						status: 'candidate',
					},
				],
			})
		}
		{
			using project = await Project.open(root)
			const fetch = vi.fn<typeof globalThis.fetch>(strict)
			const result = await synthesizeVolume(project, 'v1', chapters, {
				...options,
				strategy: 'whole',
				fetch,
			})
			expect(fetch).not.toHaveBeenCalled()
			expect(await project.read(tower)).toMatchObject({
				entries: [{ name: 'Edited tower', description: 'Creator edit' }],
			})
			expect(result.conflicts).toContainEqual(
				expect.objectContaining({
					entry: expect.objectContaining({
						id: 'tower',
						conflict: 'Bible changed before synthesis publication',
					}),
				}),
			)
			expect(result.glossaryConflicts).toHaveLength(2)
			expect(result.quarantined).toBe(true)
			expect(result.bibleBase).toBeUndefined()
		}
	},
)

test('a checkpoint quarantined on resume stays quarantined even if the original Bible is restored', async () => {
	await seed(root)
	const tower = projectFiles.location(scope, 'tower')
	const preview = projectFiles.preview(chapters[0])
	const original = { formatVersion: 1 as const, entries: [candidateTower] }
	const whole = { ...options, strategy: 'whole' as const }
	{
		using project = await Project.open(root)
		await project.write(tower, original)
		const write = project.write.bind(project)
		const interruption = vi
			.spyOn(project, 'write')
			.mockImplementation(async (file, value) => {
				await write(file, value)
				if (
					file.path === files.checkpoint.path &&
					(value as { ready: boolean }).ready
				)
					throw new Error('Stopped after checkpoint')
			})
		await expect(
			synthesizeVolume(project, 'v1', chapters, whole),
		).rejects.toThrow('Stopped after checkpoint')
		interruption.mockRestore()
		await project.write(tower, {
			...original,
			entries: [{ ...candidateTower, description: 'Edited after stop' }],
		})
	}
	{
		using project = await Project.open(root)
		const read = project.read.bind(project)
		let previewReads = 0
		vi.spyOn(project, 'read').mockImplementation(async (file) => {
			if (file.path === preview.path && ++previewReads === 2)
				await project.write(tower, original)
			return read(file)
		})
		const fetch = vi.fn<typeof globalThis.fetch>(strict)
		const result = await synthesizeVolume(project, 'v1', chapters, {
			...whole,
			fetch,
		})
		expect(previewReads).toBe(2)
		expect(fetch).not.toHaveBeenCalled()
		expect(await read(tower)).toEqual(original)
		expect(result.conflicts).toContainEqual(
			expect.objectContaining({
				entry: expect.objectContaining({
					id: 'tower',
					conflict: 'Bible changed before synthesis publication',
				}),
			}),
		)
	}
})

test('an edit committed after the ready write but before publication is never overwritten', async () => {
	await seed(root)
	using project = await Project.open(root)
	const tower = projectFiles.location(scope, 'tower')
	const write = project.write.bind(project)
	const edited = {
		...candidateTower,
		description: 'Creator edit during publication',
	}
	vi.spyOn(project, 'write').mockImplementation(async (file, value) => {
		await write(file, value)
		if (
			file.path === files.checkpoint.path &&
			(value as { ready: boolean; applied: boolean }).ready &&
			!(value as { applied: boolean }).applied
		)
			await write(tower, { formatVersion: 1, entries: [edited] })
	})
	const result = await synthesizeVolume(project, 'v1', chapters, {
		...options,
		strategy: 'whole',
	})
	expect(await project.read(tower)).toMatchObject({ entries: [edited] })
	expect(result.conflicts).toContainEqual(
		expect.objectContaining({
			entry: expect.objectContaining({
				id: 'tower',
				conflict: 'Bible changed before synthesis publication',
			}),
		}),
	)
})

test('changing a source preview during the run prevents publication', async () => {
	await seed(root)
	using project = await Project.open(root)
	const fetch: typeof globalThis.fetch = async (...args) => {
		const response = await strict(...args)
		await project.write(projectFiles.preview(chapters[0]), {
			...previews[0],
			summary: 'New input.',
		})
		return response
	}
	await expect(
		synthesizeVolume(project, 'v1', chapters, {
			...options,
			fetch,
			strategy: 'whole',
		}),
	).rejects.toThrow('Chapter previews changed during synthesis')
	await expect(project.read(files.result)).rejects.toMatchObject({
		code: 'ENOENT',
	})
})
