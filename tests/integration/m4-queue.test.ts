import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compile } from '@earendil-works/pi-schema'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createConfigStore } from '../../packages/creator/src/config'
import type { EventEnvelope } from '../../packages/creator/src/contract'
import { productionQueueSchema } from '../../packages/creator/src/contract/queue'
import { Project } from '../../packages/creator/src/project'
import { createProduction } from '../../packages/creator/src/project/production'
import { ChapterScheduler } from '../../packages/creator/src/scheduler/chapter'
import { projectFiles } from '../../packages/format/src/model'
import { ref, series, work } from '../fixtures/project-schema/seed'
import { ScriptedWorker } from '../fixtures/scheduler/m1b/worker'

const workers = new Map<string, ScriptedWorker>()
vi.mock('../../packages/creator/src/project/production-worker', () => ({
	productionModels: async () => ({ image: { concurrency: 1 } }),
	chapterWorker: (_project: Project, _volumeId: string, item: typeof work) => ({
		art: () => ({}),
		worker: workers.get(item.workId),
		setModels: () => {},
	}),
}))

type Production = ReturnType<typeof createProduction>
const validateQueue = compile(productionQueueSchema)
const chapterIds = ['ch1', 'ch2', 'ch3']
let profile: string
let hosts: Production[]
let events: EventEnvelope[]

beforeEach(async () => {
	profile = await mkdtemp(join(tmpdir(), 'novelive-work-queue-'))
	hosts = []
	events = []
})

afterEach(async () => {
	for (const host of hosts) await host.close()
	workers.clear()
	await rm(profile, { recursive: true, force: true })
})

function openProduction() {
	const host = createProduction(
		profile,
		createConfigStore(profile),
		undefined,
		(event) => events.push(event),
		() => {},
	)
	hosts.push(host)
	return host
}

async function seed(
	host: Production,
	title: string,
	{
		beforeFirst = false,
		sharedRoot,
	}: { beforeFirst?: boolean; sharedRoot?: string } = {},
) {
	const workId = randomUUID()
	const root = sharedRoot ?? join(profile, workId)
	const volumeId = ref.volumeId
	using project = sharedRoot
		? await Project.open(sharedRoot)
		: await Project.create(root, { ...series, seriesId: title })
	const volumeFile = projectFiles.volume(volumeId)
	const previous = sharedRoot ? (await project.read(volumeFile)).workIds : []
	await project.write(volumeFile, {
		formatVersion: work.formatVersion,
		volumeId,
		title,
		workIds: [...previous, workId],
	})
	await project.write(projectFiles.work(volumeId, workId), {
		...work,
		title,
		workId,
		chapterIds,
	})
	for (const chapterId of chapterIds) {
		await project.write(projectFiles.chapter({ workId, volumeId, chapterId }), {
			formatVersion: work.formatVersion,
			chapterId,
			title: chapterId,
			paragraphIds: ['p0001'],
			sceneIds: [],
			cg: [],
		})
	}
	project.tasks.registerWork({ workId, title })
	const bootstrap = new ScriptedWorker()
	if (beforeFirst) bootstrap.hold('write:ch1')
	const scheduler = new ChapterScheduler(project.database, bootstrap)
	scheduler.start(workId, chapterIds)
	scheduler.confirmVisual(workId)
	if (beforeFirst) scheduler.stop(workId)
	await scheduler.idle()
	scheduler.dispose()
	await host.remember(workId, root)
	const worker = new ScriptedWorker()
	workers.set(workId, worker)
	return { root, workId, worker }
}

async function queueState(host: Production) {
	const queue = await host.getQueue()
	expect(validateQueue.validate(queue).ok).toBe(true)
	return {
		owner: queue.active?.title,
		order: queue.queued.map(({ title }) => title),
		inactive: Object.fromEntries(
			queue.inactive.map((item) => [
				item.title,
				item.status === 'done' ? 'done' : item.reason,
			]),
		),
	}
}

test('confirmation yields the slot, and confirming again goes to the head without preemption', async () => {
	const host = openProduction()
	const a = await seed(host, 'alpha', { beforeFirst: true })
	const b = await seed(host, 'beta', { sharedRoot: a.root })
	const first = await host.get(a.workId)
	a.worker.hold('write:ch1')
	b.worker.hold('write:ch2')
	try {
		await first.continue()
		// Opening a sibling after production starts cannot recover or pause the active work.
		const second = await host.get(b.workId)
		await second.continue()
		expect(await queueState(host)).toEqual({
			owner: 'alpha',
			order: ['beta'],
			inactive: {},
		})
		expect(b.worker.calls).toEqual([])
		a.worker.release('write:ch1')
		await vi.waitFor(async () =>
			expect(await queueState(host)).toEqual({
				owner: 'beta',
				order: [],
				inactive: { alpha: 'confirm_first' },
			}),
		)
		await first.continue()
		expect(await queueState(host)).toMatchObject({
			owner: 'beta',
			order: ['alpha'],
		})
		expect(a.worker.calls).not.toContain('write:ch2')
		expect(b.worker.aborted).toEqual([])
		b.worker.release('write:ch2')
		await vi.waitFor(async () =>
			expect(await queueState(host)).toEqual({
				owner: undefined,
				order: [],
				inactive: { alpha: 'done', beta: 'done' },
			}),
		)
	} finally {
		a.worker.release('write:ch1')
		b.worker.release('write:ch2')
	}
})

test('only queued entries are reordered, and chapter priority does not take the slot', async () => {
	const host = openProduction()
	const a = await seed(host, 'alpha')
	const b = await seed(host, 'beta')
	const c = await seed(host, 'gamma')
	const first = await host.get(a.workId)
	const second = await host.get(b.workId)
	const third = await host.get(c.workId)
	a.worker.hold('write:ch2')
	b.worker.hold('write:ch3')
	c.worker.hold('write:ch2')
	try {
		await first.continue()
		await second.continue()
		await third.continue()
		expect(await queueState(host)).toMatchObject({
			owner: 'alpha',
			order: ['gamma', 'beta'],
		})
		await host.moveQueueWork(a.workId, 1)
		expect(await queueState(host)).toMatchObject({
			owner: 'alpha',
			order: ['gamma', 'beta'],
		})
		await host.moveQueueWork(b.workId, -1)
		second.queue.prioritizeChapter(b.workId, 'ch3')
		expect(await queueState(host)).toMatchObject({
			owner: 'alpha',
			order: ['beta', 'gamma'],
		})
		expect(b.worker.calls).toEqual([])
		first.queue.stop(a.workId)
		await vi.waitFor(async () =>
			expect(await queueState(host)).toEqual({
				owner: 'beta',
				order: ['gamma'],
				inactive: { alpha: 'stopped' },
			}),
		)
		expect(a.worker.aborted).toEqual(['write:ch2'])
		expect(b.worker.calls).toEqual(['write:ch3'])
		expect(b.worker.links.get('ch3')).toBe('preview-summary')
		expect(c.worker.calls).toEqual([])
		b.worker.release('write:ch3')
		await vi.waitFor(async () =>
			expect((await queueState(host)).owner).toBe('gamma'),
		)
		c.worker.release('write:ch2')
		await third.queue.idle()
		a.worker.release('write:ch2')
		await first.continue()
		await vi.waitFor(async () =>
			expect((await queueState(host)).inactive.alpha).toBe('done'),
		)
		expect(a.worker.count('write:ch2')).toBe(2)
		expect(a.worker.calls).not.toContain('write:ch1')
	} finally {
		a.worker.release('write:ch2')
		b.worker.release('write:ch3')
		c.worker.release('write:ch2')
	}
})

test('a resumed work draining a stopped request cannot jump the queue', async () => {
	const host = openProduction()
	const a = await seed(host, 'alpha')
	const b = await seed(host, 'beta')
	const first = await host.get(a.workId)
	const second = await host.get(b.workId)
	const drain = Promise.withResolvers<void>()
	const write = a.worker.write.bind(a.worker)
	a.worker.write = async (context) => {
		try {
			await write(context)
		} catch (reason) {
			await drain.promise
			throw reason
		}
	}
	a.worker.hold('write:ch2')
	b.worker.hold('write:ch2')
	try {
		await first.continue()
		await second.continue()
		first.queue.stop(a.workId)
		await first.continue()
		await host.moveQueueWork(a.workId, 1)
		expect(await queueState(host)).toMatchObject({
			owner: undefined,
			order: ['beta', 'alpha'],
		})
		drain.resolve()
		await vi.waitFor(async () =>
			expect(await queueState(host)).toMatchObject({
				owner: 'beta',
				order: ['alpha'],
			}),
		)
		expect(a.worker.count('write:ch2')).toBe(1)
	} finally {
		drain.resolve()
		a.worker.release('write:ch2')
		b.worker.release('write:ch2')
	}
})

const crashScript = `
	import { createServer } from 'vite'
	const server = await createServer({
		configFile: false,
		server: { middlewareMode: true, ws: false, watch: null },
	})
	const { Project } = await server.ssrLoadModule('/packages/creator/src/project/index.ts')
	const { ChapterScheduler } = await server.ssrLoadModule('/packages/creator/src/scheduler/chapter/index.ts')
	const { ScriptedWorker } = await server.ssrLoadModule('/tests/fixtures/scheduler/m1b/worker.ts')
	const [activeDir, activeId, queuedDir, queuedId] = process.argv.slice(1)
	const active = await Project.open(activeDir)
	const queued = await Project.open(queuedDir)
	const worker = new ScriptedWorker()
	worker.hold('review:ch2')
	const scheduler = new ChapterScheduler(active.database, worker)
	const waiting = new ChapterScheduler(queued.database, new ScriptedWorker(), {
		slot: { workId: queuedId, granted: () => false, enqueueFirst: () => {} },
	})
	scheduler.continue(activeId)
	waiting.continue(queuedId)
	while (!worker.calls.includes('review:ch2')) {
		await new Promise((resolve) => setTimeout(resolve, 5))
	}
	process.send('running')
	setInterval(() => {}, 1000)
`

test('real process death preserves checkpoints and pauses active and queued work until explicitly resumed', async () => {
	const original = openProduction()
	const a = await seed(original, 'alpha')
	const b = await seed(original, 'beta')
	await seed(original, 'gamma')
	const child = spawn(
		process.execPath,
		[
			'--input-type=module',
			'-e',
			crashScript,
			a.root,
			a.workId,
			b.root,
			b.workId,
		],
		{ stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
	)
	let stderr = ''
	child.stderr?.setEncoding('utf8').on('data', (chunk) => {
		stderr += chunk
	})
	const exited = once(child, 'exit')
	try {
		await Promise.race([
			once(child, 'message', { signal: AbortSignal.timeout(10000) }),
			exited.then(() => {
				throw new Error(
					`Crash fixture exited before reaching the checkpoint: ${stderr}`,
				)
			}),
		])
	} finally {
		child.kill('SIGKILL')
		await exited
	}

	const host = openProduction()
	expect(await queueState(host)).toEqual({
		owner: undefined,
		order: [],
		inactive: { alpha: 'crashed', beta: 'crashed', gamma: 'confirm_first' },
	})
	const first = await host.get(a.workId)
	expect(
		first.queue.runLog(a.workId).find(({ status }) => status === 'interrupted'),
	).toMatchObject({
		ref: 'ch2',
		steps: [
			{ purpose: 'write', status: 'completed' },
			{ purpose: 'review', status: 'cancelled' },
		],
	})
	expect(a.worker.calls).toEqual([])
	expect(b.worker.calls).toEqual([])
	expect(first.snapshot().status).toBe('stopped')
	await first.continue()
	await vi.waitFor(async () =>
		expect((await queueState(host)).inactive.alpha).toBe('done'),
	)
	expect(a.worker.calls).not.toContain('write:ch2')
	expect(a.worker.calls[0]).toBe('review:ch2')
	expect(b.worker.calls).toEqual([])
	expect((await queueState(host)).inactive.beta).toBe('crashed')
	const records = events.filter(
		({ event, scopeId }) =>
			event.type === 'production.chapterRecord' && scopeId === a.workId,
	)
	expect(records.map(({ event }) => event.payload)).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				chapterId: 'ch2',
				step: 'review',
				status: 'cancelled',
			}),
			expect.objectContaining({
				chapterId: 'ch2',
				step: 'review',
				status: 'done',
			}),
		]),
	)
}, 15000)
