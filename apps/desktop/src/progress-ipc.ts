import { type BrowserWindow, ipcMain } from 'electron'
import {
	playerProgressRequest,
	workProgress,
} from '../../../packages/creator/src/contract/player-progress'
import { slotKey } from '../../../packages/player/src/progress'
import { createDesktopProgressStore } from './save-data'

export async function installProgressIpc(
	window: () => BrowserWindow | undefined,
) {
	const store = await createDesktopProgressStore()
	ipcMain.handle('novelive:progress', async (event, input: unknown) => {
		const player = window()
		if (
			!player ||
			event.sender !== player.webContents ||
			event.senderFrame !== player.webContents.mainFrame ||
			(JSON.stringify(input)?.length ?? 0) > 8_000_000 ||
			!playerProgressRequest.check(input)
		)
			throw new Error('无效的播放器存档请求')
		const { workId } = input
		if (input.operation === 'load') {
			const saved = await store.load(workId)
			if (saved && !workProgress.check(saved))
				throw new Error('存档文件格式无效')
			return saved
		}
		if (input.operation === 'save') return store.save(workId, input.progress)
		if (input.operation === 'thumbnail') {
			const entry = (await store.load(workId))?.saves.find(
				(entry) => slotKey(entry.slot) === slotKey(input.slot),
			)
			if (!entry) throw new Error('存档为空')
			return `data:image/webp;base64,${(await store.thumbnail(workId, entry)).toString('base64')}`
		}
		const [width, height] = player.getContentSize()
		if (
			input.rect.x + input.rect.width > width ||
			input.rect.y + input.rect.height > height
		)
			throw new Error('无效的舞台截图范围')
		const capture = await player.webContents.capturePage(input.rect)
		return store.saveSlot(workId, input.slot, input.snapshot, capture.toPNG())
	})
}
