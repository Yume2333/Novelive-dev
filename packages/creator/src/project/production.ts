import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { projectFiles } from '@novelive/format/model'
import type { createConfigStore } from '../config'
import type {
	CommandInput,
	EventEnvelope,
	ProductionSnapshot,
} from '../contract'
import type { ProductionQueue } from '../contract/queue'
import { readImportWizard } from '../import/wizard'
import { prepareVolume } from '../project-pipeline'
import { createReplayFetch, type ReplayOptions } from '../replay'
import { ChapterScheduler, recoverChapterWork } from '../scheduler/chapter'
import {
	type QueueMove,
	readQueueWork,
	WorkQueue,
} from '../scheduler/work-queue'
import { existing } from '../synthesis/patch'
import { withUsage } from '../usage'
import { Project } from './index'
import { loadPlayerChapter } from './player'
import {
	chapterWorker,
	productionBible,
	productionModels,
} from './production-worker'

const fail = (code: 'not_found' | 'invalid_config', message: string): never => {
	throw { code, message }
}

export function createProduction(
	dataDir: string,
	config: ReturnType<typeof createConfigStore>,
	replay: ReplayOptions | undefined,
	publish: (event: EventEnvelope) => void,
	active: (busy: boolean) => void,
) {
	const cacheDir = join(dataDir, 'cache')
	const bindingsDir = join(dataDir, 'projects')
	const binding = (workId: string) => join(bindingsDir, workId)
	const sessions = new Map<string, ReturnType<typeof open>>()
	const recoveredProjects = new Set<string>()
	let loading = 0
	let closing = false
	let seq = 0
	let restored: Promise<void> | undefined
	let lastQueue: string | undefined
	const workQueue = new WorkQueue(publishQueue)

	function publishBusy() {
		active(!closing && (loading > 0 || workQueue.busy))
	}

	function publishQueue(queue: ProductionQueue) {
		publishBusy()
		const key = JSON.stringify(queue)
		if (key === lastQueue) return
		lastQueue = key
		publish({
			scope: 'app',
			scopeId: 'app',
			seq: ++seq,
			at: new Date().toISOString(),
			event: { type: 'production.queue', payload: queue },
		})
	}

	async function remember(workId: string, directory: string) {
		const file = binding(workId)
		await mkdir(dirname(file), { recursive: true })
		await writeFile(file, directory)
	}

	async function directory(workId: string) {
		return (
			(await existing(() => readFile(binding(workId), 'utf8'))) ??
			fail('not_found', '工程中找不到这部作品')
		)
	}

	async function identity(project: Project, workId: string) {
		const series = await project.read(projectFiles.series)
		const volumes = await Promise.all(
			series.volumeIds.map((id) => project.read(projectFiles.volume(id))),
		)
		const volume =
			volumes.find(({ workIds }) => workIds.includes(workId)) ??
			fail('not_found', '工程中找不到这部作品')
		return { seriesId: series.seriesId, volumeId: volume.volumeId, workId }
	}

	function recoverProject(project: Project) {
		if (recoveredProjects.has(project.root)) return
		recoverChapterWork(project.database)
		recoveredProjects.add(project.root)
	}

	async function restore() {
		const bindings =
			(await existing(() => readdir(bindingsDir, { withFileTypes: true }))) ??
			[]
		const entries = await Promise.allSettled(
			bindings
				.filter((file) => file.isFile())
				.map(async ({ name: workId }) => {
					using project = await Project.open(await directory(workId))
					recoverProject(project)
					const row = project.database
						.prepare('SELECT title FROM work WHERE work_id = ?')
						.get(workId) as { title: string } | undefined
					if (!row) return null
					return readQueueWork(project.database, {
						link: await identity(project, workId),
						projectDir: project.root,
						title: row.title,
					})
				}),
		)
		for (const entry of entries) {
			// Unavailable projects still report their open error when selected directly.
			if (entry.status === 'fulfilled' && entry.value)
				workQueue.restore(entry.value)
		}
	}

	function ready() {
		restored ??= restore()
		return restored
	}

	async function cache(project: Project, path: string) {
		const bytes = await project.readFile(path)
		const file = `production/${createHash('sha256').update(bytes).digest('hex')}${extname(path)}`
		const destination = join(cacheDir, file)
		await mkdir(dirname(destination), { recursive: true })
		await writeFile(destination, bytes)
		return file
	}

	async function open(workId: string) {
		const project = await Project.open(await directory(workId))
		let scheduler: ChapterScheduler | undefined
		try {
			recoverProject(project)
			const link = await identity(project, workId)
			const { volumeId } = link
			const work = await project.read(projectFiles.work(volumeId, workId))
			const chapterTitles = Object.fromEntries(
				await Promise.all(
					work.chapterIds.map(async (chapterId) => [
						chapterId,
						(
							await project.read(
								projectFiles.chapter({ volumeId, workId, chapterId }),
							)
						).title,
					]),
				),
			)
			const settings = () =>
				productionModels(config, work.settings.writerPresetId)
			const models = await settings()
			const { art, worker, setModels, rewriteScene, redraw, adoptImage } =
				chapterWorker(project, volumeId, work, models, replay)
			const service = art()
			const data = project.database
			data
				.prepare(
					'INSERT OR IGNORE INTO work (work_id, title, queue_pos, created_at) VALUES (?, ?, 0, ?)',
				)
				.run(workId, work.title, Date.now())
			const started = data
				.prepare('SELECT 1 FROM chapter WHERE work_id = ? LIMIT 1')
				.get(workId)
			let pool: Awaited<ReturnType<typeof service.candidates>> | undefined
			let visual: ProductionSnapshot['visual'] = null
			let summary = (
				await existing(() => project.read(projectFiles.skeleton(volumeId)))
			)?.overview
			const records: EventEnvelope[] = []
			const seen = new Set<string>()

			function envelope(type: string, payload: unknown): EventEnvelope {
				return {
					scope: 'work',
					scopeId: workId,
					seq: ++seq,
					at: new Date().toISOString(),
					event: { type, payload },
				}
			}
			function snapshot(): ProductionSnapshot {
				const result = queue.snapshot(workId)
				return {
					...result,
					title: work.title,
					summary,
					chapterTitles,
					visual: result.phase === 'confirm-visual' ? visual : null,
				}
			}
			function emit() {
				if (closing) return
				const status = snapshot()
				workQueue.changed()
				for (const run of queue.runLog(workId)) {
					if (run.kind !== 'chapter') continue
					run.steps.forEach((step, index) => {
						if (!['write', 'review', 'stage'].includes(step.purpose)) return
						const key = `${run.runId}/${index}`
						if (seen.has(key)) return
						seen.add(key)
						const [status, message] =
							step.status === 'completed'
								? ['done', '已完成']
								: step.status === 'cancelled'
									? ['cancelled', '已取消']
									: ['failed', '运行失败']
						const event = envelope('production.chapterRecord', {
							workId,
							chapterId: run.ref,
							step: step.purpose,
							status,
							message,
							...(step.errorType ? { detail: step.errorType } : {}),
						})
						records.push(event)
						publish(event)
					})
				}
				publish(envelope('production.snapshot', status))
			}
			const queue = new ChapterScheduler(data, worker, {
				imageConcurrency: models.image.concurrency,
				onChange: emit,
				slot: {
					workId,
					granted: () => workQueue.granted(workId),
					enqueueFirst: () => workQueue.enqueueFirst(workId),
				},
			})
			scheduler = queue
			workQueue.attach(workId, {
				read: () =>
					readQueueWork(data, {
						link,
						title: work.title,
						projectDir: project.root,
					}),
				busy: () => queue.busy,
				wake: () => queue.wake(),
			})
			async function refresh() {
				const next = await settings()
				setModels(next)
				queue.setImageConcurrency(next.image.concurrency)
			}
			if (!started || queue.snapshot(workId).phase === 'confirm-visual') {
				if (!started) {
					const { synthesis } = await withUsage(
						project,
						workId,
						'synthesize',
						() =>
							prepareVolume(project, volumeId, {
								previewConnection: models.organizer,
								synthesisConnection: models.director,
								language: work.language,
								fetch: createReplayFetch(replay),
							}),
					)
					summary = synthesis.overview
				}
				const bible = (await productionBible(project)).art
				const references = (await readImportWizard(project)).references.map(
					(cachePath, i) => ({ id: `reference-${i + 1}`, cachePath }),
				)
				if (references.length && !work.settings.confirmWithReferences) {
					await service.confirmVisual(
						bible.style,
						{ mainVisuals: references, supplemental: [], characters: [] },
						{
							mainVisualId: references[0].id,
							supplementalIds: [],
							characters: [],
						},
					)
					if (!started) queue.start(workId, work.chapterIds)
					queue.confirmVisual(workId)
				} else {
					pool = await service.candidates(
						bible,
						work.chapterIds,
						undefined,
						references,
					)
					const candidate = async ({
						id,
						cachePath,
					}: {
						id: string
						cachePath: string
					}) => ({
						id,
						cachePath: await cache(project, cachePath),
					})
					visual = {
						mainVisuals: await Promise.all(pool.mainVisuals.map(candidate)),
						supplemental: await Promise.all(pool.supplemental.map(candidate)),
						characters: await Promise.all(
							pool.characters.map(async (item) => {
								const character = bible.characters.find(
									({ id }) => id === item.characterId,
								)
								return {
									...item,
									characterName: character?.name,
									candidates: await Promise.all(item.candidates.map(candidate)),
								}
							}),
						),
					}
					if (!started) queue.start(workId, work.chapterIds)
				}
			}
			emit()
			return {
				workId,
				project,
				queue,
				snapshot,
				records,
				refreshSettings: refresh,
				async confirm(input: CommandInput<'production.confirmVisual'>) {
					if (snapshot().phase !== 'confirm-visual' || !pool) return snapshot()
					await refresh()
					await art().confirmVisual(
						(await productionBible(project)).art.style,
						pool,
						input,
					)
					queue.confirmVisual(workId)
					return snapshot()
				},
				async continue() {
					await refresh()
					queue.continue(workId)
					return snapshot()
				},
				async retry(chapterId: string) {
					await refresh()
					queue.retryChapter(workId, chapterId)
					return snapshot()
				},
				async redo(chapterId: string) {
					await refresh()
					queue.redoChapter(workId, chapterId)
					return snapshot()
				},
				rewriteScene,
				redraw,
				adoptImage,
				async asset(id: string) {
					const asset = (await service.registry()).entries.find(
						(entry) => entry.id === id && entry.status !== 'pending',
					)
					return asset ? { cachePath: await cache(project, asset.path) } : null
				},
			}
		} catch (error) {
			scheduler?.dispose()
			await scheduler?.idle()
			workQueue.detach(workId)
			project.close()
			throw error
		}
	}

	async function get(workId: string) {
		await ready()
		if (closing) throw { code: 'cancelled', message: '创作端正在关闭' }
		const session = sessions.get(workId)
		if (session) return session
		loading++
		publishBusy()
		const result = open(workId)
			.catch((error) => {
				sessions.delete(workId)
				throw error
			})
			.finally(() => {
				loading--
				publishBusy()
			})
		sessions.set(workId, result)
		return result
	}

	return {
		remember,
		get,
		async getQueue() {
			await ready()
			return workQueue.snapshot()
		},
		async moveQueueWork(workId: string, direction: QueueMove) {
			await ready()
			return workQueue.move(workId, direction)
		},
		async refreshSettings() {
			await Promise.all(
				[...sessions.values()].map(async (session) =>
					(await session).refreshSettings(),
				),
			)
		},
		async player(workId: string, selected?: string, chapterId?: string) {
			const linked = await existing(() => readFile(binding(workId), 'utf8'))
			return loadPlayerChapter(
				linked ?? selected ?? fail('not_found', '请选择本地工程'),
				workId,
				cacheDir,
				chapterId,
			)
		},
		async close() {
			closing = true
			workQueue.close()
			const results = await Promise.allSettled(sessions.values())
			await Promise.all(
				results.map(async (result) => {
					if (result.status !== 'fulfilled') return
					const { queue, project } = result.value
					queue.dispose()
					await queue.idle()
					project.close()
				}),
			)
			publishBusy()
		},
	}
}
