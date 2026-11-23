import { Assets } from 'pixi.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlaybackBeat } from '../contract/playback'
import { AssetWindow, lookahead } from './assets'

afterEach(() => vi.restoreAllMocks())

describe('asset reference window', () => {
	it('does not block a ready stage on unresolved lookahead decoding', async () => {
		let resolve!: (value: unknown) => void
		const future = new Promise((value) => {
			resolve = value
		})
		vi.spyOn(Assets, 'load').mockImplementation(
			({ src }: { src: string }) =>
				(src === 'future'
					? future
					: Promise.resolve({ destroyed: true })) as never,
		)
		vi.spyOn(Assets, 'unload').mockResolvedValue(undefined)
		const window = new AssetWindow({ resolveAsset: (id) => id })
		await window.sync(['current'], ['future'])
		expect(window.get('current')).toBeDefined()
		resolve({ destroyed: true })
		await window.destroy()
	})
	it('handles an empty window and reports missing asset requests', async () => {
		const window = new AssetWindow({
			resolveAsset: () => {
				throw new Error('missing')
			},
		})
		await window.sync([], [])
		expect(() => window.get('missing')).toThrow('素材未预载')
		await expect(window.sync(['missing'], [])).rejects.toThrow('missing')
		await window.destroy()
	})
	it('retains stage and lookahead references across aliases and player instances', async () => {
		const destroy = vi.fn()
		const texture = { destroyed: false, destroy }
		vi.spyOn(Assets, 'load').mockResolvedValue(texture)
		const unload = vi.spyOn(Assets, 'unload').mockResolvedValue(undefined)
		const resources = { resolveAsset: () => 'shared.png' }
		const first = new AssetWindow(resources)
		const second = new AssetWindow(resources)
		await first.sync(['hero'], ['hero', 'alias'])
		await second.sync(['hero'], [])
		await first.sync([], ['alias'])
		expect(unload).not.toHaveBeenCalled()
		await first.destroy()
		expect(unload).not.toHaveBeenCalled()
		await second.destroy()
		expect(unload).toHaveBeenCalledExactlyOnceWith('shared.png')
		expect(destroy).toHaveBeenCalledExactlyOnceWith(true)
	})
	it('retries load failures and disposes in-flight loads after teardown', async () => {
		const load = vi
			.spyOn(Assets, 'load')
			.mockRejectedValueOnce(new Error('decode failed'))
		const unload = vi.spyOn(Assets, 'unload').mockResolvedValue(undefined)
		const texture = { destroyed: false, destroy: vi.fn() }
		const window = new AssetWindow({ resolveAsset: () => 'retry.png' })
		await expect(window.sync(['hero'], [])).rejects.toThrow('decode failed')
		load.mockResolvedValueOnce(texture)
		await window.sync(['hero'], [])
		expect(window.get('hero')).toBe(texture)
		await window.destroy()
		expect(unload).toHaveBeenCalledOnce()
	})
	it('counts sentences rather than stage-only beats and clamps the 20–32 sentence budget', () => {
		const beats: PlaybackBeat[] = Array.from({ length: 40 }, (_, i) => ({
			sceneId: 'scene',
			actions: [
				{
					type: 'action',
					line: 1,
					col: 1,
					name: 'bg',
					args: {},
					assets: [{ id: String(i) }],
				},
			],
			cue: {
				kind: 'text',
				position: { chapterId: 'ch', sceneId: 'scene', sentenceId: String(i) },
				text: { kind: 'narration', content: [] },
			},
			advance: { kind: 'click' },
		}))
		expect(lookahead(beats, 0)).toHaveLength(32)
		expect(lookahead(beats, 0, 1)).toHaveLength(20)
		expect(lookahead(beats, 0, 100)).toHaveLength(32)
		expect(lookahead(beats, 40)).toEqual([])
	})
})
