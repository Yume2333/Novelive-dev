import type { CommandOutput } from '@novelive/creator/contract'
import { humanizeSlug } from '../../format/asset'
import { formatChapterLabel, formatParagraphLabel } from '../../format/chapter'

export type Bible = CommandOutput<'bible.get'>
export type BibleCharacter = Bible['characters'][number]
export type BibleLocation = Bible['locations'][number]
export type BibleRelation = Bible['relations'][number]
export type BibleTimeline = Bible['timeline'][number]
export type BibleForeshadowing = Bible['foreshadowing'][number]
export type BibleStyle = Bible['styles'][number]
export type BibleGlossary = Bible['glossary'][number]
export type BibleEntry =
	| BibleCharacter
	| BibleLocation
	| BibleRelation
	| BibleTimeline
	| BibleForeshadowing
	| BibleStyle
	| BibleGlossary
export type BibleChange = NonNullable<BibleCharacter['changes']>[number]

export type ResolvedAssetMap = Readonly<Record<string, string | null>>

export type PreviewTarget =
	| {
			kind: 'expression'
			charId: string
			costumeId: string
			exprId: string
			assetId: string
			title: string
			subtitle?: string
			description?: string
	  }
	| {
			kind: 'location'
			locId: string
			assetId: string
			title: string
			subtitle?: string
			description?: string
			variants?: readonly { id: string; description: string }[]
	  }
	| {
			kind: 'styleRef'
			styleId: string
			index: number
			title: string
			path: string
			gradientIndex: number
	  }

/** 确定性 FNV-1a 风格散列，返回 0..modulo-1，用于封面渐变取色 */
export function hashIndex(seed: string, modulo = 6): number {
	let hash = 0x811c9dc5
	for (let index = 0; index < seed.length; index += 1) {
		hash ^= seed.charCodeAt(index)
		hash = Math.imul(hash, 0x01000193)
	}
	return (hash >>> 0) % modulo
}

export function coverGradientVar(seed: string): string {
	return `var(--cover-${hashIndex(seed, 6)})`
}

/** 从章节 ID 里抽出第一串整数（`ch01` → 1）；抽不到返回 undefined */
export function parseChapterNumber(chapterId?: string): number | undefined {
	if (!chapterId) return undefined
	const match = /(\d+)/.exec(chapterId)
	if (!match) return undefined
	const value = Number.parseInt(match[1], 10)
	return Number.isFinite(value) ? value : undefined
}

/**
 * 章节标签：`第 N 章`，空 id 返回空串；
 * 序号查不出时退回「未命名章节」，绝不返回内部 id。
 */
export function chapterText(
	chapterId: string | undefined,
	chapterOrder?: ReadonlyMap<string, number>,
): string {
	if (!chapterId) return ''
	return formatChapterLabel({
		index: resolveChapterOrdinal(chapterId, chapterOrder),
	})
}

/**
 * 原文出处标签：`第 N 章 · 第 M 段`；
 * 段落 id 无法解析时舍弃段落部分，只留章节标签。
 */
export function occurrenceText(
	chapterId: string,
	paragraphId: string,
	chapterOrder?: ReadonlyMap<string, number>,
): string {
	const chapter = chapterText(chapterId, chapterOrder)
	const paragraph = formatParagraphLabel(paragraphId)
	if (!paragraph) return chapter
	return `${chapter} · ${paragraph}`
}

/**
 * 造型 / 表情 / 变体的展示名：优先用描述，
 * 描述缺失时把 slug 人性化，绝不原样渲染内部 id。
 */
export function nameOrSlug(item: { id: string; description?: string }): string {
	return item.description?.trim() || humanizeSlug(item.id)
}

/** 章节序号：优先取播放器章节顺序表（1 基），否则退化为章节 ID 里的数字 */
export function resolveChapterOrdinal(
	chapterId: string | undefined,
	chapterOrder?: ReadonlyMap<string, number>,
): number | undefined {
	if (!chapterId) return undefined
	const ordered = chapterOrder?.get(chapterId)
	if (ordered !== undefined) return ordered
	return parseChapterNumber(chapterId)
}

/** 章节是否落在截止范围内：没有截止、截止非法或章节无法定位时都视为在范围内 */
export function isWithinChapter(
	chapterId: string | undefined,
	cutoff: number | undefined,
	chapterOrder?: ReadonlyMap<string, number>,
): boolean {
	if (cutoff === undefined || !Number.isFinite(cutoff)) return true
	const ordinal = resolveChapterOrdinal(chapterId, chapterOrder)
	if (ordinal === undefined) return true
	return ordinal <= cutoff
}

/** 条目来源层级：系列 / 卷 / 作品（整条覆盖上级同 ID 条目） */
export function entryLayer(
	entry: unknown,
): 'series' | 'volume' | 'work' | undefined {
	if (!entry || typeof entry !== 'object') return undefined
	const record = entry as Record<string, unknown>
	for (const key of ['layer', 'scope'] as const) {
		const value = record[key]
		if (value === 'series' || value === 'volume' || value === 'work')
			return value
	}
	return undefined
}

/** 缓存路径转资源 URL；version > 0 时追加查询串绕过缓存 */
export function assetResourceUrl(
	cachePath: string | null | undefined,
	version?: number,
): string | undefined {
	if (!cachePath) return undefined
	if (
		typeof window === 'undefined' ||
		typeof window.novelive?.resourceUrl !== 'function'
	)
		return undefined
	const base = window.novelive.resourceUrl(cachePath)
	if (!version || version <= 0) return base
	return `${base}${base.includes('?') ? '&' : '?'}v=${version}`
}

/** 地点候选素材 ID：变体优先，退到 day / base 基准图 */
export function locationCandidateAssetIds(location: BibleLocation): string[] {
	const ids: string[] = []
	for (const variant of location.variants ?? [])
		ids.push(`${location.id}/${variant.id}`)
	ids.push(`${location.id}/day`, `${location.id}/base`)
	return [...new Set(ids)]
}
