import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { projectFiles } from '@novelive/format/model'
import { Project } from './index'
import { resolveSeries } from './series/resolve'

export async function loadPlayerChapter(
	directory: string,
	workId: string,
	cacheDir: string,
) {
	using project = await Project.open(directory)
	const series = await project.read(projectFiles.series)
	for (const volumeId of series.volumeIds) {
		const volume = await project.read(projectFiles.volume(volumeId))
		if (!volume.workIds.includes(workId)) continue
		const work = await project.read(projectFiles.work(volumeId, workId))
		const chapterId = work.chapterIds[0]
		if (!chapterId) throw { code: 'not_found', message: '作品还没有章节' }
		const ref = { volumeId, workId, chapterId }
		const chapter = await project.read(projectFiles.chapter(ref))
		const scripts = await Promise.all(
			chapter.sceneIds.map(async (sceneId) =>
				(await project.readFile(projectFiles.scene(ref, sceneId))).toString(
					'utf8',
				),
			),
		)
		const effective = await resolveSeries(project, {
			level: 'work',
			volumeId,
			workId,
		})
		const speakers = new Map(
			effective.bible.character.map((entry) => [entry.id, entry.name]),
		)
		const assets = await Promise.all(
			effective.registry.entries.map(async (entry) => {
				const missing = () => ({
					...entry,
					path: `player/unavailable/${createHash('sha256').update(`${project.root}/${entry.id}`).digest('hex')}${extname(entry.path)}`,
				})
				if (entry.status === 'pending') return missing()
				let bytes: Buffer
				try {
					bytes = await project.readFile(entry.path)
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === 'ENOENT')
						return missing()
					throw error
				}
				const hash = createHash('sha256').update(bytes).digest('hex')
				const path = `player/${hash}${extname(entry.path)}`
				const destination = join(cacheDir, path)
				await mkdir(dirname(destination), { recursive: true })
				await writeFile(destination, bytes)
				return { ...entry, path }
			}),
		)
		return {
			script: scripts.join('\n\n'),
			chapter,
			registry: { formatVersion: 1 as const, entries: assets },
			speakers: [...speakers.keys()],
			speakerNames: Object.fromEntries(speakers),
			customMarks: Object.keys(work.settings.customMarks),
		}
	}
	throw { code: 'not_found', message: '工程中找不到这部作品' }
}
