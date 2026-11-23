import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const size = 320
const plane = size * size
const means = [0.485, 0.456, 0.406]
const deviations = [0.229, 0.224, 0.225]
let runtime: ReturnType<typeof loadMatting> | undefined

export class MattingUnavailableError extends Error {
	constructor(cause: unknown) {
		super('本地去背景不可用；请使用可返回透明底的图片模型。', { cause })
	}
}

async function loadMatting() {
	const { InferenceSession, Tensor } = await import('onnxruntime-node')
	const root =
		process.env.NL_MATTING_DIR ??
		fileURLToPath(new URL('../../../../../bin/matting/', import.meta.url))
	const model = await InferenceSession.create(join(root, 'u2netp.onnx'), {
		executionProviders: ['cpu'],
		intraOpNumThreads: 2,
	})
	return { model, Tensor }
}

export async function removeBackground(bytes: Buffer, signal?: AbortSignal) {
	signal?.throwIfAborted()
	runtime ??= loadMatting().catch((cause: unknown) => {
		runtime = undefined
		throw new MattingUnavailableError(cause)
	})
	const { model, Tensor } = await runtime
	const source = sharp(bytes).toColourspace('srgb')
	const { width, height } = await source.metadata()
	const rgb = await source
		.clone()
		.resize(size, size, { fit: 'fill' })
		.raw()
		.toBuffer()
	const input = new Float32Array(plane * 3)
	for (let c = 0; c < 3; c++)
		for (let i = 0; i < plane; i++)
			input[c * plane + i] = (rgb[i * 3 + c] / 255 - means[c]) / deviations[c]
	signal?.throwIfAborted()
	const output = model.outputNames[0]
	const result = await model.run(
		{ [model.inputNames[0]]: new Tensor('float32', input, [1, 3, size, size]) },
		[output],
	)
	signal?.throwIfAborted()
	const mask = result[output].data as Float32Array
	const alpha = Buffer.alloc(plane)
	for (let i = 0; i < plane; i++)
		alpha[i] = Math.round(Math.min(1, Math.max(0, (mask[i] - 0.1) / 0.8)) * 255)
	const matte = await sharp(alpha, {
		raw: { width: size, height: size, channels: 1 },
	})
		.resize(width, height, { fit: 'fill' })
		.toColourspace('b-w')
		.raw()
		.toBuffer()
	return source
		.joinChannel(matte, { raw: { width, height, channels: 1 } })
		.png()
		.toBuffer()
}
