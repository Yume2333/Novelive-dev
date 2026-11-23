import { type BrowserWindow, ipcMain } from 'electron'
import {
	playerProgressRequest,
	workProgress,
} from '../../../packages/creator/src/contract/player-progress'
import type { WorkProgress } from '../../../packages/player/src/contract'
import { slotKey } from '../../../packages/player/src/progress'
import { createDesktopProgressStore } from './save-data'
import {
	type PackageWrites,
	packageProgressId,
} from './save-data/package-writes'

export async function installProgressIpc(
	window: () => BrowserWindow | undefined,
	installed?: {
		hasVersion(workId: string, version: number): boolean
		writes: PackageWrites
	},
) {
	const store = await createDesktopProgressStore()
	const progress = new Map<string, Promise<WorkProgress | null>>()
	function load(workId: string, fresh = false) {
		let pending = fresh ? undefined : progress.get(workId)
		if (!pending) {
			pending = store
				.load(workId)
				.then((saved) => {
					if (saved && !workProgress.check(saved))
						throw new Error('存档文件格式无效')
					return saved
				})
				.catch((error) => {
					progress.delete(workId)
					throw error
				})
			progress.set(workId, pending)
		}
		return pending
	}
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
		const packageKey = /^package:(\d+):([a-f0-9-]+)$/.exec(input.workId)
		const installedId = packageKey?.[2]
		if (
			installedId &&
			!installed?.hasVersion(installedId, Number(packageKey?.[1]))
		)
			throw new Error('作品版本已更新，请重新打开作品')
		const workId = installedId ? packageProgressId(installedId) : input.workId
		const write = <T>(operation: () => Promise<T>) =>
			installedId && installed
				? installed.writes.run(installedId, operation)
				: operation()
		if (input.operation === 'load') return load(workId, true)
		if (input.operation === 'save') {
			await write(async () => {
				await store.save(workId, input.progress)
				progress.set(workId, Promise.resolve(input.progress))
			})
			return
		}
		if (input.operation === 'listLegacy') return store.loadLegacySaves(workId)
		if (input.operation === 'deleteLegacy')
			return write(() =>
				store.deleteLegacySave(workId, input.version, input.slot),
			)
		if (input.operation === 'thumbnail') {
			const entry = (await load(workId))?.saves.find(
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
		return write(async () => {
			const capture = await player.webContents.capturePage(input.rect)
			const entry = await store.saveSlot(
				workId,
				input.slot,
				input.snapshot,
				capture.toPNG(),
			)
			progress.delete(workId)
			return entry
		})
	})
}
