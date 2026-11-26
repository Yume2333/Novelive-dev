import { randomUUID } from 'node:crypto'
import {
	defaultWorkSettings,
	formatVersion,
	type ImportReport,
	projectFiles,
	type WorkSettings,
} from '@novelive/format/model'
import { ImportFailureError } from '../../contract/errors'
import type { Project } from '../../project'
import { decodeTxt, type TxtEncoding } from './encoding'
import {
	type HeadingRule,
	parseTxt,
	type TxtStructure,
	type TxtVolume,
} from './structure'

export {
	decodeTxt,
	detectTxtEncoding,
	encodings,
	type TxtEncoding,
	TxtEncodingError,
} from './encoding'
export {
	type HeadingRule,
	headingRules,
	MAX_CHAPTER_CHARS,
	parseTxt,
	type TxtStructure,
	type TxtVolume,
} from './structure'

export interface TxtImportOptions {
	title: string
	language?: string
	encoding?: TxtEncoding
	rules?: HeadingRule[]
	cleanupRules?: RegExp[]
}

export async function importTxt(
	project: Project,
	bytes: Uint8Array,
	options: TxtImportOptions,
) {
	const series = await project.read(projectFiles.series)
	if (series.volumeIds.length)
		throw new ImportFailureError(
			'project_not_empty',
			'TXT import requires an empty project',
		)
	const decoded = decodeTxt(bytes, options.encoding)
	const structure = parseTxt(decoded.text, options)
	const language =
		options.language ??
		(decoded.encoding === 'shift_jis'
			? 'ja'
			: decoded.encoding === 'big5'
				? 'zh-TW'
				: 'zh-CN')
	const report: ImportReport & {
		encoding: TxtEncoding
		structure: TxtStructure
	} = {
		formatVersion,
		check: {
			title: options.title,
			language,
			chapterFindings: structure.findings.map((finding) => {
				const chapters = structure.volumes.flatMap((volume) => volume.chapters)
				const chapter =
					chapters.findLast((chapter) => chapter.line <= finding.line) ??
					chapters[0]
				return {
					chapterId: chapter.chapterId,
					note: `${finding.code}: ${finding.note} (line ${finding.line}: ${finding.title})`,
				}
			}),
		},
		volumeSuggestions: structure.volumes
			.filter((volume) => volume.chapters.length)
			.map((volume) => ({
				title: volume.title,
				firstChapterId: volume.chapters[0].chapterId,
				lastChapterId: volume.chapters[volume.chapters.length - 1].chapterId,
			})),
		encoding: decoded.encoding,
		structure,
	}
	await project.writeFile(projectFiles.original('txt'), bytes)
	await writeTxtLayout(project, structure.volumes, {
		title: options.title,
		language,
	})
	await project.write(projectFiles.importReport, report)
	await project.write(projectFiles.series, {
		...series,
		volumeIds: structure.volumes.map((volume) => volume.volumeId),
	})
	return report
}

export async function writeTxtLayout(
	project: Project,
	volumes: TxtVolume[],
	options: {
		title: string
		language: string
		workIds?: string[]
		settings?: WorkSettings
	},
) {
	for (const [index, volume] of volumes.entries()) {
		const workId = options.workIds?.[index] ?? randomUUID()
		await project.write(projectFiles.volume(volume.volumeId), {
			formatVersion,
			volumeId: volume.volumeId,
			title: volume.title,
			workIds: [workId],
		})
		await project.write(projectFiles.work(volume.volumeId, workId), {
			formatVersion,
			workId,
			title: options.title,
			chapterIds: volume.chapters.map((chapter) => chapter.chapterId),
			version: 0,
			minReaderVersion: 1,
			appVersion: '0.1.0',
			language: options.language,
			settings: options.settings ?? defaultWorkSettings(),
		})
		for (const chapter of volume.chapters) {
			await project.write(
				projectFiles.chapter({
					volumeId: volume.volumeId,
					workId,
					chapterId: chapter.chapterId,
				}),
				{
					formatVersion,
					chapterId: chapter.chapterId,
					title: chapter.title,
					paragraphIds: chapter.paragraphs.map((paragraph) => paragraph.id),
					sceneIds: [],
					cg: [],
				},
			)
			await project.writeFile(
				projectFiles.chapterText(chapter.chapterId),
				chapter.paragraphs.map((paragraph) => paragraph.text).join('\n\n') +
					(chapter.paragraphs.length ? '\n' : ''),
			)
			await project.writeFile(
				projectFiles.chapterNotes(chapter.chapterId),
				chapter.notes.join('\n') + (chapter.notes.length ? '\n' : ''),
			)
		}
	}
}
