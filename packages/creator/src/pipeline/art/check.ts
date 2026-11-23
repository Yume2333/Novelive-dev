import sharp from 'sharp'
import { hasTransparency } from '../../models/image'

export type Dimensions = { width: number; height: number }
export const spriteFrameIssue = '立绘主体缺失，或头部、侧面超出画布。'
export const derivedFrameIssue = '差分图主体外框偏离基准图。'
type Pixels = Dimensions & { data: Buffer }

async function pixels(input: Buffer): Promise<Pixels> {
	const { data, info } = await sharp(input)
		.toColourspace('srgb')
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true })
	return { data, width: info.width, height: info.height }
}

function bounds({ data, width, height }: Pixels) {
	let left = width
	let right = -1
	let top = height
	let bottom = -1
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (data[(y * width + x) * 4 + 3] < 128) continue
			left = Math.min(left, x)
			right = Math.max(right, x)
			top = Math.min(top, y)
			bottom = y
		}
	}
	return { left, right, top, bottom }
}

function restoreExpressionCrown(raster: Pixels, base: Pixels) {
	const { width, height } = raster
	const rows = Math.ceil(height * 0.005)
	const reference = bounds({ ...base, height: rows })
	const margin = Math.ceil(width * 0.01)
	if (
		reference.top === 0 ||
		reference.top >= rows ||
		reference.right - reference.left > width * 0.05
	)
		return false
	const edited = bounds({ ...raster, height: rows })
	if (
		edited.left < reference.left - margin ||
		edited.right > reference.right + margin
	)
		return false
	const seamTolerance = Math.ceil(width * 0.003)
	const covers = (source: Pixels, row: number, x: number) =>
		source.data[(row * width + x) * 4 + 3] >= 128
	let joins = false
	for (let x = 0; x < width; x++) {
		const above = covers(base, rows - 1, x)
		const below = covers(raster, rows, x)
		if (above && below) joins = true
		if (above === below) continue
		let near = false
		for (
			let neighbor = Math.max(0, x - seamTolerance);
			neighbor <= Math.min(width - 1, x + seamTolerance);
			neighbor++
		) {
			if (
				above
					? covers(raster, rows, neighbor)
					: covers(base, rows - 1, neighbor)
			) {
				near = true
				break
			}
		}
		if (!near) return false
	}
	if (!joins) return false
	base.data.copy(raster.data, 0, 0, rows * width * 4)
	return true
}

function checkerboard({ data, width, height }: Pixels) {
	function runs(length: number, at: (offset: number) => number) {
		let previous = -1
		let start = 0
		const lengths: number[] = []
		for (let i = 0; i < length; i++) {
			const idx = at(i)
			const [red, green, blue, alpha] = data.subarray(idx, idx + 4)
			const grey = Math.max(red, green, blue) - Math.min(red, green, blue) < 9
			const shade = alpha > 245 && grey && red >= 145 ? Number(red >= 224) : -1
			if (shade === previous) continue
			if (shade === -1 || previous === -1) lengths.length = 0
			else {
				lengths.push(i - start)
				if (lengths.length > 6) lengths.shift()
				if (
					lengths.length === 6 &&
					Math.min(...lengths) >= 3 &&
					Math.max(...lengths) - Math.min(...lengths) <= 2
				)
					return true
			}
			start = i
			previous = shade
		}
		return false
	}
	return (
		[0.1, 0.25, 0.5, 0.75, 0.9].some((fraction) =>
			runs(width, (x) => (Math.floor(height * fraction) * width + x) * 4),
		) &&
		[0.1, 0.25, 0.5, 0.75, 0.9].some((fraction) =>
			runs(height, (y) => (y * width + Math.floor(width * fraction)) * 4),
		)
	)
}

async function safeArea(input: Buffer) {
	const { data, info } = await sharp(input)
		.resize(192, 108, { fit: 'fill' })
		.removeAlpha()
		.greyscale()
		.raw()
		.toBuffer({ resolveWithObject: true })
	let total = 0
	let inside = 0
	for (let y = 1; y < info.height; y++) {
		for (let x = 1; x < info.width; x++) {
			const i = y * info.width + x
			const edge =
				Math.max(
					Math.abs(data[i] - data[i - 1]),
					Math.abs(data[i] - data[i - info.width]),
				) - 12
			if (edge <= 0) continue
			total += edge
			if (x >= 24 && x < 168) inside += edge
		}
	}
	return total === 0 || inside / total >= 0.7
}

export async function checkImage(
	input: Buffer,
	target: Dimensions,
	options: { transparent: boolean; base?: Buffer; variant: boolean },
): Promise<{ png: Buffer } | { issue: string; unsupported?: true }> {
	try {
		const { width, height, hasAlpha } = await sharp(input).metadata()
		if (options.transparent && !hasAlpha)
			return {
				issue: '透明底能力不支持（图片没有 alpha 通道）；请换图片模型。',
				unsupported: true,
			}
		if (options.base && (width !== target.width || height !== target.height))
			return { issue: '差分图尺寸与基准图不一致。' }
		const fit =
			Math.abs(width / height / (target.width / target.height) - 1) <= 0.01
				? 'fill'
				: 'cover'
		let png = await sharp(input)
			.resize({ ...target, fit, kernel: 'lanczos3' })
			.png()
			.toBuffer()
		if (options.transparent) {
			if (!(await hasTransparency(png))) return { issue: '全透明像素不足。' }
			const raster = await pixels(png)
			if (checkerboard(raster)) return { issue: '立绘绘制了棋盘格背景。' }
			let frame = bounds(raster)
			const base = options.base ? await pixels(options.base) : undefined
			if (
				base &&
				!options.variant &&
				frame.top === 0 &&
				base.width === raster.width &&
				base.height === raster.height &&
				restoreExpressionCrown(raster, base)
			) {
				png = await sharp(raster.data, {
					raw: { width: raster.width, height: raster.height, channels: 4 },
				})
					.png()
					.toBuffer()
				if (!(await hasTransparency(png))) return { issue: '全透明像素不足。' }
				frame = bounds(raster)
			}
			if (
				frame.right < 0 ||
				frame.top === 0 ||
				frame.left === 0 ||
				frame.right === target.width - 1
			)
				return { issue: spriteFrameIssue }
			if (base) {
				const original = bounds(base)
				if (
					(['left', 'right', 'top', 'bottom'] as const).some(
						(key) =>
							Math.abs(frame[key] - original[key]) >
							(key === 'left' || key === 'right'
								? target.width
								: target.height) *
								0.02,
					)
				)
					return { issue: derivedFrameIssue }
			}
		} else if (!options.variant && !(await safeArea(png))) {
			return { issue: '主体未达到中央 4:3 安全区的 70% 阈值。' }
		}
		return { png }
	} catch {
		return { issue: '图片无法解码。' }
	}
}

export function placeholder(kind: 'character' | 'location' | 'cg') {
	const portrait = kind === 'character'
	const width = portrait ? 1024 : 1920
	const height = portrait ? 1536 : 1080
	const icon =
		kind === 'character'
			? '<circle cy="-31" r="23"/><path d="M-46 36a46 46 0 0192 0z"/>'
			: kind === 'location'
				? '<path d="M-56 36l38-58 22 28 18-21 34 51z"/><circle cx="30" cy="-32" r="10"/>'
				: '<path d="M-52-37h104v74H-52z"/><path d="M-14-19l35 19-35 19z" fill="#5b5b5b"/>'
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="${portrait ? 80 : 0}" y="${portrait ? 80 : 0}" width="${width - (portrait ? 160 : 0)}" height="${height - (portrait ? 160 : 0)}" fill="#5b5b5b" rx="${portrait ? 40 : 0}"/><g transform="translate(${width / 2} ${height / 2 - 45})" fill="#ddd">${icon}</g><text x="50%" y="${height / 2 + 82}" text-anchor="middle" font-family="PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, Source Han Sans SC, WenQuanYi Micro Hei, sans-serif" font-size="52" fill="#eee">需要处理</text></svg>`
	return sharp(Buffer.from(svg)).webp({ quality: 90 }).toBuffer()
}
