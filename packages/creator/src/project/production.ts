import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { projectFiles, type Style } from '@novelive/format/model'
import type { createConfigStore } from '../config'
import type {
	CommandInput,
	EventEnvelope,
	ProductionSnapshot,
} from '../contract'
import type { ProductionQueue } from '../contract/queue'
import { readImportWizard } from '../import/wizard'
import { createReplayFetch, type ReplayOptions } from '../replay'
import { ChapterScheduler, recoverChapterWork } from '../scheduler/chapter'
import {
	type QueueMove,
	readQueueWork,
	WorkQueue,
} from '../scheduler/work-queue'
import { prepareSeries } from '../synthesis/incremental'
import { existing } from '../synthesis/patch'
import { Project } from './index'
import { loadPlayerChapter, loadPlayerStatus } from './player'
import {
	chapterWorker,
	productionBible,
	productionModels,
} from './production-worker'
import { entryOwner } from './series/ownership'

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
	const chapterRecords = new Map<string, EventEnvelope[]>()
	const recoveredProjects = new Set<string>()
	const preparations = new Map<string, ReturnType<typeof startPreparation>>()
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

	function startPreparation(
		root: string,
		language: string,
		models: Awaited<ReturnType<typeof productionModels>>,
	) {
		const controller = new AbortController()
		const initialized = Promise.withResolvers<void>()
		void initialized.promise.catch(() => {})
		const volumes = new Map<
			string,
			ReturnType<typeof Promise.withResolvers<void>>
		>()
		loading++
		publishBusy()
		const running = (async () => {
			using project = await Project.open(root)
			const series = await project.read(projectFiles.series)
			for (const volumeId of series.volumeIds) {
				const volume = await project.read(projectFiles.volume(volumeId))
				for (const workId of volume.workIds) {
					const work = await project.read(projectFiles.work(volumeId, workId))
					if (
						!project.database
							.prepare('SELECT 1 FROM work WHERE work_id = ?')
							.get(workId)
					)
						project.tasks.registerWork({ workId, title: work.title })
				}
				const gate = Promise.withResolvers<void>()
				void gate.promise.catch(() => {})
				volumes.set(volumeId, gate)
			}
			initialized.resolve()
			await prepareSeries(project, {
				previewConnection: models.organizer,
				synthesisConnection: models.director,
				language,
				fetch: createReplayFetch(replay),
				signal: controller.signal,
				skipVolume: async (volumeId) => {
					const volume = await project.read(projectFiles.volume(volumeId))
					const started = volume.workIds.every((id) =>
						project.database
							.prepare('SELECT 1 FROM chapter WHERE work_id = ? LIMIT 1')
							.get(id),
					)
					if (started) volumes.get(volumeId)?.resolve()
					return started
				},
				onReady: async (volumeId) => {
					volumes.get(volumeId)?.resolve()
					const volume = await project.read(projectFiles.volume(volumeId))
					for (const id of volume.workIds) {
						await remember(id, root)
						if (!closing) void get(id).catch(() => {})
					}
				},
			})
		})()
			.catch((error) => {
				preparations.delete(root)
				initialized.reject(error)
				for (const gate of volumes.values()) gate.reject(error)
				throw error
			})
			.finally(() => {
				loading--
				publishBusy()
			})
		void running.catch(() => {})
		return {
			controller,
			running,
			async has(volumeId: string) {
				await initialized.promise
				return volumes.has(volumeId)
			},
			async volume(volumeId: string) {
				await initialized.promise
				await volumes.get(volumeId)?.promise
			},
		}
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
			let preparation = preparations.get(project.root)
			if (preparation && !(await preparation.has(volumeId))) {
				await preparation.running
				if (preparations.get(project.root) === preparation)
					preparations.delete(project.root)
				preparation = preparations.get(project.root)
			}
			if (!preparation) {
				preparation = startPreparation(project.root, work.language, models)
				preparations.set(project.root, preparation)
			}
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
			async function inheritsVisual(style: Style) {
				if (style.status !== 'confirmed' || !style.references?.length)
					return false
				const owner = await entryOwner(
					project,
					{ level: 'work', volumeId, workId },
					{ level: 'series' },
					projectFiles.style,
					style.id,
				)
				const document = await existing(() =>
					project.read(projectFiles.style(owner)),
				)
				const approval = document?.visualApprovals?.find(
					({ styleId }) => styleId === style.id,
				)
				if (!approval) return false
				if (!approval.volumeId) return true
				const series = await project.read(projectFiles.series)
				const approvedAt = series.volumeIds.indexOf(approval.volumeId)
				return (
					approvedAt >= 0 && approvedAt < series.volumeIds.indexOf(volumeId)
				)
			}
			if (!started || queue.snapshot(workId).phase === 'confirm-visual') {
				if (!started) {
					await preparation.volume(volumeId)
					summary = (await project.read(projectFiles.skeleton(volumeId)))
						.overview
				}
				const bible = (await productionBible(project, volumeId, workId)).art
				const references = (await readImportWizard(project)).references.map(
					(cachePath, i) => ({ id: `reference-${i + 1}`, cachePath }),
				)
				if (await inheritsVisual(bible.style)) {
					if (!started) queue.start(workId, work.chapterIds)
					queue.confirmVisual(workId)
				} else if (references.length && !work.settings.confirmWithReferences) {
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
			chapterRecords.set(workId, records)
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
					const style = (await productionBible(project, volumeId, workId)).art
						.style
					if (!(await inheritsVisual(style)))
						await art().confirmVisual(style, pool, input)
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
		records(workId: string): readonly EventEnvelope[] {
			return chapterRecords.get(workId) ?? []
		},
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
		async playerStatus(workId: string, selected?: string) {
			const linked = await existing(() => readFile(binding(workId), 'utf8'))
			return loadPlayerStatus(
				linked ?? selected ?? fail('not_found', '请选择本地工程'),
				workId,
			)
		},
		async player(workId: string, selected?: string, chapterId?: string) {
			const linked = await existing(() => readFile(binding(workId), 'utf8'))
			return {
				...(await loadPlayerChapter(
					linked ?? selected ?? fail('not_found', '请选择本地工程'),
					workId,
					cacheDir,
					chapterId,
				)),
				linked: !!linked,
			}
		},
		async close() {
			closing = true
			chapterRecords.clear()
			workQueue.close()
			for (const preparation of preparations.values())
				preparation.controller.abort()
			await Promise.allSettled(
				[...preparations.values()].map((preparation) => preparation.running),
			)
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
