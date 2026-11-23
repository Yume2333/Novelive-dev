import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { bibleRevision } from '../../packages/creator/src/bible/editing'
import { projectProposals } from '../../packages/creator/src/chat/project'
import { Project } from '../../packages/creator/src/project'
import { readBible } from '../../packages/creator/src/synthesis/patch'
import { ref, seed } from '../fixtures/project-schema/seed'

let directory: string
let project: Project
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'novelive-bible-chat-'))
	await seed(join(directory, 'project'))
	project = await Project.open(join(directory, 'project'))
})
afterEach(async () => {
	project.close()
	await rm(directory, { recursive: true, force: true })
})

test('project proposal preparation stamps current Bible revision without writing, including empty patches', async () => {
	const actions = projectProposals(project, ref.workId)
	const signal = new AbortController().signal
	const before = await readBible(project)
	const change = {
		id: 'boat',
		original: 'boat',
		written: 'Boat',
		category: 'object',
		status: 'candidate' as const,
	}
	const prepared = await actions.prepare(
		{
			kind: 'glossary',
			volumeId: ref.volumeId,
			changes: [change],
			reason: 'Fix terminology',
		},
		signal,
	)
	expect(prepared).toEqual({
		prompt: 'Fix terminology',
		chapterIds: [ref.chapterId],
		payload: {
			kind: 'glossary',
			volumeId: ref.volumeId,
			changes: [change],
			expectedRevision: bibleRevision(before),
		},
	})
	expect(
		await actions.prepare(
			{
				kind: 'bible',
				volumeId: ref.volumeId,
				changes: [],
				reason: 'No changes',
			},
			signal,
		),
	).toMatchObject({
		payload: {
			kind: 'bible',
			changes: [],
			expectedRevision: bibleRevision(before),
		},
	})
	expect(await readBible(project)).toEqual(before)
})

test('project proposal preparation rejects foreign work, unsupported domains and cancellation', async () => {
	const signal = new AbortController().signal
	const intent = {
		kind: 'bible' as const,
		volumeId: ref.volumeId,
		changes: [],
		reason: 'Test',
	}
	await expect(
		projectProposals(project, 'foreign').prepare(intent, signal),
	).rejects.toMatchObject({ code: 'not_found' })
	const actions = projectProposals(project, ref.workId)
	await expect(
		actions.prepare(
			{ kind: 'requirements', text: 'New notes', reason: 'Test' },
			signal,
		),
	).rejects.toMatchObject({ code: 'unsupported' })
	const controller = new AbortController()
	controller.abort()
	await expect(
		actions.prepare(intent, controller.signal),
	).rejects.toMatchObject({ name: 'AbortError' })
	expect(
		project.database.prepare('SELECT COUNT(*) AS n FROM proposal').get(),
	).toEqual({ n: 0 })
})
