import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compile } from '@earendil-works/pi-schema'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { productionSnapshotSchema } from '../../packages/creator/src/contract/production'
import { productionQueueSchema } from '../../packages/creator/src/contract/queue'
import { testTextConnection } from '../../packages/creator/src/models/text'
import { Project } from '../../packages/creator/src/project'
import {
	ChapterScheduler,
	ProductionTaskError,
} from '../../packages/creator/src/scheduler/chapter'
import { readQueueWork } from '../../packages/creator/src/scheduler/work-queue'
import { SpendBudgetError } from '../../packages/creator/src/usage/spend'
import type { ImageQueueItem } from '../../packages/format/src/model'
import { configuration } from '../fixtures/cassettes/m1b-gate/fixture'
import { ref, series } from '../fixtures/project-schema/seed'
import { ScriptedWorker } from '../fixtures/scheduler/m1b/worker'

const workId = ref.workId
const validate = compile(productionSnapshotSchema)
const cg = (assetId: string): ImageQueueItem => ({ assetId, kind: 'cg' })

let directory: string
let root: string
let project: Project
let scheduler: ChapterScheduler | undefined

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'novelive-scheduler-'))
	root = join(directory, 'project')
	project = await Project.create(root, series)
	project.tasks.registerWork({ workId, title: series.title })
})
afterEach(async () => {
	scheduler?.dispose()
	scheduler = undefined
	project.close()
	await rm(directory, { recursive: true, force: true })
})

function open(worker: ScriptedWorker, imageConcurrency?: number) {
	scheduler = new ChapterScheduler(project.database, worker, {
		imageConcurrency,
	})
	return scheduler
}

function snapshot(target = scheduler) {
	const value = target?.snapshot(workId)
	const result = validate.validate(value)
	expect(result.ok).toBe(true)
	return value as NonNullable<typeof value>
}

function row<T>(sql: string, ...params: string[]) {
	return project.database.prepare(sql).get(...params) as T
}

async function throughConfirmations(target: ChapterScheduler) {
	target.confirmVisual(workId)
	await target.idle()
	expect(snapshot().phase).toBe('confirm-first')
	target.continue(workId)
}

test('two confirmation points gate chapter production', async () => {
	const worker = new ScriptedWorker({
		ch1: [{ assetId: 'traveler/default', kind: 'character' }],
		ch2: [cg('cg-door')],
	})
	const target = open(worker)
	expect(target.start(workId, ['ch1', 'ch2'], [cg('cg-key')])).toMatchObject({
		phase: 'confirm-visual',
		status: 'confirm',
	})
	await target.idle()
	expect(worker.calls).toEqual(['draw:cg-key'])

	target.confirmVisual(workId)
	await target.idle()
	expect(worker.calls).not.toContain('write:ch2')
	expect(snapshot()).toMatchObject({
		phase: 'confirm-first',
		status: 'confirm',
		chapters: [
			{ chapterId: 'ch1', status: 'published', priority: true },
			{ chapterId: 'ch2', status: 'waiting', priority: false },
		],
	})

	target.continue(workId)
	await target.idle()
	expect(snapshot()).toMatchObject({
		phase: 'done',
		status: 'idle',
		chapters: [{ status: 'published' }, { status: 'published' }],
	})
})

test('writes the next chapter while images draw, dedupes assets, draws bases first within the concurrency limit', async () => {
	const worker = new ScriptedWorker({
		ch1: [{ assetId: 'traveler/default', kind: 'character' }],
		ch2: [
			{ assetId: 'yard/night', kind: 'variant', baseAssetId: 'yard/day' },
			{ assetId: 'yard/day', kind: 'location' },
			{ assetId: 'room/day', kind: 'location' },
			...['cg-a', 'cg-b', 'cg-c', 'cg-d', 'cg-e'].map(cg),
		],
		ch3: [
			{ assetId: 'traveler/default', kind: 'character' },
			{ assetId: 'room/day', kind: 'location' },
		],
	})
	const target = open(worker, 3)
	target.start(workId, ['ch1', 'ch2', 'ch3'])
	worker.hold('draw:room/day')
	await throughConfirmations(target)

	await vi.waitFor(() => expect(worker.calls).toContain('stage:ch3'))
	expect(snapshot().chapters[1]).toMatchObject({
		status: 'producing',
		step: 'draw',
	})
	worker.release('draw:room/day')
	await target.idle()

	expect(worker.count('draw:traveler/default')).toBe(1)
	expect(worker.count('draw:room/day')).toBe(1)
	expect(
		row<{ n: number }>(
			"SELECT COUNT(*) AS n FROM task WHERE kind = 'image' AND ref_id = 'room/day'",
		).n,
	).toBe(1)
	expect(worker.calls.indexOf('draw:yard/day')).toBeLessThan(
		worker.calls.indexOf('draw:yard/night'),
	)
	expect(worker.maxDrawing).toBe(3)
	expect(snapshot().phase).toBe('done')
})

test('prioritized chapters jump the chapter pipeline and link through the preview summary', async () => {
	const worker = new ScriptedWorker()
	const target = open(worker)
	target.start(workId, ['ch1', 'ch2', 'ch3', 'ch4'])
	expect(
		target.prioritizeChapter(workId, 'ch3').chapters.map((c) => c.priority),
	).toEqual([true, false, true, false])
	await throughConfirmations(target)
	await target.idle()

	expect(worker.calls.filter((call) => call.startsWith('write:'))).toEqual([
		'write:ch1',
		'write:ch3',
		'write:ch2',
		'write:ch4',
	])
	expect(Object.fromEntries(worker.links)).toEqual({
		ch1: 'none',
		ch3: 'preview-summary',
		ch2: 'previous',
		ch4: 'previous',
	})
})

test('stop cancels queued work, aborts running calls, and continue reruns only what was cut off', async () => {
	const worker = new ScriptedWorker({ ch2: [cg('cg-a'), cg('cg-b')] })
	const target = open(worker)
	target.start(workId, ['ch1', 'ch2', 'ch3', 'ch4'])
	worker.hold('draw:cg-b')
	worker.hold('write:ch3')
	await throughConfirmations(target)
	await vi.waitFor(() =>
		expect(worker.calls).toEqual(
			expect.arrayContaining(['write:ch3', 'draw:cg-b']),
		),
	)

	expect(target.stop(workId)).toEqual({
		workId,
		mode: 'immediate',
		cancelledQueued: 2,
		abortedRunning: 2,
	})
	expect(worker.aborted.sort()).toEqual(['draw:cg-b', 'write:ch3'])
	worker.release('draw:cg-b')
	worker.release('write:ch3')
	await target.idle()
	expect(snapshot()).toMatchObject({ phase: 'producing', status: 'stopped' })
	expect(
		row<{ status: string }>("SELECT status FROM asset WHERE asset_key = 'cg-b'")
			.status,
	).toBe('pending')

	target.continue(workId)
	await target.idle()
	expect(snapshot().phase).toBe('done')
	expect(worker.count('draw:cg-a')).toBe(1)
	expect(worker.count('draw:cg-b')).toBe(2)
	expect(worker.count('write:ch3')).toBe(2)
	expect(worker.count('write:ch2')).toBe(1)
	expect(
		target
			.runLog(workId)
			.filter((run) => run.status === 'interrupted')
			.map((run) => [run.ref, run.steps.at(-1)?.status])
			.sort(),
	).toEqual([
		['cg-b', 'cancelled'],
		['ch3', 'cancelled'],
	])
})

test('a failed chapter pauses the work until it is retried and resumes from the failed step', async () => {
	const worker = new ScriptedWorker({ ch2: [cg('cg-x')] })
	const target = open(worker)
	target.start(workId, ['ch1', 'ch2', 'ch3'])
	worker.script('write:ch1', new ProductionTaskError('moderation', 'refused'))
	worker.script(
		'write:ch2',
		new ProductionTaskError('transient', 'reset'),
		new ProductionTaskError('transient', 'reset'),
	)
	worker.script('review:ch2', new ProductionTaskError('transient', 'reset'))
	worker.script(
		'review:ch3',
		new ProductionTaskError('final', '审稿结果无法解析'),
	)
	worker.hold('draw:cg-x')
	await throughConfirmations(target)
	await vi.waitFor(() => expect(snapshot().blockedChapterId).toBe('ch3'))

	expect(worker.desensitized).toEqual(['write:ch1', 'review:ch1', 'stage:ch1'])
	expect(worker.count('write:ch2')).toBe(3)
	expect(snapshot()).toMatchObject({
		status: 'stopped',
		chapters: [
			{ status: 'published' },
			{ status: 'producing', step: 'draw' },
			{ status: 'producing', step: 'review', issue: '审稿结果无法解析' },
		],
	})
	worker.release('draw:cg-x')
	await target.idle()
	expect(snapshot().chapters[1]).toMatchObject({ status: 'published' })

	target.stop(workId)
	target.continue(workId)
	await target.idle()
	expect(
		row<{ pause_reason: string }>('SELECT pause_reason FROM work').pause_reason,
	).toBe('chapter_failed')

	target.retryChapter(workId, 'ch3')
	await target.idle()
	expect(snapshot()).toMatchObject({
		phase: 'done',
		chapters: [{}, {}, { status: 'published' }],
	})
	expect(snapshot().chapters[2]?.issue).toBeUndefined()
	expect(worker.count('write:ch3')).toBe(1)
	expect(worker.count('review:ch3')).toBe(2)
})

test('a placeholder after retry does not surface the resolved chapter failure', async () => {
	const worker = new ScriptedWorker({ ch2: [cg('cg-retry')] })
	const target = open(worker)
	worker.script('write:ch2', new ProductionTaskError('final', '写作请求失败'))
	worker.script('draw:cg-retry', { status: 'placeholder', issue: '素材损坏' })
	target.start(workId, ['ch1', 'ch2'])
	await throughConfirmations(target)
	await target.idle()
	expect(snapshot().chapters[1]?.issue).toBe('写作请求失败')

	target.retryChapter(workId, 'ch2')
	await target.idle()
	expect(snapshot().chapters[1]).toMatchObject({
		status: 'published',
		issue: '1 张图用了占位图',
	})
	expect(target.runLog(workId)).toContainEqual(
		expect.objectContaining({ ref: 'ch2', status: 'needs_attention' }),
	)
})

test('local matting unavailable publishes with the reason on each affected chapter', async () => {
	const sprite = { assetId: 'hero/default', kind: 'character' } as const
	const worker = new ScriptedWorker({ ch1: [sprite], ch2: [sprite] })
	const target = open(worker)
	const issue = '本地去背景不可用；请使用可返回透明底的图片模型。'
	worker.script('draw:hero/default', {
		status: 'placeholder',
		reason: 'matting_unavailable',
		issue,
	})
	target.start(workId, ['ch1', 'ch2'])
	await throughConfirmations(target)
	await target.idle()

	for (const chapter of snapshot().chapters)
		expect(chapter).toMatchObject({
			status: 'published',
			issue: `1 张图用了占位图；${issue}`,
		})
	expect(target.runLog(workId)).toContainEqual(
		expect.objectContaining({
			ref: 'hero/default',
			status: 'done',
			errorType: 'matting_unavailable',
			errorMessage: issue,
		}),
	)
})

test('image failures fall back to placeholders but unsupported capabilities pause the work', async () => {
	const worker = new ScriptedWorker({
		ch1: [
			{ assetId: 'hero/default', kind: 'character' },
			{
				assetId: 'hero/default/smile',
				kind: 'expression',
				baseAssetId: 'hero/default',
			},
			cg('cg-a'),
			cg('cg-b'),
		],
		ch2: [cg('cg-c'), { assetId: 'hero/default', kind: 'character' }],
	})
	const target = open(worker)
	target.start(workId, ['ch1', 'ch2'])
	worker.script('draw:hero/default', {
		status: 'placeholder',
		issue: '立绘没通过视觉审核',
	})
	const reset = new ProductionTaskError('transient', 'overloaded')
	worker.script('draw:cg-a', reset, reset, reset)
	worker.script('draw:cg-b', new ProductionTaskError('moderation', 'refused'))
	worker.script('draw:cg-c', {
		status: 'unsupported',
		issue: '图片接口不支持透明底',
	})
	target.confirmVisual(workId)
	await target.idle()

	expect(snapshot()).toMatchObject({
		phase: 'confirm-first',
		chapters: [
			{ status: 'published', issue: '3 张图用了占位图' },
			{ status: 'waiting' },
		],
	})
	expect(worker.count('draw:hero/default/smile')).toBe(0)
	expect(worker.count('placeholder:hero/default/smile')).toBe(1)
	expect(worker.count('placeholder:cg-a')).toBe(1)
	expect(worker.count('draw:cg-a')).toBe(3)
	expect(worker.desensitized).toEqual(['draw:cg-b'])

	target.continue(workId)
	await target.idle()
	expect(snapshot()).toMatchObject({
		phase: 'producing',
		status: 'stopped',
		chapters: [
			{},
			{ status: 'producing', step: 'draw', issue: '图片接口不支持透明底' },
		],
	})
	expect(worker.count('draw:cg-c')).toBe(1)
	expect(
		row<{ status: string }>("SELECT status FROM asset WHERE asset_key = 'cg-c'")
			.status,
	).toBe('failed')
	expect(
		row<{ pause_reason: string }>('SELECT pause_reason FROM work').pause_reason,
	).toBe('image_unsupported')

	target.continue(workId)
	await target.idle()
	expect(snapshot()).toMatchObject({
		phase: 'done',
		chapters: [{}, { status: 'published' }],
	})
	expect(snapshot().chapters[1]?.issue).toBe('1 张图用了占位图')
	expect(worker.count('draw:hero/default')).toBe(1)
})

test('Continue repairs a legacy placeholder and resumes the task that paused the work', async () => {
	const worker = new ScriptedWorker({
		ch1: [cg('old-placeholder')],
		ch2: [cg('paused-draw')],
	})
	const target = open(worker)
	worker.script('draw:old-placeholder', {
		status: 'placeholder',
		issue: 'Historic failure',
	})
	worker.script('draw:paused-draw', {
		status: 'unsupported',
		issue: 'Unsupported',
	})
	target.start(workId, ['ch1', 'ch2'])
	await throughConfirmations(target)
	await target.idle()
	expect(snapshot().status).toBe('stopped')
	project.database
		.prepare(
			"UPDATE run SET error_message = ? WHERE kind = 'image' AND ref = 'old-placeholder'",
		)
		.run('[reasoning_limit] Historic failure')

	target.continue(workId)
	await target.idle()

	expect(worker.count('draw:old-placeholder')).toBe(2)
	expect(worker.count('draw:paused-draw')).toBe(2)
	expect(snapshot().chapters).toEqual([
		{ chapterId: 'ch1', status: 'published', priority: true },
		{ chapterId: 'ch2', status: 'published', priority: false },
	])
})

test('a single-chapter work still stops at the first-chapter confirmation', async () => {
	const target = open(new ScriptedWorker())
	target.start(workId, ['ch1'])
	target.confirmVisual(workId)
	await target.idle()
	expect(snapshot().phase).toBe('confirm-first')
	expect(target.continue(workId).phase).toBe('done')
})

test('a budget refusal pauses the queue explicitly and retains the image for continuation', async () => {
	const worker = new ScriptedWorker({ ch1: [cg('cg-budget')] })
	const refused = new SpendBudgetError('超出工程预算')
	const draw = vi.spyOn(worker, 'draw').mockRejectedValueOnce(refused)
	const target = open(worker)
	target.start(workId, ['ch1'])
	target.confirmVisual(workId)
	await target.idle()

	const entry = readQueueWork(project.database, {
		title: series.title,
		link: { workId, volumeId: ref.volumeId, seriesId: series.seriesId },
		projectDir: root,
	})
	expect(entry).toMatchObject({ status: 'paused', reason: 'budget_paused' })
	expect(
		compile(productionQueueSchema).check({
			active: null,
			queued: [],
			inactive: [entry],
		}),
	).toBe(true)
	expect(snapshot().chapters[0]).toMatchObject({ issue: refused.message })
	expect(worker.count('placeholder:cg-budget')).toBe(0)
	target.continue(workId)
	await target.idle()
	expect(draw).toHaveBeenCalledTimes(2)
	expect(snapshot().chapters[0]).toMatchObject({ status: 'published' })
})

test('restaging restores the audit continuation for a retained budget-paused image', async () => {
	const retained = cg('cg-retained')
	const obsolete = cg('cg-obsolete')
	const worker = new ScriptedWorker({ ch1: [retained, obsolete] })
	const draw = vi
		.spyOn(worker, 'draw')
		.mockRejectedValueOnce(new SpendBudgetError('超出工程预算'))
	const stage = vi.spyOn(worker, 'stage')
	const target = new ChapterScheduler(project.database, worker, {
		imageConcurrency: 1,
		imageBudget: () => 1,
	})
	scheduler = target
	target.start(workId, ['ch1'])
	target.confirmVisual(workId)
	await target.idle()
	expect(snapshot().chapters[0]).toMatchObject({
		issue: expect.stringContaining('超出工程预算'),
	})
	expect(draw).toHaveBeenCalledTimes(1)
	stage.mockResolvedValueOnce([retained])
	target.continue(workId)
	await target.idle()
	expect(stage).toHaveBeenCalledTimes(2)
	expect(draw).toHaveBeenCalledTimes(2)
	expect(draw).toHaveBeenLastCalledWith(
		expect.objectContaining({ assetId: retained.assetId }),
		expect.objectContaining({ resumingBudget: true }),
	)
	expect(snapshot().chapters[0]).toMatchObject({ status: 'published' })
})

test('a refused writing request surfaces the budget pause and continues the same step', async () => {
	const worker = new ScriptedWorker()
	const refused = new SpendBudgetError(
		'超出工程预算（软停止线 1600000 tokens）',
	)
	const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(refused)
	const write = vi.spyOn(worker, 'write').mockImplementationOnce(async () => {
		await testTextConnection(configuration.models.writing, { fetch })
	})
	const target = open(worker)
	target.start(workId, ['ch1'])
	target.confirmVisual(workId)
	await target.idle()

	expect(
		row<{ pause_reason: string }>('SELECT pause_reason FROM work').pause_reason,
	).toBe('budget_paused')
	expect(snapshot()).toMatchObject({
		status: 'stopped',
		chapters: [
			{
				status: 'producing',
				step: 'write',
				issue: expect.stringContaining(refused.message),
			},
		],
	})
	expect(fetch).toHaveBeenCalledTimes(1)
	expect(worker.count('review:ch1')).toBe(0)
	target.continue(workId)
	await target.idle()
	expect(write).toHaveBeenCalledTimes(2)
	expect(snapshot()).toMatchObject({
		phase: 'confirm-first',
		chapters: [{ status: 'published' }],
	})
})

test('continuing a budget pause preserves the moderation retry', async () => {
	const worker = new ScriptedWorker()
	const write = vi
		.spyOn(worker, 'write')
		.mockRejectedValueOnce(new ProductionTaskError('moderation', 'refused'))
		.mockRejectedValueOnce(new SpendBudgetError('超出工程预算'))
	const target = open(worker)
	target.start(workId, ['ch1'])
	target.confirmVisual(workId)
	await target.idle()
	expect(write.mock.calls.map(([ctx]) => ctx.desensitized)).toEqual([
		false,
		true,
	])
	expect(snapshot()).toMatchObject({ status: 'stopped' })

	target.continue(workId)
	await target.idle()
	expect(write.mock.calls.map(([ctx]) => ctx.desensitized)).toEqual([
		false,
		true,
		true,
	])
	expect(snapshot()).toMatchObject({ chapters: [{ status: 'published' }] })
})

test('crash recovery keeps confirmed work, skips saved images and leaves a replayable run log', async () => {
	const manifests = { ch1: [cg('cg-a'), cg('cg-b')], ch2: [] }
	const worker = new ScriptedWorker(manifests)
	const first = open(worker)
	first.start(workId, ['ch1', 'ch2'])
	worker.hold('draw:cg-b')
	first.confirmVisual(workId)
	await vi.waitFor(() => expect(worker.saved.has('cg-a')).toBe(true))
	await vi.waitFor(() => expect(worker.calls).toContain('draw:cg-b'))
	first.dispose()
	project.close()

	project = await Project.open(root)
	const restarted = new ScriptedWorker(manifests)
	restarted.saved.add('cg-b')
	const second = open(restarted)
	expect(snapshot()).toMatchObject({
		phase: 'producing',
		status: 'stopped',
		chapters: [{ status: 'producing', step: 'draw' }, { status: 'waiting' }],
	})
	expect(
		row<{ status: string }>("SELECT status FROM asset WHERE asset_key = 'cg-b'")
			.status,
	).toBe('pending')

	second.continue(workId)
	await second.idle()
	expect(snapshot().phase).toBe('confirm-first')
	expect(restarted.calls).toEqual([])
	const log = second
		.runLog(workId)
		.map((run) => [
			run.kind,
			run.ref,
			run.status,
			run.steps.map((s) => `${s.purpose}:${s.status}`),
		])
	expect(log).toEqual([
		[
			'chapter',
			'ch1',
			'done',
			['write:completed', 'review:completed', 'stage:completed'],
		],
		['image', 'cg-a', 'done', ['draw:completed']],
		['image', 'cg-b', 'interrupted', ['draw:cancelled']],
		['image', 'cg-b', 'done', ['draw:completed']],
	])
	const runIds = second.runLog(workId).map((run) => run.runId)
	second.dispose()
	project.close()

	project = await Project.open(root)
	expect(
		open(new ScriptedWorker(manifests))
			.runLog(workId)
			.map((run) => run.runId),
	).toEqual(runIds)
})
