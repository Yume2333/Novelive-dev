import { saveThumbnail } from '../contract/progress'

export async function captureThumbnail(
	source: HTMLCanvasElement,
	visibleHeight = 1,
	filter = 'none',
): Promise<Uint8Array> {
	const canvas = document.createElement('canvas')
	canvas.width = saveThumbnail.width
	canvas.height = saveThumbnail.height
	const context = canvas.getContext('2d')
	if (!context) throw new Error('无法创建存档缩略图')
	context.filter = filter
	const height = source.height * visibleHeight
	const scale = Math.max(canvas.width / source.width, canvas.height / height)
	const cropWidth = canvas.width / scale
	const cropHeight = canvas.height / scale
	context.drawImage(
		source,
		(source.width - cropWidth) / 2,
		(height - cropHeight) / 2,
		cropWidth,
		cropHeight,
		0,
		0,
		canvas.width,
		canvas.height,
	)
	const blob = await new Promise<Blob>((resolve, reject) =>
		canvas.toBlob(
			(image) =>
				image ? resolve(image) : reject(new Error('无法编码存档缩略图')),
			saveThumbnail.mime,
		),
	)
	if (blob.type !== saveThumbnail.mime)
		throw new Error('无法编码 WebP 存档缩略图')
	return new Uint8Array(await blob.arrayBuffer())
}
