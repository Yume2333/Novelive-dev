import sharp from 'sharp'
import { expect, test, vi } from 'vitest'
import { removeBackground } from '../../packages/creator/src/pipeline/art/background'

vi.mock('onnxruntime-node', () => ({
	InferenceSession: {
		create: async () => ({
			inputNames: ['image'],
			outputNames: ['mask'],
			run: async () => {
				const data = new Float32Array(320 * 320)
				for (let y = 0; y < 320; y++) data.fill(1, y * 320 + 64, y * 320 + 128)
				return { mask: { data } }
			},
		}),
	},
	Tensor: class {},
}))

test('maps a square model matte back to the original portrait coordinates', async () => {
	const width = 100
	const height = 200
	const source = await sharp({
		create: { width, height, channels: 3, background: '#7148a0' },
	})
		.png()
		.toBuffer()
	const { data, info } = await sharp(await removeBackground(source))
		.raw()
		.toBuffer({ resolveWithObject: true })
	expect(info).toMatchObject({ width, height, channels: 4 })
	const alphaAt = (x: number) => data[(100 * width + x) * 4 + 3]
	expect(alphaAt(10)).toBe(0)
	expect(alphaAt(30)).toBe(255)
	expect(alphaAt(50)).toBe(0)
})
