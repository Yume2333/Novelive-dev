import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { bibleRevision } from '../../packages/creator/src/bible/editing'
import { ChatService } from '../../packages/creator/src/chat'
import {
	projectChat,
	projectProposals,
} from '../../packages/creator/src/chat/project'
import { createConfigStore } from '../../packages/creator/src/config'
import { Project } from '../../packages/creator/src/project'
import { readBible } from '../../packages/creator/src/synthesis/patch'
import { model } from '../fixtures/cassettes/m2-chat/fixture'
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

test('production chat includes the current editor position in model instructions', async () => {
	const config = createConfigStore(join(directory, 'profile'))
	await config.update({
		models: { main: { ...model, maxOutputTokens: 128, inheritFast: false } },
	})
	let request = ''
	let finish!: () => void
	const completed = new Promise<void>((resolve) => {
		finish = resolve
	})
	const chat = await projectChat(
		project,
		ref.workId,
		config,
		directory,
		{
			mode: 'replay',
			directory: join(directory, 'empty-cassette'),
			fetch: async (input, init) => {
				request = await new Request(input, init).text()
				return new Response(
					'data: {"choices":[{"index":0,"delta":{"content":"好"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
					{ headers: { 'content-type': 'text/event-stream' } },
				)
			},
		},
		(event) => {
			if (event.payload.status !== 'streaming') finish()
		},
	)
	try {
		const { session } = chat.create()
		chat.send(
			{
				workId: ref.workId,
				sessionId: session.sessionId,
				expectedHeadId: null,
				parentId: null,
				content: { text: '重写这里', attachmentIds: [] },
				position: {
					kind: 'editor',
					chapterId: ref.chapterId,
					sceneId: 'aabbccdd',
					sourceIds: ['p0001'],
				},
			},
			new AbortController().signal,
		)
		await completed
		const { messages } = JSON.parse(request)
		expect(messages[0].content).toContain('aabbccdd')
		expect(messages[0].content).toContain(ref.chapterId)
		expect(messages[0].content).toContain('p0001')
	} finally {
		await chat.close()
	}
})

test('chat opens an imported work before production and preserves existing scheduler state on reopen', async () => {
	project.database.prepare('DELETE FROM task WHERE work_id = ?').run(ref.workId)
	project.database.prepare('DELETE FROM work WHERE work_id = ?').run(ref.workId)
	const options = {
		database: project.database,
		workId: ref.workId,
		cacheDir: directory,
		mainModel() {
			throw new Error('Network forbidden')
		},
		emit() {},
	}
	const unwired = new ChatService(options)
	expect(() => unwired.create()).toThrow('FOREIGN KEY constraint failed')
	await unwired.close()
	const config = createConfigStore(join(directory, 'profile'))
	const chat = await projectChat(
		project,
		ref.workId,
		config,
		directory,
		{ mode: 'strict' },
		() => {},
	)
	try {
		expect(chat.create('Imported work').session.title).toBe('Imported work')
		project.database
			.prepare('UPDATE work SET settings_rev = 7, status = ? WHERE work_id = ?')
			.run('paused', ref.workId)
		const reopened = await projectChat(
			project,
			ref.workId,
			config,
			directory,
			{ mode: 'strict' },
			() => {},
		)
		await reopened.close()
		expect(
			project.database
				.prepare('SELECT settings_rev, status FROM work WHERE work_id = ?')
				.get(ref.workId),
		).toEqual({ settings_rev: 7, status: 'paused' })
		await expect(
			projectChat(
				project,
				'foreign',
				config,
				directory,
				{ mode: 'strict' },
				() => {},
			),
		).rejects.toMatchObject({ code: 'not_found' })
	} finally {
		await chat.close()
	}
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
