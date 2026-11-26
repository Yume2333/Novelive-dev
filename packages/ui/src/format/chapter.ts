import { scoped } from '../i18n'

const t = scoped('format')

/**
 * 章节、卷、段落、场景的统一展示标签。所有函数保证不返回内部 id：
 * 查不到信息时退回序号或通用的本地化名称。
 */

/** 行首序号列用的零填充章序号（`03`）。index 为 0 起的数组下标。 */
export function formatChapterNumeral(index: number): string {
	return String(index + 1).padStart(2, '0')
}

/**
 * 章节标签：`第 N 章 · 标题`。index 为 1 起的序数；
 * 只有标题时返回标题本身，两者都缺时退回「未命名章节」。
 */
export function formatChapterLabel(chapter: {
	index?: number
	title?: string
}): string {
	const index = chapter.index
	const title = chapter.title?.trim()
	if (index !== undefined && Number.isFinite(index) && index >= 1)
		return title
			? t('第 {{index}} 章 · {{title}}', { index, title })
			: t('第 {{index}} 章', { index })
	if (title) return title
	return t('未命名章节')
}

/**
 * 在章节列表中按 id 解析标签。列表项的次序决定序数；
 * 查不到该 id 时退回「未命名章节」，绝不返回 id 本身。
 */
export function formatChapterLabelFor(
	chapters: readonly { chapterId: string; title?: string }[],
	chapterId: string | undefined,
): string {
	const index = chapters.findIndex((entry) => entry.chapterId === chapterId)
	if (index < 0) return formatChapterLabel({})
	return formatChapterLabel({
		index: index + 1,
		title: chapters[index].title,
	})
}

/** 章节范围：`第 1–5 章`。起止为 1 起的序数。 */
export function formatChapterRange(start: number, end: number): string {
	return t('第 {{start}}–{{end}} 章', { start, end })
}

const paragraphDigits = /(\d+)/

/**
 * 从 `p0007` 形的段落 id 解析序数。无法解析时返回 undefined，
 * 由调用方决定舍弃这一段落标签。
 */
export function paragraphOrdinal(id: string): number | undefined {
	const match = paragraphDigits.exec(id)
	if (!match) return undefined
	const value = Number.parseInt(match[1], 10)
	return Number.isFinite(value) && value > 0 ? value : undefined
}

/**
 * 段落标签：`第 N 段`。接受 `p0007` 形的 id 或 1 起的序数；
 * id 无法解析时返回空串（调用方舍弃该段）。
 */
export function formatParagraphLabel(paragraph: string | number): string {
	const ordinal =
		typeof paragraph === 'number' ? paragraph : paragraphOrdinal(paragraph)
	if (ordinal === undefined || !Number.isFinite(ordinal) || ordinal < 1)
		return ''
	return t('第 {{index}} 段', { index: ordinal })
}

/** 段落范围：`第 1–5 段`。接受 id 或 1 起的序数。 */
export function formatParagraphRange(
	start: string | number,
	end: string | number,
): string {
	const first = typeof start === 'number' ? start : paragraphOrdinal(start)
	const last = typeof end === 'number' ? end : paragraphOrdinal(end)
	if (first === undefined || last === undefined) return ''
	return t('第 {{start}}–{{end}} 段', { start: first, end: last })
}

/**
 * 卷标签：`第 N 卷 · 标题`。index 为 1 起的序数；
 * 只有标题时返回标题本身，两者都缺时退回「未命名卷」。
 */
export function formatVolumeLabel(volume: {
	index?: number
	title?: string
}): string {
	const index = volume.index
	const title = volume.title?.trim()
	if (index !== undefined && Number.isFinite(index) && index >= 1)
		return title
			? t('第 {{index}} 卷 · {{title}}', { index, title })
			: t('第 {{index}} 卷', { index })
	if (title) return title
	return t('未命名卷')
}

/** 场景标签：`第 N 场`。index 为 1 起的序数；缺省时返回空串。 */
export function formatSceneLabel(index: number | undefined): string {
	if (index === undefined || !Number.isFinite(index) || index < 1) return ''
	return t('第 {{index}} 场', { index })
}

/**
 * 在场景列表中按 id 解析 `第 N 场`。查不到时返回空串，
 * 由调用方舍弃这一段，绝不返回 8 位十六进制 id。
 */
export function formatSceneLabelFor(
	scenes: readonly { sceneId: string }[],
	sceneId: string | undefined,
): string {
	const index = scenes.findIndex((scene) => scene.sceneId === sceneId)
	return formatSceneLabel(index < 0 ? undefined : index + 1)
}
