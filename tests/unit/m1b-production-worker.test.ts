import { EventEmitter, once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formatVersion, projectFiles } from '@novelive/format/model'
import sharp from 'sharp'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createConfigStore } from '../../packages/creator/src/config'
import type {
	Command,
	CommandInput,
	CreatorFrame,
} from '../../packages/creator/src/contract'
import { productionChapterRecordEvent } from '../../packages/creator/src/contract/production'
import { ProjectEditor } from '../../packages/creator/src/editor/history'
import { CreativeRevisions } from '../../packages/creator/src/editor/revisions'
import { importTxtProject } from '../../packages/creator/src/import/wizard'
import { Project } from '../../packages/creator/src/project'
import { createProduction } from '../../packages/creator/src/project/production'
import {
	chapterWorker,
	productionBible,
	productionModels,
} from '../../packages/creator/src/project/production-worker'
import { ChapterScheduler } from '../../packages/creator/src/scheduler/chapter'
import {
	chapterImageBudget,
	quoteSpend,
	requestedOutputTokens,
	SpendBudgetError,
} from '../../packages/creator/src/usage/spend'
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
		{ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } },
	]
	return new Response(
		`${lines.map((line) => `data: ${JSON.stringify(line)}\n\n`).join('')}data: [DONE]\n\n`,
		{
			headers: { 'content-type': 'text/event-stream' },
		},
	)
}

test('reopening a saved synthesis candidate omits invalid style images from the art Bible', async () => {
	const { projectDir, workId } = await fixture()
	using project = await Project.open(projectDir)
	const file = projectFiles.style({ level: 'series' })
	const style = {
		...bible.style,
		status: 'candidate' as const,
		references: [{ path: 'ch0001', description: 'Chapter, not an image' }],
	}
	await project.write(file, { formatVersion, entries: [style] })
	const saved = await project.read(file)
	const { art } = await productionBible(project, 'v0001', workId)
	expect(art.style).toMatchObject({
		id: style.id,
		description: style.description,
	})
	expect(art.style.references).toBeUndefined()
	expect(await project.read(file)).toEqual(saved)
})

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
	let painterOutput: unknown
	const fetch: typeof globalThis.fetch = async (input, init) => {
		const req = new Request(input, init)
		if (req.url.includes('/images/'))
			return Response.json({ data: [{ b64_json: 'dGVzdA==' }] })
		const body = await req.json()
		const { model } = body
		if (model === 'fixture-art-visual')
			painterOutput = requestedOutputTokens(req, body)
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
	expect(painterOutput).toBe(1024)
})

test('a painter format error after one repair materializes both base and variant placeholders before publication', async () => {
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
		expect(requests).toBe(2)
	} finally {
		queue.dispose()
	}
})

test('a later volume publishes with the reason from a reused series placeholder', async () => {
	vi.stubEnv('NL_RUN_ID', 'offline-placeholder')
	vi.stubEnv('NL_RUN_IMAGE_CAP', '5')
	const { projectDir, workId } = await fixture()
	using project = await Project.open(projectDir)
	const work = await project.read(projectFiles.work('v0001', workId))
	const config = createConfigStore(directory)
	await config.update(configuration)
	const models = await productionModels(config)
	const fetch = vi.fn<typeof globalThis.fetch>(async () =>
		completion({
			patch: 'PUT <4:\n@show ada/uniform/neutral center',
			items: [],
			merges: {},
		}),
	)
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
	const chapterId = laterWork.chapterIds[0]
	await project.write(
		projectFiles.chapter({
			volumeId: 'v0002',
			workId: laterWork.workId,
			chapterId,
		}),
		await project.read(
			projectFiles.chapter({ volumeId: 'v0001', workId, chapterId }),
		),
	)
	project.tasks.registerWork({
		workId: laterWork.workId,
		title: laterWork.title,
	})
	const { worker } = chapterWorker(project, 'v0002', laterWork, models, {
		fetch,
	})
	await project.writeFile(
		`source/production/${laterWork.chapterIds[0]}/draft.nvs`,
		'scene 纸船\nsource p0001\n\n: 暮色中，一只纸船从桥下漂过。\n',
	)
	const queue = new ChapterScheduler(project.database, {
		...worker,
		async write() {},
		async review() {},
	})
	try {
		queue.start(laterWork.workId, [laterWork.chapterIds[0]])
		queue.confirmVisual(laterWork.workId)
		await queue.idle()
		expect(queue.snapshot(laterWork.workId).chapters).toMatchObject([
			{ status: 'published', issue: `1 张图用了占位图；${issue}` },
		])
		expect(fetch).toHaveBeenCalledTimes(1)
		expect(String(fetch.mock.calls[0][1]?.body)).toContain(
			'Hard limit for this whole chapter: 0',
		)
	} finally {
		queue.dispose()
	}
})

test('staging queues only referenced images and their bases, including reused pending images', async () => {
	const { projectDir, workId } = await fixture()
	using project = await Project.open(projectDir)
	const work = await project.read(projectFiles.work('v0001', workId))
	const config = createConfigStore(directory)
	await config.update(configuration)
	let chapter = 0
	const fetch: typeof globalThis.fetch = async () =>
		completion({
			patch: 'PUT <4:\n@bg room/night',
			items:
				++chapter === 1
					? [
							{ id: 'room/night', kind: 'variant', description: 'Night' },
							{ id: 'cg-unused', kind: 'cg', description: 'Unreferenced' },
						]
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
	const dependencies = [
		{ assetId: 'room/night', baseAssetId: 'room/day' },
		{ assetId: 'room/day' },
	]
	expect(await worker.stage({ ...ctx, chapterId: first })).toMatchObject(
		dependencies,
	)
	expect((await art().registry()).entries).toMatchObject([
		{ id: 'room/day', status: 'pending' },
		{ id: 'room/night', status: 'pending' },
		{ id: 'cg-unused', status: 'pending' },
	])
	expect(await worker.stage({ ...ctx, chapterId: second })).toMatchObject(
		dependencies,
	)
})

test('resume replaces an oversized drawing queue with one bounded staging repair', async () => {
	const { projectDir, workId } = await fixture()
	using project = await Project.open(projectDir)
	const work = await project.read(projectFiles.work('v0001', workId))
	const config = createConfigStore(directory)
	await config.update(configuration)
	const chapterId = work.chapterIds[0]
	const draft = `source/production/${chapterId}/draft.nvs`
	const script = 'scene 纸船\nsource p0001\n\n: 暮色中，一只纸船从桥下漂过。\n'
	await project.writeFile(draft, script)
	const previous = new ScriptedWorker({
		[chapterId]: [
			{ assetId: 'cg-old-first', kind: 'cg' },
			{ assetId: 'cg-old-second', kind: 'cg' },
		],
	})
	const initial = new ChapterScheduler(project.database, previous, {
		imageConcurrency: 0,
	})
	project.tasks.registerWork({ workId, title: work.title })
	initial.start(workId, [chapterId])
	initial.confirmVisual(workId)
	await initial.idle()
	initial.dispose()
	expect(previous.calls).toEqual([
		`write:${chapterId}`,
		`review:${chapterId}`,
		`stage:${chapterId}`,
	])

	vi.stubEnv('NL_RUN_ID', 'offline-restage')
	vi.stubEnv('NL_RUN_IMAGE_CAP', '6')
	const prompts: string[] = []
	const { worker } = chapterWorker(
		project,
		'v0001',
		work,
		await productionModels(config),
		{
			fetch: async (_url, init) => {
				prompts.push(String(init?.body))
				return prompts.length === 1
					? completion({
							patch: 'PUT <4:\n@bg room/night',
							items: [
								{ id: 'room/night', kind: 'variant', description: 'Night' },
							],
							merges: {},
						})
					: completion({
							patch: 'PUT <4:\n@bg room/day',
							items: [
								{ id: 'room/day', kind: 'location', description: 'Day' },
								{ id: 'cg-unused', kind: 'cg', description: 'Not referenced' },
							],
							merges: {},
						})
			},
		},
	)
	const draws: string[] = []
	const resumed = new ChapterScheduler(
		project.database,
		{
			...worker,
			async write() {
				throw new Error('Writing redispatched')
			},
			async review() {
				throw new Error('Review redispatched')
			},
			async draw(job) {
				draws.push(job.assetId)
				return { status: 'drawn' }
			},
		},
		{ imageBudget: (id) => chapterImageBudget(project.database, id) },
	)
	try {
		resumed.continue(workId)
		await resumed.idle()
		expect(prompts).toHaveLength(2)
		expect(prompts[0]).toContain('Hard limit for this whole chapter: 1')
		expect(prompts[1]).toContain(
			'Chapter needs 2 new provider images; budget is 1. Over-budget assets: room/day',
		)
		expect(draws).toEqual(['room/day'])
		expect(resumed.snapshot(workId).chapters).toMatchObject([
			{ status: 'published' },
		])
		expect((await project.readFile(draft)).toString()).toBe(script)
		expect(
			project.database
				.prepare("SELECT ref_id FROM task WHERE kind = 'image'")
				.all(),
		).toEqual([{ ref_id: 'room/day' }])
	} finally {
		resumed.dispose()
	}
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
	vi.stubEnv('NL_RUN_TOKEN_CAP', '2000000')
	vi.stubEnv('NL_RUN_IMAGE_CAP', '50')
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

test.each([
	{ scenario: 'unchanged setting' },
	{ scenario: 'changed setting', redraw: true },
	{ scenario: 'review rejected', reject: true },
	{ scenario: 'first image blocked', firstImage: true },
	{ scenario: 'local image check failed', localRejection: true },
])(
	'recording resumes an image budget pause: $scenario',
	async ({ redraw, reject, firstImage, localRejection }) => {
		const { projectDir, workId } = await fixture()
		const config = createConfigStore(directory)
		await config.update(configuration)
		const models = await productionModels(config)
		if (reject || localRejection) models.image = { ...models.image, retries: 1 }
		const assetId = 'room/day'
		const requests: string[] = []
		const painterPrompts: string[] = []
		const imagePrompts: string[] = []
		let allowReview = firstImage === true
		let rejectReview = reject
		let blockImage = firstImage === true
		let blockRewrite = false
		const open = async () => {
			const project = await Project.open(projectDir)
			const work = await project.read(projectFiles.work('v0001', workId))
			const { worker, art } = chapterWorker(project, 'v0001', work, models, {
				mode: 'record',
				directory: join(directory, 'cassettes'),
				async spend(request, send) {
					if (blockImage && request.url.endsWith('/images/generations'))
						throw new SpendBudgetError('超出工程预算')
					if (request.url.endsWith('/chat/completions')) {
						const { model } = await request.clone().json()
						if (
							(model === models.visual.model && !allowReview) ||
							(model === models.main.model && blockRewrite)
						)
							throw new SpendBudgetError('超出工程预算')
					}
					return send(request, await quoteSpend(request))
				},
				async fetch(input, init) {
					const request = new Request(input, init)
					const body = await request.json()
					requests.push(body.model)
					if (body.model === models.main.model)
						painterPrompts.push(JSON.stringify(body.messages))
					if (request.url.endsWith('/images/generations')) {
						imagePrompts.push(body.prompt)
						if (localRejection && imagePrompts.length === 1) {
							blockRewrite = true
							return Response.json({
								data: [
									{ b64_json: Buffer.from('not a PNG').toString('base64') },
								],
							})
						}
						const png = await sharp({
							create: { width: 64, height: 36, channels: 3, background: 'red' },
						})
							.png()
							.toBuffer()
						return Response.json({
							data: [{ b64_json: png.toString('base64') }],
						})
					}
					if (body.model === models.visual.model && rejectReview) {
						rejectReview = false
						blockImage = true
						return completion({
							pass: false,
							failedChecks: ['description'],
							feedback: 'Move the window to the center.',
						})
					}
					return body.model === models.visual.model
						? completion({ pass: true, failedChecks: [], feedback: '' })
						: completion({
								content:
									localRejection && painterPrompts.length > 1
										? 'A bright room with clear edges.'
										: 'A sunny room.',
							})
				},
			})
			const queue = new ChapterScheduler(project.database, {
				...worker,
				write: async () => {},
				review: async () => {},
				stage: async () => [{ assetId, kind: 'location' }],
			})
			return { project, queue, art }
		}
		{
			const { project, queue, art } = await open()
			try {
				const location = projectFiles.location({ level: 'series' }, 'room')
				await project.write(location, {
					formatVersion,
					entries: [...bible.locations],
				})
				const [job] = await art().register(
					[{ id: assetId, kind: 'location', description: 'Room in sunlight' }],
					bible,
				)
				await project.writeFile(
					`source/production/art/${job.assetId}.json`,
					JSON.stringify({ job }),
				)
				project.tasks.registerWork({ workId, title: 'Paper boat' })
				queue.start(workId, ['ch0001'])
				queue.confirmVisual(workId)
				await queue.idle()
				expect(queue.snapshot(workId).chapters[0].issue).toMatch(/超出工程预算/)
				expect(requests).toEqual([
					models.main.model,
					...(firstImage ? [] : [models.image.model]),
				])
				if (redraw)
					await project.write(location, {
						formatVersion,
						entries: [
							{ ...bible.locations[0], description: 'A moonlit observatory' },
						],
					})
			} finally {
				queue.dispose()
				project.close()
			}
		}
		allowReview = true
		blockImage = false
		blockRewrite = false
		if (reject) {
			const { project, queue } = await open()
			try {
				queue.continue(workId)
				await queue.idle()
				expect(queue.snapshot(workId).chapters[0].issue).toMatch(/超出工程预算/)
				expect(requests).toEqual([
					models.main.model,
					models.image.model,
					models.visual.model,
					models.main.model,
				])
				expect(painterPrompts.at(-1)).toContain(
					'Move the window to the center.',
				)
			} finally {
				queue.dispose()
				project.close()
			}
			blockImage = false
		}
		const { project, queue } = await open()
		try {
			queue.continue(workId)
			await queue.idle()
			expect(requests).toEqual([
				models.main.model,
				models.image.model,
				...(redraw || localRejection
					? [models.main.model, models.image.model]
					: []),
				...(reject
					? [models.visual.model, models.main.model, models.image.model]
					: []),
				models.visual.model,
			])
			if (redraw)
				expect(painterPrompts.at(-1)).toContain('A moonlit observatory')
			if (localRejection) {
				expect(painterPrompts.at(-1)).toContain('图片无法解码。')
				expect(imagePrompts.at(-1)).toContain('A bright room with clear edges.')
			}
			if (reject)
				expect(imagePrompts.at(-1)).toContain('Move the window to the center.')
			expect(queue.snapshot(workId).chapters[0].status).toBe('published')
		} finally {
			queue.dispose()
			project.close()
		}
	},
)

async function verifyFreshCandidates(returnUrl: boolean) {
	vi.stubEnv('NL_RUN_TOKEN_CAP', '2000000')
	vi.stubEnv('NL_RUN_IMAGE_CAP', '50')
	const { projectDir, workId } = await fixture()
	const config = createConfigStore(directory)
	await config.update(configuration)
	const assetId = 'room/day'
	{
		using project = await Project.open(projectDir)
		const work = await project.read(projectFiles.work('v0001', workId))
		const { art } = chapterWorker(
			project,
			'v0001',
			work,
			await productionModels(config),
		)
		const [job] = await art().register(
			[{ id: assetId, kind: 'location', description: 'Room in sunlight' }],
			bible,
		)
		await project.writeFile(
			`source/production/art/${job.assetId}.json`,
			JSON.stringify({ job }),
		)
		project.tasks.registerWork({ workId, title: 'Paper boat' })
		const queue = new ChapterScheduler(project.database, new ScriptedWorker())
		try {
			queue.start(workId, ['ch0001'])
			queue.confirmVisual(workId)
			queue.stop(workId)
			await queue.idle()
		} finally {
			queue.dispose()
		}
	}
	const images: unknown[] = []
	const textModels: string[] = []
	const downloads: string[] = []
	const url = new URL('/candidate.png', configuration.models.image.baseUrl).href
	const candidatePng = () =>
		sharp({
			create: {
				width: 64,
				height: 36,
				channels: 3,
				background: ['red', 'blue', 'red', 'yellow'][images.length - 1],
			},
		})
			.png()
			.toBuffer()
	const fetch: typeof globalThis.fetch = async (input, init) => {
		const request = new Request(input, init)
		if (request.url === url && request.method === 'GET') {
			downloads.push(request.url)
			return new Response(new Uint8Array(await candidatePng()), {
				headers: { 'content-type': 'image/png' },
			})
		}
		if (!request.url.endsWith('/images/generations')) {
			const { model } = await request.json()
			textModels.push(model)
			return model === configuration.models.visual.model
				? completion({ pass: true, failedChecks: [], feedback: '' })
				: completion({ content: 'A sunny room.' })
		}
		images.push(await request.json())
		if (returnUrl) return Response.json({ data: [{ url }] })
		const png = await candidatePng()
		return Response.json({ data: [{ b64_json: png.toString('base64') }] })
	}
	const recorded = join(directory, 'cassettes')
	const regenerate = async (target: string, fallbackDirectory?: string) => {
		const production = createProduction(
			directory,
			config,
			{
				mode: 'record',
				directory: target,
				fallbackDirectory,
				reuseRecorded: true,
				fetch,
			},
			() => {},
			() => {},
		)
		try {
			await production.remember(workId, projectDir)
			const session = await production.get(workId)
			const revisions = new CreativeRevisions(
				session.project,
				workId,
				new ProjectEditor(session.project, 'v0001', workId),
				session,
			)
			const result = await revisions.regenerateImage({
				workId,
				assetId,
				expectedRevision: await revisions.imageRevision(assetId),
				count: 2,
			})
			if (result.status !== 'candidates') throw new Error('Expected candidates')
			return await Promise.all(
				result.candidates.map(({ cachePath }) =>
					session.project.readFile(cachePath),
				),
			)
		} finally {
			await production.close()
		}
	}
	const [first, second] = await regenerate(recorded)
	expect(images).toHaveLength(2)
	expect(images[1]).toEqual(images[0])
	expect(first.equals(second)).toBe(false)
	expect(textModels).toEqual([
		configuration.models.main.model,
		configuration.models.visual.model,
		configuration.models.main.model,
		configuration.models.visual.model,
	])
	const [third, fourth] = await regenerate(join(directory, 'fresh'), recorded)
	expect(images).toHaveLength(4)
	if (returnUrl) expect(downloads).toEqual([url, url, url, url])
	expect(images.slice(2)).toEqual(images.slice(0, 2))
	expect(third.equals(first)).toBe(true)
	expect(third.equals(fourth)).toBe(false)
	expect(textModels.slice(4)).toEqual([configuration.models.visual.model])
}

test('recording dispatches identical image requests for distinct editor candidates', async () => {
	await verifyFreshCandidates(false)
})

test('recording downloads fresh candidate bytes when generation returns the same URL', async () => {
	await verifyFreshCandidates(true)
})

test('production records to NL_CASSETTE_DIR when no production directory is set', async () => {
	vi.stubEnv('NL_RUN_TOKEN_CAP', '2000000')
	vi.stubEnv('NL_RUN_IMAGE_CAP', '50')
	const cassette = join(directory, 'general-cassette')
	vi.stubEnv('NL_CASSETTE_DIR', cassette)
	const { projectDir, workId } = await fixture()
	const config = createConfigStore(directory)
	await config.update(configuration)
	const fetch = vi
		.fn<typeof globalThis.fetch>()
		.mockImplementation(async () =>
			Response.json(
				{ error: { message: 'Fixture request rejected' } },
				{ status: 400 },
			),
		)
	const production = createProduction(
		directory,
		config,
		{ mode: 'record', fetch },
		() => {},
		() => {},
	)
	try {
		await production.remember(workId, projectDir)
		await expect(production.get(workId)).rejects.toMatchObject({
			code: 'invalid_config',
		})
		expect(fetch).toHaveBeenCalled()
		const rows = (await readFile(join(cassette, 'cassette.jsonl'), 'utf8'))
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line))
		expect(rows).toMatchObject([{ status: 400, path: '/v1/chat/completions' }])
	} finally {
		await production.close()
	}
})

test('production refuses over-cap background preparation before the provider fetch', async () => {
	vi.stubEnv('NL_RUN_TOKEN_CAP', '0')
	vi.stubEnv('NL_RUN_IMAGE_CAP', '50')
	const ledger = join(directory, 'usage.csv')
	vi.stubEnv('NL_USAGE_CSV', ledger)
	const { projectDir, workId } = await fixture()
	const config = createConfigStore(directory)
	await config.update(configuration)
	const fetch = vi
		.fn<typeof globalThis.fetch>()
		.mockRejectedValue(new Error('The provider must not be called'))
	const production = createProduction(
		directory,
		config,
		{ mode: 'record', directory: join(directory, 'cassettes'), fetch },
		() => {},
		() => {},
	)
	try {
		await production.remember(workId, projectDir)
		await expect(production.get(workId)).rejects.toMatchObject({
			code: 'invalid_config',
			message: expect.stringContaining('超出工程预算'),
		})
		expect(fetch).not.toHaveBeenCalled()
		await expect(readFile(ledger)).rejects.toMatchObject({ code: 'ENOENT' })
	} finally {
		await production.close()
	}
})

test('creator config.update applies the new image model and concurrency to queued draws', async () => {
	vi.stubEnv('NL_RUN_TOKEN_CAP', '2000000')
	vi.stubEnv('NL_RUN_IMAGE_CAP', '50')
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
