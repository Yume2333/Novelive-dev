import { scoped } from '../i18n'

const t = scoped('format')

/**
 * 资产键（`ada/uniform/neutral`、`school-rooftop/day`、`cg-…`）的
 * 展示标签。查找顺序：设定集里的名字与造型／表情／变体描述，
 * 都没有时把 slug 人性化；任何情况下都不原样渲染 `a/b/c` 键。
 * 分隔符统一用 ` · `。
 */

export interface AssetLabelInfo {
	/** characterId → 角色名 */
	characters?: Readonly<Record<string, string>>
	/** `characterId/costumeId` → 造型描述 */
	costumes?: Readonly<Record<string, string>>
	/** `characterId/expressionId` → 表情描述 */
	expressions?: Readonly<Record<string, string>>
	/** locationId → 场景名 */
	locations?: Readonly<Record<string, string>>
	/** `locationId/variantId` → 变体描述 */
	variants?: Readonly<Record<string, string>>
	/** cg 资产键 → 插画描述 */
	cgs?: Readonly<Record<string, string>>
}

/** 设定集条目形状（`bible.get` 输出的人物与场景）的最小所需面。 */
export interface AssetLabelBible {
	characters?: readonly {
		id: string
		name?: string
		costumes?: readonly { id: string; description?: string }[]
		expressions?: readonly { id: string; description?: string }[]
	}[]
	locations?: readonly {
		id: string
		name?: string
		variants?: readonly { id: string; description?: string }[]
	}[]
}

/** 从 `bible.get` 的人物／场景数据构建查找表。 */
export function assetLabelInfoFromBible(
	bible: AssetLabelBible,
): AssetLabelInfo {
	const characters: Record<string, string> = {}
	const costumes: Record<string, string> = {}
	const expressions: Record<string, string> = {}
	const locations: Record<string, string> = {}
	const variants: Record<string, string> = {}
	for (const character of bible.characters ?? []) {
		if (character.name) characters[character.id] = character.name
		for (const costume of character.costumes ?? [])
			if (costume.description)
				costumes[`${character.id}/${costume.id}`] = costume.description
		for (const expression of character.expressions ?? [])
			if (expression.description)
				expressions[`${character.id}/${expression.id}`] = expression.description
	}
	for (const location of bible.locations ?? []) {
		if (location.name) locations[location.id] = location.name
		for (const variant of location.variants ?? [])
			if (variant.description)
				variants[`${location.id}/${variant.id}`] = variant.description
	}
	return { characters, costumes, expressions, locations, variants }
}

/** slug 的人性化兜底：连字符／下划线变空格，首字母大写。 */
export function humanizeSlug(slug: string): string {
	const words = slug.replace(/[-_]+/g, ' ').trim()
	if (!words) return ''
	return words.charAt(0).toUpperCase() + words.slice(1)
}

function segment(id: string, names: (string | undefined)[]): string {
	for (const name of names) if (name) return name
	return humanizeSlug(id)
}

/**
 * 资产键 → 展示标签。两段键可能是人物造型（`ada/uniform`）或
 * 场景变体（`room/day`），三种键是人物表情；查表不区分种类，
 * 命中哪张表用哪张，都没有时逐段人性化。CG 键有描述用描述，
 * 否则退回通用名「插画」。
 */
export function formatAssetLabel(
	assetKey: string,
	info?: AssetLabelInfo,
): string {
	if (!assetKey) return ''
	if (assetKey.startsWith('cg-'))
		return (
			info?.cgs?.[assetKey] ?? (humanizeSlug(assetKey.slice(3)) || t('插画'))
		)
	const parts = assetKey.split('/').filter(Boolean)
	if (parts.length === 0) return ''
	const [first, second, third] = parts
	const head = segment(first, [
		info?.characters?.[first],
		info?.locations?.[first],
	])
	const labels = [head]
	if (second)
		labels.push(
			segment(second, [
				info?.costumes?.[`${first}/${second}`],
				info?.variants?.[`${first}/${second}`],
			]),
		)
	if (third)
		labels.push(segment(third, [info?.expressions?.[`${first}/${third}`]]))
	return labels.filter(Boolean).join(' · ')
}
