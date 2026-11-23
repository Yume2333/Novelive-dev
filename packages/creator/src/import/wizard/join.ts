import { defaultWorkSettings, projectFiles } from '@novelive/format/model'
import type { ExtractedBook, ImportJoined } from '../../contract/import'
import { Project } from '../../project'
import { joinSeriesVolumes } from '../../project/series'
import { decodeTxt, parseTxt } from '../txt'
import type { ImportWizardView, importTxtProject } from './index'

const invalid = (message: string) => ({ code: 'invalid_config', message })
export type RegisterJoined = (
	workIds: string[],
	projectDir: string,
) => Promise<void>

async function openTarget(projectDir: string, seriesId?: string) {
	let project: Project
	try {
		project = await Project.open(projectDir)
	} catch {
		throw invalid('请选择有效的 Novelive 工程文件夹')
	}
	try {
		const series = await project.read(projectFiles.series)
		if (seriesId !== undefined && series.seriesId !== seriesId)
			throw invalid('所选系列不存在，请重新选择工程')
		for (const volumeId of series.volumeIds) {
			const volume = await project.read(projectFiles.volume(volumeId))
			for (const workId of volume.workIds)
				await project.read(projectFiles.work(volumeId, workId))
		}
		return project
	} catch (error) {
		project.close()
		if ((error as { code?: string }).code === 'invalid_config') throw error
		throw invalid('工程的系列数据无效，请选择有效的 Novelive 工程')
	}
}

export async function readImportTarget(projectDir: string) {
	using project = await openTarget(projectDir)
	const series = await project.read(projectFiles.series)
	return {
		projectDir: project.root,
		seriesId: series.seriesId,
		title: series.title,
	}
}

export async function joinImportedVolumes(
	options: Parameters<typeof importTxtProject>[0],
	bytes: Uint8Array,
	format: ImportWizardView['format'],
	book?: ExtractedBook,
	register?: RegisterJoined,
): Promise<ImportJoined> {
	if (!options.join) throw invalid('请选择要加入的系列')
	using project = await openTarget(
		options.join.projectDir,
		options.join.seriesId,
	)
	if (options.references.length) throw invalid('加入已有系列时不支持添加参考图')
	if (!bytes.length) throw invalid('原文无正文，无法加入系列')
	const series = await project.read(projectFiles.series)
	const firstVolume = series.volumeIds[0]
		? await project.read(projectFiles.volume(series.volumeIds[0]))
		: undefined
	const firstWork = firstVolume?.workIds[0]
		? await project.read(
				projectFiles.work(firstVolume.volumeId, firstVolume.workIds[0]),
			)
		: undefined
	const decoded =
		format === 'txt' ? decodeTxt(bytes, options.encoding) : undefined
	const volumes =
		book?.volumes ??
		parseTxt(decoded?.text ?? '').volumes.map((volume) => ({
			title: volume.title,
			chapters: volume.chapters.map((chapter) => ({
				title: chapter.title,
				paragraphs: chapter.paragraphs.map((paragraph) => paragraph.text),
				notes: chapter.notes,
			})),
		}))
	if (
		!volumes.length ||
		volumes.some(
			(volume) =>
				!volume.chapters.length ||
				volume.chapters.some((chapter) => !chapter.paragraphs.length),
		)
	)
		throw invalid('原文含无正文的卷或章节，无法加入系列')
	const language =
		firstWork?.language ??
		book?.metadata.language ??
		(decoded
			? decoded.encoding === 'shift_jis'
				? 'ja'
				: decoded.encoding === 'big5'
					? 'zh-TW'
					: 'zh-CN'
			: 'zh-CN')
	const links = await joinSeriesVolumes(
		project,
		volumes.map((volume) => ({
			...volume,
			language,
			settings: firstWork ? firstWork.settings : defaultWorkSettings(),
			original: { extension: format === 'markdown' ? 'md' : format, bytes },
		})),
		register && ((workIds) => register(workIds, project.root)),
	)
	const joined = links.map(({ volumeId, workId }, index) => ({
		volumeId,
		workId,
		title: volumes[index].title,
		chapters: volumes[index].chapters.length,
	}))
	return {
		status: 'joined' as const,
		format,
		projectDir: project.root,
		seriesId: series.seriesId,
		workId: joined[0].workId,
		workIds: joined.map((volume) => volume.workId),
		volumes: joined,
	}
}
