import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { HostState } from '@novelive/creator/contract'
import {
	app,
	BrowserWindow,
	dialog,
	ipcMain,
	MessageChannelMain,
	powerSaveBlocker,
	protocol,
	shell,
	utilityProcess,
} from 'electron'
import { cacheResponse } from '../../../../packages/creator/src/host-runtime/cache'
import { installProgressIpc } from '../progress-ipc'
import { t } from './i18n'
import { installNotifications } from './notifications'
import { installLifecycle } from './tray'

let creator: Electron.UtilityProcess | undefined
let creatorDraining = false
let generation = 0
let state: HostState['creator'] = 'down'
let library: BrowserWindow | undefined
let failures = 0
let blocker: number | undefined
let lifecycle: ReturnType<typeof installLifecycle>
let closeNotifications: (() => void) | undefined
const failureLimit = 3
const handshakeTimeoutMs = 10_000
const primaryInstance = app.requestSingleInstanceLock()
if (!primaryInstance) app.quit()
else app.on('second-instance', () => lifecycle?.show())

protocol.registerSchemesAsPrivileged([
	{
		scheme: 'novelive',
		privileges: { standard: true, secure: true, corsEnabled: true },
	},
])

const rendererUrl = !app.isPackaged
	? process.env.ELECTRON_RENDERER_URL
	: undefined

function logDir() {
	return join(app.getPath('userData'), 'logs')
}

function appState(): HostState {
	return {
		creator: state,
		generation,
		breakerOpen: failures >= failureLimit,
		logDir: logDir(),
	}
}

function keepAwake(active: boolean) {
	if (active && blocker === undefined)
		blocker = powerSaveBlocker.start('prevent-app-suspension')
	else if (!active && blocker !== undefined) {
		powerSaveBlocker.stop(blocker)
		blocker = undefined
	}
}

function stopCreator() {
	keepAwake(false)
	const worker = creator
	creator = undefined
	worker?.kill()
}

async function drainCreator() {
	creatorDraining = true
	const worker = creator
	creator = undefined
	if (!worker) return
	await new Promise<void>((resolve) => {
		worker.once('exit', () => resolve())
		worker.postMessage({ type: 'shutdown', generation })
	})
	keepAwake(false)
}

function startCreator(window: BrowserWindow) {
	if (creatorDraining || failures >= failureLimit || window.isDestroyed())
		return
	stopCreator()
	generation += 1
	state = 'starting'
	const current = generation
	const worker = utilityProcess.fork(
		join(import.meta.dirname, 'creator.js'),
		[],
		{
			env: {
				...process.env,
				NL_CREATOR_GENERATION: String(current),
				NL_CREATOR_DATA_DIR: app.getPath('userData'),
				NL_UPSCALE_DIR: app.isPackaged
					? join(process.resourcesPath, 'upscale')
					: join(app.getAppPath(), '../../bin/upscale'),
				NL_E2E: !app.isPackaged && process.env.NL_E2E === '1' ? '1' : '0',
			},
			serviceName: 'Novelive Creator',
		},
	)
	creator = worker
	const { port1, port2 } = new MessageChannelMain()
	let ready = false
	const handshake = setTimeout(() => {
		if (worker === creator) {
			down()
			worker.kill()
		}
	}, handshakeTimeoutMs)

	function down() {
		clearTimeout(handshake)
		if (worker !== creator) return
		keepAwake(false)
		creator = undefined
		if (!ready) failures += 1
		state = ready ? 'down' : 'failed'
		if (window.isDestroyed()) return
		window.webContents.send('novelive:down', { generation: current })
		if (ready) startCreator(window)
	}

	worker.on('message', (message) => {
		if (worker !== creator || message?.generation !== current) return
		if (
			ready &&
			message.type === 'production.active' &&
			typeof message.active === 'boolean'
		) {
			keepAwake(message.active)
			return
		}
		if (ready || message.type !== 'ready') return
		clearTimeout(handshake)
		ready = true
		failures = 0
		state = 'ready'
		if (!window.isDestroyed())
			window.webContents.send('novelive:ready', { generation: current })
	})
	worker.once('exit', down)

	worker.postMessage(null, [port1])
	window.webContents.postMessage('novelive:port', current, [port2])
}

function openLibrary() {
	const window = new BrowserWindow({
		width: 1080,
		height: 720,
		webPreferences: {
			preload: join(import.meta.dirname, '../preload/index.cjs'),
			contextIsolation: true,
			sandbox: true,
		},
	})
	library = window
	lifecycle.attach(window)
	window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
	window.webContents.on('will-navigate', (event) => event.preventDefault())
	window.webContents.on('did-finish-load', () => startCreator(window))
	window.once('closed', () => {
		library = undefined
		stopCreator()
	})
	if (rendererUrl) {
		void window.loadURL(rendererUrl)
	} else {
		void window.loadFile(join(import.meta.dirname, '../renderer/index.html'))
	}
}

app.whenReady().then(async () => {
	if (!primaryInstance) return
	await installProgressIpc(() => library)
	lifecycle = installLifecycle({
		window: () => library,
		active: () => blocker !== undefined,
		cleanup: async () => {
			closeNotifications?.()
			await drainCreator()
		},
	})
	closeNotifications = installNotifications(() => library, lifecycle.show)
	const rendererOrigin = rendererUrl ? new URL(rendererUrl).origin : 'null'
	protocol.handle('novelive', async (request) => {
		const response = await cacheResponse(
			join(app.getPath('userData'), 'cache'),
			request.url,
		)
		if (request.headers.get('origin') === rendererOrigin) {
			response.headers.set('access-control-allow-origin', rendererOrigin)
		}
		return response
	})
	ipcMain.handle('novelive:state', () => appState())
	ipcMain.handle('novelive:pick-folder', async () => {
		const result = await dialog.showOpenDialog({
			properties: ['openDirectory'],
		})
		return result.filePaths[0] ?? null
	})
	ipcMain.handle('novelive:pick-files', async (_event, kind: unknown) => {
		if (kind !== 'source' && kind !== 'txt' && kind !== 'image') return []
		const result = await dialog.showOpenDialog({
			properties:
				kind === 'image' ? ['openFile', 'multiSelections'] : ['openFile'],
			filters:
				kind === 'image'
					? [{ name: t('图片'), extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
					: [
							{
								name: t('原文'),
								extensions: ['txt', 'epub', 'md', 'markdown', 'docx', 'pdf'],
							},
						],
		})
		return result.filePaths
	})
	ipcMain.handle('novelive:open-log-dir', async () => {
		await mkdir(logDir(), { recursive: true })
		const error = await shell.openPath(logDir())
		if (error) throw new Error(error)
	})
	ipcMain.handle('novelive:restart', () => {
		failures = 0
		if (library) startCreator(library)
	})

	openLibrary()
	app.on('activate', () => {
		if (!library) openLibrary()
		else lifecycle.show()
	})
})
app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit()
})
