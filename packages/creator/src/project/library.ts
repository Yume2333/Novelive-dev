import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { projectFiles } from '@novelive/format/model'
import { existing } from '../synthesis/patch'
import { Project } from './index'

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
					return { workId, title: work.title }
				}
			}),
	)
	return {
		works: works
			.flatMap((work) =>
				work.status === 'fulfilled' && work.value ? [work.value] : [],
			)
			.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN')),
	}
}
