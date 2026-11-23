import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
	defaultWorkSettings,
	formatVersion,
	projectFiles,
	type WorkSettings,
} from '@novelive/format/model'
import type { Project } from '../index'

export type JoinBook = {
	title: string
	language: string
	chapters: readonly {
		title: string
		paragraphs: readonly string[]
		notes?: readonly string[]
	}[]
	original?: {
		extension: 'txt' | 'epub' | 'md' | 'docx' | 'pdf'
		bytes: Uint8Array
	}
	settings?: WorkSettings
}

const pendingJoins = new Map<string, Promise<unknown>>()

export async function joinSeries(project: Project, book: JoinBook) {
	const [volume] = await joinSeriesVolumes(project, [book])
	return volume
}

export async function joinSeriesVolumes(
	project: Project,
	books: readonly JoinBook[],
	beforePublish?: (workIds: string[]) => Promise<void>,
) {
	const previous = pendingJoins.get(project.root) ?? Promise.resolve()
	const running = previous
		.catch(() => {})
		.then(() => appendVolumes(project, books, beforePublish))
	pendingJoins.set(project.root, running)
	try {
		return await running
	} finally {
		if (pendingJoins.get(project.root) === running)
			pendingJoins.delete(project.root)
	}
}

function planVolume(book: JoinBook) {
	if (
		!book.title.trim() ||
		!book.language.trim() ||
		!book.chapters.length ||
		book.chapters.some(
			(chapter) =>
				!chapter.title.trim() ||
				!chapter.paragraphs.length ||
				chapter.paragraphs.some((text) => !text.length),
		)
	)
		throw new Error(
			'Joining a series requires a title, language and nonempty chapters',
		)
	const volumeId = `joined-${randomUUID()}`
	const workId = randomUUID()
	const chapterIds = book.chapters.map(
		(_, index) => `${volumeId}-ch${index + 1}`,
	)
	return { book, volumeId, workId, chapterIds }
}

async function appendVolumes(
	project: Project,
	books: readonly JoinBook[],
	beforePublish?: (workIds: string[]) => Promise<void>,
) {
	const volumes = books.map(planVolume)
	const series = await project.read(projectFiles.series)
	const staged = []
	try {
		for (const volume of volumes) {
			staged.push(volume)
			await writeVolume(project, volume)
		}
		await beforePublish?.(volumes.map(({ workId }) => workId))
		await project.write(projectFiles.series, {
			...series,
			volumeIds: [
				...series.volumeIds,
				...volumes.map(({ volumeId }) => volumeId),
			],
		})
	} catch (error) {
		await Promise.allSettled(
			staged.flatMap(({ volumeId, chapterIds }) =>
				[
					`volumes/${volumeId}`,
					`source/imports/${volumeId}`,
					...chapterIds.flatMap((chapterId) => [
						projectFiles.chapterText(chapterId),
						projectFiles.chapterNotes(chapterId),
					]),
				].map((path) =>
					rm(join(project.root, path), { force: true, recursive: true }),
				),
			),
		)
		throw error
	}
	return volumes.map(({ volumeId, workId, chapterIds }) => ({
		seriesId: series.seriesId,
		volumeId,
		workId,
		chapterIds,
	}))
}

async function writeVolume(
	project: Project,
	{ book, volumeId, workId, chapterIds }: ReturnType<typeof planVolume>,
) {
	const sourceDir = `source/imports/${volumeId}`
	await mkdir(join(project.root, 'volumes'), { recursive: true })
	await mkdir(join(project.root, 'volumes', volumeId))
	await mkdir(join(project.root, 'source', 'imports'), { recursive: true })
	await mkdir(join(project.root, sourceDir))
	await mkdir(join(project.root, 'source', 'chapters'), { recursive: true })
	for (const [index, chapter] of book.chapters.entries()) {
		const chapterId = chapterIds[index]
		await writeFile(
			join(project.root, projectFiles.chapterText(chapterId)),
			`${chapter.paragraphs.join('\n\n')}\n`,
			{ flag: 'wx' },
		)
		await writeFile(
			join(project.root, projectFiles.chapterNotes(chapterId)),
			(chapter.notes ?? []).join('\n'),
			{ flag: 'wx' },
		)
		await project.write(projectFiles.chapter({ volumeId, workId, chapterId }), {
			formatVersion,
			chapterId,
			title: chapter.title,
			paragraphIds: chapter.paragraphs.map(
				(_, i) => `p${String(i + 1).padStart(4, '0')}`,
			),
			sceneIds: [],
			cg: [],
		})
	}
	if (book.original)
		await writeFile(
			join(project.root, sourceDir, `original.${book.original.extension}`),
			book.original.bytes,
			{ flag: 'wx' },
		)
	await project.write(projectFiles.work(volumeId, workId), {
		formatVersion,
		workId,
		title: book.title,
		language: book.language,
		chapterIds,
		version: 0,
		minReaderVersion: 1,
		appVersion: '0.1.0',
		settings: book.settings ?? defaultWorkSettings(),
	})
	await project.write(projectFiles.volume(volumeId), {
		formatVersion,
		volumeId,
		title: book.title,
		workIds: [workId],
	})
}
