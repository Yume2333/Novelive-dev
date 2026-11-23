import { app, type BrowserWindow, dialog, shell } from 'electron'
import updaters from 'electron-updater'
import { checkUpdate, updatePolicy } from './policy'

export function installUpdates(options: {
	window: () => BrowserWindow | undefined
	quit: (exit: () => void) => Promise<void>
}) {
	const policy = updatePolicy(
		app.isPackaged,
		process.platform,
		Boolean(process.env.APPIMAGE),
		process.env.NL_UPDATE_URL,
	)
	const Updater =
		policy &&
		{
			nsis: updaters.NsisUpdater,
			appimage: updaters.AppImageUpdater,
			dmg: updaters.MacUpdater,
			deb: updaters.DebUpdater,
		}[policy.mode]
	const engine =
		policy && Updater && new Updater({ provider: 'generic', url: policy.feed })
	if (engine) {
		engine.autoDownload = false
		engine.autoInstallOnAppQuit = false
	}

	let checking: Promise<void> | undefined
	async function prompt(message: string, action?: string) {
		const buttons = action ? ['稍后', action] : ['确定']
		const dialogOptions = {
			title: 'Novelive 更新',
			message,
			buttons,
			defaultId: 0,
			cancelId: 0,
			noLink: true,
		}
		const window = options.window()
		const { response } = window
			? await dialog.showMessageBox(window, dialogOptions)
			: await dialog.showMessageBox(dialogOptions)
		return response === 1
	}

	async function check(manual: boolean) {
		if (!policy || !engine) {
			if (manual) await prompt('未配置应用更新源。')
			return
		}
		try {
			const result = await checkUpdate(engine, policy)
			if (result.kind === 'current') {
				if (manual) await prompt('已是最新版本。')
			} else if (result.kind === 'manual') {
				if (
					await prompt(
						`版本 ${result.version} 已可用，请手动下载。`,
						'打开下载',
					)
				)
					await shell.openExternal(result.url)
			} else if (
				await prompt(
					`版本 ${result.version} 已下载，可以重启安装。`,
					'重启安装',
				)
			) {
				await options.quit(() => engine.quitAndInstall(false, true))
			}
		} catch (error) {
			console.error('Novelive update check failed', error)
			if (manual) await prompt('检查或下载应用更新失败，请稍后重试。')
		}
	}

	return (manual: boolean) => {
		checking ??= check(manual).finally(() => {
			checking = undefined
		})
		return checking
	}
}
