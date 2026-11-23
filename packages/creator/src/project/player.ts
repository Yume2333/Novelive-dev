import { createHash } from 'node:crypto'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { type AssetRegistry, projectFiles } from '@novelive/format/model'
import { Project } from './index'

async function playerChapters(
	project: Project,
	volumeId: string,
	workId: string,
	chapterIds: readonly string[],
) {
	const states = project.database
		.prepare('SELECT chapter_id, user_state FROM chapter WHERE work_id = ?')
		.all(workId)
	return Promise.all(
		chapterIds.map(async (chapterId) => {
			const document = await project.read(
				projectFiles.chapter({ volumeId, workId, chapterId }),
			)
			const state = states.find(
				(row) => row.chapter_id === chapterId,
			)?.user_state
			const task = project.database
				.prepare(
					"SELECT phase FROM task WHERE work_id = ? AND ref_id = ? AND kind IN ('chapter', 'redo_chapter') ORDER BY seq DESC LIMIT 1",
				)
				.get(workId, chapterId)
			const phases: Record<string, string> = {
				write: '写作',
				review: '审稿',
				stage: '演出',
				await_draw: '出图',
				queued: '等待',
				done: '完成',
			}
			return {
				chapterId,
				title: document.title,
				published:
					state === 'published' ||
					(states.length === 0 && document.sceneIds.length > 0),
				progress:
					state === 'producing'
						? `制作中 · ${phases[String(task?.phase)] ?? '等待'}`
						: state === 'published'
							? '已发布'
							: '等待',
			}
		}),
	)
}

export async function loadPlayerStatus(directory: string, workId: string) {
	using project = await Project.open(directory)
	const series = await project.read(projectFiles.series)
	for (const volumeId of series.volumeIds) {
		const volume = await project.read(projectFiles.volume(volumeId))
		if (!volume.workIds.includes(workId)) continue
		const work = await project.read(projectFiles.work(volumeId, workId))
		return {
			chapters: await playerChapters(
				project,
				volumeId,
				workId,
				work.chapterIds,
			),
		}
	}
	throw { code: 'not_found', message: '工程中找不到这部作品' }
}

export async function loadPlayerChapter(
	directory: string,
	workId: string,
	cacheDir: string,
	selectedChapterId?: string,
) {
	using project = await Project.open(directory)
	const series = await project.read(projectFiles.series)
	for (const volumeId of series.volumeIds) {
		const volume = await project.read(projectFiles.volume(volumeId))
		if (!volume.workIds.includes(workId)) continue
		const work = await project.read(projectFiles.work(volumeId, workId))
		const chapters = await playerChapters(
			project,
			volumeId,
			workId,
			work.chapterIds,
		)
		const chapterId = selectedChapterId ?? work.chapterIds[0]
		if (!chapterId) throw { code: 'not_found', message: '作品还没有章节' }
		if (!chapters.find((chapter) => chapter.chapterId === chapterId)?.published)
			throw { code: 'not_found', message: '章节尚未发布' }
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
			chapters,
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
