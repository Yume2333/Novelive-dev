import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
	type BiblePatch,
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
	biblePatch?: BiblePatch
}

export async function joinSeries(project: Project, book: JoinBook) {
	if (book.biblePatch?.some(({ op }) => op === 'delete'))
		throw new Error('Joining a series cannot delete existing entries')
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
	const series = await project.read(projectFiles.series)
	const volumeId = `joined-${randomUUID()}`
	const workId = randomUUID()
	const sourceDir = `source/imports/${volumeId}`
	await mkdir(join(project.root, 'volumes'), { recursive: true })
	await mkdir(join(project.root, 'volumes', volumeId))
	await mkdir(join(project.root, 'source', 'imports'), { recursive: true })
	await mkdir(join(project.root, sourceDir))
	await mkdir(join(project.root, 'source', 'chapters'), { recursive: true })
	const chapterIds = book.chapters.map(
		(_, index) => `${volumeId}-ch${index + 1}`,
	)
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
	await project.write(projectFiles.series, {
		...series,
		volumeIds: [...series.volumeIds, volumeId],
	})
	return { seriesId: series.seriesId, volumeId, workId, chapterIds }
}
