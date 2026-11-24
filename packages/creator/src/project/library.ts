import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { projectFiles } from '@novelive/format/model'
import { existing } from '../synthesis/patch'
import { Project } from './index'
import { chapterStates, isChapterPublished } from './publication'

export async function listLibrary(dataDir: string) {
	const bindings = join(dataDir, 'projects')
	const entries = await existing(() =>
		readdir(bindings, { withFileTypes: true }),
	)
	const works = await Promise.allSettled(
		(entries ?? [])
			.filter((entry) => entry.isFile())
			.map(async ({ name: workId }) => {
				using project = await Project.open(
					await readFile(join(bindings, workId), 'utf8'),
				)
				const series = await project.read(projectFiles.series)
				for (const volumeId of series.volumeIds) {
					const volume = await project.read(projectFiles.volume(volumeId))
					if (!volume.workIds.includes(workId)) continue
					const work = await project.read(projectFiles.work(volumeId, workId))
					const states = chapterStates(project, workId)
					let published = 0
					for (const chapterId of work.chapterIds) {
						const hasScenes =
							states.size === 0 &&
							(
								await project.read(
									projectFiles.chapter({ volumeId, workId, chapterId }),
								)
							).sceneIds.length > 0
						if (isChapterPublished(states, chapterId, hasScenes)) published++
					}
					return {
						workId,
						title: work.title,
						published,
						chapters: work.chapterIds.length,
						project: {
							directory: project.root,
							seriesId: series.seriesId,
							seriesTitle: series.title,
							volumeId,
							volumeTitle: volume.title,
							volumeIndex: series.volumeIds.indexOf(volumeId) + 1,
						},
					}
				}
			}),
	)
	const readable = works
		.flatMap((work) =>
			work.status === 'fulfilled' && work.value ? [work.value] : [],
		)
		.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
	return { works: readable, unreadableCount: works.length - readable.length }
}
