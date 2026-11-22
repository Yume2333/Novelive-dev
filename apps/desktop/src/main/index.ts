import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { HostState } from '@novelive/creator/contract'
import {
	app,
	BrowserWindow,
	dialog,
	ipcMain,
	MessageChannelMain,
	protocol,
	shell,
	utilityProcess,
} from 'electron'
import { cacheResponse } from '../../../../packages/creator/src/host-runtime/cache'

let creator: Electron.UtilityProcess | undefined
let generation = 0
let state: HostState['creator'] = 'down'
let library: BrowserWindow | undefined
let failures = 0
const failureLimit = 3
const handshakeTimeoutMs = 10_000

protocol.registerSchemesAsPrivileged([
	{ scheme: 'novelive', privileges: { standard: true, secure: true } },
])

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

function stopCreator() {
	const worker = creator
	creator = undefined
	worker?.kill()
}

function startCreator(window: BrowserWindow) {
	if (failures >= failureLimit || window.isDestroyed()) return
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
		creator = undefined
		if (!ready) failures += 1
		state = ready ? 'down' : 'failed'
		if (window.isDestroyed()) return
		window.webContents.send('novelive:down', { generation: current })
		if (ready) startCreator(window)
	}

	worker.on('message', (message) => {
		if (
			worker !== creator ||
			ready ||
			message?.type !== 'ready' ||
			message.generation !== current
		)
			return
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
	window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
	window.webContents.on('will-navigate', (event) => event.preventDefault())
	window.webContents.on('did-finish-load', () => startCreator(window))
	window.once('closed', () => {
		library = undefined
		stopCreator()
	})
	if (process.env.ELECTRON_RENDERER_URL && !app.isPackaged) {
		void window.loadURL(process.env.ELECTRON_RENDERER_URL)
	} else {
		void window.loadFile(join(import.meta.dirname, '../renderer/index.html'))
	}
}

app.whenReady().then(() => {
	protocol.handle('novelive', (request) =>
		cacheResponse(join(app.getPath('userData'), 'cache'), request.url),
	)
	ipcMain.handle('novelive:state', () => appState())
	ipcMain.handle('novelive:pick-folder', async () => {
		const result = await dialog.showOpenDialog({
			properties: ['openDirectory'],
		})
		return result.filePaths[0] ?? null
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
	})
})
app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit()
})
