import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
	app,
	type BrowserWindow,
	dialog,
	Menu,
	nativeImage,
	Tray,
} from 'electron'
import { onLanguage, t } from '../i18n'

const run = promisify(execFile)

async function linuxTrayAvailable() {
	try {
		const { stdout } = await run(
			'gdbus',
			[
				'call',
				'--session',
				'--dest',
				'org.kde.StatusNotifierWatcher',
				'--object-path',
				'/StatusNotifierWatcher',
				'--method',
				'org.freedesktop.DBus.Properties.Get',
				'org.kde.StatusNotifierWatcher',
				'IsStatusNotifierHostRegistered',
			],
			{ timeout: 1000 },
		)
		return stdout.includes('true')
	} catch {
		return false
	}
}

export function installLifecycle(options: {
	window(): BrowserWindow | undefined
	active(): boolean
	cleanup(): void | Promise<void>
}) {
	let quitting = false
	let prompting = false
	let tray: Tray | undefined
	const show = () => {
		const window = options.window()
		if (!window || window.isDestroyed()) return
		if (window.isMinimized()) window.restore()
		window.show()
		window.focus()
	}
	const quit = async (
		exit = () => app.quit(),
		canQuit?: () => Promise<boolean>,
	) => {
		if (quitting || prompting) return
		prompting = true
		try {
			if (options.active()) {
				const { response } = await dialog.showMessageBox({
					type: 'question',
					title: t('退出 Novelive'),
					message: t('制作仍在进行，确定停止制作并退出？'),
					buttons: [t('继续制作'), t('停止并退出')],
					defaultId: 0,
					cancelId: 0,
					noLink: true,
				})
				if (response !== 1) return
			}
			if (canQuit && !(await canQuit())) return
			await options.cleanup()
			quitting = true
			tray?.destroy()
			exit()
		} finally {
			prompting = false
		}
	}
	const menu = () =>
		Menu.buildFromTemplate([
			{ label: t('打开 Novelive'), click: show },
			{ type: 'separator' },
			{
				label: t('退出 Novelive'),
				click: () => void quit(),
			},
		])
	try {
		const pixels = Buffer.alloc(22 * 22 * 4)
		for (let y = 2; y < 20; y += 1) {
			for (let x = 2; x < 20; x += 1) {
				const offset = (y * 22 + x) * 4
				const ink = x < 6 || x > 15 || Math.abs(x - y) < 2
				pixels.set(ink ? [79, 102, 132, 255] : [255, 255, 255, 255], offset)
			}
		}
		tray = new Tray(
			nativeImage.createFromBitmap(pixels, { width: 22, height: 22 }),
		)
		tray.setToolTip('Novelive')
		tray.setContextMenu(menu())
		onLanguage(() => tray?.setContextMenu(menu()))
		tray.on('click', show)
	} catch {
		tray = undefined
	}
	app.on('before-quit', (event) => {
		if (quitting) return
		event.preventDefault()
		void quit()
	})
	return {
		quit,
		show,
		attach(window: BrowserWindow) {
			window.on('close', (event) => {
				if (quitting) return
				event.preventDefault()
				void (async () => {
					const available =
						tray &&
						!tray.isDestroyed() &&
						(process.platform !== 'linux' || (await linuxTrayAvailable()))
					if (quitting || window.isDestroyed()) return
					if (available) window.hide()
					else window.minimize()
				})()
			})
		},
	}
}
