import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectFiles } from '@novelive/format/model'
import sharp from 'sharp'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createConfigStore } from '../../packages/creator/src/config'
import { productionChapterRecordEvent } from '../../packages/creator/src/contract/production'
import { importTxtProject } from '../../packages/creator/src/import/wizard'
import { Project } from '../../packages/creator/src/project'
import { createProduction } from '../../packages/creator/src/project/production'
import {
	chapterWorker,
	productionModels,
} from '../../packages/creator/src/project/production-worker'
import { ChapterScheduler } from '../../packages/creator/src/scheduler/chapter'
import { bible } from '../fixtures/cassettes/m1b-art/fixture'
import { configuration, original } from '../fixtures/cassettes/m1b-gate/fixture'
import { ScriptedWorker } from '../fixtures/scheduler/m1b/worker'

let directory: string

beforeEach(async () => {
	vi.stubEnv('NL_REPLAY', '')
	directory = await mkdtemp(join(tmpdir(), 'novelive-production-worker-'))
})
afterEach(async () => {
	vi.unstubAllEnvs()
	await rm(directory, { recursive: true, force: true })
})

async function fixture() {
	const sourcePath = join(directory, 'paper-boat.txt')
	await writeFile(sourcePath, original)
	const imported = await importTxtProject({
		sourcePath,
		folder: directory,
		title: 'Paper boat',
		encoding: 'utf-8',
		references: [],
	})
	if (imported.status !== 'ready') throw new Error('Fixture import failed')
	return imported
}

function completion(payload: unknown) {
	const content = JSON.stringify(payload)
	const lines = [
		{
			choices: [
				{
					index: 0,
					delta: { role: 'assistant', content },
					finish_reason: null,
				},
			],
		},
		{ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
	]
	return new Response(
		`${lines.map((line) => `data: ${JSON.stringify(line)}\n\n`).join('')}data: [DONE]\n\n`,
		{
			headers: { 'content-type': 'text/event-stream' },
		},
	)
}

test('staging and portrait painting dispatch to their configured role models', async () => {
	const { projectDir, workId } = await fixture()
	using project = await Project.open(projectDir)
	const work = await project.read(projectFiles.work('v0001', workId))
	const config = createConfigStore(directory)
	await config.update({
		...configuration,
		production: {
			roleModels: { artist: 'fast', 'painter-portrait': 'visual' },
		},
	})
	const requests: string[] = []
	const fetch: typeof globalThis.fetch = async (input, init) => {
		const req = new Request(input, init)
		if (req.url.includes('/images/'))
			return Response.json({ data: [{ b64_json: 'dGVzdA==' }] })
		const { model } = await req.json()
		requests.push(model)
		return requests.length === 1
			? completion({ patch: '', items: [], merges: {} })
			: completion({ content: '蓝色制服。' })
	}
	const { worker, art } = chapterWorker(
		project,
		'v0001',
		work,
		await productionModels(config),
		{ fetch },
	)
	const chapterId = 'ch0001'
	await project.writeFile(
		`source/production/${chapterId}/draft.nvs`,
		'scene 纸船\nsource p0001-p0001\n\n: 暮色中，一只纸船从桥下漂过。\n',
	)
	await worker.stage({
		workId,
		chapterId,
		link: 'none',
		desensitized: false,
		signal: new AbortController().signal,
	})
	const service = art()
	const [job] = await service.register(
		[{ id: 'ada/uniform/neutral', kind: 'character', description: '蓝色制服' }],
		bible,
	)
	await service.draw(job, bible)
	expect(requests).toEqual(['fixture-art-fast', 'fixture-art-visual'])
})

test('a painter exception materializes both base and variant placeholders before publication', async () => {
	const { projectDir, workId } = await fixture()
	using project = await Project.open(projectDir)
	const work = await project.read(projectFiles.work('v0001', workId))
	const config = createConfigStore(directory)
	await config.update(configuration)
	let requests = 0
	const fetch: typeof globalThis.fetch = async () => {
		requests++
		return completion({ unexpected: 'Invalid painter response' })
	}
	const { worker, art } = chapterWorker(
		project,
		'v0001',
		work,
		await productionModels(config),
		{ fetch },
	)
	const jobs = await art().register(
		[
			{ id: 'room/day', kind: 'location', description: 'Sunny' },
			{ id: 'room/night', kind: 'variant', description: 'Night' },
		],
		bible,
	)
	for (const job of jobs)
		await project.writeFile(
			`source/production/art/${job.assetId}.json`,
			JSON.stringify({ job }),
		)
	const queue = new ChapterScheduler(project.database, {
		...worker,
		async write() {},
		async review() {},
		async stage() {
			return jobs
		},
	})
	project.tasks.registerWork({ workId, title: work.title })
	try {
		queue.start(workId, ['ch0001'])
		queue.confirmVisual(workId)
		await queue.idle()
		expect(queue.snapshot(workId).chapters).toMatchObject([
			{ status: 'published', issue: '2 张图用了占位图' },
		])
		const { entries } = await art().registry()
		expect(entries.map(({ status }) => status)).toEqual([
			'placeholder',
			'placeholder',
		])
		for (const { path } of entries)
			expect(
				(await sharp(await project.readFile(path)).metadata()).format,
			).toBe('webp')
		expect(requests).toBe(1)
	} finally {
		queue.dispose()
	}
})

test('staging depends on a reused pending image absent from the new manifest', async () => {
	const { projectDir, workId } = await fixture()
	using project = await Project.open(projectDir)
	const work = await project.read(projectFiles.work('v0001', workId))
	const config = createConfigStore(directory)
	await config.update(configuration)
	let chapter = 0
	const fetch: typeof globalThis.fetch = async () =>
		completion({
			patch: 'PUT <4:\n@bg room/day',
			items:
				++chapter === 1
					? [{ id: 'room/day', kind: 'location', description: 'Sunny' }]
					: [],
			merges: {},
		})
	const { worker, art } = chapterWorker(
		project,
		'v0001',
		work,
		await productionModels(config),
		{ fetch },
	)
	const ctx = {
		workId,
		link: 'none',
		desensitized: false,
		signal: new AbortController().signal,
	} as const
	const [first, second] = work.chapterIds
	for (const chapterId of work.chapterIds)
		await project.writeFile(
			`source/production/${chapterId}/draft.nvs`,
			'scene 纸船\nsource p0001\n\n: 暮色中，一只纸船从桥下漂过。\n',
		)
	expect(await worker.stage({ ...ctx, chapterId: first })).toMatchObject([
		{ assetId: 'room/day' },
	])
	expect((await art().registry()).entries).toMatchObject([
		{ id: 'room/day', status: 'pending' },
	])
	expect(await worker.stage({ ...ctx, chapterId: second })).toMatchObject([
		{ assetId: 'room/day' },
	])
})

test('records a manually interrupted chapter as cancelled when production reopens', async () => {
	const { projectDir, workId } = await fixture()
	const config = createConfigStore(directory)
	await config.update(configuration)
	{
		using project = await Project.open(projectDir)
		project.tasks.registerWork({ workId, title: 'Paper boat' })
		const worker = new ScriptedWorker()
		worker.hold('write:ch0001')
		const queue = new ChapterScheduler(project.database, worker)
		try {
			queue.start(workId, ['ch0001'])
			queue.confirmVisual(workId)
			expect(queue.stop(workId).abortedRunning).toBe(1)
			worker.release('write:ch0001')
			await queue.idle()
		} finally {
			queue.dispose()
		}
	}
	const production = createProduction(
		directory,
		config,
		{
			fetch: async () => {
				throw new Error('Reopening a stopped project should not call providers')
			},
		},
		() => {},
		() => {},
	)
	try {
		await production.remember(workId, projectDir)
		const session = await production.get(workId)
		const events = session.records
			.map(({ event }) => event)
			.filter((event) => productionChapterRecordEvent.check(event))
		expect(events).toMatchObject([
			{
				payload: {
					chapterId: 'ch0001',
					step: 'write',
					status: 'cancelled',
					message: '已取消',
				},
			},
		])
	} finally {
		await production.close()
	}
})
