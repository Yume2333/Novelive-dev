import { createHash } from 'node:crypto'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { type AssetRegistry, projectFiles } from '@novelive/format/model'
import { Project } from './index'

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
		const entries = new Map<string, AssetRegistry['entries'][number]>()
		const speakers = new Map<string, string>()
		for (const scope of [
			{ level: 'series' },
			{ level: 'volume', volumeId },
			{ level: 'work', volumeId, workId },
		] as const) {
			const characters = dirname(
				projectFiles.character(scope, 'character').path,
			)
			let files: string[]
			try {
				files = await readdir(join(project.root, characters))
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
				files = []
			}
			for (const file of files
				.filter((file) => file.endsWith('.json'))
				.sort()) {
				const bible = await project.read(
					projectFiles.character(scope, file.slice(0, -5)),
				)
				for (const character of bible.entries)
					speakers.set(character.id, character.name)
			}
			let registry: AssetRegistry
			try {
				registry = await project.read(projectFiles.assetRegistry(scope))
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
				throw error
			}
			for (const entry of registry.entries) entries.set(entry.id, entry)
		}
		const assets = await Promise.all(
			[...entries.values()].map(async (entry) => {
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
		}
	}
	throw { code: 'not_found', message: '工程中找不到这部作品' }
}
