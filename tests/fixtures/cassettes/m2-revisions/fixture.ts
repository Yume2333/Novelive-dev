import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { projectFiles } from '@novelive/format/model'
import { projectProposals } from '../../../../packages/creator/src/chat/project'
import { createConfigStore } from '../../../../packages/creator/src/config'
import type { Proposal } from '../../../../packages/creator/src/contract/chat'
import { ProjectEditor } from '../../../../packages/creator/src/editor/history'
import { CreativeRevisions } from '../../../../packages/creator/src/editor/revisions'
import { saveRules } from '../../../../packages/creator/src/editor/rules'
import { importTxtProject } from '../../../../packages/creator/src/import/wizard'
import { Project } from '../../../../packages/creator/src/project'
import {
	chapterWorker,
	productionModels,
} from '../../../../packages/creator/src/project/production-worker'
import type { ReplayOptions } from '../../../../packages/creator/src/replay'
import { picture } from '../m1b-art/fixture'
import { configuration, original } from '../m1b-gate/fixture'

export const directory = import.meta.dirname
export const volumeId = 'v0001'
export const chapterId = 'ch0001'
export const sceneId = 'aabbccdd'
export const assetId = 'ada/uniform/neutral'
export const scene = [
	'scene 纸船',
	'source p0001-p0001',
	'',
	`@show ${assetId} center`,
	': 暮色中，一只纸船从桥下漂过。 #0001',
	': 桥下很安静。 #0002',
	'',
].join('\n')
export const rewritten = [
	'scene 纸船',
	'source p0001-p0001',
	'',
	': 暮色里，一只纸船从桥下慢慢漂过。',
	': 桥下很安静。',
	': 远处传来笛声。',
].join('\n')
export const instruction = '让结尾多一点声音'
export const rule = '纸船始终是白色的'

/** Imports the gate novel, publishes one scene and one drawn base marked stale. */
export async function revisionProject(folder: string, replay: ReplayOptions) {
	const sourcePath = join(folder, 'paper-boat.txt')
	await writeFile(sourcePath, original)
	const imported = await importTxtProject({
		sourcePath,
		folder,
		title: 'Paper boat',
		encoding: 'utf-8',
		references: [],
	})
	if (imported.status !== 'ready') throw new Error('Fixture import failed')
	const { projectDir, workId } = imported
	const project = await Project.open(projectDir)
	const ref = { volumeId, workId, chapterId }
	const chapter = await project.read(projectFiles.chapter(ref))
	await project.write(projectFiles.chapter(ref), {
		...chapter,
		sceneIds: [sceneId],
	})
	await project.writeFile(projectFiles.scene(ref, sceneId), scene)
	const path = `assets/characters/${assetId}.webp`
	await project.writeFile(path, await picture(64, 96, true))
	await project.write(projectFiles.assetRegistry({ level: 'series' }), {
		formatVersion: 1,
		entries: [
			{ id: assetId, path, type: 'character', status: 'drawn', aliases: [] },
		],
	})
	await project.writeFile(
		`source/production/art/${assetId}.json`,
		JSON.stringify({
			job: { assetId, kind: 'character', description: '蓝色制服的 Ada' },
		}),
	)
	project.database
		.prepare(
			'INSERT OR IGNORE INTO work (work_id, title, queue_pos, created_at) VALUES (?, ?, 0, ?)',
		)
		.run(workId, 'Paper boat', 0)
	project.database
		.prepare(
			"INSERT INTO asset (work_id, asset_key, kind, chapter_id, status) VALUES (?, ?, 'base', ?, 'stale')",
		)
		.run(workId, assetId, chapterId)
	const config = createConfigStore(folder)
	await config.update(configuration)
	const work = await project.read(projectFiles.work(volumeId, workId))
	const { rewriteScene, redraw, adoptImage } = chapterWorker(
		project,
		volumeId,
		work,
		await productionModels(config),
		replay,
	)
	const redone: string[] = []
	const editor = new ProjectEditor(project, volumeId, workId)
	const revisions = new CreativeRevisions(project, workId, editor, {
		rewriteScene,
		redraw,
		adoptImage,
		redo: async (id) => redone.push(id),
	})
	return { project, workId, ref, editor, revisions, redone, path }
}

/** Every model-backed revision the unit test replays, in recording order. */
export async function runRevisions(folder: string, replay: ReplayOptions) {
	const fixture = await revisionProject(folder, replay)
	const { project, workId, editor, revisions } = fixture
	const target = { workId, chapterId }
	const opened = await editor.open(target)
	const proposal = await revisions.rewriteScene({
		...target,
		sceneId,
		expectedRevision: opened.chapter.revision,
		instruction,
	})
	const rules = await saveRules(project, volumeId, {
		workId,
		expectedRevision: opened.settingsRevision,
		target: { scope: 'chapter', chapterId },
		previous: [],
		next: [rule],
	})
	const proposals = projectProposals(project, workId, revisions)
	const signal = new AbortController().signal
	const prepared = await proposals.prepare(
		{
			kind: 'rewriteScene',
			chapterId,
			sceneId,
			instruction,
			reason: '对话面板',
		},
		signal,
	)
	const chat = await proposals.applyIfCurrent(
		{ id: 'chat-rewrite', workId, ...prepared } as unknown as Proposal,
		signal,
	)
	if (!('rewrite' in chat) || !chat.rewrite)
		throw new Error('The chat rewrite returned no proposal')
	const { rewrite } = chat
	const selected = rewrite.hunks.filter(({ after }) =>
		after.some((line) => line.includes('笛声')),
	)
	const applied = await revisions.applyRewrite({
		...target,
		sceneId,
		proposalId: rewrite.proposalId,
		expectedRevision: rewrite.expectedRevision,
		hunkIds: selected.map(({ id }) => id),
	})
	const before = await project.readFile(fixture.path)
	const redrawn = await revisions.regenerateImage({
		workId,
		assetId,
		expectedRevision: await revisions.imageRevision(assetId),
		instruction: '光线更柔和',
		count: 1,
	})
	const choices = await revisions.regenerateImage({
		workId,
		assetId,
		expectedRevision: await revisions.imageRevision(assetId),
		count: 2,
	})
	return {
		...fixture,
		proposal,
		selected,
		applied,
		rules,
		prepared,
		chat,
		before,
		redrawn,
		choices,
	}
}
