import {
	type AssetLabelInfo,
	formatAssetLabel,
	humanizeSlug,
} from '../../format/asset'
import {
	formatParagraphLabel,
	formatParagraphRange,
} from '../../format/chapter'
import { msg, scoped } from '../../i18n'

const t = scoped('editor')

/** `@show` / `@hide` / `@move` 的槽位名 → 本地化位置。 */
const slotLabel: Record<string, string> = {
	left: msg('左侧'),
	center: msg('中间'),
	right: msg('右侧'),
}

const cameraLabel: Record<string, string> = {
	sway: msg('镜头 · 摇摆'),
	'push-in': msg('镜头 · 推近'),
	'pull-out': msg('镜头 · 拉远'),
	reset: msg('镜头 · 复位'),
}

const particleLabel: Record<string, string> = {
	rain: msg('粒子 · 雨'),
	snow: msg('粒子 · 雪'),
	sakura: msg('粒子 · 樱'),
	none: msg('粒子 · 停止'),
}

const maskLabel: Record<string, string> = {
	vignette: msg('遮罩 · 暗角'),
	letterbox: msg('遮罩 · 黑边'),
	none: msg('遮罩 · 清除'),
}

const filterLabel: Record<string, string> = {
	blur: msg('滤镜 · 模糊'),
	brightness: msg('滤镜 · 亮度'),
	sepia: msg('滤镜 · 怀旧'),
	glitch: msg('滤镜 · 故障'),
	none: msg('滤镜 · 清除'),
}

function slotText(slot: string | undefined): string {
	if (!slot) return ''
	return t(slotLabel[slot] ?? humanizeSlug(slot))
}

function sourceLabel(ids: readonly string[]): string {
	if (!ids.length) return ''
	if (ids.length === 1) {
		const single = formatParagraphLabel(ids[0])
		return single ? t('原文{{range}}', { range: single }) : ''
	}
	const range = formatParagraphRange(ids[0], ids[ids.length - 1])
	if (range) return t('原文{{range}}', { range })
	// 非连续列表（`p0001, p0003`）：逐段标注后并列
	const labels = ids
		.map((id) => formatParagraphLabel(id))
		.filter((label) => label !== '')
	if (!labels.length) return ''
	return t('原文{{range}}', { range: labels.join(t('、')) })
}

/**
 * NVS 演出指令行的人类化描述。返回值保证不含原始指令词、
 * 素材键或参数；无法识别时返回 undefined，由调用方把原文
 * 收进折叠的「详细信息」，绝不作为主文本渲染。
 */
export function describeDirective(
	raw: string,
	info: AssetLabelInfo,
): string | undefined {
	const trimmed = raw.trim()
	if (!trimmed) return undefined

	// scene 标题 / source 段落对照（非 @ 指令，但同属剧本结构行）
	const sceneMatch = /^scene(?:\s+(.+))?$/.exec(trimmed)
	if (sceneMatch) {
		const title = sceneMatch[1]?.trim()
		return title ? `${t('场景')} · ${title}` : t('场景')
	}
	const sourceMatch = /^source\s+(.+)$/.exec(trimmed)
	if (sourceMatch) {
		// 单个区间写法 `p0001-p0005` 先拆成起止两个 id
		const ids = sourceMatch[1]
			.split(/[\s,、]+/)
			.filter(Boolean)
			.flatMap((token) => {
				const range = /^([A-Za-z]*\d+)-([A-Za-z]*\d+)$/.exec(token)
				return range ? [range[1], range[2]] : [token]
			})
		if (!ids.length) return undefined
		return sourceLabel(ids) || undefined
	}

	if (!trimmed.startsWith('@')) return undefined
	const words = trimmed.slice(1).split(/\s+/)
	const [name, ...rest] = words
	const first = rest[0]

	switch (name) {
		case 'bg': {
			if (!first) return undefined
			return `${t('背景')} · ${formatAssetLabel(first, info)}`
		}
		case 'cg':
		case 'fg': {
			if (!first) return undefined
			const kind = t(name === 'cg' ? msg('插画') : msg('前景'))
			if (first === 'none') return `${kind} · ${t('清除')}`
			return `${kind} · ${formatAssetLabel(first, info)}`
		}
		case 'show': {
			if (!first) return undefined
			const label = formatAssetLabel(first, info)
			const slot = slotText(rest[1])
			return slot
				? `${t('立绘')} · ${label} · ${slot}`
				: `${t('立绘')} · ${label}`
		}
		case 'hide': {
			if (!first) return undefined
			const slot = slotText(first)
			if (slot) return `${t('收起立绘')} · ${slot}`
			return `${t('收起立绘')} · ${formatAssetLabel(first, info)}`
		}
		case 'face': {
			if (!first) return undefined
			return `${t('表情')} · ${formatAssetLabel(first, info)}`
		}
		case 'costume': {
			if (!first) return undefined
			return `${t('换装')} · ${formatAssetLabel(first, info)}`
		}
		case 'move': {
			const from = slotText(first)
			const to = slotText(rest[1])
			if (!from || !to) return undefined
			return t('移动立绘 · {{from}}到{{to}}', { from, to })
		}
		case 'camera':
			return t(cameraLabel[first ?? ''] ?? msg('镜头'))
		case 'zoom':
			return t('镜头缩放')
		case 'shake':
			return t('画面震动')
		case 'particle':
			return t(particleLabel[first ?? ''] ?? msg('粒子'))
		case 'mask':
			return t(maskLabel[first ?? ''] ?? msg('遮罩'))
		case 'filter':
			return t(filterLabel[first ?? ''] ?? msg('滤镜'))
		case 'wait': {
			if (!first) return t('等待点击')
			if (!/^\d+(?:\.\d+)?$/.test(first)) return undefined
			return t('停顿 {{seconds}} 秒', { seconds: first })
		}
		default:
			return undefined
	}
}
