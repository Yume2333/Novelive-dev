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
} from '../../packages/creator/src/synthesis/patch'
import { projectFiles } from '../../packages/format/src/model'
import {
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

test('character deletion is rejected before writing if a surviving relation references it', async () => {
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
	} as const
	await expect(
		applyPatches(project, bible, [patch], [], new Set(chapters)),
	).rejects.toThrow('Cannot delete character guide: still referenced')
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

test('a ready checkpoint with a stale Bible saves conflicts without replacing later candidate edits', async () => {
	await seed(root)
	const tower = projectFiles.location(scope, 'tower')
	{
		using project = await Project.open(root)
		const write = project.write.bind(project)
		const interrupted = vi
			.spyOn(project, 'write')
			.mockImplementation(async (file, value) => {
				if (file.path === tower.path) throw new Error('Publication interrupted')
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
