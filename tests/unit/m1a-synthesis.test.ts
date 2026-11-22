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
		is_last: returning
			? events === 2
			: !(firstLongEvent || repeated) || events > 0,
		biblePatch:
			repeated || returning
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
		status: 'candidate',
		id: 'new',
		aliases: [],
		changes: history,
	} as const
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
