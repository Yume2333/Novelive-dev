import { projectFiles } from '@novelive/format/model'
import { applyBibleProposal, bibleRevision } from '../bible/editing'
import type { createConfigStore } from '../config'
import type { CreativeRevisions } from '../editor/revisions'
import type { Project } from '../project'
import type { ReplayOptions } from '../replay'
import { readBible, validatePatch } from '../synthesis/patch'
import { usageMethods } from '../usage'
import { type ChatEvent, ChatService, type ProposalActions } from './index'

const isStale = (error: unknown) =>
	!!error &&
	typeof error === 'object' &&
	'code' in error &&
	error.code === 'stale_revision'

export function projectProposals(
	project: Project,
	workId: string,
	revisions?: CreativeRevisions,
): ProposalActions {
	return {
		async prepare(intent, signal) {
			signal.throwIfAborted()
			if (
				revisions &&
				(intent.kind === 'rewriteScene' ||
					intent.kind === 'redrawImage' ||
					intent.kind === 'redoChapter')
			) {
				if (intent.kind === 'redrawImage')
					return {
						prompt: intent.reason,
						chapterIds: [],
						payload: {
							kind: 'redrawImage',
							assetId: intent.assetId,
							expectedRevision: await revisions.imageRevision(intent.assetId),
							...(intent.instruction
								? { instruction: intent.instruction }
								: {}),
						},
					}
				const expectedRevision = await (intent.kind === 'redoChapter'
					? revisions.redoChapterRevision(intent.chapterId)
					: revisions.chapterRevision(intent.chapterId))
				return {
					prompt: intent.reason,
					chapterIds: [intent.chapterId],
					payload:
						intent.kind === 'redoChapter'
							? {
									kind: 'redoChapter',
									chapterId: intent.chapterId,
									expectedRevision,
								}
							: {
									kind: 'rewriteScene',
									request: {
										workId,
										chapterId: intent.chapterId,
										sceneId: intent.sceneId,
										instruction: intent.instruction,
										expectedRevision,
									},
								},
				}
			}
			if (intent.kind !== 'bible' && intent.kind !== 'glossary')
				throw { code: 'unsupported', message: '此类提议的工程执行器尚未接通' }
			const volume = await project.read(projectFiles.volume(intent.volumeId))
			if (!volume.workIds.includes(workId))
				throw { code: 'not_found', message: '工程中找不到这部作品或卷' }
			const bible = await readBible(project)
			const chapters = new Set<string>()
			const series = await project.read(projectFiles.series)
			for (const volumeId of series.volumeIds) {
				const volume = await project.read(projectFiles.volume(volumeId))
				for (const id of volume.workIds) {
					const work = await project.read(projectFiles.work(volumeId, id))
					for (const chapter of work.chapterIds) chapters.add(chapter)
				}
			}
			validatePatch(
				bible,
				intent.kind === 'bible' ? intent.changes : [],
				intent.kind === 'glossary' ? intent.changes : [],
				chapters,
				chapters,
				false,
			)
			signal.throwIfAborted()
			const { reason, ...payload } = intent
			return {
				prompt: reason,
				chapterIds: (
					await project.read(projectFiles.work(intent.volumeId, workId))
				).chapterIds,
				payload: {
					...payload,
					expectedRevision: bibleRevision(bible),
				},
			}
		},
		async applyIfCurrent(proposal, signal) {
			signal.throwIfAborted()
			if (proposal.workId !== workId)
				throw { code: 'not_found', message: '提议不属于当前作品' }
			const { payload } = proposal
			if (
				revisions &&
				(payload.kind === 'rewriteScene' ||
					payload.kind === 'redrawImage' ||
					payload.kind === 'redoChapter')
			) {
				try {
					if (payload.kind === 'rewriteScene')
						return {
							status: 'applied',
							rewrite: await revisions.rewriteScene(payload.request, signal),
						}
					if (payload.kind === 'redrawImage')
						await revisions.regenerateImage(
							{
								workId,
								assetId: payload.assetId,
								expectedRevision: payload.expectedRevision,
								count: 1,
								...(payload.instruction
									? { instruction: payload.instruction }
									: {}),
							},
							signal,
						)
					else
						await revisions.redoChapter({
							workId,
							chapterId: payload.chapterId,
							expectedRevision: payload.expectedRevision,
						})
					return { status: 'applied' }
				} catch (error) {
					if (isStale(error)) return { status: 'stale' }
					throw error
				}
			}
			if (
				proposal.payload.kind !== 'bible' &&
				proposal.payload.kind !== 'glossary'
			)
				throw { code: 'unsupported', message: '此类提议的工程执行器尚未接通' }
			return applyBibleProposal(project, proposal)
		},
	}
}

export async function projectChat(
	project: Project,
	workId: string,
	config: ReturnType<typeof createConfigStore>,
	cacheDir: string,
	replay: ReplayOptions | undefined,
	emit: (event: ChatEvent) => void,
	revisions?: CreativeRevisions,
) {
	const series = await project.read(projectFiles.series)
	let title: string | undefined
	for (const volumeId of series.volumeIds) {
		const volume = await project.read(projectFiles.volume(volumeId))
		if (!volume.workIds.includes(workId)) continue
		title = (await project.read(projectFiles.work(volumeId, workId))).title
		break
	}
	if (title === undefined)
		throw { code: 'not_found', message: '工程中找不到这部作品' }
	project.database
		.prepare(
			'INSERT OR IGNORE INTO work (work_id, title, queue_pos, created_at) VALUES (?, ?, 0, ?)',
		)
		.run(workId, title, Date.now())
	return usageMethods(
		new ChatService({
			database: project.database,
			workId,
			cacheDir,
			mainModel: () => config.resolveTextModel('main'),
			summaryModel: () => config.resolveTextModel('fast'),
			proposals: projectProposals(project, workId, revisions),
			instructions: (position) =>
				position ? `Current creator position: ${JSON.stringify(position)}` : '',
			replay,
			emit,
		}),
		project,
		workId,
		'chat',
	)
}
