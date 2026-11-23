import { createHash } from 'node:crypto'
import { projectFiles, type Work } from '@novelive/format/model'
import { compileScript, formatScript } from '@novelive/format/script'
import type { createConfigStore } from '../config'
import { TextModelError } from '../models/text'
import { type ArtJob, ArtProduction, directChapterArt } from '../pipeline/art'
import type { CgReferences } from '../pipeline/art/director'
import {
	reviewChapter,
	type WriterOptions,
	type WritingChapter,
	writeChapter,
} from '../pipeline/writing'
import { createReplayFetch, type ReplayOptions } from '../replay'
import {
	ProductionTaskError,
	type ProductionWorker,
	type StepContext,
} from '../scheduler/chapter'
import { existing, readBible } from '../synthesis/patch'
import type { Project } from './index'

const draft = (id: string) => `source/production/${id}/draft.nvs`
const drawing = (id: string) => `source/production/art/${id}.json`

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

export async function productionBible(project: Project) {
	const bible = await readBible(project)
	return {
		bible,
		art: {
			characters: bible.character,
			locations: bible.location,
			style: bible.style.find(({ status }) => status === 'confirmed') ??
				bible.style[0] ?? {
					id: 'style',
					status: 'candidate' as const,
					description: '克制的叙事插画，自然光，线条干净',
				},
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
	const art = (signal?: AbortSignal) =>
		new ArtProduction(project, {
			main: models.main,
			portrait: models.portrait,
			fast: models.fast,
			visual: models.visual,
			image: models.image,
			replay,
			signal,
			resolution: work.settings.outputResolution,
		})
	const ref = (chapterId: string) => ({
		volumeId,
		workId: work.workId,
		chapterId,
	})
	async function input(ctx: StepContext) {
		const { chapterId, signal } = ctx
		const current = await project.read(projectFiles.chapter(ref(chapterId)))
		const body = (await project.readFile(projectFiles.chapterText(chapterId)))
			.toString('utf8')
			.trimEnd()
		const { bible } = await productionBible(project)
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
			settings: work.settings,
			preview: preview?.summary,
			preset: [models.preset.style, models.preset.constraints]
				.filter(Boolean)
				.join('\n'),
			terms: Object.fromEntries(
				bible.glossary.map(({ original, written }) => [original, written]),
			),
			bible: JSON.stringify(bible),
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
				customMarks: Object.keys(work.settings.customMarks),
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
				const result = await writeChapter(chapter, options)
				ctx.signal.throwIfAborted()
				await project.writeFile(
					draft(ctx.chapterId),
					formatScript(result.scenes.map(({ scene }) => scene)),
				)
			}),
		review: (ctx) =>
			step(async () => {
				const { chapter, options } = await input(ctx)
				const script = (await project.readFile(draft(ctx.chapterId))).toString()
				const result = await reviewChapter(
					chapter,
					compiled(script, chapter, options),
					options,
				)
				ctx.signal.throwIfAborted()
				await project.writeFile(
					draft(ctx.chapterId),
					formatScript(result.scenes.map(({ scene }) => scene)),
				)
			}),
		stage: (ctx) =>
			step(async () => {
				const { current, chapter, options } = await input(ctx)
				const bible = (await productionBible(project)).art
				const service = art(ctx.signal)
				const script = (await project.readFile(draft(ctx.chapterId))).toString()
				const staged = await directChapterArt(
					script,
					bible,
					await service.registry(),
					{
						main: models.artist,
						replay,
						customMarks: options.script.customMarks,
						signal: ctx.signal,
					},
				)
				ctx.signal.throwIfAborted()
				const jobs = await service.register(
					staged.items,
					bible,
					staged.merges,
					ref(ctx.chapterId),
				)
				const { entries } = await service.registry()
				const output = compiled(staged.script, chapter, {
					...options,
					script: {
						...options.script,
						assets: entries,
					},
				})
				for (const job of jobs)
					await project.writeFile(
						drawing(job.assetId),
						JSON.stringify({ job, cg: staged.cgReferences.get(job.assetId) }),
					)
				const dependencies = new Map(jobs.map((job) => [job.assetId, job]))
				const byId = new Map(entries.map((entry) => [entry.id, entry]))
				for (const { beats } of output.scenes)
					for (const { actions } of beats)
						for (const { assets } of actions)
							for (const { id } of assets) {
								if (dependencies.has(id) || byId.get(id)?.status === 'drawn')
									continue
								const { job } = await drawingMetadata(id)
								dependencies.set(id, job)
							}
				const sceneIds: string[] = []
				for (const { scene } of output.scenes) {
					if (!scene.id) throw new Error('Missing compiled scene ID')
					sceneIds.push(scene.id)
					ctx.signal.throwIfAborted()
					await project.writeFile(
						projectFiles.scene(ref(ctx.chapterId), scene.id),
						formatScript([scene]),
					)
				}
				const updated = await project.read(
					projectFiles.chapter(ref(ctx.chapterId)),
				)
				ctx.signal.throwIfAborted()
				await project.write(projectFiles.chapter(ref(ctx.chapterId)), {
					...current,
					cg: updated.cg,
					sceneIds,
				})
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
		async draw(job, ctx) {
			const metadata = await drawingMetadata(job.assetId)
			return art(ctx.signal).draw(
				metadata.job,
				(await productionBible(project)).art,
				metadata.cg,
			)
		},
		placeholder(job, issue, signal) {
			return art(signal).savePlaceholder(job.assetId, issue)
		},
	}
	async function drawingMetadata(
		id: string,
	): Promise<{ job: ArtJob; cg?: CgReferences }> {
		return JSON.parse((await project.readFile(drawing(id))).toString())
	}
	return {
		worker,
		art,
		setModels(next: typeof models) {
			models = next
		},
	}
}
