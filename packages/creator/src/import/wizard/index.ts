import { copyFile, mkdir, readFile, rm } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import {
	formatVersion,
	type ImportReport,
	projectFiles,
} from '@novelive/format/model'
import { Project } from '../../project'
import {
	detectTxtEncoding,
	importTxt,
	type TxtEncoding,
	type TxtStructure,
	type TxtVolume,
	writeTxtLayout,
} from '../txt'

export interface ImportLayout {
	title: string
	language: string
	confirmWithReferences: boolean
	/** `start` is the chapter's first paragraph across the whole book. */
	chapters: { title: string; start: number }[]
	/** `start` is the index of the volume's first chapter. */
	volumes: { title: string; start: number }[]
}

export interface ImportWizardView {
	status: 'ready'
	projectDir: string
	workId: string
	encoding: TxtEncoding
	paragraphs: number
	layout: ImportLayout
	suggested: ImportLayout
	findings: { paragraph: number; note: string }[]
	references: string[]
}

type WizardReport = ImportReport & {
	encoding: TxtEncoding
	structure: TxtStructure
	references?: string[]
	layout?: ImportLayout
}

const referenceTypes = new Set(['.png', '.jpg', '.jpeg', '.webp'])

const invalid = (message: string) => ({ code: 'invalid_config', message })

function originals(structure: TxtStructure) {
	let start = 0
	return structure.volumes.flatMap((volume) =>
		volume.chapters.map((chapter) => {
			const item = { chapter, start }
			start += chapter.paragraphs.length
			return item
		}),
	)
}

function suggestedLayout(
	structure: TxtStructure,
	title: string,
	language: string,
	confirmWithReferences: boolean,
): ImportLayout {
	const chapters = originals(structure)
	const volumes: ImportLayout['volumes'] = []
	let index = 0
	for (const volume of structure.volumes) {
		if (volume.chapters.length)
			volumes.push({ title: volume.title, start: index })
		index += volume.chapters.length
	}
	return {
		title,
		language,
		confirmWithReferences,
		chapters: chapters.map(({ chapter, start }) => ({
			title: chapter.title,
			start,
		})),
		volumes,
	}
}

export function validateLayout(layout: ImportLayout, paragraphs: number) {
	const { chapters, volumes } = layout
	if (!layout.title.trim()) throw invalid('作品名不能为空')
	if (!chapters.length || chapters[0].start !== 0)
		throw invalid('第一章必须从正文开头开始')
	for (const [i, chapter] of chapters.entries()) {
		if (!chapter.title.trim()) throw invalid(`第 ${i + 1} 章缺少标题`)
		if (
			chapter.start > paragraphs ||
			(i && chapter.start < chapters[i - 1].start)
		)
			throw invalid('章节划分顺序无效')
	}
	if (!volumes.length || volumes[0].start !== 0)
		throw invalid('第一卷必须从第一章开始')
	for (const [i, volume] of volumes.entries()) {
		if (!volume.title.trim()) throw invalid(`第 ${i + 1} 卷缺少标题`)
		if (
			volume.start >= chapters.length ||
			(i && volume.start <= volumes[i - 1].start)
		)
			throw invalid('分卷顺序无效')
	}
}

/** Rebuilds volumes and chapters from the M1a structure; the suggested layout reproduces it exactly. */
export function applyLayout(
	structure: TxtStructure,
	layout: ImportLayout,
): TxtVolume[] {
	const sources = originals(structure)
	const paragraphs = sources.flatMap(({ chapter }) => chapter.paragraphs)
	validateLayout(layout, paragraphs.length)
	const { chapters } = layout
	const end = (i: number) => chapters[i + 1]?.start ?? paragraphs.length
	const notes = chapters.map(() => [] as string[])
	const lines = chapters.map(() => 1)
	const seen = new Map<number, number>()
	for (const { chapter, start } of sources) {
		const rank = seen.get(start) ?? 0
		seen.set(start, rank + 1)
		const exact = chapters.flatMap((item, i) =>
			item.start === start ? [i] : [],
		)
		const target = exact.length
			? exact[Math.min(rank, exact.length - 1)]
			: chapters.findLastIndex((item) => item.start < start)
		notes[target].push(...chapter.notes)
		if (!rank && exact.length) lines[target] = chapter.line
	}
	return layout.volumes.map((volume, v) => ({
		volumeId: `v${String(v + 1).padStart(4, '0')}`,
		title: volume.title.trim(),
		chapters: chapters
			.slice(volume.start, layout.volumes[v + 1]?.start ?? chapters.length)
			.map((chapter, offset) => {
				const i = volume.start + offset
				return {
					chapterId: `ch${String(i + 1).padStart(4, '0')}`,
					title: chapter.title.trim(),
					line: lines[i],
					paragraphs: paragraphs
						.slice(chapter.start, end(i))
						.map((paragraph, p) => ({
							id: `p${String(p + 1).padStart(4, '0')}`,
							text: paragraph.text,
						})),
					notes: notes[i],
				}
			}),
	}))
}

function findingParagraphs(structure: TxtStructure) {
	const sources = originals(structure)
	return structure.findings.map((finding) => ({
		paragraph: (
			sources.findLast(({ chapter }) => chapter.line <= finding.line) ??
			sources[0]
		).start,
		note: finding.title ? `${finding.note}：${finding.title}` : finding.note,
		record: `${finding.code}: ${finding.note} (line ${finding.line}: ${finding.title})`,
	}))
}

async function workIds(project: Project) {
	const series = await project.read(projectFiles.series)
	return Promise.all(
		series.volumeIds.map(
			async (volumeId) =>
				(await project.read(projectFiles.volume(volumeId))).workIds[0],
		),
	)
}

async function firstSettings(project: Project) {
	const series = await project.read(projectFiles.series)
	const volumeId = series.volumeIds[0]
	const [workId] = (await project.read(projectFiles.volume(volumeId))).workIds
	return (await project.read(projectFiles.work(volumeId, workId))).settings
}

export async function readImportWizard(
	project: Project,
): Promise<ImportWizardView> {
	const report = (await project.read(projectFiles.importReport)) as WizardReport
	const title = report.check?.title ?? ''
	const language = report.check?.language ?? 'zh-CN'
	const { confirmWithReferences } = await firstSettings(project)
	const suggested = suggestedLayout(
		report.structure,
		title,
		language,
		confirmWithReferences,
	)
	return {
		status: 'ready',
		projectDir: project.root,
		workId: (await workIds(project))[0],
		encoding: report.encoding,
		paragraphs: originals(report.structure).reduce(
			(sum, { chapter }) => sum + chapter.paragraphs.length,
			0,
		),
		layout: report.layout ?? suggested,
		suggested,
		findings: findingParagraphs(report.structure).map(
			({ paragraph, note }) => ({
				paragraph,
				note,
			}),
		),
		references: report.references ?? [],
	}
}

function folderName(title: string) {
	return (
		title
			.trim()
			.replace(/[\\/:*?"<>|\p{Cc}]/gu, '_')
			.replace(/[. ]+$/, '') || 'novelive'
	)
}

export async function importTxtProject(options: {
	sourcePath: string
	folder: string
	title: string
	encoding?: TxtEncoding
	references: string[]
}) {
	for (const path of options.references)
		if (!referenceTypes.has(extname(path).toLowerCase()))
			throw invalid(`不支持的参考图格式：${basename(path)}`)
	const bytes = await readFile(options.sourcePath)
	if (!options.encoding) {
		const candidates = detectTxtEncoding(bytes)
		if (!candidates.length)
			throw { code: 'unsupported', message: '无法识别原文编码' }
		if (candidates.length > 1)
			return {
				status: 'encoding' as const,
				candidates: candidates.map(({ encoding, preview }) => ({
					encoding,
					preview,
				})),
			}
	}
	const root = join(options.folder, folderName(options.title))
	let project: Project
	try {
		project = await Project.create(root, {
			formatVersion,
			seriesId: 'series',
			title: options.title.trim(),
			volumeIds: [],
		})
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'EEXIST')
			throw invalid(`该位置已有同名文件夹：${root}`)
		throw error
	}
	using opened = project
	try {
		await importTxt(opened, bytes, {
			title: options.title.trim(),
			encoding: options.encoding,
		})
		const references: string[] = []
		await mkdir(join(opened.root, 'source/references'), { recursive: true })
		for (const [i, path] of options.references.entries()) {
			const relative = `source/references/${String(i + 1).padStart(2, '0')}${extname(path).toLowerCase()}`
			await copyFile(path, join(opened.root, relative))
			references.push(relative)
		}
		const report = (await opened.read(
			projectFiles.importReport,
		)) as WizardReport
		const next: WizardReport = { ...report, references }
		await opened.write(projectFiles.importReport, next)
		return await readImportWizard(opened)
	} catch (error) {
		await rm(root, { recursive: true, force: true })
		throw error
	}
}

export async function reviseTxtProject(
	projectDir: string,
	layout: ImportLayout,
) {
	using project = await Project.open(projectDir)
	const report = (await project.read(projectFiles.importReport)) as WizardReport
	const volumes = applyLayout(report.structure, layout)
	const ids = await workIds(project)
	const settings = {
		...(await firstSettings(project)),
		confirmWithReferences: layout.confirmWithReferences,
	}
	const title = layout.title.trim()
	await rm(join(project.root, 'volumes'), { recursive: true, force: true })
	await rm(join(project.root, 'source/chapters'), {
		recursive: true,
		force: true,
	})
	await writeTxtLayout(project, volumes, {
		title,
		language: layout.language,
		workIds: ids,
		settings,
	})
	const chapters = volumes.flatMap((volume) => volume.chapters)
	const starts = layout.chapters.map((chapter) => chapter.start)
	const next: WizardReport = {
		...report,
		check: {
			title,
			language: layout.language,
			chapterFindings: findingParagraphs(report.structure).map((finding) => ({
				chapterId:
					chapters[
						Math.max(
							starts.findLastIndex((start) => start <= finding.paragraph),
							0,
						)
					].chapterId,
				note: finding.record,
			})),
		},
		layout: { ...layout, title },
	}
	await project.write(projectFiles.importReport, next)
	const series = await project.read(projectFiles.series)
	await project.write(projectFiles.series, {
		...series,
		title,
		volumeIds: volumes.map((volume) => volume.volumeId),
	})
	return readImportWizard(project)
}
