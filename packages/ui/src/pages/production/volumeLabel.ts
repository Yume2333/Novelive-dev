import { formatVolumeLabel } from '../../format/chapter'

/**
 * 「第 N 卷 · 卷名」的组合标签，但卷名只是序数的另一种写法（「第一卷」「第 1 卷」）
 * 或为空时省略卷名段——否则同一信息会在一行里读两遍。
 * 任务 03 的本地共享助手：format/ 归窗口 01 所有，故放在 pages/production 下
 * 供 production 与 confirm 三处眉批/章节列表标题共用。
 */
export function volumeLabelUnlessOrdinal(volume: {
	index?: number
	title?: string
}): string {
	const title = volume.title?.trim()
	if (
		title &&
		volume.index !== undefined &&
		/^第\s*[0-9零一二三四五六七八九十百千]+\s*卷$/.test(title)
	)
		return formatVolumeLabel({ index: volume.index })
	return formatVolumeLabel(volume)
}
