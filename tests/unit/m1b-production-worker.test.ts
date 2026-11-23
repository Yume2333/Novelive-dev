import { EventEmitter, once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectFiles } from '@novelive/format/model'
import sharp from 'sharp'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createConfigStore } from '../../packages/creator/src/config'
import type {
	Command,
	CommandInput,
	CreatorFrame,
} from '../../packages/creator/src/contract'
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
	const content =
		typeof payload === 'string' ? payload : JSON.stringify(payload)
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

test('a later volume publishes with the reason from a reused series placeholder', async () => {
	const { projectDir, workId } = await fixture()
	using project = await Project.open(projectDir)
	const work = await project.read(projectFiles.work('v0001', workId))
	const config = createConfigStore(directory)
	await config.update(configuration)
	const models = await productionModels(config)
	const fetch = vi.fn<typeof globalThis.fetch>(async () => {
		throw new Error('Reusing a placeholder must not call a model')
	})
	const first = chapterWorker(project, 'v0001', work, models, { fetch })
	const issue = '本地去背景不可用；请使用可返回透明底的图片模型。'
	const [job] = await first
		.art()
		.register(
			[{ id: 'ada/uniform/neutral', kind: 'character', description: 'Ada' }],
			bible,
		)
	await first.art().savePlaceholder(job.assetId, issue, 'matting_unavailable')
	await project.writeFile(
		`source/production/art/${job.assetId}.json`,
		JSON.stringify({ job }),
	)
	const laterWork = {
		...work,
		workId: '7a49d711-b6f5-442f-8234-58b43df92da0',
	}
	await project.write(projectFiles.work('v0002', laterWork.workId), laterWork)
	project.tasks.registerWork({
		workId: laterWork.workId,
		title: laterWork.title,
	})
	const { worker } = chapterWorker(project, 'v0002', laterWork, models, {
		fetch,
	})
	const queue = new ChapterScheduler(project.database, {
		...worker,
		async write() {},
		async review() {},
		async stage() {
			return [job]
		},
	})
	try {
		queue.start(laterWork.workId, [laterWork.chapterIds[0]])
		queue.confirmVisual(laterWork.workId)
		await queue.idle()
		expect(queue.snapshot(laterWork.workId).chapters).toMatchObject([
			{ status: 'published', issue: `1 张图用了占位图；${issue}` },
		])
		expect(fetch).not.toHaveBeenCalled()
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

test('invalid staging does not advertise assets without drawing metadata on retry', async () => {
	const { projectDir, workId } = await fixture()
	using project = await Project.open(projectDir)
	const work = await project.read(projectFiles.work('v0001', workId))
	const config = createConfigStore(directory)
	await config.update(configuration)
	let attempt = 0
	const fetch: typeof globalThis.fetch = async (input, init) => {
		const { messages } = await new Request(input, init).json()
		const prompt = JSON.stringify(messages)
		const alreadyRegistered = prompt.includes('assets/locations/room/day.webp')
		return completion({
			patch:
				++attempt === 1
					? 'PUT <4:\n@bg room/day\n@costume ada/uniform'
					: 'PUT <4:\n@bg room/day',
			items: [
				...(alreadyRegistered
					? []
					: [{ id: 'room/day', kind: 'location', description: 'Sunny' }]),
				...(attempt === 1
					? [
							{
								id: 'ada/uniform/neutral',
								kind: 'character',
								description: 'Blue uniform',
							},
						]
					: []),
			],
			merges: {},
		})
	}
	const { worker, art } = chapterWorker(
		project,
		'v0001',
		work,
		await productionModels(config),
		{ fetch },
	)
	const chapterId = work.chapterIds[0]
	await project.writeFile(
		`source/production/${chapterId}/draft.nvs`,
		'scene 纸船\nsource p0001\n\n: 暮色中，一只纸船从桥下漂过。\n',
	)
	const ctx = {
		workId,
		chapterId,
		link: 'none',
		desensitized: false,
		signal: new AbortController().signal,
	} as const
	await expect(worker.stage(ctx)).rejects.toThrow('舞台上找不到')
	expect((await art().registry()).entries).toEqual([])
	expect(await worker.stage(ctx)).toMatchObject([{ assetId: 'room/day' }])
	expect(
		JSON.parse(
			(
				await project.readFile('source/production/art/room/day.json')
			).toString(),
		),
	).toMatchObject({
		job: { assetId: 'room/day' },
	})
})

test('a reused pending variant queues its missing base before the variant', async () => {
	const { projectDir, workId } = await fixture()
	using project = await Project.open(projectDir)
	const work = await project.read(projectFiles.work('v0001', workId))
	const config = createConfigStore(directory)
	await config.update(configuration)
	let stages = 0
	const fetch: typeof globalThis.fetch = async () =>
		completion({
			patch: 'PUT <4:\n@bg room/night',
			items:
				++stages === 1
					? [{ id: 'room/night', kind: 'variant', description: 'Night' }]
					: [],
			merges: {},
		})
	const { worker } = chapterWorker(
		project,
		'v0001',
		work,
		await productionModels(config),
		{ fetch },
	)
	const [first, second] = work.chapterIds
	for (const chapterId of work.chapterIds)
		await project.writeFile(
			`source/production/${chapterId}/draft.nvs`,
			'scene 纸船\nsource p0001\n\n: 暮色中，一只纸船从桥下漂过。\n',
		)
	await worker.stage({
		workId,
		chapterId: first,
		link: 'none',
		desensitized: false,
		signal: new AbortController().signal,
	})
	project.tasks.registerWork({ workId, title: work.title })
	const drawn = new Set<string>()
	const queue = new ChapterScheduler(project.database, {
		...worker,
		async write() {},
		async review() {},
		async draw(job) {
			if (job.baseAssetId && !drawn.has(job.baseAssetId))
				throw new Error('Variant dispatched before its base')
			drawn.add(job.assetId)
			return { status: 'drawn' }
		},
	})
	try {
		queue.start(workId, [second])
		queue.confirmVisual(workId)
		await queue.idle()
		expect([...drawn]).toEqual(['room/day', 'room/night'])
		expect(queue.snapshot(workId).chapters).toMatchObject([
			{ status: 'published' },
		])
	} finally {
		queue.dispose()
	}
})

test('a settings save changes the next step of an active production session', async () => {
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
			queue.stop(workId)
			await queue.idle()
		} finally {
			queue.dispose()
		}
	}
	const writerStarted = Promise.withResolvers<void>()
	const releaseWriter = Promise.withResolvers<void>()
	const requests: string[] = []
	const fetch: typeof globalThis.fetch = async (input, init) => {
		const { model } = await new Request(input, init).json()
		requests.push(model)
		if (requests.length === 1) {
			writerStarted.resolve()
			await releaseWriter.promise
			return completion(
				'scene 纸船\nsource p0001\n\n: 暮色中，一只纸船从桥下漂过。\n',
			)
		}
		return Response.json(
			{ error: { message: 'Stop after observing review model' } },
			{ status: 400 },
		)
	}
	const production = createProduction(
		directory,
		config,
		{ fetch },
		() => {},
		() => {},
	)
	try {
		await production.remember(workId, projectDir)
		const session = await production.get(workId)
		await session.continue()
		await writerStarted.promise
		expect(session.snapshot().status).toBe('producing')
		await config.update({
			production: { roleModels: { 'reviewer-script': 'visual' } },
		})
		await production.refreshSettings()
		releaseWriter.resolve()
		await session.queue.idle()
		expect(requests).toEqual([
			configuration.models.writing.model,
			'fixture-art-visual',
		])
	} finally {
		releaseWriter.resolve()
		await production.close()
	}
})

test('creator config.update applies the new image model and concurrency to queued draws', async () => {
	const { projectDir, workId } = await fixture()
	const config = createConfigStore(directory)
	await config.update(configuration)
	{
		using project = await Project.open(projectDir)
		const work = await project.read(projectFiles.work('v0001', workId))
		const { art } = chapterWorker(
			project,
			'v0001',
			work,
			await productionModels(config),
		)
		const jobs = await art().register(
			['room/day', 'bridge/day', 'garden/day'].map((id) => ({
				id,
				kind: 'location',
				description: 'Sunny',
			})),
			bible,
		)
		for (const job of jobs)
			await project.writeFile(
				`source/production/art/${job.assetId}.json`,
				JSON.stringify({ job }),
			)
		project.tasks.registerWork({ workId, title: work.title })
		const worker = new ScriptedWorker({ ch0001: jobs })
		worker.hold('draw:room/day')
		const scheduler = new ChapterScheduler(project.database, worker, {
			imageConcurrency: 1,
		})
		try {
			scheduler.start(workId, ['ch0001'])
			scheduler.confirmVisual(workId)
			await expect.poll(() => worker.count('draw:room/day')).toBe(1)
			scheduler.stop(workId)
			await scheduler.idle()
		} finally {
			scheduler.dispose()
		}
	}
	await createProduction(
		directory,
		config,
		undefined,
		() => {},
		() => {},
	).remember(workId, projectDir)

	const generation = 1
	const parent = new EventEmitter()
	const port = new EventEmitter()
	const parentPort = Object.getOwnPropertyDescriptor(process, 'parentPort')
	Object.defineProperty(process, 'parentPort', {
		configurable: true,
		value: {
			once: parent.once.bind(parent),
			postMessage: (frame: { type: string; active?: boolean }) =>
				parent.emit('frame', frame),
		},
	})
	const transport = Object.assign(port, {
		start() {},
		postMessage(frame: CreatorFrame) {
			port.emit('frame', frame)
		},
	})
	let requestId = 0
	async function call<K extends Command>(command: K, payload: CommandInput<K>) {
		const id = ++requestId
		const response = new Promise<CreatorFrame>((resolve) => {
			const receive = (frame: CreatorFrame) => {
				if (frame.type === 'event' || frame.requestId !== id) return
				port.off('frame', receive)
				resolve(frame)
			}
			port.on('frame', receive)
		})
		port.emit('message', {
			data: { type: 'call', generation, requestId: id, command, payload },
		})
		const frame = await response
		if (frame.type !== 'result') throw new Error(JSON.stringify(frame))
		return frame.result
	}
	const requests: string[] = []
	const oldDraw = Promise.withResolvers<void>()
	const newDraws = Promise.withResolvers<void>()
	const fetch: typeof globalThis.fetch = async (input, init) => {
		const request = new Request(input, init)
		if (!request.url.endsWith('/images/generations'))
			return completion({ content: 'Sunny' })
		const { model } = await request.json()
		requests.push(model)
		await (requests.length === 1 ? oldDraw.promise : newDraws.promise)
		return Response.json({ data: [{ b64_json: 'dGVzdA==' }] })
	}
	vi.stubEnv('NL_CREATOR_GENERATION', String(generation))
	vi.stubEnv('NL_CREATOR_DATA_DIR', directory)
	vi.stubGlobal('fetch', fetch)
	let connected = false
	try {
		await import('../../packages/creator/src/entry')
		const ready = once(parent, 'frame')
		parent.emit('message', { ports: [transport] })
		connected = true
		await ready
		await call('production.continue', { workId })
		await expect
			.poll(() => requests)
			.toEqual([configuration.models.image.model])
		await call('config.update', {
			models: { image: { model: 'fixture-updated-image', concurrency: 2 } },
		})
		oldDraw.resolve()
		await expect
			.poll(() => requests)
			.toEqual([
				configuration.models.image.model,
				'fixture-updated-image',
				'fixture-updated-image',
			])
		newDraws.resolve()
		await expect
			.poll(() => call('production.get', { workId }))
			.toMatchObject({ phase: 'confirm-first' })
	} finally {
		oldDraw.resolve()
		newDraws.resolve()
		if (connected) {
			const closed = once(parent, 'frame')
			port.emit('close')
			await closed
		}
		if (parentPort) Object.defineProperty(process, 'parentPort', parentPort)
		else Reflect.deleteProperty(process, 'parentPort')
		vi.unstubAllGlobals()
	}
})
