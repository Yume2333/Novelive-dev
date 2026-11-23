import { afterEach, expect, it, vi } from 'vitest'
import type { StageSnapshot } from '../contract'
import { mountStage } from './index'
import { PixiStage } from './renderer'
import { emptyStage } from './state'
import { captureThumbnail } from './thumbnail'

vi.mock('./renderer', () => ({
	PixiStage: class {
		async mount() {}
		complete() {}
		async commit() {}
		async thumbnail() {
			return new Uint8Array([1])
		}
		destroy() {}
	},
}))
vi.mock('./assets', () => ({
	AssetWindow: class {
		async sync() {}
		async destroy() {}
	},
	lookahead: () => [],
}))

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

const saved = (): StageSnapshot => ({
	position: { chapterId: 'chapter', sceneId: 'scene', sentenceId: 'sentence' },
	stage: {
		...emptyStage(),
		text: { kind: 'narration', content: [{ type: 'text', text: 'First' }] },
	},
	active: [],
})

it('restores empty snapshots, replays only state directions and restarts text at page zero', async () => {
	const restart = vi.fn()
	const player = await mountStage(
		{} as HTMLElement,
		{ resolveAsset: (id) => id },
		restart,
	)
	const snapshot = saved()
	await player.restore(snapshot)
	expect(player.state).toEqual(snapshot.stage)
	expect(restart).toHaveBeenLastCalledWith(snapshot.stage.text, 0)
	snapshot.active = [
		{ restore: 'skip-relative' },
		{ restore: 'restart-text' },
		{
			restore: 'replay-state',
			action: {
				type: 'action',
				line: 1,
				col: 1,
				name: 'cg',
				args: {},
				assets: [{ id: 'image' }],
			},
		},
	]
	await player.restore(snapshot)
	expect(player.state).toEqual({ ...snapshot.stage, cg: 'image' })
	expect(restart).toHaveBeenCalledTimes(2)
	expect(snapshot.stage.cg).toBeNull()
	await player.destroy()
})

it('propagates restore rendering errors without restarting text or mutating saved state', async () => {
	const restart = vi.fn()
	const player = await mountStage(
		{} as HTMLElement,
		{ resolveAsset: (id) => id },
		restart,
	)
	vi.spyOn(PixiStage.prototype, 'commit').mockRejectedValueOnce(
		new Error('renderer failed'),
	)
	await expect(player.restore(saved())).rejects.toThrow('renderer failed')
	expect(restart).not.toHaveBeenCalled()
	expect(player.state).toEqual(emptyStage())
	await player.destroy()
})

it('encodes the visible stage as a 480×270 WebP and reports context and encoder failures', async () => {
	const drawImage = vi.fn()
	const canvas = {
		width: 0,
		height: 0,
		getContext: vi.fn(() => ({ drawImage })),
		toBlob: vi.fn((callback: BlobCallback) =>
			callback(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' })),
		),
	}
	vi.stubGlobal('document', { createElement: () => canvas })
	const source = { width: 960, height: 540 } as HTMLCanvasElement
	expect(await captureThumbnail(source, 0.8)).toEqual(new Uint8Array([1, 2, 3]))
	expect(canvas.width).toBe(480)
	expect(canvas.height).toBe(270)
	expect(drawImage).toHaveBeenCalledWith(
		source,
		96,
		0,
		768,
		432,
		0,
		0,
		480,
		270,
	)
	expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp')
	canvas.toBlob.mockImplementationOnce((callback) => callback(null))
	await expect(captureThumbnail(source)).rejects.toThrow('无法编码存档缩略图')
	canvas.toBlob.mockImplementationOnce((callback) =>
		callback(new Blob([], { type: 'image/png' })),
	)
	await expect(captureThumbnail(source)).rejects.toThrow(
		'无法编码 WebP 存档缩略图',
	)
	canvas.getContext.mockImplementationOnce(() => null as never)
	await expect(captureThumbnail(source)).rejects.toThrow('无法创建存档缩略图')
})
