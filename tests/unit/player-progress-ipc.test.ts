import type { BrowserWindow } from 'electron'
import { beforeEach, expect, test, vi } from 'vitest'
import { installProgressIpc } from '../../apps/desktop/src/progress-ipc'
import type { WorkProgress } from '../../packages/player/src/contract'

const store = vi.hoisted(() => ({
	handle: vi.fn(),
	load: vi.fn(),
	save: vi.fn(),
	saveSlot: vi.fn(),
	thumbnail: vi.fn(),
}))
vi.mock('electron', () => ({ ipcMain: { handle: store.handle } }))
vi.mock('../../apps/desktop/src/save-data', () => ({
	createDesktopProgressStore: async () => store,
}))

const position = { chapterId: 'ch1', sceneId: 'scene', sentenceId: 'sentence' }
const progress: WorkProgress = {
	mainline: position,
	read: [position],
	saves: [
		{
			slot: { kind: 'manual', slot: 1 },
			savedAt: '2026-11-23T00:00:00.000Z',
			thumbnailRef: `${'0'.repeat(64)}.webp`,
			snapshot: {
				position,
				active: [],
				stage: {
					background: null,
					sprites: {},
					cg: null,
					foreground: null,
					camera: {
						motion: 'reset',
						zoom: { scale: 1, target: 'stage' },
						shake: null,
					},
					particle: null,
					mask: null,
					filter: null,
					text: {
						kind: 'narration',
						content: [{ type: 'text', text: '开始' }],
					},
				},
			},
		},
	],
}
beforeEach(() => {
	vi.resetAllMocks()
	store.load.mockResolvedValue(progress)
	store.thumbnail.mockResolvedValue(Buffer.from('image'))
	store.saveSlot.mockResolvedValue(progress.saves[0])
})
async function setup() {
	const webContents = {
		mainFrame: {},
		capturePage: async () => ({ toPNG: () => Buffer.from('capture') }),
	}
	await installProgressIpc(
		() =>
			({
				webContents,
				getContentSize: () => [960, 540],
			}) as unknown as BrowserWindow,
	)
	const handle = store.handle.mock.calls[0][1]
	const event = { sender: webContents, senderFrame: webContents.mainFrame }
	return { invoke: (input: unknown) => handle(event, input), handle, event }
}
test('thumbnail grids share validated progress and refresh after slot writes', async () => {
	const { invoke } = await setup()
	const thumbnail = {
		operation: 'thumbnail',
		workId: 'work',
		slot: { kind: 'manual', slot: 1 },
	}
	const images = await Promise.all(
		Array.from({ length: 60 }, () => invoke(thumbnail)),
	)
	expect(images).toEqual(Array(60).fill('data:image/webp;base64,aW1hZ2U='))
	expect(store.load).toHaveBeenCalledTimes(1)
	await invoke({
		operation: 'save',
		workId: 'work',
		progress: { ...progress, saves: [] },
	})
	await expect(invoke(thumbnail)).rejects.toThrow('存档为空')
	expect(store.load).toHaveBeenCalledTimes(1)
	await invoke({
		operation: 'saveSlot',
		workId: 'work',
		slot: progress.saves[0].slot,
		snapshot: progress.saves[0].snapshot,
		rect: { x: 0, y: 0, width: 480, height: 270 },
	})
	await invoke(thumbnail)
	expect(store.load).toHaveBeenCalledTimes(2)
})
test('invalid senders and corrupt progress cannot populate the thumbnail cache', async () => {
	const { invoke, handle, event } = await setup()
	const request = { operation: 'load', workId: 'work' }
	await expect(handle({ ...event, sender: {} }, request)).rejects.toThrow(
		'无效的播放器存档请求',
	)
	expect(store.load).not.toHaveBeenCalled()
	store.load.mockResolvedValueOnce({ mainline: 123 })
	await expect(invoke(request)).rejects.toThrow('存档文件格式无效')
	await expect(invoke(request)).resolves.toEqual(progress)
	expect(store.load).toHaveBeenCalledTimes(2)
})

test("explicit loads refresh another instance's progress without disabling thumbnail caching", async () => {
	const { invoke } = await setup()
	const request = { operation: 'load', workId: 'work' }
	await expect(invoke(request)).resolves.toEqual(progress)
	const newer = {
		...progress,
		mainline: { ...position, sentenceId: 'newer' },
		saves: [
			...progress.saves,
			{ ...progress.saves[0], slot: { kind: 'quick' } },
		],
	}
	store.load.mockResolvedValue(newer)
	await expect(invoke(request)).resolves.toEqual(newer)
	await invoke({
		operation: 'thumbnail',
		workId: 'work',
		slot: { kind: 'quick' },
	})
	expect(store.load).toHaveBeenCalledTimes(2)
})
