import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compile } from '@earendil-works/pi-schema'
import {
	type AssetRegistry,
	defaultWorkSettings,
	formatVersion,
	projectFiles,
} from '@novelive/format/model'
import { afterEach, expect, test } from 'vitest'
import { commands } from '../../packages/creator/src/contract'
import {
	listHistory,
	ProjectEditor,
} from '../../packages/creator/src/editor/history'
import {
	captureChapterRules,
	formatChapterRules,
	saveRules,
} from '../../packages/creator/src/editor/rules'
import { Project } from '../../packages/creator/src/project'

const workId = 'f947f6e9-b854-4b16-b322-6aad47eb5df8'
const volumeId = 'v0001'
const chapterId = 'ch0001'
const target = { workId, chapterId }
const ref = { ...target, volumeId }
const sceneId = 'aabbccdd'
const secondSceneId = '11223344'
const path = projectFiles.scene(ref, sceneId)
const secondPath = projectFiles.scene(ref, secondSceneId)
const workFile = projectFiles.work(volumeId, workId)
const neutral = 'rin/coat/neutral'
const happy = 'rin/coat/happy'
const otherCostume = 'rin/dress/happy'
const originalLine = 'rin: 灯亮了。'
const originalScene = [
	'scene 旧屋',
	'source p0001-p0001',
	'',
	`@show duration 0.3 ${neutral} center`,
	`  ${originalLine} #a001  `,
	'@wait #a002',
	'',
].join('\r\n')
const secondScene = 'scene 门外\nsource p0002-p0002\n\nrin: 走吧。 #a001\n'
const editedLine =
	'rin: {letter}灯{/letter}{ruby míng}明{/ruby}{wait 0.4}{speed 0.6}灭。{/speed}'
let directory: string

async function fixture() {
	directory = await mkdtemp(join(tmpdir(), 'novelive-m2-history-'))
	const project = await Project.create(join(directory, 'project'), {
		formatVersion,
		seriesId: 'series',
		title: '灯火',
		volumeIds: [volumeId],
	})
	try {
		project.tasks.registerWork({ workId, title: '灯火' })
		await project.write(projectFiles.volume(volumeId), {
			formatVersion,
			volumeId,
			title: '卷一',
			workIds: [workId],
		})
		await project.write(workFile, {
			formatVersion,
			workId,
			title: '灯火',
			version: 0,
			appVersion: '0.1.0',
			minReaderVersion: 1,
			language: 'zh',
			chapterIds: [chapterId, 'ch0002'],
			settings: {
				...defaultWorkSettings(),
				requirements: '保留主线',
				rules: ['灯是红色的'],
				customMarks: { letter: { css: 'color: navy;', perChar: false } },
			},
		})
		await project.write(projectFiles.chapter(ref), {
			formatVersion,
			chapterId,
			title: '灯',
			sceneIds: [sceneId, secondSceneId],
			paragraphIds: ['p0001', 'p0002'],
			cg: [],
		})
		await project.writeFile(
			projectFiles.chapterText(chapterId),
			'灯亮了。\n\n我们离开了。\n',
		)
		await project.writeFile(path, originalScene)
		await project.writeFile(secondPath, secondScene)
		await project.write(projectFiles.character({ level: 'series' }, 'rin'), {
			formatVersion,
			entries: [{ id: 'rin', name: '凛', status: 'confirmed', aliases: [] }],
		})
		await project.write(projectFiles.assetRegistry({ level: 'series' }), {
			formatVersion,
			entries: [neutral, happy, otherCostume].map(
				(id): AssetRegistry['entries'][number] => ({
					id,
					type: id === neutral ? 'character' : 'expression',
					status: 'drawn',
					path: `assets/${id}.webp`,
					aliases: [],
				}),
			),
		})
		return project
	} catch (error) {
		project.close()
		throw error
	}
}

afterEach(() => rm(directory, { recursive: true, force: true }))

const editor = (project: Project) =>
	new ProjectEditor(project, volumeId, workId)

test('edits text, inline marks and expressions by stable ID and audits their inverses', async () => {
	using project = await fixture()
	const service = editor(project)
	const opened = await service.open(target)
	expect(compile(commands['editor.open'].output).check(opened)).toBe(true)
	expect(opened.chapter).toMatchObject({
		paragraphs: [
			{ id: 'p0001', text: '灯亮了。' },
			{ id: 'p0002', text: '我们离开了。' },
		],
		scenes: [
			{ sceneId, sourceIds: ['p0001'] },
			{ sceneId: secondSceneId, sourceIds: ['p0002'] },
		],
	})
	const session = { ...target, editorId: opened.editorId }
	const text = await service.editLine({
		...session,
		sceneId,
		expectedRevision: opened.chapter.revision,
		edit: {
			kind: 'text',
			lineId: 'a001',
			previous: originalLine,
			next: editedLine,
		},
	})
	expect((await project.readFile(path)).toString()).toBe(
		originalScene.replace(originalLine, editedLine),
	)
	expect(text.scenes[1].nvs).toBe(secondScene)
	const expression = await service.editLine({
		...session,
		sceneId,
		expectedRevision: text.revision,
		edit: {
			kind: 'expression',
			lineId: 'a001',
			previous: neutral,
			next: happy,
		},
	})
	expect(expression.scenes[0].nvs).toBe(
		originalScene.replace(originalLine, editedLine).replace(neutral, happy),
	)
	const undoneExpression = await service.undo({
		...session,
		expectedRevision: expression.revision,
	})
	expect(undoneExpression.scenes).toEqual(text.scenes)
	expect(undoneExpression.revision).not.toBe(text.revision)
	const undoneText = await service.undo({
		...session,
		expectedRevision: undoneExpression.revision,
	})
	expect(undoneText.scenes).toEqual(opened.chapter.scenes)
	expect((await project.readFile(path)).toString()).toBe(originalScene)
	expect(undoneText.revision).not.toBe(opened.chapter.revision)
	const history = listHistory(project, target)
	expect(compile(commands['editor.history'].output).check(history)).toBe(true)
	expect(
		history.entries.map(({ origin, kind, previous, next, lineId }) => ({
			origin,
			kind,
			previous,
			next,
			lineId,
		})),
	).toEqual([
		{
			origin: 'undo',
			kind: 'text',
			previous: `${editedLine} #a001`,
			next: `${originalLine} #a001`,
			lineId: 'a001',
		},
		{
			origin: 'undo',
			kind: 'expression',
			previous: happy,
			next: neutral,
			lineId: 'a001',
		},
		{
			origin: 'creator',
			kind: 'expression',
			previous: neutral,
			next: happy,
			lineId: 'a001',
		},
		{
			origin: 'creator',
			kind: 'text',
			previous: `${originalLine} #a001`,
			next: `${editedLine} #a001`,
			lineId: 'a001',
		},
	])
})

test.each(['', '@move center right\n'])(
	'changes an inherited expression without touching the earlier scene (move: %j)',
	async (move) => {
		using project = await fixture()
		const scene = secondScene.replace('rin:', `${move}rin:`)
		await project.writeFile(secondPath, scene)
		const service = editor(project)
		const { editorId, chapter } = await service.open(target)
		const session = { ...target, editorId }
		const updated = await service.editLine({
			...session,
			sceneId: secondSceneId,
			expectedRevision: chapter.revision,
			edit: {
				kind: 'expression',
				lineId: 'a001',
				previous: neutral,
				next: happy,
			},
		})
		expect(updated.scenes[0].nvs).toBe(originalScene)
		expect(updated.scenes[1].nvs).toBe(
			scene.replace('rin:', `@show ${happy} center\nrin:`),
		)
		const undone = await service.undo({
			...session,
			expectedRevision: updated.revision,
		})
		expect(undone.scenes[1].nvs).toBe(scene)
		expect((await project.readFile(secondPath)).toString()).toBe(scene)
	},
)

test('rejects stale values, invalid edits, and racing writes without logging them', async () => {
	using project = await fixture()
	const service = editor(project)
	const { editorId, chapter } = await service.open(target)
	const input = {
		...target,
		editorId,
		sceneId,
		expectedRevision: chapter.revision,
	}
	const edit = {
		kind: 'text',
		lineId: 'a001',
		previous: originalLine,
		next: editedLine,
	} as const
	await expect(
		service.editLine({ ...input, expectedRevision: 'old', edit }),
	).rejects.toMatchObject({ code: 'stale_revision' })
	await expect(
		service.editLine({ ...input, edit: { ...edit, previous: 'rin: 昨天。' } }),
	).rejects.toMatchObject({ code: 'stale_revision' })
	for (const next of [
		'rin: {b}没闭合',
		'rin: 换 ID #b002',
		'@wait',
		'rin: 一\nrin: 二',
	]) {
		await expect(
			service.editLine({ ...input, edit: { ...edit, next } }),
		).rejects.toMatchObject({ code: 'invalid_config' })
	}
	await expect(
		service.editLine({
			...input,
			edit: {
				kind: 'expression',
				lineId: 'a001',
				previous: neutral,
				next: otherCostume,
			},
		}),
	).rejects.toMatchObject({ code: 'invalid_config' })
	expect((await project.readFile(path)).toString()).toBe(originalScene)
	expect(listHistory(project, target).entries).toEqual([])

	using otherProject = await Project.open(project.root)
	const other = editor(otherProject)
	const second = await other.open(target)
	const firstWrite = service.editLine({ ...input, edit })
	const otherWrite = other.editLine({
		...input,
		editorId: second.editorId,
		edit: { ...edit, next: 'rin: 吹熄了。' },
	})
	const [winner, loser] = await Promise.allSettled([firstWrite, otherWrite])
	expect(winner.status).toBe('fulfilled')
	expect(loser).toMatchObject({
		status: 'rejected',
		reason: { code: 'stale_revision' },
	})
	expect(listHistory(project, target).entries).toHaveLength(1)
})

test('reopen keeps persistent history but never restores the inverse stack', async () => {
	let project = await fixture()
	const root = project.root
	const service = editor(project)
	const opened = await service.open(target)
	const second = await service.open(target)
	const session = { ...target, editorId: opened.editorId }
	const edit = {
		kind: 'text',
		lineId: 'a001',
		previous: originalLine,
		next: editedLine,
	} as const
	try {
		const changed = await service.editLine({
			...session,
			sceneId,
			expectedRevision: opened.chapter.revision,
			edit,
		})
		expect(
			await service.undo({
				...target,
				editorId: second.editorId,
				expectedRevision: changed.revision,
			}),
		).toEqual(changed)
		expect(await service.close(session)).toEqual({ closed: true })
		await expect(
			service.undo({ ...session, expectedRevision: changed.revision }),
		).rejects.toMatchObject({ code: 'not_found' })
		const history = listHistory(project, target)
		project.close()
		project = await Project.open(root)
		const reopened = editor(project)
		const fresh = await reopened.open(target)
		expect(fresh.chapter).toEqual(changed)
		expect(
			await reopened.undo({
				...target,
				editorId: fresh.editorId,
				expectedRevision: fresh.chapter.revision,
			}),
		).toEqual(changed)
		expect(listHistory(project, target)).toEqual(history)
	} finally {
		project.close()
	}
})

test('saves versioned chapter and work rules without changing a running task’s captured rules', async () => {
	using project = await fixture()
	const service = editor(project)
	const opened = await service.open(target)
	const runningTask = await captureChapterRules(
		project,
		volumeId,
		workId,
		chapterId,
	)
	expect(runningTask.revision).toBe(opened.settingsRevision)
	const input = {
		workId,
		target: { scope: 'chapter', chapterId } as const,
		expectedRevision: opened.settingsRevision,
		previous: [],
		next: ['灯是蓝色的'],
	}
	const saved = await saveRules(project, volumeId, input)
	expect(saved.revision).not.toBe(input.expectedRevision)
	await expect(saveRules(project, volumeId, input)).rejects.toMatchObject({
		code: 'stale_revision',
	})
	await expect(
		saveRules(project, volumeId, {
			...input,
			expectedRevision: saved.revision,
			previous: [],
		}),
	).rejects.toMatchObject({ code: 'stale_revision' })
	const queuedTask = await captureChapterRules(
		project,
		volumeId,
		workId,
		chapterId,
	)
	expect(formatChapterRules(queuedTask)).toBe(
		'Chapter rules (take precedence over conflicting work rules): 灯是蓝色的\nRules: 灯是红色的',
	)
	expect(runningTask).toMatchObject({
		chapterRules: [],
		workRules: ['灯是红色的'],
	})
	const edited = await saveRules(project, volumeId, {
		...input,
		expectedRevision: saved.revision,
		previous: saved.rules,
		next: ['灯是白色的'],
	})
	const removed = await saveRules(project, volumeId, {
		...input,
		expectedRevision: edited.revision,
		previous: edited.rules,
		next: [],
	})
	expect(removed.revision).not.toBe(input.expectedRevision)
	await saveRules(project, volumeId, {
		workId,
		target: { scope: 'work' },
		expectedRevision: removed.revision,
		previous: ['灯是红色的'],
		next: ['灯是绿色的'],
	})
	expect((await project.read(workFile)).settings).toMatchObject({
		requirements: '保留主线',
		rules: ['灯是绿色的'],
		chapterRules: {},
	})
	expect(
		await captureChapterRules(project, volumeId, workId, 'ch0002'),
	).toMatchObject({
		chapterRules: [],
		workRules: ['灯是绿色的'],
	})
	expect(listHistory(project, target).entries).toHaveLength(3)
	expect(listHistory(project, { workId }).entries[0]).toMatchObject({
		kind: 'rules',
		previous: '["灯是红色的"]',
		next: '["灯是绿色的"]',
	})
})

test('restores the exact project file when its audit record cannot be saved', async () => {
	using project = await fixture()
	const service = editor(project)
	const { editorId, chapter, settingsRevision } = await service.open(target)
	const workBefore = await project.readFile(workFile.path)
	project.database.exec(`
		CREATE TRIGGER reject_audit BEFORE INSERT ON history
		BEGIN SELECT RAISE(ABORT, 'audit rejected'); END;
	`)
	await expect(
		service.editLine({
			...target,
			editorId,
			sceneId,
			expectedRevision: chapter.revision,
			edit: {
				kind: 'text',
				lineId: 'a001',
				previous: originalLine,
				next: editedLine,
			},
		}),
	).rejects.toThrow('audit rejected')
	await expect(
		saveRules(project, volumeId, {
			workId,
			target: { scope: 'work' },
			expectedRevision: settingsRevision,
			previous: ['灯是红色的'],
			next: [],
		}),
	).rejects.toThrow('audit rejected')
	expect((await project.readFile(path)).toString()).toBe(originalScene)
	expect(await project.readFile(workFile.path)).toEqual(workBefore)
	expect(listHistory(project, { workId }).entries).toEqual([])
	expect(
		await service.undo({
			...target,
			editorId,
			expectedRevision: chapter.revision,
		}),
	).toEqual(chapter)
})
