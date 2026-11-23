import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { projectFiles } from '@novelive/format/model'
import type { createConfigStore } from '../config'
import type {
	CommandInput,
	EventEnvelope,
	ProductionSnapshot,
} from '../contract'
import { readImportWizard } from '../import/wizard'
import { prepareVolume } from '../project-pipeline'
import { createReplayFetch, type ReplayOptions } from '../replay'
import { ChapterScheduler } from '../scheduler/chapter'
import { existing } from '../synthesis/patch'
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
	const binding = (workId: string) => join(dataDir, 'projects', workId)
	let state: Awaited<ReturnType<typeof open>> | undefined
	let loading:
		| { workId: string; result: Promise<Awaited<ReturnType<typeof open>>> }
		| undefined
	let closing = false
	let seq = 0

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
			const series = await project.read(projectFiles.series)
			const volumes = await Promise.all(
				series.volumeIds.map((id) => project.read(projectFiles.volume(id))),
			)
			const volume =
				volumes.find(({ workIds }) => workIds.includes(workId)) ??
				fail('not_found', '工程中找不到这部作品')
			const { volumeId } = volume
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
				active(status.status === 'producing' || !!loading)
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
			})
			scheduler = queue
			async function refresh() {
				const next = await settings()
				setModels(next)
				queue.setImageConcurrency(next.image.concurrency)
			}
			if (!started || queue.snapshot(workId).phase === 'confirm-visual') {
				if (!started) {
					const { synthesis } = await prepareVolume(project, volumeId, {
						previewConnection: models.organizer,
						synthesisConnection: models.director,
						language: work.language,
						fetch: createReplayFetch(replay),
					})
					summary = synthesis.overview
				}
				const bible = (await productionBible(project, volumeId, workId)).art
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
						(await productionBible(project, volumeId, workId)).art.style,
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
			project.close()
			throw error
		}
	}

	async function get(workId: string) {
		if (state?.workId === workId) return state
		if (loading?.workId === workId) return loading.result
		if (loading || state?.snapshot().status === 'producing')
			fail('invalid_config', '当前已有作品正在制作')
		const start = async () => {
			if (state) {
				state.queue.dispose()
				await state.queue.idle()
				state.project.close()
				state = undefined
			}
			return open(workId)
		}
		active(true)
		const result = start()
		loading = { workId, result }
		try {
			state = await result
			return state
		} finally {
			loading = undefined
			active(state?.snapshot().status === 'producing')
		}
	}

	return {
		remember,
		get,
		async refreshSettings() {
			await state?.refreshSettings()
		},
		async player(workId: string, selected?: string) {
			const linked = await existing(() => readFile(binding(workId), 'utf8'))
			if (linked) {
				using project = await Project.open(linked)
				if (
					!project.database
						.prepare(
							"SELECT 1 FROM chapter WHERE work_id = ? AND ord = 1 AND user_state = 'published'",
						)
						.get(workId)
				)
					fail('not_found', '第一章尚未发布')
			}
			return loadPlayerChapter(
				linked ?? selected ?? fail('not_found', '请选择本地工程'),
				workId,
				cacheDir,
			)
		},
		async close() {
			closing = true
			const session = await (loading?.result.catch(() => undefined) ?? state)
			session?.queue.dispose()
			await session?.queue.idle()
			session?.project.close()
			active(false)
		},
	}
}
