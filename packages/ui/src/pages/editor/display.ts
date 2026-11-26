import { type AssetLabelInfo, humanizeSlug } from '../../format/asset'

export type { AssetLabelInfo }

export type SpeakerNames = Readonly<Record<string, string>>

/**
 * 说话人显示名的唯一入口：优先设定集角色名，
 * 查不到时把 slug 人性化；任何情况下都不原样渲染角色 id。
 */
export function speakerDisplayName(
	speakerNames: SpeakerNames,
	speakerId: string,
): string {
	if (!speakerId) return ''
	return speakerNames[speakerId] ?? humanizeSlug(speakerId)
}

/**
 * 资产键（`ada/uniform/neutral`）里表情一段的展示标签：
 * 查设定集表情描述（键为 `characterId/expressionId`，与
 * `formatAssetLabel` 的第三段约定一致），查不到时人性化最后一段 slug。
 * 非三段键返回空串。
 */
export function expressionLabel(assetId: string, info: AssetLabelInfo): string {
	const parts = assetId.split('/').filter(Boolean)
	if (parts.length < 3) return ''
	const [characterId, , expressionId] = parts
	return (
		info.expressions?.[`${characterId}/${expressionId}`] ??
		humanizeSlug(expressionId)
	)
}
