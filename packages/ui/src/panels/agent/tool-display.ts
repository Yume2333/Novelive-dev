import type { AssetLabelInfo } from '../../format/asset'
import { formatAssetLabel } from '../../format/asset'
import {
	formatChapterLabel,
	formatParagraphRange,
	formatVolumeLabel,
} from '../../format/chapter'
import { scoped } from '../../i18n'

const t = scoped('agent')

/**
 * 工具卡的内容描述：每个后端工具一个本地化标题和最多 3 条精选
 * 参数行、3 条精选结果行。内部 id 通过上下文解析成章节名、卷名、
 * 条目名或素材标签，查不到时退回序号或通用名，绝不渲染原始 id、
 * 键名、工具名或 JSON。patch 数组（changes）、未知键与面向模型的
 * 结果句子不进精选行，只出现在折叠的「详细信息」里。
 */

export interface ToolDisplayContext {
	/** chapterId → 章节标题（可为空） */
	chapterTitles: Readonly<Record<string, string>>
	/** 章节次序：id 按书籍次序排列，或 chapterId → 1 起序数；用于序号兜底（可选） */
	chapterOrder?: readonly string[] | Readonly<Record<string, number>>
	/** volumeId → 卷标题 */
	volumeTitles?: Readonly<Record<string, string>>
	/** 设定集条目 id → 展示名 */
	entryNames?: Readonly<Record<string, string>>
	/** 素材标签查找表，见 format/asset.ts */
	assetInfo?: AssetLabelInfo
}
export interface ToolRow {
	label: string
	value: string
}
export interface ToolDisplay {
	/** spawn_agent 为 true：子任务卡已经代表它 */
	hidden: boolean
	/** 本地化标题，绝不是工具名 */
	title: string
	/** 0..3 条精选参数行 */
	args: ToolRow[]
	/** 0..3 条精选结果行（result 为 undefined 时为空） */
	results: ToolRow[]
	/** propose_* 为 true：面向模型的结果句子不渲染 */
	suppressResultText: boolean
}

/** 已登记的全部后端工具名，单元测试用 */
export const toolNames: readonly string[] = [
	'read_chapter_preview',
	'read_bible',
	'read_glossary',
	'read_scene',
	'read_source_range',
	'list_assets',
	'read_chapter_manifest',
	'read_task_result',
	'propose_bible_change',
	'propose_glossary_change',
	'propose_adaptation_notes',
	'propose_rewrite_scene',
	'propose_redraw_image',
	'propose_redo_chapter',
	'propose_resynthesize_volume',
	'spawn_agent',
]

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

function parseJson(value: unknown): unknown {
	if (typeof value !== 'string') return value
	const text = value.trim()
	if (!text) return undefined
	try {
		return JSON.parse(text)
	} catch {
		return undefined
	}
}

function asObject(value: unknown): Record<string, unknown> {
	const parsed = parseJson(value)
	return isPlainObject(parsed) ? parsed : {}
}

function pick(object: Record<string, unknown>, keys: readonly string[]) {
	for (const key of keys) {
		const value = object[key]
		if (typeof value === 'string' && value.trim()) return value
		if (typeof value === 'number' && Number.isFinite(value))
			return String(value)
	}
	return undefined
}

/** 面向创作者的自然文本：折成一行，太长时省略 */
function text(value: string, limit = 60): string {
	const one = value.replace(/\s+/g, ' ').trim()
	return one.length > limit ? `${one.slice(0, limit)}…` : one
}

/** 章节 id 在书籍次序里的序数（1 起）；查不到为 undefined */
function chapterOrdinal(
	id: string | undefined,
	ctx: ToolDisplayContext,
): number | undefined {
	if (!id || !ctx.chapterOrder) return undefined
	const order = ctx.chapterOrder
	if (typeof order === 'object' && !('length' in order)) {
		const ordinal = order[id]
		return typeof ordinal === 'number' &&
			Number.isFinite(ordinal) &&
			ordinal >= 1
			? ordinal
			: undefined
	}
	const index = (order as readonly string[]).indexOf(id)
	return index >= 0 ? index + 1 : undefined
}

/** 章节 id → 「第 N 章 · 标题」；查不到时退回「未命名章节」，不渲染 id */
function chapterLabel(id: string | undefined, ctx: ToolDisplayContext): string {
	if (!id) return formatChapterLabel({})
	return formatChapterLabel({
		index: chapterOrdinal(id, ctx),
		title: ctx.chapterTitles[id],
	})
}

/** 卷 id → 「第 N 卷 · 标题」；查不到时退回「未命名卷」 */
function volumeLabel(id: string | undefined, ctx: ToolDisplayContext): string {
	if (!id) return formatVolumeLabel({})
	return formatVolumeLabel({ title: ctx.volumeTitles?.[id] })
}

/** 素材 id → 造型／场景／插画标签；查不到时逐段人性化，不渲染原始键 */
function assetLabel(id: string | undefined, ctx: ToolDisplayContext): string {
	if (!id) return ''
	return formatAssetLabel(id, ctx.assetInfo)
}

// 实体 id 只含小写字母数字与连字符/下划线；`Anne-Marie` 式带大写的连字符名是自然名称
const slugShaped = /^[a-z0-9][a-z0-9_-]*-[a-z0-9_-]+$/
const uuidShaped =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const idShaped = (value: string): boolean =>
	slugShaped.test(value) || uuidShaped.test(value)

/**
 * 设定集条目参数 → 展示名。entryNames 命中时用条目名；
 * 未命中但文本像自然名称（中文或带空格的词）时按原文显示；
 * 明显是 id 形状（`char-lin` 式或 uuid）时舍弃该行，绝不渲染原始 id。
 */
function entryName(value: string | undefined, ctx: ToolDisplayContext): string {
	if (!value) return ''
	const resolved = ctx.entryNames?.[value]
	if (resolved) return text(resolved)
	if (idShaped(value)) return ''
	return text(value)
}

/** 子任务角色 → 本地化名称（与 MessageView 的角色-chip 用词一致） */
function roleLabel(role: string | undefined): string {
	switch (role) {
		case 'organizer':
			return t('整理')
		case 'writer':
			return t('写手')
		case 'reviewer':
			return t('审稿')
		case 'artDirector':
			return t('美术指导')
		case 'visualAuditor':
			return t('视觉审核')
		default:
			return t('子任务')
	}
}

interface Description {
	title: string
	args: ToolRow[]
	results: ToolRow[]
}

type Descriptor = (
	input: Record<string, unknown>,
	result: Record<string, unknown> | undefined,
	ctx: ToolDisplayContext,
) => Description

function row(label: string, value: string | undefined): ToolRow[] {
	return value ? [{ label, value }] : []
}

/** 章节的参数行：有 id 时给完整标签 */
function chapterRow(
	input: Record<string, unknown>,
	ctx: ToolDisplayContext,
): ToolRow[] {
	const chapterId = pick(input, ['chapterId', 'chapter'])
	return chapterId
		? [{ label: t('章节'), value: chapterLabel(chapterId, ctx) }]
		: []
}

/** 理由行：propose_* 工具都有 reason */
function reasonRow(input: Record<string, unknown>): ToolRow[] {
	return row(t('理由'), text(pick(input, ['reason']) ?? '', 80) || undefined)
}

function instructionRow(input: Record<string, unknown>): ToolRow[] {
	return row(
		t('要求'),
		text(pick(input, ['instruction']) ?? '', 80) || undefined,
	)
}

function countRow(
	result: Record<string, unknown> | undefined,
	keys: readonly string[],
	label: string,
): ToolRow[] {
	if (!result) return []
	for (const key of keys) {
		const value = result[key]
		if (typeof value === 'number' && Number.isFinite(value))
			return [{ label, value: String(value) }]
		if (Array.isArray(value)) return [{ label, value: String(value.length) }]
	}
	return []
}

/* ---- 读工具 ---- */

const readChapterPreview: Descriptor = (input, _result, ctx) => {
	const chapterId = pick(input, ['chapterId', 'chapter'])
	const ordinal = chapterOrdinal(chapterId, ctx)
	return {
		title:
			chapterId && ordinal !== undefined
				? t('查看第 {{index}} 章剧本', { index: ordinal })
				: t('查看章节预览'),
		args: chapterRow(input, ctx),
		results: countRow(_result, ['scenes', 'sceneCount'], t('场数')),
	}
}

const readBible: Descriptor = (input, _result, ctx) => {
	const args: ToolRow[] = []
	const entry = entryName(pick(input, ['entry']), ctx)
	if (entry) args.push({ label: t('条目'), value: entry })
	const section = pick(input, ['section'])
	if (section && section.toLowerCase() !== 'glossary')
		args.push({ label: t('部分'), value: text(section) })
	const chapterId = pick(input, ['chapterId'])
	if (chapterId)
		args.push({ label: t('截至'), value: chapterLabel(chapterId, ctx) })
	return { title: t('读取设定集'), args: args.slice(0, 3), results: [] }
}

const readGlossary: Descriptor = (input, result) => {
	const term = pick(input, ['term'])
	return {
		title: t('读取术语表'),
		args: row(t('术语'), term ? text(term) : undefined),
		results: countRow(result, ['terms', 'termCount'], t('条数')),
	}
}

const readScene: Descriptor = (input, _result, ctx) => {
	const chapterId = pick(input, ['chapterId', 'chapter'])
	const ordinal = chapterOrdinal(chapterId, ctx)
	return {
		title:
			chapterId && ordinal !== undefined
				? t('查看第 {{index}} 章的场景', { index: ordinal })
				: t('查看场景'),
		args: chapterRow(input, ctx),
		results: [],
	}
}

const readSourceRange: Descriptor = (input, _result, ctx) => {
	const args: ToolRow[] = [...chapterRow(input, ctx)]
	const from = pick(input, ['fromParagraph', 'from'])
	const to = pick(input, ['toParagraph', 'to'])
	const range = from && to ? formatParagraphRange(from, to) : ''
	if (range) args.push({ label: t('范围'), value: range })
	return { title: t('查看原文'), args: args.slice(0, 3), results: [] }
}

const listAssets: Descriptor = (_input, result) => ({
	title: t('列出素材'),
	args: [],
	results: countRow(result, ['assets', 'assetCount', 'count'], t('数量')),
})

const readChapterManifest: Descriptor = (input, result, ctx) => ({
	title: t('查看章节清单'),
	args: chapterRow(input, ctx),
	results: countRow(result, ['images', 'imageCount', 'assets'], t('图片数')),
})

const readTaskResult: Descriptor = () => ({
	title: t('查看任务结果'),
	args: [],
	results: [],
})

/* ---- 提议工具：patch 数组与机器结果句子不进精选行 ---- */

const proposeBibleChange: Descriptor = (input, _result, ctx) => {
	const args: ToolRow[] = []
	const volumeId = pick(input, ['volumeId', 'volume'])
	if (volumeId) args.push({ label: t('卷'), value: volumeLabel(volumeId, ctx) })
	args.push(...reasonRow(input))
	return { title: t('提议修改设定集'), args: args.slice(0, 3), results: [] }
}

const proposeGlossaryChange: Descriptor = (input, _result, ctx) => {
	const args: ToolRow[] = []
	const volumeId = pick(input, ['volumeId', 'volume'])
	if (volumeId) args.push({ label: t('卷'), value: volumeLabel(volumeId, ctx) })
	args.push(...reasonRow(input))
	return { title: t('提议修改术语表'), args: args.slice(0, 3), results: [] }
}

const proposeAdaptationNotes: Descriptor = (input) => ({
	title: t('提议修改改编要求'),
	args: reasonRow(input).slice(0, 3),
	results: [],
})

const proposeRewriteScene: Descriptor = (input, _result, ctx) => ({
	title: t('提议重写场景'),
	args: [
		...chapterRow(input, ctx),
		...instructionRow(input),
		...reasonRow(input),
	].slice(0, 3),
	results: [],
})

const proposeRedrawImage: Descriptor = (input, _result, ctx) => {
	const assetId = pick(input, ['assetId', 'asset'])
	return {
		title: t('提议重画图片'),
		args: [
			...row(t('图片'), assetLabel(assetId, ctx) || undefined),
			...instructionRow(input),
			...reasonRow(input),
		].slice(0, 3),
		results: [],
	}
}

const proposeRedoChapter: Descriptor = (input, _result, ctx) => ({
	title: t('提议重做章节'),
	args: [...chapterRow(input, ctx), ...reasonRow(input)].slice(0, 3),
	results: [],
})

const proposeResynthesizeVolume: Descriptor = (input, _result, ctx) => {
	const volumeId = pick(input, ['volumeId', 'volume'])
	return {
		title: t('提议重新综合'),
		args: [
			...row(t('卷'), volumeId ? volumeLabel(volumeId, ctx) : undefined),
			...reasonRow(input),
		].slice(0, 3),
		results: [],
	}
}

const spawnAgent: Descriptor = (input) => ({
	title: t('派出子任务'),
	args: [
		...row(t('角色'), roleLabel(pick(input, ['role']))),
		...row(t('任务'), text(pick(input, ['task']) ?? '', 80) || undefined),
	].slice(0, 3),
	results: [],
})

const registry: Record<string, Descriptor> = {
	read_chapter_preview: readChapterPreview,
	read_bible: readBible,
	read_glossary: readGlossary,
	read_scene: readScene,
	read_source_range: readSourceRange,
	list_assets: listAssets,
	read_chapter_manifest: readChapterManifest,
	read_task_result: readTaskResult,
	propose_bible_change: proposeBibleChange,
	propose_glossary_change: proposeGlossaryChange,
	propose_adaptation_notes: proposeAdaptationNotes,
	propose_rewrite_scene: proposeRewriteScene,
	propose_redraw_image: proposeRedrawImage,
	propose_redo_chapter: proposeRedoChapter,
	propose_resynthesize_volume: proposeResynthesizeVolume,
	spawn_agent: spawnAgent,
}

/**
 * 描述一次工具调用。input/result 是解析后的 JSON 或原始字符串，
 * 形状不合法时按无参数/无结果处理，绝不抛错；未登记的工具名
 * 退回通用的本地化标题，绝不渲染原始工具名。
 */
export function describeTool(
	name: string,
	input: unknown,
	result: unknown,
	ctx: ToolDisplayContext,
): ToolDisplay {
	const descriptor = registry[name]
	if (!descriptor)
		return {
			hidden: false,
			title: t('执行操作'),
			args: [],
			results: [],
			suppressResultText: false,
		}
	const inputObject = asObject(input)
	const parsedResult = parseJson(result)
	const resultObject = isPlainObject(parsedResult) ? parsedResult : undefined
	const described = descriptor(inputObject, resultObject, ctx)
	return {
		hidden: name === 'spawn_agent',
		title: described.title,
		args: described.args.slice(0, 3),
		results: described.results.slice(0, 3),
		suppressResultText: name.startsWith('propose_'),
	}
}
