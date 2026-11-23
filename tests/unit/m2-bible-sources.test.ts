import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import {
	bibleRevision,
	getBible,
} from '../../packages/creator/src/bible/editing'
import { ChatService } from '../../packages/creator/src/chat'
import { projectProposals } from '../../packages/creator/src/chat/project'
import { ChatStore } from '../../packages/creator/src/chat/store'
import { Project } from '../../packages/creator/src/project'
import {
	synthesisFiles,
	type VolumeSynthesis,
} from '../../packages/creator/src/synthesis'
import { readBible } from '../../packages/creator/src/synthesis/patch'
import { formatVersion, projectFiles } from '../../packages/format/src/model'
import { ref, scope, seed } from '../fixtures/project-schema/seed'

let directory: string
let project: Project
const input = { workId: ref.workId, volumeId: ref.volumeId }
const file = synthesisFiles(ref.volumeId).result

beforeEach(async () => {
	directory = join(
		await mkdtemp(join(tmpdir(), 'novelive-bible-sources-')),
		'project',
	)
	await seed(directory)
	project = await Project.open(directory)
})
afterEach(async () => {
	project.close()
	await rm(dirname(directory), { recursive: true, force: true })
})

async function publish() {
	const bible = await readBible(project)
	const result: VolumeSynthesis = {
		formatVersion,
		volumeId: ref.volumeId,
		overview: 'Synthesized fixture',
		chapters: [],
		biblePatch: [],
		glossaryPatch: [],
		conflicts: [
			{
				kind: 'character',
				op: 'update',
				entry: {
					...bible.character[0],
					name: '新旅人',
					status: 'candidate',
					conflict: 'Name conflict',
				},
			},
		],
		glossaryConflicts: [
			{ ...bible.glossary[0], written: '铁门', conflict: 'Term conflict' },
		],
		bibleRevision: bibleRevision(bible),
	}
	await project.write(file, result)
	return result
}

function chat() {
	return new ChatService({
		database: project.database,
		workId: ref.workId,
		cacheDir: directory,
		mainModel() {
			throw new Error('Network forbidden')
		},
		emit() {},
		proposals: projectProposals(project, ref.workId),
	})
}

test('synthesis proposals persist source revisions, resolve through chat and never resurrect on reopen', async () => {
	const result = await publish()
	project.database.prepare('DELETE FROM task WHERE work_id = ?').run(ref.workId)
	project.database.prepare('DELETE FROM work WHERE work_id = ?').run(ref.workId)
	const first = await getBible(project, input)
	expect(first.proposalIds).toHaveLength(2)
	const store = new ChatStore(project.database, ref.workId)
	const proposals = first.proposalIds.map((id) => store.proposal(id).proposal)
	const character = proposals.find(({ payload }) => payload.kind === 'bible')
	const glossary = proposals.find(({ payload }) => payload.kind === 'glossary')
	if (!character || !glossary) throw new Error('Missing bridged proposals')
	expect(store.proposal(character.id).source).toMatchObject({
		path: file.path,
		revision: expect.any(String),
	})
	expect(character.payload).toMatchObject({
		expectedRevision: result.bibleRevision,
	})
	const service = chat()
	try {
		expect(
			await service.resolve(
				{
					...input,
					proposalId: glossary.id,
					decision: { kind: 'reject', reason: 'Keep wooden door' },
				},
				new AbortController().signal,
			),
		).toMatchObject({ status: 'resolved', proposal: { status: 'rejected' } })
		expect(
			await service.resolve(
				{ ...input, proposalId: character.id, decision: { kind: 'approve' } },
				new AbortController().signal,
			),
		).toMatchObject({ status: 'resolved', proposal: { status: 'approved' } })
	} finally {
		await service.close()
	}
	expect((await readBible(project)).character[0].name).toBe('新旅人')
	project.close()
	project = await Project.open(directory)
	expect((await getBible(project, input)).proposalIds).toEqual([])
	const reopened = new ChatStore(project.database, ref.workId)
	expect(reopened.proposal(glossary.id)).toMatchObject({
		proposal: { status: 'rejected', feedback: 'Keep wooden door' },
		source: { path: file.path },
	})
	expect(
		project.database.prepare('SELECT COUNT(*) AS n FROM proposal').get(),
	).toEqual({ n: 2 })
})

test('old synthesis is stale even when first discovered after a newer confirmed revision', async () => {
	const result = await publish()
	await project.write(projectFiles.style(scope), {
		formatVersion,
		entries: [
			{ id: 'new', description: 'New confirmed style', status: 'confirmed' },
		],
	})
	const first = await getBible(project, input)
	const before = await readBible(project)
	const service = chat()
	try {
		for (const id of first.proposalIds) {
			expect(
				new ChatStore(project.database, ref.workId).proposal(id).proposal
					.payload,
			).toMatchObject({ expectedRevision: result.bibleRevision })
			expect(
				await service.resolve(
					{ ...input, proposalId: id, decision: { kind: 'approve' } },
					new AbortController().signal,
				),
			).toMatchObject({ status: 'stale' })
		}
	} finally {
		await service.close()
	}
	expect(await readBible(project)).toEqual(before)
	expect((await getBible(project, input)).proposalIds).toEqual(
		first.proposalIds,
	)
})

test('replaced or missing synthesis source cannot apply an old proposal even if Bible is unchanged', async () => {
	const result = await publish()
	const first = await getBible(project, input)
	await project.write(file, { ...result, overview: 'A replacement synthesis' })
	const service = chat()
	try {
		expect(
			await service.resolve(
				{
					...input,
					proposalId: first.proposalIds[0],
					decision: { kind: 'approve' },
				},
				new AbortController().signal,
			),
		).toMatchObject({ status: 'stale' })
		await rm(join(directory, file.path))
		expect(
			await service.resolve(
				{
					...input,
					proposalId: first.proposalIds[0],
					decision: { kind: 'approve' },
				},
				new AbortController().signal,
			),
		).toMatchObject({ status: 'stale' })
	} finally {
		await service.close()
	}
})

test('unversioned legacy conflicts remain visible but cannot overwrite confirmed content', async () => {
	const { bibleRevision: _, ...legacy } = await publish()
	await project.write(file, legacy)
	const first = await getBible(project, input)
	const before = await readBible(project)
	const service = chat()
	try {
		for (const id of first.proposalIds)
			expect(
				await service.resolve(
					{ ...input, proposalId: id, decision: { kind: 'approve' } },
					new AbortController().signal,
				),
			).toMatchObject({ status: 'stale' })
	} finally {
		await service.close()
	}
	expect(await readBible(project)).toEqual(before)
})

test('candidate deduplication survives rejection, unrelated collection edits and reopen', async () => {
	const first = await getBible(project, input)
	const store = new ChatStore(project.database, ref.workId)
	const term = first.proposalIds
		.map((id) => store.proposal(id).proposal)
		.find(({ payload }) => payload.kind === 'glossary')
	if (!term) throw new Error('Missing glossary candidate')
	const source = store.proposal(term.id).source
	store.resolve(term, 'rejected', 'Keep original')
	const glossary = await project.read(projectFiles.glossary(scope))
	await project.write(projectFiles.glossary(scope), {
		...glossary,
		entries: [
			...glossary.entries,
			{
				id: 'extra',
				original: 'Extra',
				written: 'Extra',
				category: 'object',
				status: 'confirmed',
			},
		],
	})
	project.close()
	project = await Project.open(directory)
	expect((await getBible(project, input)).proposalIds).not.toContain(term.id)
	expect(
		new ChatStore(project.database, ref.workId).proposal(term.id),
	).toMatchObject({
		source,
		proposal: { status: 'rejected', feedback: 'Keep original' },
	})
})

test('empty sources yield no proposals and invalid synthesis is not silently ignored', async () => {
	await project.write(projectFiles.character(scope, 'traveler'), {
		formatVersion,
		entries: [],
	})
	await project.write(projectFiles.glossary(scope), {
		formatVersion,
		entries: [],
	})
	expect((await getBible(project, input)).proposalIds).toEqual([])
	await project.writeFile(file.path, '{invalid JSON')
	await expect(getBible(project, input)).rejects.toThrow()
	expect(
		project.database.prepare('SELECT COUNT(*) AS n FROM proposal').get(),
	).toEqual({ n: 0 })
})

test('a pending file candidate can be approved through the unified resolver', async () => {
	const first = await getBible(project, input)
	const term = first.proposalIds
		.map(
			(id) => new ChatStore(project.database, ref.workId).proposal(id).proposal,
		)
		.find(({ payload }) => payload.kind === 'glossary')
	if (!term) throw new Error('Missing glossary candidate')
	const service = chat()
	try {
		expect(
			await service.resolve(
				{ ...input, proposalId: term.id, decision: { kind: 'approve' } },
				new AbortController().signal,
			),
		).toMatchObject({ status: 'resolved', proposal: { status: 'approved' } })
	} finally {
		await service.close()
	}
	expect((await readBible(project)).glossary[0].status).toBe('confirmed')
	expect((await getBible(project, input)).proposalIds).not.toContain(term.id)
})

test('legacy synthesis uses its saved basis instead of stamping discovery-time Bible revision', async () => {
	const { bibleRevision: basis, ...legacy } = await publish()
	await project.write(file, legacy)
	await project.write(synthesisFiles(ref.volumeId).checkpoint, {
		formatVersion,
		fingerprint: 'legacy',
		basis: basis ?? '',
		packet: 0,
		events: [],
		whole: null,
		ready: true,
		applied: true,
	})
	const first = await getBible(project, input)
	for (const id of first.proposalIds)
		expect(
			new ChatStore(project.database, ref.workId).proposal(id).proposal.payload,
		).toMatchObject({ expectedRevision: basis })
	await project.write(projectFiles.style(scope), {
		formatVersion,
		entries: [{ id: 'new', status: 'confirmed', description: 'Newer style' }],
	})
	expect((await getBible(project, input)).proposalIds).toEqual(
		first.proposalIds,
	)
	for (const id of first.proposalIds)
		expect(
			new ChatStore(project.database, ref.workId).proposal(id).proposal.payload,
		).toMatchObject({ expectedRevision: basis })
})

test('an unfinished replacement checkpoint cannot rebase legacy conflicts onto a newer Bible', async () => {
	const { bibleRevision: _, ...legacy } = await publish()
	await project.write(file, legacy)
	await project.write(projectFiles.style(scope), {
		formatVersion,
		entries: [{ id: 'new', status: 'confirmed', description: 'Newer style' }],
	})
	await project.write(synthesisFiles(ref.volumeId).checkpoint, {
		formatVersion,
		fingerprint: 'replacement',
		basis: bibleRevision(await readBible(project)),
		packet: 0,
		events: [],
		whole: null,
		ready: true,
		applied: false,
	})
	const first = await getBible(project, input)
	const service = chat()
	try {
		for (const id of first.proposalIds) {
			expect(
				new ChatStore(project.database, ref.workId).proposal(id).proposal
					.payload,
			).toMatchObject({ expectedRevision: 'unversioned-synthesis' })
			expect(
				await service.resolve(
					{ ...input, proposalId: id, decision: { kind: 'approve' } },
					new AbortController().signal,
				),
			).toMatchObject({ status: 'stale' })
		}
	} finally {
		await service.close()
	}
})
