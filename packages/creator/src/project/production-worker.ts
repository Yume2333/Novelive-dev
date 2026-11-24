import { createHash } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
	formatVersion,
	projectFiles,
	type Style,
	type Work,
} from '@novelive/format/model'
import { compileScript, formatScript } from '@novelive/format/script'
import type { createConfigStore } from '../config'
import { withProjectEdits } from '../editor/history/storage'
import { replaceMarkSuggestions } from '../editor/marks'
import { TextModelError, UnknownTextOutcomeError } from '../models/text'
import {
	type ArtBible,
	type ArtJob,
	ArtProduction,
	directChapterArt,
	planArt,
} from '../pipeline/art'
import type { CgReferences } from '../pipeline/art/director'
import { playbackAssetIds } from '../pipeline/art/plan'
import {
	reviewChapter,
	type WriterOptions,
	type WritingChapter,
	type WritingProgress,
	writeChapter,
} from '../pipeline/writing'
import {
	createReplayFetch,
	type ReplayOptions,
	usesReplyCheckpoint,
} from '../replay'
import {
	ProductionTaskError,
	type ProductionWorker,
	type StepContext,
} from '../scheduler/chapter'
import { existing, readBible } from '../synthesis/patch'
import { validateStyleReferences } from '../synthesis/style-references'
import { usageMethods, withUsage } from '../usage'
import { SpendBudgetError, settledChapterImageBudget } from '../usage/spend'
import type { Project } from './index'
import { resolveBible } from './series/resolve'

const draft = (id: string) => `source/production/${id}/draft.nvs`
const drawing = (id: string) => `source/production/art/${id}.json`
const stagingJournal = (workId: string, chapterId: string) =>
	join('.novelive', 'staging', workId, chapterId)

export async function productionModels(
	config: ReturnType<typeof createConfigStore>,
	presetId?: string,
) {
	const [
		organizer,
		director,
		artist,
		writer,
		reviewer,
		main,
		portrait,
		fast,
		visual,
		image,
		preset,
	] = await Promise.all([
		config.resolveRoleModel('organizer'),
		config.resolveRoleModel('director'),
		config.resolveRoleModel('artist'),
		config.resolveRoleModel('writer'),
		config.resolveRoleModel('reviewer-script'),
		config.resolveRoleModel('painter-scene'),
		config.resolveRoleModel('painter-portrait'),
		config.resolveRoleModel('painter-variant'),
		config.resolveRoleModel('reviewer-visual'),
		config.resolveImageModel(),
		config.resolveWriterPreset(presetId),
	])
	return {
		organizer,
		director,
		artist,
		writer,
		reviewer,
		main,
		portrait,
		fast,
		visual,
		image,
		preset,
	}
}

export async function productionBible(
	project: Project,
	volumeId?: string,
	workId?: string,
) {
	const bible =
		volumeId && workId
			? await resolveBible(project, { level: 'work', volumeId, workId })
			: await readBible(project)
	const approved = bible.style.find(
		({ status, references }) => status === 'confirmed' && references?.length,
	)
	const seriesStyle =
		!approved && volumeId && workId
			? (
					await existing(() =>
						project.read(projectFiles.style({ level: 'series' })),
					)
				)?.entries.find(
					({ status, references }) =>
						status === 'confirmed' && references?.length,
				)
			: undefined
	const style: Style = approved ??
		seriesStyle ??
		bible.style.find(({ status }) => status === 'confirmed') ??
		bible.style[0] ?? {
			id: 'style',
			status: 'candidate',
			description: '克制的叙事插画，自然光，线条干净',
		}
	return {
		bible,
		art: {
			characters: bible.character,
			locations: bible.location,
			style:
				style.status === 'candidate'
					? await validateStyleReferences(project, style)
					: style,
		},
	}
}

export function chapterWorker(
	project: Project,
	volumeId: string,
	work: Work,
	models: Awaited<ReturnType<typeof productionModels>>,
	replay?: ReplayOptions,
) {
	const fetch = createReplayFetch(replay)
	const imageReplayPositions = new Map<string, number>()
	const art = (
		signal?: AbortSignal,
		imageGenerationReplay?: ReplayOptions,
		drawingReplay = replay,
		desensitized = false,
		drawingPositions?: Map<string, number>,
	) =>
		usageMethods(
			new ArtProduction(project, {
				main: models.main,
				portrait: models.portrait,
				fast: models.fast,
				visual: models.visual,
				image: models.image,
				replay: drawingReplay,
				imageGenerationReplay,
				imageReplayPositions: drawingPositions,
				desensitized,
				signal,
				resolution: work.settings.outputResolution,
				readScope: { level: 'work', volumeId, workId: work.workId },
			}),
			project,
			work.workId,
			'draw',
		)
	const ref = (chapterId: string) => ({
		volumeId,
		workId: work.workId,
		chapterId,
	})
	async function input(ctx: StepContext) {
		const { chapterId, signal } = ctx
		const { settings } = await project.read(
			projectFiles.work(volumeId, work.workId),
		)
		const current = await project.read(projectFiles.chapter(ref(chapterId)))
		const body = (await project.readFile(projectFiles.chapterText(chapterId)))
			.toString('utf8')
			.trimEnd()
		const { bible } = await productionBible(project, volumeId, work.workId)
		const preview = await existing(() =>
			project.read(projectFiles.preview(chapterId)),
		)
		let continuity: WritingChapter['continuity'] = { kind: 'none' }
		const previousId = work.chapterIds[work.chapterIds.indexOf(chapterId) - 1]
		if (previousId && ctx.link === 'previous') {
			const previous = await project.read(projectFiles.chapter(ref(previousId)))
			const last = previous.sceneIds.at(-1)
			if (last)
				continuity = {
					kind: 'previous',
					ending:
						(await project.readFile(projectFiles.scene(ref(previousId), last)))
							.toString()
							.trimEnd()
							.split('\n')
							.at(-1) ?? '',
				}
		} else if (previousId && ctx.link === 'preview-summary') {
			const earlier = await existing(() =>
				project.read(projectFiles.preview(previousId)),
			)
			if (earlier)
				continuity = { kind: 'preview-summary', summary: earlier.summary }
		}
		const chapter: WritingChapter = {
			chapterId,
			language: work.language,
			continuity,
			paragraphs: current.paragraphIds.map((id, i) => ({
				id,
				text: body.split('\n\n')[i],
			})),
			settings,
			preview: preview?.summary,
			preset: [models.preset.style, models.preset.constraints]
				.filter(Boolean)
				.join('\n'),
			terms: Object.fromEntries(
				bible.glossary.map(({ original, written }) => [original, written]),
			),
			bible: JSON.stringify(bible),
			...(bible.character.length ||
			bible.location.length ||
			bible.glossary.length
				? {
						canonicalNames: {
							characters: bible.character,
							locations: bible.location,
						},
					}
				: {}),
			...(ctx.desensitized
				? {
						redLines: [
							'Keep the adaptation non-graphic. Use implication instead of explicit detail.',
						],
					}
				: {}),
		}
		let i = 0
		const options: WriterOptions = {
			writer: models.writer,
			reviewer: models.reviewer,
			fetch,
			signal,
			script: {
				assets: (await art(signal).registry()).entries,
				speakers: bible.character.map(({ id }) => id),
				customMarks: Object.keys(settings.customMarks),
				makeId: (size) =>
					createHash('sha256')
						.update(`${chapterId}/${++i}`)
						.digest('hex')
						.slice(0, size),
			},
		}
		return { chapter, options, current }
	}
	function compiled(
		script: string,
		chapter: WritingChapter,
		options: WriterOptions,
	) {
		const result = compileScript(script, {
			...options.script,
			paragraphIds: chapter.paragraphs.map(({ id }) => id),
		})
		if (!result.ok)
			throw new Error(
				result.diagnostics.map(({ message }) => message).join('; '),
			)
		return result
	}
	async function step<T>(run: () => Promise<T>) {
		try {
			return await run()
		} catch (error) {
			if (
				error instanceof TextModelError &&
				(error.code === 'network' || error.code === 'moderation')
			)
				throw new ProductionTaskError(
					error.code === 'moderation' ? 'moderation' : 'transient',
					error.message,
				)
			throw error
		}
	}
	const worker: ProductionWorker = {
		write: (ctx) =>
			step(async () => {
				const { chapter, options } = await input(ctx)
				const journal = `source/production/${ctx.workId}/${ctx.chapterId}/writing-resume.json`
				const clear = () => rm(join(project.root, journal), { force: true })
				const checkpoint = usesReplyCheckpoint(replay)
				if (!checkpoint && !ctx.resumingBudget) await clear()
				if (checkpoint)
					await rm(
						join(project.root, stagingJournal(ctx.workId, ctx.chapterId)),
						{
							recursive: true,
							force: true,
						},
					)
				const progress: WritingProgress =
					checkpoint || ctx.resumingBudget
						? ((await existing(async () =>
								JSON.parse((await project.readFile(journal)).toString('utf8')),
							)) ?? [])
						: []
				const saveProgress = (current: WritingProgress) =>
					project.writeFile(journal, JSON.stringify(current))
				const result = await writeChapter(
					chapter,
					{ ...options, proposeMarks: true },
					progress,
					checkpoint ? saveProgress : undefined,
				).catch(async (error: unknown) => {
					if (
						error instanceof SpendBudgetError ||
						(error instanceof Error &&
							error.cause instanceof SpendBudgetError) ||
						error instanceof UnknownTextOutcomeError ||
						ctx.signal.aborted ||
						((checkpoint || ctx.resumingBudget) &&
							error instanceof TextModelError &&
							error.code === 'network')
					) {
						await saveProgress(progress)
					} else {
						await clear()
					}
					throw error
				})
				await withProjectEdits(project, async () => {
					ctx.signal.throwIfAborted()
					await project.writeFile(
						draft(ctx.chapterId),
						formatScript(result.scenes.map(({ scene }) => scene)),
					)
					await replaceMarkSuggestions(
						project,
						volumeId,
						ctx,
						result.markSuggestions,
					)
				})
				await clear()
			}),
		review: (ctx) =>
			step(async () => {
				const { chapter, options } = await input(ctx)
				const script = (await project.readFile(draft(ctx.chapterId))).toString()
				const checkpointDirectory = usesReplyCheckpoint(replay)
					? join(project.root, '.novelive', 'review', ctx.workId, ctx.chapterId)
					: undefined
				const clear = async () => {
					if (checkpointDirectory)
						await rm(checkpointDirectory, { recursive: true, force: true })
				}
				const result = await reviewChapter(
					chapter,
					compiled(script, chapter, options),
					{
						...options,
						checkpoint: checkpointDirectory
							? { ...replay, checkpointDirectory }
							: undefined,
					},
				).catch(async (error: unknown) => {
					if (
						!ctx.signal.aborted &&
						!(error instanceof TextModelError) &&
						!(error instanceof SpendBudgetError)
					)
						await clear()
					throw error
				})
				ctx.signal.throwIfAborted()
				await project.writeFile(
					draft(ctx.chapterId),
					formatScript(result.scenes.map(({ scene }) => scene)),
				)
				await clear()
			}),
		stage: (ctx) =>
			step(async () => {
				const { current, chapter, options } = await input(ctx)
				const bible = (await productionBible(project, volumeId, work.workId))
					.art
				const service = art(ctx.signal)
				const script = (await project.readFile(draft(ctx.chapterId))).toString()
				const limit = await settledChapterImageBudget(
					project.database,
					work.workId,
					ctx.signal,
				)
				const registry = await service.registry()
				const journal = stagingJournal(ctx.workId, ctx.chapterId)
				const directory = join(project.root, journal)
				const checkpoint = usesReplyCheckpoint(replay)
				const clearJournal = async () => {
					if (checkpoint) await rm(directory, { recursive: true, force: true })
				}
				const allowance = join(journal, 'allowance.json')
				const saved = checkpoint
					? await existing(async () => {
							const value: unknown = JSON.parse(
								(await project.readFile(allowance)).toString(),
							)
							if (
								value === null ||
								(typeof value === 'number' &&
									Number.isSafeInteger(value) &&
									value >= 0)
							)
								return value
							throw new Error('Invalid staging checkpoint allowance')
						})
					: undefined
				const stagingLimit = saved === undefined ? (limit ?? null) : saved
				if (checkpoint && saved === undefined)
					await project.writeFile(allowance, JSON.stringify(stagingLimit))
				const previousBases = new Map<string, string>()
				const reusedImages = new Set<string>()
				if (limit !== undefined || stagingLimit !== null) {
					const previousDraw = project.database.prepare(
						"SELECT error_type FROM run WHERE work_id = ? AND kind = 'image' AND ref = ? ORDER BY rowid DESC LIMIT 1",
					)
					for (const entry of registry.entries) {
						if (
							(entry.status === 'placeholder' &&
								(await existing(() => project.readFile(entry.path)))) ||
							(entry.status === 'pending' &&
								previousDraw.get(work.workId, entry.id)?.error_type ===
									'budget_paused' &&
								service.hasPendingReview(entry.id))
						)
							reusedImages.add(entry.id)
						if (
							entry.status === 'drawn' ||
							!['expression', 'variant'].includes(entry.type)
						)
							continue
						const prior = await existing(() => drawingMetadata(entry.id))
						if (prior && 'baseAssetId' in prior.job)
							previousBases.set(entry.id, prior.job.baseAssetId)
					}
				}
				const budget = (limit: number) => ({
					limit,
					previousBases,
					reusedImages,
					paragraphIds: chapter.paragraphs.map(({ id }) => id),
					speakers: options.script.speakers,
				})
				const staged = await directChapterArt(script, bible, registry, {
					main: models.artist,
					replay: { ...replay, checkpointDirectory: directory },
					customMarks: options.script.customMarks,
					signal: ctx.signal,
					imageBudget: limit === undefined ? undefined : budget(limit),
					stagingImageBudget:
						stagingLimit === null ? null : budget(stagingLimit),
				})
				ctx.signal.throwIfAborted()
				if (staged.trimmed.length) ctx.recordStageTrim?.(staged.trimmed)
				const dependencies = new Map<string, ArtJob>()
				const sceneIds: string[] = []
				await service.register(
					staged.items,
					bible,
					staged.merges,
					ref(ctx.chapterId),
					async ({ jobs, registry: { entries } }) => {
						const output = compiled(staged.script, chapter, {
							...options,
							script: { ...options.script, assets: entries },
						})
						const planned = new Map(jobs.map((job) => [job.assetId, job]))
						const byId = new Map(entries.map((entry) => [entry.id, entry]))
						for (const id of playbackAssetIds(output.scenes)) {
							if (byId.get(id)?.status === 'drawn') continue
							const job = planned.get(id) ?? (await drawingMetadata(id)).job
							dependencies.set(id, job)
						}
						for (const job of dependencies.values()) {
							if ('baseAssetId' in job && !dependencies.has(job.baseAssetId)) {
								const base =
									planned.get(job.baseAssetId) ??
									(
										await existing(() => drawingMetadata(job.baseAssetId)).then(
											(metadata) =>
												metadata ?? confirmedPortrait(job.baseAssetId, bible),
										)
									).job
								dependencies.set(base.assetId, base)
							}
						}
						for (const job of jobs) {
							ctx.signal.throwIfAborted()
							await project.writeFile(
								drawing(job.assetId),
								JSON.stringify({
									job,
									cg: staged.cgReferences.get(job.assetId),
								}),
							)
						}
						for (const { scene } of output.scenes) {
							if (!scene.id) throw new Error('Missing compiled scene ID')
							sceneIds.push(scene.id)
							ctx.signal.throwIfAborted()
							await project.writeFile(
								projectFiles.scene(ref(ctx.chapterId), scene.id),
								formatScript([scene]),
							)
						}
						ctx.signal.throwIfAborted()
					},
				)
				const updated = await project.read(
					projectFiles.chapter(ref(ctx.chapterId)),
				)
				ctx.signal.throwIfAborted()
				await project.write(projectFiles.chapter(ref(ctx.chapterId)), {
					...current,
					cg: updated.cg,
					sceneIds,
				})
				await clearJournal()
				return [...dependencies.values()]
			}),
		async isDrawn(_workId, job) {
			const item = (await art().registry()).entries.find(
				({ id }) => id === job.assetId,
			)
			return (
				item?.status === 'drawn' &&
				!!(await existing(() => project.readFile(item.path)))
			)
		},
		hasPendingReview(assetId) {
			return art().hasPendingReview(assetId)
		},
		draw(job, ctx) {
			return step(async () => {
				const metadata = await drawingMetadata(job.assetId)
				return art(
					ctx.signal,
					undefined,
					{
						...replay,
						checkpointDirectory: join(
							project.root,
							'.novelive',
							'draw',
							work.workId,
						),
						normalizeCheckpointIds: true,
					},
					ctx.desensitized,
					imageReplayPositions,
				).draw(
					metadata.job,
					(await productionBible(project, volumeId, work.workId)).art,
					metadata.cg,
					ctx.resumingBudget,
				)
			})
		},
		placeholder(job, issue, signal) {
			return art(signal).savePlaceholder(job.assetId, issue)
		},
	}
	// Portraits picked at visual approval are registered without a drawing job.
	async function confirmedPortrait(assetId: string, bible: ArtBible) {
		const [characterId] = assetId.split('/')
		const character = bible.characters.find(({ id }) => id === characterId)
		if (!character) throw new Error(`No drawing record for ${assetId}`)
		const [job] = planArt(
			[{ id: assetId, kind: 'character', description: character.name }],
			bible,
			{ formatVersion, entries: [] },
		).jobs
		if (!job) throw new Error(`No drawing record for ${assetId}`)
		return { job, cg: undefined }
	}
	async function drawingMetadata(
		id: string,
	): Promise<{ job: ArtJob; cg?: CgReferences }> {
		return JSON.parse((await project.readFile(drawing(id))).toString())
	}
	return {
		worker: usageMethods(worker, project, work.workId, 'write'),
		art,
		rewriteScene: (
			chapterId: string,
			scene: { sourceIds: readonly string[]; nvs: string; instruction: string },
			signal: AbortSignal,
		) =>
			withUsage(project, work.workId, 'write', () =>
				step(async () => {
					const { chapter, options } = await input({
						workId: work.workId,
						chapterId,
						link: 'none',
						desensitized: false,
						signal,
					})
					const result = await writeChapter(
						{
							...chapter,
							paragraphs: chapter.paragraphs.filter(({ id }) =>
								scene.sourceIds.includes(id),
							),
							rewrite: { instruction: scene.instruction, current: scene.nvs },
						},
						options,
					)
					signal.throwIfAborted()
					if (result.scenes.length !== 1)
						throw new Error('A scene rewrite must return exactly one scene')
					return result.scenes[0].scene
				}),
			),
		async redraw(
			assetId: string,
			target: { path: string; instruction?: string },
			signal: AbortSignal,
		) {
			const bible = (await productionBible(project, volumeId, work.workId)).art
			const metadata =
				(await existing(() => drawingMetadata(assetId))) ??
				(await confirmedPortrait(assetId, bible))
			const imageGenerationReplay =
				(replay?.mode ?? process.env.NL_REPLAY) === 'record'
					? { ...replay, fallbackDirectory: undefined, reuseRecorded: false }
					: undefined
			return art(signal, imageGenerationReplay).redraw(
				metadata.job,
				bible,
				metadata.cg,
				target,
			)
		},
		adoptImage: (assetId: string, source: string) =>
			art().adopt(assetId, source),
		setModels(next: typeof models) {
			models = next
		},
	}
}
