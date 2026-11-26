import type {
	PlayerSettings,
	SentenceRef,
} from '../../../../../player/src/contract/playback'
import type { PlaybackMode } from '../../../../../player/src/contract/progress'

export const defaultPlayerSettings: PlayerSettings = {
	textMillisecondsPerCharacter: 30,
	autoPlaySpeedMultiplier: 1,
	fontSize: 30,
	dialogueOpacity: 0.9,
	dialogueStyle: 'soft',
	skipRead: false,
	fullscreen: false,
}

/**
 * 章节制作阶段及对应的等待卡进度比例。顺序与后端
 * （`creator/src/project/player.ts`：写 → 审稿 → 演出 → 出图）一致，
 * 播放器等待卡据此渲染进度条，比例的语义是「阶段已过半」。
 * `等待` 与 `完成` 没有比例：等待卡对纯等待只显示文案。
 * 键是后端制作进度文案里的 zh-CN 源串（亦为 i18n 键），逐字匹配。
 * 此处刻意不用 `msg()` 标记：导入 `i18n` 会把 locales JSON 拖进模块图，
 * 使直接引用本文件的 Playwright 规格在 Node 24 下加载失败。
 */
export const chapterPhaseFractions: Readonly<Record<string, number>> = {
	写作: 0.25,
	审稿: 0.5,
	演出: 0.72,
	出图: 0.88,
}

/** 在制作进度文案（`制作中 · 演出` 等拆开的片段）中取第一个已知阶段的比例。 */
export function chapterPhaseFraction(parts: readonly string[]) {
	for (const part of parts)
		if (part in chapterPhaseFractions) return chapterPhaseFractions[part]
	return undefined
}

/**
 * 文字速度滑杆与内部毫秒值的映射。滑杆是无单位的 慢 ↔ 快：
 * 最左端 `textSpeedSliderMin` 为最慢（`textSpeedSlowestMilliseconds` 毫秒 / 字），
 * 最右端 `textSpeedSliderMax` 表示瞬间显示（内部为 0 毫秒）。
 * 除右端点外线性对应毫秒值，因此已保存的设置落回滑杆时位置确定、往返无损。
 */
export const textSpeedSliderMin = 5
export const textSpeedSliderMax = 55
const textSpeedSlowestMilliseconds = 150
const textSpeedFastestStepMilliseconds = 2

export function textSpeedToSlider(milliseconds: number): number {
	if (milliseconds <= 0) return textSpeedSliderMax
	const value =
		textSpeedSliderMin +
		((textSpeedSlowestMilliseconds - milliseconds) /
			(textSpeedSlowestMilliseconds - textSpeedFastestStepMilliseconds)) *
			(textSpeedSliderMax - 1 - textSpeedSliderMin)
	return Math.min(
		textSpeedSliderMax - 1,
		Math.max(textSpeedSliderMin, Math.round(value)),
	)
}

export function textSpeedFromSlider(value: number): number {
	if (value >= textSpeedSliderMax) return 0
	const position = Math.min(
		Math.max(value, textSpeedSliderMin),
		textSpeedSliderMax - 1,
	)
	return Math.round(
		textSpeedSlowestMilliseconds -
			((position - textSpeedSliderMin) /
				(textSpeedSliderMax - 1 - textSpeedSliderMin)) *
				(textSpeedSlowestMilliseconds - textSpeedFastestStepMilliseconds),
	)
}

export interface ControlFrame {
	position: SentenceRef | null
	characters: number
	read: boolean
	ready: boolean
	pageReady?: boolean
	scripted?: boolean
	ended: boolean
}

export interface PlayerControlsController {
	frame(): ControlFrame
	subscribe(listener: () => void): () => void
	advance(skip: boolean): void
	applySettings(settings: PlayerSettings): void
	mode: PlaybackMode
}

export function dwellMilliseconds(characters: number, multiplier: number) {
	return (1200 + 80 * characters) * multiplier
}

export function schedulePlayback(
	controller: PlayerControlsController,
	settings: PlayerSettings,
	auto: boolean,
	paused: boolean,
) {
	const frame = controller.frame()
	if (paused || !frame.ready || frame.ended) return () => {}
	if (settings.skipRead && !frame.read) return () => {}
	const skip = settings.skipRead && frame.read
	if (!skip && !auto) return () => {}
	if (!skip && (frame.scripted || frame.pageReady === false)) return () => {}
	const timer = setTimeout(
		() => controller.advance(skip),
		skip
			? 0
			: dwellMilliseconds(frame.characters, settings.autoPlaySpeedMultiplier),
	)
	return () => clearTimeout(timer)
}
