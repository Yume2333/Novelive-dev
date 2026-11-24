import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectFiles } from '@novelive/format/model'
import { parseScript } from '@novelive/format/script'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { projectProposals } from '../../packages/creator/src/chat/project'
import { listHistory } from '../../packages/creator/src/editor/history/storage'
import { CreativeRevisions } from '../../packages/creator/src/editor/revisions'
import * as artModels from '../../packages/creator/src/pipeline/art/models'
import { Project } from '../../packages/creator/src/project'
import { ChapterScheduler } from '../../packages/creator/src/scheduler/chapter'
import { picture } from '../fixtures/cassettes/m1b-art/fixture'
import {
	assetId,
	directory as cassettes,
	chapterId,
	revisionProject,
	rewritten,
	rule,
	runRevisions,
	scene,
	sceneId,
} from '../fixtures/cassettes/m2-revisions/fixture'
import { ref, series } from '../fixtures/project-schema/seed'
import { ScriptedWorker } from '../fixtures/scheduler/m1b/worker'

let directory: string

beforeEach(async () => {
	vi.stubEnv('NL_REPLAY', 'strict')
	directory = await mkdtemp(join(tmpdir(), 'novelive-revisions-'))
})
afterEach(async () => {
	vi.unstubAllEnvs()
	await rm(directory, { recursive: true, force: true })
})

test('both entries rewrite one scene through the writer, apply only checked hunks and redraw with history', async () => {
	const run = await runRevisions(directory, {
		directory: cassettes,
		mode: 'strict',
	})
	const { project, workId, ref: chapter, revisions } = run
	try {
		expect(run.proposal.hunks).toEqual([
			expect.objectContaining({
				afterLineId: null,
				before: [': 暮色中，一只纸船从桥下漂过。 #0001'],
				after: [
					expect.stringMatching(
						/^: 暮色里，一只纸船从桥下慢慢漂过。 #[0-9a-f]{4}$/,
					),
				],
			}),
			expect.objectContaining({
				afterLineId: '0002',
				before: [],
				after: [expect.stringMatching(/^: 远处传来笛声。 #[0-9a-f]{4}$/)],
			}),
		])
		const applied = run.applied.scenes.find((s) => s.sceneId === sceneId)?.nvs
		expect(applied).toContain(': 暮色中，一只纸船从桥下漂过。 #0001')
		expect(applied).toContain(': 桥下很安静。 #0002')
		expect(applied).toContain(run.selected[0].after[0])
		expect(applied).not.toContain('慢慢')
		expect(applied).toContain(`@show ${assetId} center`)
		expect(
			(await listHistory(project, { workId, chapterId })).entries[0],
		).toMatchObject({ origin: 'agent' })
		await expect(
			revisions.applyRewrite({
				workId,
				chapterId,
				sceneId,
				proposalId: run.proposal.proposalId,
				expectedRevision: run.proposal.expectedRevision,
				hunkIds: [run.proposal.hunks[0].id],
			}),
		).rejects.toMatchObject({ code: 'stale_revision' })

		expect(run.rules.rules).toEqual([rule])
		expect(run.prepared).toMatchObject({
			chapterIds: [chapterId],
			payload: { kind: 'rewriteScene' },
		})
		expect(run.chat).toMatchObject({
			status: 'applied',
			rewrite: {
				sceneId,
				hunks: [{ afterLineId: null }, { afterLineId: '0002' }],
			},
		})

		expect(run.redrawn).toMatchObject({ status: 'applied' })
		const history = (await listHistory(project, { workId })).entries.filter(
			(entry) => entry.assetId === assetId,
		)
		expect(history).toHaveLength(1)
		expect(history[0]).toMatchObject({ origin: 'agent', kind: 'image' })
		expect(
			Buffer.compare(
				await project.readFile(String(history[0].previous)),
				run.before,
			),
		).toBe(0)
		expect(
			project.database
				.prepare(
					'SELECT status, version, draw_count FROM asset WHERE work_id = ? AND asset_key = ?',
				)
				.get(workId, assetId),
		).toEqual({ status: 'drawn', version: 1, draw_count: 1 })

		expect(run.choices).toMatchObject({ status: 'candidates' })
		if (run.choices.status !== 'candidates') throw new Error('unreachable')
		const [, second] = run.choices.candidates
		await revisions.selectImage({
			workId,
			assetId,
			expectedRevision: await revisions.imageRevision(assetId),
			candidateId: second.id,
		})
		const current = await project.readFile(run.path)
		expect(
			Buffer.compare(current, await project.readFile(second.cachePath)),
		).toBe(0)
		await expect(
			revisions.selectImage({
				workId,
				assetId,
				expectedRevision: 'stale',
				candidateId: second.id,
			}),
		).rejects.toMatchObject({ code: 'stale_revision' })

		expect(
			await revisions.redoChapter({
				workId,
				chapterId,
				expectedRevision: (await run.editor.snapshot({ workId, chapterId }))
					.revision,
			}),
		).toBeDefined()
		expect(run.redone).toEqual([chapterId])
		expect(chapter.chapterId).toBe(chapterId)
	} finally {
		project.close()
	}
})

test('does not propose or redo a shared chapter without source text', async () => {
	const { project, workId, ref, editor, revisions, redone } =
		await revisionProject(directory, { directory: cassettes, mode: 'strict' })
	using imported = project
	const file = projectFiles.work(ref.volumeId, workId)
	await imported.write(file, {
		...(await imported.read(file)),
		derivedFrom: { workId, version: 1 },
	})
	await rm(join(imported.root, projectFiles.chapterText(chapterId)))
	const target = { workId, chapterId }
	const snapshot = await editor.snapshot(target)
	const signal = new AbortController().signal
	await expect(
		projectProposals(imported, workId, revisions).prepare(
			{ kind: 'redoChapter', chapterId, reason: 'Redo' },
			signal,
		),
	).rejects.toMatchObject({ code: 'unsupported' })
	await expect(
		revisions.redoChapter({ ...target, expectedRevision: snapshot.revision }),
	).rejects.toMatchObject({ code: 'unsupported' })
	expect(redone).toEqual([])
	expect(await editor.snapshot(target)).toEqual(snapshot)
})

test('regeneration reports unavailable matting without replacing the original image', async () => {
	vi.stubEnv('NL_MATTING_DIR', join(directory, 'missing-matting'))
	const opaque = await picture(64, 96, false)
	const renderer = vi
		.spyOn(artModels, 'imageRenderer')
		.mockReturnValue(async () => ({ bytes: opaque }))
	const model = vi
		.spyOn(artModels, 'artJson')
		.mockResolvedValue({ content: 'Ada' })
	try {
		const { project, revisions, workId, path } = await revisionProject(
			directory,
			{
				directory: cassettes,
				mode: 'strict',
			},
		)
		using opened = project
		const original = await opened.readFile(path)
		const expectedRevision = await revisions.imageRevision(assetId)
		await expect(
			revisions.regenerateImage({
				workId,
				assetId,
				expectedRevision,
				count: 1,
			}),
		).rejects.toMatchObject({
			code: 'unsupported',
			message: '本地去背景不可用；请使用可返回透明底的图片模型。',
		})
		expect(await opened.readFile(path)).toEqual(original)
		expect(await revisions.imageRevision(assetId)).toBe(expectedRevision)
	} finally {
		renderer.mockRestore()
		model.mockRestore()
	}
})

test('rewrite applies to compact narration while still rejecting changed bases', async () => {
	const run = await revisionProject(directory, {
		directory: cassettes,
		mode: 'strict',
	})
	try {
		await run.project.writeFile(
			projectFiles.scene(run.ref, sceneId),
			scene.replace(': 暮色中', ':暮色中'),
		)
		const revisions = new CreativeRevisions(
			run.project,
			run.workId,
			run.editor,
			{
				rewriteScene: async () => parseScript(rewritten).scenes[0],
				redraw: vi.fn(),
				adoptImage: vi.fn(),
				redo: vi.fn(),
			},
		)
		const proposal = await revisions.rewriteScene({
			workId: run.workId,
			chapterId,
			sceneId,
			expectedRevision: await revisions.chapterRevision(chapterId),
			instruction: 'test',
		})
		const input = { ...proposal, hunkIds: [proposal.hunks[0].id] }
		const applied = await revisions.applyRewrite(input)
		expect(applied.scenes[0].nvs).toContain('慢慢')
		expect(applied.scenes[0].nvs).not.toContain('笛声')
		await expect(revisions.applyRewrite(input)).rejects.toMatchObject({
			code: 'stale_revision',
		})
	} finally {
		run.project.close()
	}
})

test('redoing the first chapter at its checkpoint keeps later chapters gated', async () => {
	const project = await Project.create(join(directory, 'checkpoint'), series)
	project.tasks.registerWork({ workId: ref.workId, title: series.title })
	const worker = new ScriptedWorker({ ch1: [], ch2: [] })
	const scheduler = new ChapterScheduler(project.database, worker)
	try {
		scheduler.start(ref.workId, ['ch1', 'ch2'])
		scheduler.confirmVisual(ref.workId)
		await scheduler.idle()
		expect(scheduler.snapshot(ref.workId).phase).toBe('confirm-first')
		expect(() => scheduler.redoChapter(ref.workId, 'ch2')).toThrow()
		const before = worker.calls.length
		scheduler.redoChapter(ref.workId, 'ch1')
		await scheduler.idle()
		expect(worker.calls.slice(before)).toEqual([
			'write:ch1',
			'review:ch1',
			'stage:ch1',
		])
		expect(scheduler.snapshot(ref.workId).phase).toBe('confirm-first')
		expect(worker.count('write:ch2')).toBe(0)
		scheduler.continue(ref.workId)
		await scheduler.idle()
		expect(scheduler.snapshot(ref.workId).phase).toBe('done')
	} finally {
		scheduler.dispose()
		project.close()
	}
})

test('stale bases with an old image stay usable and a redo reruns only that chapter, reusing drawn images', async () => {
	const root = join(directory, 'project')
	const project = await Project.create(root, series)
	project.tasks.registerWork({ workId: ref.workId, title: series.title })
	const worker = new ScriptedWorker({
		ch1: [{ assetId: 'hero/default', kind: 'character' }],
		ch2: [
			{
				assetId: 'hero/default/smile',
				kind: 'expression',
				baseAssetId: 'hero/default',
			},
		],
	})
	const scheduler = new ChapterScheduler(project.database, worker)
	try {
		scheduler.start(ref.workId, ['ch1', 'ch2'])
		scheduler.confirmVisual(ref.workId)
		await scheduler.idle()
		project.database
			.prepare(
				"UPDATE asset SET status = 'stale' WHERE asset_key = 'hero/default'",
			)
			.run()
		scheduler.continue(ref.workId)
		await scheduler.idle()
		expect(worker.count('draw:hero/default/smile')).toBe(1)
		expect(scheduler.snapshot(ref.workId)).toMatchObject({
			phase: 'done',
			chapters: [{ status: 'published' }, { status: 'published' }],
		})

		const before = [...worker.calls]
		scheduler.redoChapter(ref.workId, 'ch1')
		await scheduler.idle()
		expect(worker.calls.slice(before.length)).toEqual([
			'write:ch1',
			'review:ch1',
			'stage:ch1',
		])
		expect(worker.count('draw:hero/default')).toBe(1)
		expect(scheduler.snapshot(ref.workId).chapters[0]).toMatchObject({
			status: 'published',
		})
	} finally {
		scheduler.dispose()
		project.close()
	}
})

test('reconciles compatible open-editor undo steps across a partial rewrite and discards overwritten line undo', async () => {
	const run = await revisionProject(directory, {
		directory: cassettes,
		mode: 'strict',
	})
	try {
		const target = { workId: run.workId, chapterId }
		// Give the chapter a second scene so an undo step outside the rewritten
		// scene can be proven to survive a partial rewrite.
		const secondSceneId = '11223344'
		const chapterFile = projectFiles.chapter(run.ref)
		const chapterRecord = await run.project.read(chapterFile)
		await run.project.write(chapterFile, {
			...chapterRecord,
			paragraphIds: ['p0001', 'p0002'],
			sceneIds: [sceneId, secondSceneId],
		})
		await run.project.writeFile(
			projectFiles.chapterText(chapterId),
			'暮色中，一只纸船从桥下漂过。\n\n夜风吹过岸边。',
		)
		await run.project.writeFile(
			projectFiles.scene(run.ref, secondSceneId),
			'scene 岸边\nsource p0002\n\n: 夜风吹过岸边。 #0003\n',
		)
		const opened = await run.editor.open(target)
		const session = { ...target, editorId: opened.editorId }
		const otherSceneEdit = await run.editor.editLine({
			...session,
			sceneId: secondSceneId,
			expectedRevision: opened.chapter.revision,
			edit: {
				kind: 'text',
				lineId: '0003',
				previous: ': 夜风吹过岸边。',
				next: ': 夜风依然吹过岸边。',
			},
		})
		const edited = await run.editor.editLine({
			...session,
			sceneId,
			expectedRevision: otherSceneEdit.revision,
			edit: {
				kind: 'text',
				lineId: '0002',
				previous: ': 桥下很安静。',
				next: ': 桥下依然很安静。',
			},
		})
		const revisions = new CreativeRevisions(
			run.project,
			run.workId,
			run.editor,
			{
				rewriteScene: async (_chapterId, current) =>
					parseScript(
						current.nvs.includes('依然') && current.nvs.includes('0002')
							? rewritten.replace(': 桥下很安静。', ': 桥下依然很安静。')
							: rewritten,
					).scenes[0],
				redraw: vi.fn(),
				adoptImage: vi.fn(),
				redo: vi.fn(),
			},
		)
		const proposal = await revisions.rewriteScene({
			...target,
			sceneId,
			expectedRevision: edited.revision,
			instruction: 'test',
		})
		const firstHunkOnly = await revisions.applyRewrite({
			...proposal,
			hunkIds: [proposal.hunks[0].id],
		})
		expect(firstHunkOnly.scenes[0].nvs).toContain('慢慢')
		expect(firstHunkOnly.scenes[0].nvs).toContain(': 桥下依然很安静。 #0002')
		const undone = await run.editor.undo({
			...session,
			expectedRevision: firstHunkOnly.revision,
		})
		expect(undone.scenes[0].nvs).toContain('慢慢')
		expect(undone.scenes[0].nvs).toContain(': 桥下很安静。 #0002')

		const secondEdit = await run.editor.editLine({
			...session,
			sceneId,
			expectedRevision: undone.revision,
			edit: {
				kind: 'text',
				lineId: '0002',
				previous: ': 桥下很安静。',
				next: ': 桥下不再安静。',
			},
		})
		const fullProposal = await revisions.rewriteScene({
			...target,
			sceneId,
			expectedRevision: secondEdit.revision,
			instruction: 'test',
		})
		const appliedFull = await revisions.applyRewrite({
			...fullProposal,
			hunkIds: fullProposal.hunks.map(({ id }) => id),
		})
		const undoneOtherScene = await run.editor.undo({
			...session,
			expectedRevision: appliedFull.revision,
		})
		// The rewritten scene's own overwritten edit was dropped, but the edit in
		// the untouched second scene survived and undoes cleanly.
		expect(undoneOtherScene.scenes[0].nvs).toBe(appliedFull.scenes[0].nvs)
		expect(undoneOtherScene.scenes[1].nvs).toContain(': 夜风吹过岸边。 #0003')
		expect(undoneOtherScene.scenes[1].nvs).not.toContain('依然')
		const emptyUndo = await run.editor.undo({
			...session,
			expectedRevision: undoneOtherScene.revision,
		})
		expect(emptyUndo).toEqual(undoneOtherScene)
	} finally {
		run.project.close()
	}
})
