import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createConfigStore } from '../../packages/creator/src/config'
import type { EventEnvelope } from '../../packages/creator/src/contract'
import { importFileProject } from '../../packages/creator/src/import/wizard'
import { Project } from '../../packages/creator/src/project'
import { createProduction } from '../../packages/creator/src/project/production'
import { projectFiles, type Work } from '../../packages/format/src/model'
import { connection } from '../fixtures/cassettes/m1a-synthesis/fixture'
import { ScriptedWorker } from '../fixtures/scheduler/m1b/worker'

const workers = new Map<string, ScriptedWorker>()
const candidates = vi.fn()
const approvedStyle = {
	id: 'style',
	status: 'confirmed' as const,
	description: 'Approved',
	references: [
		{ path: 'assets/style/main-visual.webp', description: 'Main visual' },
	],
}
const approveVisual = vi.fn(
	async (_project: Project, _volumeId: string) => approvedStyle,
)
vi.mock('../../packages/creator/src/project/production-worker', () => ({
	productionModels: async () => ({
		organizer: connection,
		director: connection,
		image: { concurrency: 1 },
	}),
	productionBible: async () => ({
		art: {
			style: { id: 'style', status: 'candidate', description: 'Candidate' },
			characters: [],
		},
	}),
	chapterWorker: (project: Project, _volumeId: string, work: Work) => ({
		art: () => ({
			candidates: async () => {
				candidates(work.workId)
				await project.writeFile(
					'assets/candidate.png',
					new Uint8Array([1, 2, 3]),
				)
				return {
					mainVisuals: ['one', 'two', 'three'].map((id) => ({
						id,
						cachePath: 'assets/candidate.png',
					})),
					characters: [],
					supplemental: [],
				}
			},
			confirmVisual: async () => approveVisual(project, _volumeId),
		}),
		worker: workers.get(work.workId),
		setModels: () => {},
	}),
}))

let root: string
let hosts: ReturnType<typeof createProduction>[]
let requests: string[]
let events: EventEnvelope[]
let hostBusy: Map<ReturnType<typeof createProduction>, boolean>
let laterEntered: ReturnType<typeof Promise.withResolvers<void>>
let laterRelease: ReturnType<typeof Promise.withResolvers<void>> | undefined

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'novelive-series-production-'))
	hosts = []
	requests = []
	events = []
	hostBusy = new Map()
	laterEntered = Promise.withResolvers<void>()
	laterRelease = undefined
	candidates.mockClear()
	approveVisual.mockReset()
})
afterEach(async () => {
	laterRelease?.resolve()
	for (const worker of workers.values()) {
		worker.release('write:ch0001')
		worker.release('write:ch0003')
	}
	for (const host of hosts) await host.close()
	workers.clear()
	await rm(root, { recursive: true, force: true })
})

function sse(content: unknown) {
	return new Response(
		`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: JSON.stringify(content) }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
		{ headers: { 'content-type': 'text/event-stream' } },
	)
}
const synthetic: typeof fetch = async (input, init) => {
	const body = await new Request(input, init).json()
	const prompt = body.messages[0].content as string
	requests.push(prompt)
	if (prompt.startsWith('Preview fiction')) {
		if (prompt.includes('后卷')) {
			laterEntered.resolve()
			await laterRelease?.promise
		}
		return sse({
			summary: 'Arrival',
			characters: [],
			locations: [],
			timelineNotes: [],
			foreshadowingHints: [],
		})
	}
	if (prompt.startsWith('Summarize volume'))
		return sse({ summary: 'Earlier digest' })
	const ids = prompt.includes('ch0003')
		? ['ch0003', 'ch0004']
		: ['ch0001', 'ch0002']
	return sse({
		overview: 'Arrival',
		chapters: ids.map((chapterId) => ({ chapterId, progress: 'Arrived' })),
		biblePatch: [],
		glossaryPatch: [],
	})
}
function production() {
	const host = createProduction(
		join(root, 'profile'),
		createConfigStore(join(root, 'profile')),
		{ mode: 'record', directory: join(root, 'cassettes'), fetch: synthetic },
		(event) => events.push(event),
		(value) => hostBusy.set(host, value),
	)
	hosts.push(host)
	return host
}
async function seed() {
	const sourcePath = join(root, 'book.txt')
	await writeFile(
		sourcePath,
		'第一卷 出发\n第一章 门\n她推开了门。\n第二章 路\n她走过山路。\n第二卷 归来\n第三章 后卷\n后卷的风吹起。\n第四章 后卷\n后卷的灯亮了。',
	)
	const imported = await importFileProject({
		sourcePath,
		folder: root,
		title: '系列',
		references: [],
		encoding: 'utf-8',
	})
	if (imported.status !== 'ready') throw new Error('Expected ready')
	for (const id of imported.workIds) workers.set(id, new ScriptedWorker())
	return imported
}

test('onReady offers works before later synthesis, shares concurrent preparation, yields confirmation slots and resumes persisted volumes', async () => {
	const book = await seed()
	expect(book.workIds).toHaveLength(2)
	const host = production()
	for (const id of book.workIds) await host.remember(id, book.projectDir)
	laterRelease = Promise.withResolvers<void>()
	const [a, b] = book.workIds
	const firstWorker = workers.get(a)
	const secondWorker = workers.get(b)
	if (!firstWorker || !secondWorker) throw new Error('Missing fixture worker')
	firstWorker.hold('write:ch0001')
	secondWorker.hold('write:ch0003')
	const first = host.get(a)
	const duplicate = host.get(a)
	const later = host.get(b)
	let laterReady = false
	void later.then(
		() => {
			laterReady = true
		},
		() => {},
	)
	await laterEntered.promise
	const initial = await first
	expect(await duplicate).toBe(initial)
	expect(laterReady).toBe(false)
	expect(
		(await host.getQueue()).inactive.map((item) => item.link.workId),
	).toEqual([a])
	await initial.confirm({
		workId: a,
		mainVisualId: 'one',
		supplementalIds: [],
		characters: [],
	})
	await vi.waitFor(async () =>
		expect((await host.getQueue()).active?.link.workId).toBe(a),
	)
	expect(laterReady).toBe(false)
	laterRelease.resolve()
	const second = await later
	expect(second.snapshot().visual).toBeNull()
	expect(
		(await host.getQueue()).queued.map((item) => item.link.workId),
	).toEqual([b])
	firstWorker.release('write:ch0001')
	await vi.waitFor(async () =>
		expect((await host.getQueue()).active?.link.workId).toBe(b),
	)
	expect((await host.getQueue()).inactive).toMatchObject([
		{ link: { workId: a }, reason: 'confirm_first' },
	])
	await initial.continue()
	expect(
		(await host.getQueue()).queued.map((item) => item.link.workId),
	).toEqual([a])
	expect(firstWorker.count('write:ch0002')).toBe(0)
	expect(secondWorker.aborted).toEqual([])
	secondWorker.release('write:ch0003')
	await vi.waitFor(async () =>
		expect(
			(await host.getQueue()).inactive.some(
				(item) => item.link.workId === a && item.status === 'done',
			),
		).toBe(true),
	)
	await second.continue()
	await vi.waitFor(async () =>
		expect(
			(await host.getQueue()).inactive.every((item) => item.status === 'done'),
		).toBe(true),
	)
	expect(candidates.mock.calls.map(([id]) => id)).toEqual([a])
	expect(
		requests.filter((prompt) => prompt.startsWith('Synthesize the ordered')),
	).toHaveLength(2)
	expect(
		events.some(
			(event) =>
				event.scope === 'app' && event.event.type === 'production.queue',
		),
	).toBe(true)
	await host.close()
	hosts.splice(hosts.indexOf(host), 1)
	const count = requests.length
	const restarted = production()
	await restarted.get(a)
	await restarted.get(b)
	await vi.waitFor(() => expect(hostBusy.get(restarted)).toBe(false))
	expect((await restarted.getQueue()).inactive).toHaveLength(2)
	expect(requests).toHaveLength(count)
})

test('opening the first work prepares each volume in its own work language', async () => {
	const book = await seed()
	using project = await Project.open(book.projectDir)
	const series = await project.read(projectFiles.series)
	const path = projectFiles.work(series.volumeIds[1], book.workIds[1])
	await project.write(path, { ...(await project.read(path)), language: 'ja' })
	const host = production()
	for (const id of book.workIds) await host.remember(id, book.projectDir)
	await host.get(book.workIds[0])
	await laterEntered.promise
	await vi.waitFor(() =>
		expect(
			requests.filter((prompt) => prompt.startsWith('Synthesize the ordered')),
		).toHaveLength(2),
	)
	const previews = requests.filter((prompt) =>
		prompt.startsWith('Preview fiction'),
	)
	expect(
		previews.filter((prompt) => prompt.startsWith('Preview fiction in zh-CN.')),
	).toHaveLength(2)
	expect(
		previews.filter((prompt) => prompt.startsWith('Preview fiction in ja.')),
	).toHaveLength(2)
	expect(
		requests
			.filter((prompt) => prompt.startsWith('Synthesize the ordered'))
			.map((prompt) => prompt.split('.')[0]),
	).toEqual([
		'Synthesize the ordered chapter previews in zh-CN',
		'Synthesize the ordered chapter previews in ja',
	])
})

test.each([true, false])(
	'legacy approved artwork is inherited without replacing it (confirmation enabled: %s)',
	async (confirmWithReferences) => {
		const book = await seed()
		using project = await Project.open(book.projectDir)
		const series = await project.read(projectFiles.series)
		const laterVolume = series.volumeIds[1]
		const id = book.workIds[1]
		const workFile = projectFiles.work(laterVolume, id)
		const work = await project.read(workFile)
		await project.write(workFile, {
			...work,
			settings: { ...work.settings, confirmWithReferences },
		})
		const wizard = projectFiles.importReport
		const report = {
			...(await project.read(wizard)),
			references: ['source/reference.png'],
		}
		await project.write(wizard, report)
		await project.write(projectFiles.style({ level: 'series' }), {
			formatVersion: 1,
			entries: [
				{
					id: 'style',
					status: 'confirmed',
					description: 'Approved',
					references: [
						{
							path: 'assets/style/main-visual.webp',
							description: 'Main visual',
						},
					],
				},
			],
		})
		const artwork = new Uint8Array([1, 2, 3])
		await project.writeFile('assets/style/main-visual.webp', artwork)
		const worker = workers.get(id)
		if (!worker) throw new Error('Missing fixture worker')
		worker.hold('write:ch0003')
		const host = production()
		await host.remember(id, book.projectDir)
		const session = await host.get(id)
		expect(session.snapshot().visual).toBeNull()
		await vi.waitFor(() => expect(worker.count('write:ch0003')).toBe(1))
		expect(candidates.mock.calls.some(([workId]) => workId === id)).toBe(false)
		expect(approveVisual).not.toHaveBeenCalled()
		expect(await project.readFile('assets/style/main-visual.webp')).toEqual(
			Buffer.from(artwork),
		)
	},
)

test('a sequel cannot open a visual gate before the first volume and inherits the approved style after restart', async () => {
	const book = await seed()
	const host = production()
	for (const id of book.workIds) await host.remember(id, book.projectDir)
	let laterReady = false
	const later = host.get(book.workIds[1])
	void later.then(
		() => {
			laterReady = true
		},
		() => {},
	)
	const first = await host.get(book.workIds[0])
	await laterEntered.promise
	await vi.waitFor(() => expect(hostBusy.get(host)).toBe(false))
	expect(laterReady).toBe(false)
	expect(first.snapshot().phase).toBe('confirm-visual')
	expect(candidates.mock.calls.map(([id]) => id)).toEqual([book.workIds[0]])
	expect(
		(await host.getQueue()).inactive.map((item) => item.link.workId),
	).toEqual([book.workIds[0]])
	await first.confirm({
		workId: book.workIds[0],
		mainVisualId: 'one',
		supplementalIds: [],
		characters: [],
	})
	expect((await later).snapshot().visual).toBeNull()
	expect(approveVisual).toHaveBeenCalledTimes(1)
	await host.close()
	hosts.splice(hosts.indexOf(host), 1)
	const restarted = production()
	expect((await restarted.get(book.workIds[0])).snapshot().visual).toBeNull()
	expect((await restarted.get(book.workIds[1])).snapshot().visual).toBeNull()
	expect(candidates).toHaveBeenCalledTimes(1)
})

test('stale or inherited visual forms are rejected rather than silently accepting unsaved choices', async () => {
	const book = await seed()
	const host = production()
	for (const id of book.workIds) await host.remember(id, book.projectDir)
	const first = await host.get(book.workIds[0])
	const input = {
		workId: book.workIds[0],
		mainVisualId: 'one',
		supplementalIds: [],
		characters: [],
	}
	await first.confirm(input)
	await expect(first.confirm(input)).rejects.toMatchObject({
		code: 'invalid_config',
	})
	const later = await host.get(book.workIds[1])
	await expect(
		later.confirm({ ...input, workId: book.workIds[1] }),
	).rejects.toMatchObject({ code: 'invalid_config' })
	expect(approveVisual).toHaveBeenCalledTimes(1)
	expect(candidates.mock.calls.map(([id]) => id)).toEqual([book.workIds[0]])
})

test('closing while a sequel waits for series approval cancels its unopened gate', async () => {
	const book = await seed()
	const host = production()
	for (const id of book.workIds) await host.remember(id, book.projectDir)
	const later = host.get(book.workIds[1])
	const cancelled = expect(later).rejects.toMatchObject({ code: 'cancelled' })
	await host.get(book.workIds[0])
	await laterEntered.promise
	await host.close()
	await cancelled
	hosts.splice(hosts.indexOf(host), 1)
	expect(candidates.mock.calls.map(([id]) => id)).toEqual([book.workIds[0]])
})

test('empty queue and failed preparation reject cleanly and can retry without duplicate sessions', async () => {
	const host = production()
	expect(await host.getQueue()).toEqual({
		active: null,
		queued: [],
		inactive: [],
	})
	await expect(host.get('missing')).rejects.toMatchObject({ code: 'not_found' })
	const book = await seed()
	await host.remember(book.workId, book.projectDir)
	using project = await Project.open(book.projectDir)
	const path = projectFiles.chapterText('ch0001')
	const body = await project.readFile(path)
	await rm(join(project.root, path))
	await expect(host.get(book.workId)).rejects.toMatchObject({ code: 'ENOENT' })
	await project.writeFile(path, body)
	expect((await host.get(book.workId)).snapshot().phase).toBe('confirm-visual')
})
