import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { type ChapterRef, projectFiles } from '@novelive/format/model'
import { Project } from './index'
import { chapterStates, isChapterPublished } from './publication'
import { resolveBible, resolveRegistry } from './series/resolve'

async function playerChapters(
	project: Project,
	volumeId: string,
	workId: string,
	chapterIds: readonly string[],
) {
	const states = chapterStates(project, workId)
	return Promise.all(
		chapterIds.map(async (chapterId) => {
			const document = await project.read(
				projectFiles.chapter({ volumeId, workId, chapterId }),
			)
			const state = states.get(chapterId)
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
				published: isChapterPublished(
					states,
					chapterId,
					document.published ?? document.sceneIds.length > 0,
				),
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

async function playerWork(project: Project, workId: string) {
	const series = await project.read(projectFiles.series)
	for (const volumeId of series.volumeIds) {
		const volume = await project.read(projectFiles.volume(volumeId))
		if (!volume.workIds.includes(workId)) continue
		return {
			volumeId,
			work: await project.read(projectFiles.work(volumeId, workId)),
		}
	}
	throw { code: 'not_found', message: '工程中找不到这部作品' }
}

export async function loadPlayerStatus(directory: string, workId: string) {
	using project = await Project.open(directory)
	const { volumeId, work } = await playerWork(project, workId)
	return {
		chapters: await playerChapters(project, volumeId, workId, work.chapterIds),
	}
}

async function readPlayerScript(project: Project, ref: ChapterRef) {
	const chapter = await project.read(projectFiles.chapter(ref))
	const scripts = await Promise.all(
		chapter.sceneIds.map(async (sceneId) =>
			(await project.readFile(projectFiles.scene(ref, sceneId))).toString(
				'utf8',
			),
		),
	)
	return { chapter, script: scripts.join('\n\n') }
}

async function readPlayerResources(
	project: Project,
	volumeId: string,
	workId: string,
) {
	const scope = { level: 'work', volumeId, workId } as const
	const [bible, registry] = await Promise.all([
		resolveBible(project, scope),
		resolveRegistry(project, scope),
	])
	const characters = bible.character.map(({ id, name }) => [id, name] as const)
	return {
		registry,
		speakers: characters.map(([id]) => id),
		speakerNames: Object.fromEntries(characters),
	}
}

export async function* loadPlayerCompilation(
	directory: string,
	workId: string,
	chapterIds: readonly string[],
) {
	using project = await Project.open(directory)
	const { volumeId, work } = await playerWork(project, workId)
	const resources = await readPlayerResources(project, volumeId, workId)
	for (const chapterId of chapterIds) {
		yield {
			chapterId,
			...(await readPlayerScript(project, { volumeId, workId, chapterId })),
			...resources,
			customMarks: work.settings.customMarks,
		}
	}
}

export async function loadPlayerChapter(
	directory: string,
	workId: string,
	cacheDir: string,
	selectedChapterId?: string,
) {
	using project = await Project.open(directory)
	const { volumeId, work } = await playerWork(project, workId)
	const chapters = await playerChapters(
		project,
		volumeId,
		workId,
		work.chapterIds,
	)
	if (!chapters.length) throw { code: 'not_found', message: '作品还没有章节' }
	const selected = chapters.find(
		(chapter) =>
			chapter.published &&
			(selectedChapterId === undefined ||
				chapter.chapterId === selectedChapterId),
	)
	if (!selected) throw { code: 'not_found', message: '章节尚未发布' }
	const { chapterId } = selected
	const [{ chapter, script }, { registry, speakers, speakerNames }] =
		await Promise.all([
			readPlayerScript(project, { volumeId, workId, chapterId }),
			readPlayerResources(project, volumeId, workId),
		])
	const assets = await Promise.all(
		registry.entries.map(async (entry) => {
			const missing = () => ({
				...entry,
				path: `player/unavailable/${createHash('sha256').update(`${project.root}/${entry.id}`).digest('hex')}${extname(entry.path)}`,
			})
			if (entry.status === 'pending') return missing()
			let bytes: Buffer
			try {
				bytes = await project.readFile(entry.path)
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'ENOENT') return missing()
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
		script,
		chapter,
		registry: { formatVersion: 1 as const, entries: assets },
		speakers,
		speakerNames,
		customMarks: work.settings.customMarks,
	}
}
