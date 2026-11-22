export type ImageProvider =
	| 'openai'
	| 'seedream-5.5'
	| 'seedream-4.5'
	| 'seedream-4.0'
export type NativeMaxEdge = 1536 | 2048 | 2560 | 2816 | 3840

export function imageProvider(baseUrl: string, model: string): ImageProvider {
	if (
		!/seedream/i.test(model) &&
		!/volces\.com|volcengine\.com/i.test(new URL(baseUrl).hostname)
	)
		return 'openai'
	if (/4[.-]5|5[.-]0.*lite/i.test(model)) return 'seedream-4.5'
	if (/4[.-]0/i.test(model)) return 'seedream-4.0'
	return 'seedream-5.5'
}

export function imageSize(
	provider: ImageProvider,
	edge: NativeMaxEdge,
	portrait = false,
) {
	const ratio = portrait ? 2 / 3 : 9 / 16
	const min =
		provider === 'seedream-4.5' ? 3686400 : provider === 'openai' ? 0 : 921600
	const max =
		provider === 'seedream-5.5'
			? 4624220
			: provider === 'openai'
				? 3840 * 2160
				: 16777216
	let long = edge as number
	let short = Math.round((long * ratio) / 16) * 16
	if (long * short < min) {
		long = Math.ceil(Math.sqrt(min / ratio) / 16) * 16
		short = Math.ceil((long * ratio) / 16) * 16
	}
	if (long * short > max) {
		long = Math.floor(Math.sqrt(max / ratio) / 16) * 16
		short = Math.floor((long * ratio) / 16) * 16
	}
	return portrait
		? { width: short, height: long }
		: { width: long, height: short }
}
