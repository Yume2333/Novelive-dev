import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { formatVersion, projectFiles, type Style } from '@novelive/format/model'
import type { createConfigStore } from '../config'
import type {
	CommandInput,
	EventEnvelope,
	ProductionSnapshot,
} from '../contract'
import type { ProductionQueue } from '../contract/queue'
import { readImportWizard, screenImportedIllustrations } from '../import/wizard'
import { createReplayFetch, type ReplayOptions } from '../replay'
import { ChapterScheduler, recoverChapterWork } from '../scheduler/chapter'
import {
	type QueueMove,
	readQueueWork,
	WorkQueue,
} from '../scheduler/work-queue'
import { prepareSeries } from '../synthesis/incremental'
import { existing } from '../synthesis/patch'
import { withUsage } from '../usage'
import { Project } from './index'
import { loadPlayerChapter, loadPlayerStatus } from './player'
import {
	chapterWorker,
	productionBible,
	productionModels,
} from './production-worker'

const fail = (
	code: 'not_found' | 'invalid_config' | 'cancelled',
	message: string,
): never => {
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
	const settingsRefreshers = new Set<() => Promise<void>>()
	const schedulers = new Set<ChapterScheduler>()
	const jobs = new Set<Promise<unknown>>()
	const shutdown = new AbortController()
	const chapterRecords = new Map<string, EventEnvelope[]>()
	const recoveredProjects = new Set<string>()
	const preparations = new Map<string, ReturnType<typeof startPreparation>>()
	const visualChanges = new Map<
		string,
		ReturnType<typeof Promise.withResolvers<void>>
	>()
	let loading = 0
	let awaitingVisual = 0
	let seq = 0
	let restored: Promise<void> | undefined
	let lastQueue: string | undefined
	const workQueue = new WorkQueue(publishQueue)

	function publishBusy() {
		active(
			!shutdown.signal.aborted && (loading > awaitingVisual || workQueue.busy),
		)
	}

	function checkOpen() {
		if (shutdown.signal.aborted) fail('cancelled', '创作服务正在关闭')
	}

	function runJob<T>(operation: () => Promise<T>): Promise<T> {
		checkOpen()
		const job = operation().finally(() => jobs.delete(job))
		jobs.add(job)
		return job
	}

	function visualChanged(root: string) {
		const change = visualChanges.get(root)
		visualChanges.delete(root)
		change?.resolve()
	}

	async function visualOwner(project: Project) {
		const series = await project.read(projectFiles.series)
		return (await project.read(projectFiles.volume(series.volumeIds[0])))
			.workIds[0]
	}

	async function approvedVisual(project: Project): Promise<Style | undefined> {
		const document = await existing(() =>
			project.read(projectFiles.style({ level: 'series' })),
		)
		return document?.entries.find(
			(style) => style.status === 'confirmed' && style.references?.length,
		)
	}

	async function admitVisual(project: Project, workId: string) {
		for (;;) {
			checkOpen()
			let change = visualChanges.get(project.root)
			if (!change) {
				change = Promise.withResolvers<void>()
				visualChanges.set(project.root, change)
			}
			const approved = await approvedVisual(project)
			checkOpen()
			if (approved) {
				visualChanged(project.root)
				return approved
			}
			const owner = await visualOwner(project)
			if (owner === workId) return undefined
			await remember(owner, project.root)
			checkOpen()
			awaitingVisual++
			publishBusy()
			try {
				await Promise.race([
					change.promise,
					get(owner).then(() => change.promise),
				])
			} finally {
				awaitingVisual--
				publishBusy()
			}
		}
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
		project.database
			.prepare(
				`UPDATE work AS pending SET status = 'paused', pause_reason = 'crashed'
				WHERE status = 'queued'
				AND NOT EXISTS (SELECT 1 FROM chapter WHERE work_id = pending.work_id)
				AND EXISTS (SELECT 1 FROM work AS interrupted
					WHERE status = 'paused' AND pause_reason = 'crashed'
					AND EXISTS (SELECT 1 FROM chapter WHERE work_id = interrupted.work_id))`,
			)
			.run()
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
		resumingVolume?: string,
	) {
		const controller = new AbortController()
		const initialized = Promise.withResolvers<void>()
		void initialized.promise.catch(() => {})
		const volumes = new Map<
			string,
			ReturnType<typeof Promise.withResolvers<void>>
		>()
		const blocked = new Map<string, string>()
		loading++
		publishBusy()
		const running = (async () => {
			using project = await Project.open(root)
			const series = await project.read(projectFiles.series)
			let missingDigest: string | undefined
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
				if (missingDigest !== undefined) {
					blocked.set(volumeId, missingDigest)
					continue
				}
				const paused =
					volumeId !== resumingVolume &&
					volume.workIds.some((id) => crashPaused(project, id))
				if (paused) {
					const digest = await existing(() =>
						project.read(projectFiles.digest(volumeId)),
					)
					if (!digest) missingDigest = volume.title
					continue
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
					if (!volumes.has(volumeId)) return true
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
						if (!shutdown.signal.aborted && !crashPaused(project, id))
							void get(id).catch(() => {})
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
				const prerequisite = blocked.get(volumeId)
				if (prerequisite !== undefined)
					fail('invalid_config', `请先继续制作前卷：${prerequisite}`)
				await volumes.get(volumeId)?.promise
			},
		}
	}

	function crashPaused(project: Project, workId: string) {
		return !!project.database
			.prepare(
				"SELECT 1 FROM work WHERE work_id = ? AND status = 'paused' AND pause_reason = 'crashed'",
			)
			.get(workId)
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
			const service = art(shutdown.signal)
			const data = project.database
			data
				.prepare(
					'INSERT OR IGNORE INTO work (work_id, title, queue_pos, created_at) VALUES (?, ?, 0, ?)',
				)
				.run(workId, work.title, Date.now())
			const started = data
				.prepare('SELECT 1 FROM chapter WHERE work_id = ? LIMIT 1')
				.get(workId)
			async function prepare(resuming = false) {
				const currentModels = await settings()
				let preparation = preparations.get(project.root)
				while (preparation && !(await preparation.has(volumeId))) {
					await preparation.running
					if (preparations.get(project.root) === preparation)
						preparations.delete(project.root)
					preparation = preparations.get(project.root)
				}
				checkOpen()
				if (!preparation) {
					preparation = startPreparation(
						project.root,
						work.language,
						currentModels,
						resuming ? volumeId : undefined,
					)
					preparations.set(project.root, preparation)
				}
				return preparation
			}
			const pausedAfterCrash = crashPaused(project, workId)
			const preparation =
				pausedAfterCrash || work.derivedFrom ? undefined : await prepare()
			let continuing: Promise<ProductionSnapshot> | undefined
			let pool: Awaited<ReturnType<typeof service.candidates>> | undefined
			let visual: ProductionSnapshot['visual'] = null
			let confirmingVisual = false
			let admitted = false
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
					exportTarget: { projectRoot: project.root, volumeId },
					title: work.title,
					summary,
					chapterTitles,
					visual: result.phase === 'confirm-visual' ? visual : null,
				}
			}
			function emit() {
				if (shutdown.signal.aborted) return
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
			schedulers.add(queue)
			workQueue.attach(workId, {
				read: () =>
					admitted
						? readQueueWork(data, {
								link,
								title: work.title,
								projectDir: project.root,
							})
						: null,
				busy: () => queue.busy,
				wake: () => queue.wake(),
			})
			async function refresh() {
				const next = await settings()
				checkOpen()
				setModels(next)
				queue.setImageConcurrency(next.image.concurrency)
			}
			async function confirmSeriesVisual(
				...args: Parameters<typeof service.confirmVisual>
			) {
				const chosen = await art(shutdown.signal).confirmVisual(...args)
				if (!(await approvedVisual(project))) {
					const file = projectFiles.style({ level: 'series' })
					const document = await existing(() => project.read(file))
					await project.write(file, {
						...document,
						formatVersion,
						entries: [
							chosen,
							...(document?.entries ?? []).filter(({ id }) => id !== chosen.id),
						],
					})
				}
				visualChanged(project.root)
			}
			async function prepareVisual(
				preparation: Awaited<ReturnType<typeof prepare>>,
			) {
				if (!started) {
					await preparation.volume(volumeId)
					summary = (await project.read(projectFiles.skeleton(volumeId)))
						.overview
				}
				const inherited = await admitVisual(project, workId)
				admitted = true
				await refresh()
				const bible = (await productionBible(project, volumeId, workId)).art
				const wizard = await readImportWizard(project)
				const references = wizard.references.map((cachePath, i) => ({
					id: `reference-${i + 1}`,
					cachePath,
				}))
				if (inherited) {
					if (!started) queue.start(workId, work.chapterIds)
					queue.confirmVisual(workId)
				} else if (references.length && !work.settings.confirmWithReferences) {
					await confirmSeriesVisual(
						bible.style,
						{
							mainVisuals: references.slice(0, 1),
							supplemental: references.slice(1),
							characters: [],
						},
						{
							mainVisualId: references[0].id,
							supplementalIds: references.slice(1).map(({ id }) => id),
							characters: [],
						},
					)
					if (!started) queue.start(workId, work.chapterIds)
					queue.confirmVisual(workId)
				} else {
					const imported = await withUsage(project, workId, 'draw', () =>
						screenImportedIllustrations(
							project,
							JSON.stringify(bible),
							() => config.resolveRoleModel('illustration-screening'),
							{ replay, signal: shutdown.signal },
							bible.characters
								.filter(
									({ major, firstSeenChapter }) =>
										major &&
										firstSeenChapter &&
										work.chapterIds.includes(firstSeenChapter),
								)
								.map(({ id }) => id),
						),
					)
					const characterReferences = new Map<
						string,
						{ id: string; cachePath: string }
					>()
					for (const candidate of imported?.candidates ?? []) {
						const { characterId } = candidate
						if (characterId && !characterReferences.has(characterId))
							characterReferences.set(characterId, candidate)
					}
					pool = await art(shutdown.signal).candidates(
						bible,
						work.chapterIds,
						undefined,
						imported
							? references.filter(
									({ cachePath }) =>
										!wizard.selectedIllustrations.some(
											(id) => cachePath === `source/references/${id}.png`,
										),
								)
							: references,
						characterReferences,
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
						...(pool.mattingUnavailable ? { mattingUnavailable: true } : {}),
						...(imported && {
							importedIllustrations: {
								fallback: imported.fallback,
								selected: wizard.selectedIllustrations,
								recommended: imported.candidates
									.filter(({ recommended }) => recommended)
									.map(({ id }) => id),
								candidates: await Promise.all(
									imported.candidates.map(candidate),
								),
							},
						}),
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
					if (imported) {
						pool.mainVisuals.push(...imported.candidates)
						pool.supplemental.push(...imported.candidates)
					}
					await refresh()
					if (!started) queue.start(workId, work.chapterIds)
				}
			}
			if (
				preparation &&
				(!started || queue.snapshot(workId).phase === 'confirm-visual')
			)
				await prepareVisual(preparation)
			checkOpen()
			admitted = true
			emit()
			chapterRecords.set(workId, records)
			settingsRefreshers.add(refresh)
			return {
				workId,
				project,
				queue,
				snapshot,
				records,
				confirm: (input: CommandInput<'production.confirmVisual'>) =>
					runJob(async () => {
						const choices = pool
						if (
							snapshot().phase !== 'confirm-visual' ||
							!choices ||
							confirmingVisual
						)
							return fail(
								'invalid_config',
								'当前没有可提交的主视觉确认，请刷新后重试',
							)
						confirmingVisual = true
						try {
							await refresh()
							if (
								(await approvedVisual(project)) ||
								(await visualOwner(project)) !== workId
							) {
								visualChanged(project.root)
								fail('invalid_config', '系列主视觉确认状态已变化，请刷新后重试')
							}
							const style = (await productionBible(project, volumeId, workId))
								.art.style
							await confirmSeriesVisual(style, choices, input)
							queue.confirmVisual(workId)
							visualChanged(project.root)
							return snapshot()
						} finally {
							confirmingVisual = false
						}
					}),
				continue() {
					continuing ??= runJob(async () => {
						if (pausedAfterCrash) {
							const preparation = await prepare(true)
							if (!started && crashPaused(project, workId)) {
								await prepareVisual(preparation)
								return snapshot()
							}
						}
						await refresh()
						queue.continue(workId)
						return snapshot()
					}).finally(() => {
						continuing = undefined
					})
					return continuing
				},
				retry: (chapterId: string) =>
					runJob(async () => {
						await refresh()
						queue.retryChapter(workId, chapterId)
						return snapshot()
					}),
				redo: (chapterId: string) =>
					runJob(async () => {
						await refresh()
						queue.redoChapter(workId, chapterId)
						return snapshot()
					}),
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
			if (scheduler) {
				scheduler.dispose()
				await scheduler.idle()
				schedulers.delete(scheduler)
			}
			workQueue.detach(workId)
			project.close()
			checkOpen()
			throw error
		}
	}

	async function get(workId: string) {
		await ready()
		checkOpen()
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
		hasRecords(workId: string) {
			return chapterRecords.has(workId)
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
			checkOpen()
			await Promise.all(
				[...settingsRefreshers].map((refresh) => runJob(refresh)),
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
			shutdown.abort()
			publishBusy()
			for (const root of visualChanges.keys()) visualChanged(root)
			chapterRecords.clear()
			workQueue.close()
			for (const scheduler of schedulers) scheduler.dispose()
			for (const preparation of preparations.values())
				preparation.controller.abort()
			const [results] = await Promise.all([
				Promise.allSettled(sessions.values()),
				Promise.allSettled([
					...jobs,
					...[...preparations.values()].map(
						(preparation) => preparation.running,
					),
				]),
			])
			await Promise.all(
				results.map(async (result) => {
					if (result.status !== 'fulfilled') return
					const { queue, project, workId } = result.value
					await queue.idle()
					workQueue.detach(workId)
					project.close()
				}),
			)
			publishBusy()
		},
	}
}
