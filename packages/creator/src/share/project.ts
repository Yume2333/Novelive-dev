import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { projectFiles } from '@novelive/format/model'
import { forkWorkIdentity } from '@novelive/format/package'
import {
	exportPackage,
	PackageCodecError,
	type PackageExportOptions,
	type WorkPackage,
} from '@novelive/format/package/codec'
import { Project } from '../project'
import { openProjectDatabase } from '../project/database'
import { optionalFile, scopeLevels } from '../project/series/resolve'

export async function previewExport({
	projectRoot,
	scope,
}: Omit<PackageExportOptions, 'destination'>) {
	using project = await Project.open(projectRoot)
	const series = await project.read(projectFiles.series)
	const volumes = scope.level === 'series' ? series.volumeIds : [scope.volumeId]
	if (volumes.some((id) => !series.volumeIds.includes(id)))
		throw new PackageCodecError(
			'invalid_selection',
			'Volume is not in the series',
		)
	const warnings: { workId: string; chapterId: string; title: string }[] = []
	let selected = 0
	for (const volumeId of volumes) {
		const volume = await project.read(projectFiles.volume(volumeId))
		for (const workId of volume.workIds) {
			if (scope.level === 'work' && workId !== scope.workId) continue
			selected++
			const rows = project.database
				.prepare(
					'SELECT chapter_id FROM chapter WHERE work_id = ? AND placeholder = 1 ORDER BY ord',
				)
				.all(workId)
			for (const row of rows) {
				const chapterId = String(row.chapter_id)
				const { title } = await project.read(
					projectFiles.chapter({ volumeId, workId, chapterId }),
				)
				warnings.push({ workId, chapterId, title })
			}
		}
	}
	if (!selected)
		throw new PackageCodecError(
			'invalid_selection',
			'Selection contains no works',
		)
	return warnings
}

export async function exportProject(options: PackageExportOptions) {
	using project = await Project.open(options.projectRoot)
	const released = await exportPackage(options)
	for (const { volumeId, work } of released) {
		const file = projectFiles.work(volumeId, work.workId)
		const current = await project.read(file)
		await project.write(file, { ...current, version: work.version })
	}
	return released.map(({ work: { workId, version } }) => ({ workId, version }))
}

export function initializeExtractedProject(root: string) {
	openProjectDatabase(join(root, projectFiles.database), true).close()
}

export async function importProject(
	archive: WorkPackage,
	parent: string,
	dataDir: string,
) {
	const projectRoot = join(parent, `${archive.series.seriesId}-${randomUUID()}`)
	const registered: string[] = []
	await archive.extractTo(projectRoot)
	try {
		initializeExtractedProject(projectRoot)
		using project = await Project.open(projectRoot)
		const ids = new Map(
			archive.works.map(({ work }) => [work.workId, randomUUID()]),
		)
		const renamed = new Map<string, string>()
		const registries = new Map<
			string,
			ReturnType<typeof projectFiles.assetRegistry>
		>()
		for (const { volumeId, work } of archive.works) {
			const workId = ids.get(work.workId)!
			const old = projectFiles
				.work(volumeId, work.workId)
				.path.replace(/work\.json$/, '')
			const next = projectFiles
				.work(volumeId, workId)
				.path.replace(/work\.json$/, '')
			await rename(join(projectRoot, old), join(projectRoot, next))
			renamed.set(old, next)
			await project.write(projectFiles.work(volumeId, workId), {
				...work,
				...forkWorkIdentity(
					{ workId: work.workId, version: work.version },
					workId,
				),
			})
			project.tasks.registerWork({ workId, title: work.title })
			project.database
				.prepare("UPDATE work SET status = 'done' WHERE work_id = ?")
				.run(workId)
			for (const [ord, chapterId] of work.chapterIds.entries()) {
				const chapter = await project.read(
					projectFiles.chapter({ volumeId, workId, chapterId }),
				)
				const published = chapter.sceneIds.length > 0
				project.database
					.prepare(
						'INSERT INTO chapter (work_id, chapter_id, ord, user_state) VALUES (?, ?, ?, ?)',
					)
					.run(workId, chapterId, ord, published ? 'published' : 'waiting')
				const taskId = randomUUID()
				project.tasks.enqueue({
					taskId,
					workId,
					kind: 'chapter',
					refId: chapterId,
				})
				project.database
					.prepare(
						"UPDATE task SET status = 'done', phase = 'done' WHERE task_id = ?",
					)
					.run(taskId)
			}
			for (const level of scopeLevels({ level: 'work', volumeId, workId })) {
				const file = projectFiles.assetRegistry(level)
				registries.set(file.path, file)
			}
		}
		for (const file of registries.values()) {
			const registry = await optionalFile(() => project.read(file))
			if (!registry) continue
			for (const asset of registry.entries) {
				for (const [old, next] of renamed) {
					if (asset.path.startsWith(old)) {
						asset.path = next + asset.path.slice(old.length)
						break
					}
				}
			}
			await project.write(file, registry)
		}
		for (const volumeId of archive.series.volumeIds) {
			const file = projectFiles.volume(volumeId)
			const volume = await project.read(file)
			await project.write(file, {
				...volume,
				workIds: volume.workIds.map((id) => ids.get(id)!),
			})
		}
		const bindings = join(dataDir, 'projects')
		await mkdir(bindings, { recursive: true })
		for (const id of ids.values()) {
			const file = join(bindings, id)
			await writeFile(file, projectRoot, { flag: 'wx' })
			registered.push(file)
		}
		return { projectRoot, workIds: [...ids.values()] }
	} catch (error) {
		await Promise.all(registered.map((file) => rm(file, { force: true })))
		await rm(projectRoot, { recursive: true, force: true })
		throw error
	}
}
