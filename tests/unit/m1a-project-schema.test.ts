import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { Project } from '../../packages/creator/src/project'
import { formatVersion, projectFiles } from '../../packages/format/src/model'
import {
	chapterText,
	original,
	ref,
	scope,
	seed,
	series,
	work,
} from '../fixtures/project-schema/seed'

let directory: string
let root: string
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'novelive-project-schema-'))
	root = join(directory, 'project')
})
afterEach(async () => {
	await rm(directory, { recursive: true, force: true })
})

test('closes and reopens versioned documents, source bytes and queued tasks from disk', async () => {
	await seed(root)
	using project = await Project.open(root)
	expect(await project.read(projectFiles.series)).toEqual(series)
	expect(await project.read(projectFiles.volume('v1'))).toMatchObject({
		workIds: [ref.workId],
	})
	expect(await project.read(projectFiles.work('v1', ref.workId))).toEqual(work)
	expect(await project.read(projectFiles.chapter(ref))).toMatchObject({
		paragraphIds: ['p0001', 'p0002'],
	})
	expect(await project.readFile(projectFiles.original('txt'))).toEqual(original)
	expect(await readFile(join(root, 'source/chapters/ch1.txt'), 'utf8')).toBe(
		chapterText,
	)
	expect(await project.readFile(projectFiles.chapterNotes('ch1'))).toEqual(
		Buffer.from('合成附注\n'),
	)
	expect(
		(await project.read(projectFiles.character(scope, 'traveler'))).entries.map(
			(entry) => entry.status,
		),
	).toEqual(['confirmed', 'candidate'])
	expect(await project.read(projectFiles.glossary(scope))).toMatchObject({
		entries: [{ written: '木门' }],
	})
	expect(await project.read(projectFiles.assetRegistry(scope))).toMatchObject({
		entries: [{ id: 'room/day' }],
	})
	expect(project.tasks.list(ref.workId)).toEqual([
		{
			taskId: 'preview-ch1',
			workId: ref.workId,
			kind: 'preview',
			refId: 'ch1',
			status: 'queued',
			phase: 'queued',
			priority: 0,
			seq: 1,
			createdAt: 2,
		},
	])
})

test('persists all six SQLite categories with foreign keys, version and WAL', async () => {
	await seed(root)
	{
		using project = await Project.open(root)
		const db = project.database
		expect(db.prepare('PRAGMA journal_mode').get()?.journal_mode).toBe('wal')
		expect(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1)
		expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(1)
		db.prepare(
			"INSERT INTO run (run_id, work_id, kind, ref, status, started_at) VALUES ('run1', ?, 'preview', 'ch1', 'done', 1)",
		).run(ref.workId)
		db.exec(
			"INSERT INTO run_step (step_id, run_id, seq, operation_name, role, status, started_at) VALUES ('step1','run1',1,'chat','整理','completed',1)",
		)
		db.prepare(
			"INSERT INTO usage (usage_id, work_id, step_id, at, slot, model, usage_input) VALUES ('u1', ?, 'step1', 1, 'fast', 'offline-fixture', 12)",
		).run(ref.workId)
		db.prepare(
			"INSERT INTO session (session_id, work_id, role, created_at, updated_at) VALUES ('s1', ?, '主控', 1, 2)",
		).run(ref.workId)
		const entry = db.prepare(
			"INSERT INTO session_entry (session_id, entry_id, parent_id, kind, at, content) VALUES ('s1', ?, ?, ?, 1, '{}')",
		)
		entry.run('init', null, 'session_init')
		entry.run('child', 'init', 'system')
		expect(() => entry.run('orphan', 'missing', 'system')).toThrow(
			/FOREIGN KEY/,
		)
		db.prepare(
			"INSERT INTO proposal (proposal_id, work_id, session_id, kind, prompt, payload, status, feedback, created_at) VALUES ('p1', ?, 's1', 'rule', '新增规则', '{}', 'rejected', '保留旧规则', 1)",
		).run(ref.workId)
		db.prepare(
			"INSERT INTO history (history_id, work_id, at, origin, kind, previous, next) VALUES ('h1', ?, 1, 'creator', 'edit', ?, ?)",
		).run(ref.workId, '"旧句"', '"新句"')
		db.exec("UPDATE task SET status = 'done', phase = 'done', run_id = 'run1'")
	}
	using project = await Project.open(root)
	const db = project.database
	expect(project.tasks.list(ref.workId)[0]?.status).toBe('done')
	expect(db.prepare('SELECT usage_input FROM usage').get()?.usage_input).toBe(
		12,
	)
	expect(
		db
			.prepare("SELECT parent_id FROM session_entry WHERE entry_id = 'child'")
			.get()?.parent_id,
	).toBe('init')
	expect(db.prepare('SELECT feedback FROM proposal').get()?.feedback).toBe(
		'保留旧规则',
	)
	expect(db.prepare('SELECT next FROM history').get()?.next).toBe('"新句"')
	expect(
		db
			.prepare('SELECT operation_name FROM run_step JOIN run USING (run_id)')
			.get()?.operation_name,
	).toBe('chat')
	expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
})

test('allows open JSON fields but rejects incompatible versions and protects existing data', async () => {
	await seed(root)
	using project = await Project.open(root)
	const file = projectFiles.work('v1', ref.workId)
	const futureWork = { ...work, futureField: true }
	await project.write(file, futureWork)
	expect(await project.read(file)).toMatchObject({ futureField: true })
	await expect(
		project.write(file, { ...work, minReaderVersion: 2 }),
	).rejects.toMatchObject({ code: 'unsupported_reader' })
	expect(await project.read(file)).toMatchObject({ minReaderVersion: 1 })
	await expect(
		project.write(projectFiles.chapter(ref), {
			formatVersion,
			title: '坏段落',
			chapterId: 'ch1',
			paragraphIds: ['p0000'],
			sceneIds: [],
			cg: [],
		}),
	).rejects.toMatchObject({ code: 'invalid_document' })
	await writeFile(
		join(root, 'series.json'),
		JSON.stringify({ ...series, formatVersion: 2 }),
	)
	await expect(Project.open(root)).rejects.toMatchObject({
		code: 'unsupported_format',
	})
	await writeFile(join(root, 'series.json'), '{')
	await expect(Project.open(root)).rejects.toMatchObject({
		code: 'invalid_document',
	})
})

test('does not create missing databases while reopening and rejects unknown database versions', async () => {
	await seed(root)
	await rm(join(root, projectFiles.database))
	await expect(Project.open(root)).rejects.toMatchObject({ code: 'ENOENT' })
	await expect(
		readFile(join(root, projectFiles.database)),
	).rejects.toMatchObject({ code: 'ENOENT' })
	{
		using db = new DatabaseSync(join(root, projectFiles.database))
		db.exec('PRAGMA user_version = 99')
	}
	await expect(Project.open(root)).rejects.toMatchObject({
		code: 'unsupported_database',
	})
})

test('uses distinct digest and skeleton paths and rejects nonlocal project paths', async () => {
	using project = await Project.create(root, series)
	const digest = {
		formatVersion: formatVersion as 1,
		volumeId: 'v1',
		summary: '主要事件',
	}
	const skeleton = {
		formatVersion: formatVersion as 1,
		volumeId: 'v1',
		overview: '故事推进',
		chapters: [{ chapterId: 'ch1', progress: '进屋' }],
	}
	await project.write(projectFiles.digest('v1'), digest)
	await project.write(projectFiles.skeleton('v1'), skeleton)
	expect(await project.read(projectFiles.digest('v1'))).toEqual(digest)
	expect(await project.read(projectFiles.skeleton('v1'))).toEqual(skeleton)
	expect(() => projectFiles.preview('../outside')).toThrow(/identifier/)
	await expect(project.writeFile('../outside', 'no')).rejects.toThrow(
		/project path/,
	)
})
