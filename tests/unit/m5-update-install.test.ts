import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { UpdateInfo } from 'electron-updater'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
	isPackaged: true,
	showMessageBox: vi.fn(),
	openExternal: vi.fn(),
	ipcOn: vi.fn(),
	checkForUpdates: vi.fn(),
	downloadUpdate: vi.fn(),
	quitAndInstall: vi.fn(),
	debConfigs: [] as Array<{ provider: string; url: string }>,
	appImageConfigs: [] as Array<{ provider: string; url: string }>,
	createdEngines: [] as Array<{
		kind: 'deb' | 'appimage'
		autoDownload: boolean
		autoInstallOnAppQuit: boolean
	}>,
}))

vi.mock('electron', () => ({
	app: {
		get isPackaged() {
			return state.isPackaged
		},
	},
	dialog: { showMessageBox: state.showMessageBox },
	shell: { openExternal: state.openExternal },
	ipcMain: { on: state.ipcOn },
}))

vi.mock('electron-updater', () => {
	class FakeUpdater {
		autoDownload = true
		autoInstallOnAppQuit = true
		checkForUpdates = state.checkForUpdates
		downloadUpdate = state.downloadUpdate
		quitAndInstall = state.quitAndInstall
	}
	class DebUpdater extends FakeUpdater {
		constructor(config: { provider: string; url: string }) {
			super()
			state.debConfigs.push(config)
			state.createdEngines.push(Object.assign(this, { kind: 'deb' as const }))
		}
	}
	class AppImageUpdater extends FakeUpdater {
		constructor(config: { provider: string; url: string }) {
			super()
			state.appImageConfigs.push(config)
			state.createdEngines.push(
				Object.assign(this, { kind: 'appimage' as const }),
			)
		}
	}
	class NsisUpdater extends FakeUpdater {}
	class MacUpdater extends FakeUpdater {}
	return {
		default: { DebUpdater, AppImageUpdater, NsisUpdater, MacUpdater },
	}
})

import { installUpdates } from '../../apps/desktop/src/main/update'

const sha512 = Buffer.alloc(64, 2).toString('base64')
const originalPlatform = process.platform
const originalAppImage = process.env.APPIMAGE
const originalUpdateUrl = process.env.NL_UPDATE_URL

function setPlatform(platform: NodeJS.Platform) {
	Object.defineProperty(process, 'platform', {
		value: platform,
		configurable: true,
	})
}

function updateResult(files: string[], isUpdateAvailable = true) {
	const updateInfo: UpdateInfo = {
		version: '0.1.2',
		files: files.map((url) => ({ url, sha512 })),
		path: files[0],
		sha512,
		releaseDate: '2026-11-25T00:00:00.000Z',
	}
	return { isUpdateAvailable, updateInfo, versionInfo: updateInfo }
}

beforeEach(() => {
	vi.clearAllMocks()
	state.isPackaged = true
	state.debConfigs.length = 0
	state.appImageConfigs.length = 0
	state.createdEngines.length = 0
	setPlatform('linux')
	delete process.env.APPIMAGE
	process.env.NL_UPDATE_URL = 'http://127.0.0.1:41234/feed'
})

afterEach(() => {
	setPlatform(originalPlatform)
	if (originalAppImage === undefined) delete process.env.APPIMAGE
	else process.env.APPIMAGE = originalAppImage
	if (originalUpdateUrl === undefined) delete process.env.NL_UPDATE_URL
	else process.env.NL_UPDATE_URL = originalUpdateUrl
})

describe('installUpdates Linux branches', () => {
	it('prompts manual download without downloading for non-AppImage Linux (deb) and opens the deb URL when accepted', async () => {
		const quit = vi.fn(async () => {})
		const fakeWindow = {} as BrowserWindow
		const check = installUpdates({ window: () => fakeWindow, quit })

		expect(state.debConfigs).toEqual([
			{ provider: 'generic', url: 'http://127.0.0.1:41234/feed/' },
		])
		expect(state.appImageConfigs).toEqual([])
		expect(state.createdEngines[0]).toMatchObject({
			kind: 'deb',
			autoDownload: false,
			autoInstallOnAppQuit: false,
		})

		state.checkForUpdates.mockResolvedValueOnce(
			updateResult([
				'Novelive-0.1.2-linux-x86_64.AppImage',
				'Novelive-0.1.2-linux-amd64.deb',
			]),
		)
		state.showMessageBox.mockResolvedValueOnce({ response: 1 })

		await check(true)

		expect(state.downloadUpdate).not.toHaveBeenCalled()
		expect(quit).not.toHaveBeenCalled()
		expect(state.showMessageBox).toHaveBeenCalledTimes(1)
		expect(state.showMessageBox.mock.calls[0]?.[0]).toBe(fakeWindow)
		expect(state.showMessageBox.mock.calls[0]?.[1]).toMatchObject({
			message: expect.stringContaining('0.1.2'),
			buttons: [expect.any(String), expect.any(String)],
		})
		expect(state.openExternal).toHaveBeenCalledWith(
			'http://127.0.0.1:41234/feed/Novelive-0.1.2-linux-amd64.deb',
		)
	})

	it('does not open an external URL when the user dismisses the deb manual-download prompt', async () => {
		const quit = vi.fn(async () => {})
		const check = installUpdates({ window: () => undefined, quit })

		state.checkForUpdates.mockResolvedValueOnce(
			updateResult(['Novelive-0.1.2-linux-x86_64.AppImage']),
		)
		state.showMessageBox.mockResolvedValueOnce({ response: 0 })

		await check(true)

		expect(state.downloadUpdate).not.toHaveBeenCalled()
		expect(state.openExternal).not.toHaveBeenCalled()
		expect(state.showMessageBox).toHaveBeenCalledTimes(1)
	})

	it('downloads updates for Linux AppImage and blocks quitAndInstall when the AppImage directory is not writable', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'novelive-ro-appimage-'))
		try {
			process.env.APPIMAGE = join(dir, 'Novelive.AppImage')
			const quit = vi.fn(
				async (exit: () => void, canInstall?: () => Promise<boolean>) => {
					if (!canInstall || (await canInstall())) exit()
				},
			)
			const check = installUpdates({ window: () => undefined, quit })

			expect(state.appImageConfigs).toEqual([
				{ provider: 'generic', url: 'http://127.0.0.1:41234/feed/' },
			])
			expect(state.debConfigs).toEqual([])

			state.checkForUpdates.mockResolvedValueOnce(
				updateResult(['Novelive-0.1.2-linux-x86_64.AppImage']),
			)
			state.downloadUpdate.mockResolvedValueOnce([
				'/tmp/Novelive-0.1.2-linux-x86_64.AppImage',
			])
			state.showMessageBox
				.mockResolvedValueOnce({ response: 1 })
				.mockResolvedValueOnce({ response: 0 })

			await chmod(dir, 0o555)
			await check(true)

			expect(state.downloadUpdate).toHaveBeenCalledTimes(1)
			expect(quit).toHaveBeenCalledTimes(1)
			expect(state.quitAndInstall).not.toHaveBeenCalled()
			expect(state.showMessageBox).toHaveBeenCalledTimes(2)
		} finally {
			await chmod(dir, 0o755).catch(() => {})
			await rm(dir, { recursive: true, force: true })
		}
	})
})
