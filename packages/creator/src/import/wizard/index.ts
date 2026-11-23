import { copyFile, mkdir, readFile, rename, rm } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import {
	formatVersion,
	type ImportReport,
	projectFiles,
} from '@novelive/format/model'
import type {
	ExtractedBook,
	ImportExtraction,
	ImportJoinTarget,
} from '../../contract/import'
import type { TextConnection } from '../../models/text'
import type { ModelOptions } from '../../pipeline/art/models'
import { Project } from '../../project'
import { extractDocx } from '../docx'
import { extractEpub } from '../epub'
import { classifyIllustrations } from '../epub/illustrations'
import { extractMarkdown } from '../markdown'
import { extractPdf } from '../pdf'
import {
	detectTxtEncoding,
	importTxt,
	type TxtEncoding,
	type TxtStructure,
	type TxtVolume,
	writeTxtLayout,
} from '../txt'
import {
	importIllustrations,
	type StoredIllustration,
	type WizardIllustration,
} from './illustrations'
import { joinImportedVolumes, type RegisterImported } from './join'

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
	format: 'txt' | ExtractedBook['format']
	workIds: string[]
	projectDir: string
	workId: string
	encoding?: TxtEncoding
	paragraphs: number
	layout: ImportLayout
	suggested: ImportLayout
	findings: { paragraph: number; note: string }[]
	references: string[]
	illustrations: WizardIllustration[]
	selectedIllustrations: string[]
}

type WizardReport = ImportReport & {
	format?: ImportWizardView['format']
	encoding?: TxtEncoding
	structure: TxtStructure
	references?: string[]
	externalReferences?: string[]
	illustrations?: StoredIllustration[]
	selectedIllustrations?: string[]
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
	return structure.findings.map((finding) => {
		const { chapter, start } =
			sources.findLast(({ chapter }) => chapter.line <= finding.line) ??
			sources[0]
		const offset = chapter.paragraphs.findIndex(
			(paragraph) => paragraph.text === finding.title.trim(),
		)
		return {
			paragraph: start + Math.max(offset, 0),
			note: finding.title ? `${finding.note}：${finding.title}` : finding.note,
			record: `${finding.code}: ${finding.note} (line ${finding.line}: ${finding.title})`,
		}
	})
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
	const ids = await workIds(project)
	const suggested = suggestedLayout(
		report.structure,
		title,
		language,
		confirmWithReferences,
	)
	return {
		status: 'ready',
		format: report.format ?? 'txt',
		workIds: ids,
		projectDir: project.root,
		workId: ids[0],
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
		illustrations: (report.illustrations ?? []).map(
			({ cachePath: _cachePath, ...candidate }) => candidate,
		),
		selectedIllustrations: report.selectedIllustrations ?? [],
	}
}

export async function screenImportedIllustrations(
	project: Project,
	bible: string,
	connection: () => Promise<TextConnection>,
	options: ModelOptions,
) {
	const report = (await project.read(projectFiles.importReport)) as WizardReport
	const candidates =
		report.format === 'epub' ? (report.illustrations ?? []) : []
	if (!candidates.length) return undefined
	const choices = candidates.map(({ id, cachePath }) => ({ id, cachePath }))
	try {
		const extraction = await extractEpub(
			await project.readFile(projectFiles.original('epub')),
		)
		const ids = new Set(candidates.map(({ id }) => id))
		const illustrations = extraction.book.illustrations.filter((_, index) =>
			ids.has(`illustration-${index + 1}`),
		)
		if (illustrations.length !== candidates.length)
			throw new Error('EPUB illustration list does not match import')
		const results = await classifyIllustrations(
			{ ...extraction, book: { ...extraction.book, illustrations } },
			bible,
			await connection(),
			options,
		)
		return {
			fallback: false,
			candidates: choices.map((choice, index) => ({
				...choice,
				recommended: results[index].label !== 'irrelevant',
			})),
		}
	} catch {
		options.signal?.throwIfAborted()
		return {
			fallback: true,
			candidates: choices.map((choice) => ({ ...choice, recommended: false })),
		}
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

export async function importTxtProject(
	options: {
		sourcePath: string
		folder: string
		title: string
		encoding?: TxtEncoding
		references: string[]
		join?: ImportJoinTarget
	},
	register?: RegisterImported,
) {
	return importProject(options, 'txt', register)
}

export async function importFileProject(
	options: Parameters<typeof importTxtProject>[0],
	register?: RegisterImported,
) {
	const extension = extname(options.sourcePath).toLowerCase()
	const format =
		extension === '.md' || extension === '.markdown'
			? 'markdown'
			: extension.slice(1)
	if (!['txt', 'epub', 'markdown', 'docx', 'pdf'].includes(format))
		throw invalid('不支持的原文格式')
	return importProject(options, format as ImportWizardView['format'], register)
}

async function importProject(
	options: Parameters<typeof importTxtProject>[0],
	format: ImportWizardView['format'],
	register?: RegisterImported,
) {
	for (const path of options.references)
		if (!referenceTypes.has(extname(path).toLowerCase()))
			throw invalid(`不支持的参考图格式：${basename(path)}`)
	if (options.references.length > 3) throw invalid('最多选择 3 张参考图')
	const bytes = await readFile(options.sourcePath)
	if (format === 'txt' && !options.encoding) {
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
	let book: ExtractedBook | undefined
	if (format !== 'txt') {
		const extraction: ImportExtraction = await {
			epub: extractEpub,
			markdown: extractMarkdown,
			docx: extractDocx,
			pdf: extractPdf,
		}[format](bytes)
		if (extraction.status === 'unsupported') return extraction
		book = extraction.book
	}
	if (options.join)
		return joinImportedVolumes(options, bytes, format, book, register)
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
	try {
		using opened = project
		if (book) {
			let chapterIndex = 0
			const structure: TxtStructure = {
				findings: [],
				volumes: book.volumes.map((volume, v) => ({
					volumeId: `v${String(v + 1).padStart(4, '0')}`,
					title: volume.title,
					chapters: volume.chapters.map((chapter) => ({
						chapterId: `ch${String(++chapterIndex).padStart(4, '0')}`,
						title: chapter.title,
						line: chapterIndex,
						paragraphs: chapter.paragraphs.map((text, p) => ({
							id: `p${String(p + 1).padStart(4, '0')}`,
							text,
						})),
						notes: chapter.notes,
					})),
				})),
			}
			const title = options.title.trim()
			const language = book.metadata.language ?? 'zh-CN'
			await writeTxtLayout(opened, structure.volumes, { title, language })
			await opened.writeFile(
				projectFiles.original(format === 'markdown' ? 'md' : format),
				bytes,
			)
			const report: WizardReport = {
				formatVersion,
				format,
				structure,
				volumeSuggestions: structure.volumes.map((volume) => ({
					title: volume.title,
					firstChapterId: volume.chapters[0].chapterId,
					lastChapterId: volume.chapters[volume.chapters.length - 1].chapterId,
				})),
				check: { title, language, chapterFindings: [] },
			}
			await opened.write(projectFiles.importReport, report)
			const series = await opened.read(projectFiles.series)
			await opened.write(projectFiles.series, {
				...series,
				volumeIds: structure.volumes.map((volume) => volume.volumeId),
			})
		} else {
			await importTxt(opened, bytes, {
				title: options.title.trim(),
				encoding: options.encoding,
			})
		}
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
		const illustrations = book
			? await importIllustrations(opened, bytes, book)
			: []
		const next: WizardReport = {
			...report,
			references,
			externalReferences: references,
			illustrations,
			selectedIllustrations: [],
		}
		await opened.write(projectFiles.importReport, next)
		const result = await readImportWizard(opened)
		await register?.(result.workIds, result.projectDir)
		return result
	} catch (error) {
		await rm(root, { recursive: true, force: true })
		throw error
	}
}

export async function reviseTxtProject(
	projectDir: string,
	layout: ImportLayout,
	selectedIllustrations?: string[],
) {
	using project = await Project.open(projectDir)
	const report = (await project.read(projectFiles.importReport)) as WizardReport
	const selected = selectedIllustrations ?? report.selectedIllustrations ?? []
	const externalReferences =
		report.externalReferences ?? report.references ?? []
	const illustrations = report.illustrations ?? []
	if (new Set(selected).size !== selected.length) throw invalid('插图选择无效')
	const selectedCandidates = selected.map((id) => {
		const candidate = illustrations.find((candidate) => candidate.id === id)
		if (!candidate) throw invalid('插图选择无效')
		return candidate
	})
	if (externalReferences.length + selected.length > 3)
		throw invalid('最多选择 3 张参考图')
	const volumes = applyLayout(report.structure, layout)
	const ids = await workIds(project)
	if (
		ids.length !==
		(report.layout?.volumes.length ?? report.structure.volumes.length)
	)
		throw invalid('系列已添加新卷，不能重新划分原文')
	const references = [...externalReferences]
	for (const candidate of selectedCandidates) {
		const path = `source/references/${candidate.id}.png`
		await project.writeFile(path, await project.readFile(candidate.cachePath))
		references.push(path)
	}
	const settings = {
		...(await firstSettings(project)),
		confirmWithReferences: layout.confirmWithReferences,
	}
	const title = layout.title.trim()
	const staged = ['volumes', 'source/chapters'].map((path) => [
		join(project.root, path),
		join(project.root, `${path}.previous`),
	])
	for (const [path, previous] of staged) {
		await rm(previous, { recursive: true, force: true })
		await rename(path, previous)
	}
	try {
		await writeTxtLayout(project, volumes, {
			title,
			language: layout.language,
			workIds: ids,
			settings,
		})
	} catch (error) {
		for (const [path, previous] of staged) {
			await rm(path, { recursive: true, force: true })
			await rename(previous, path)
		}
		throw error
	}
	for (const [, previous] of staged)
		await rm(previous, { recursive: true, force: true })
	const chapters = volumes.flatMap((volume) => volume.chapters)
	const starts = layout.chapters.map((chapter) => chapter.start)
	const next: WizardReport = {
		...report,
		externalReferences,
		selectedIllustrations: selected,
		references,
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
