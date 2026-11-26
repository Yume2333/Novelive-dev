import { access, constants } from 'node:fs/promises'
import { dirname } from 'node:path'
import { app, type BrowserWindow, dialog, shell } from 'electron'
import updaters from 'electron-updater'
import { updateRepository } from '../../../package.json'
import { languageReady, t } from '../i18n'
import { checkUpdate, updatePolicy, updateSource } from './policy'

export function installUpdates(options: {
	window: () => BrowserWindow | undefined
	quit: (exit: () => void, canQuit?: () => Promise<boolean>) => Promise<void>
}) {
	const appImage = process.env.APPIMAGE
	const policy = updatePolicy(
		app.isPackaged,
		process.platform,
		Boolean(appImage),
		updateSource(process.env.NL_UPDATE_URL, updateRepository),
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
		const buttons = action ? [t('稍后'), action] : [t('确定')]
		const dialogOptions = {
			title: t('Novelive 更新'),
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

	async function canInstall() {
		if (policy?.mode !== 'appimage' || !appImage) return true
		try {
			await access(dirname(appImage), constants.W_OK | constants.X_OK)
			return true
		} catch (error) {
			console.error('Novelive AppImage directory is not writable', error)
			await prompt(t('无法替换 AppImage。请将其移至可写目录后再重试更新。'))
			return false
		}
	}

	async function check(manual: boolean) {
		if (!policy || !engine) {
			if (manual) await prompt(t('未配置应用更新源。'))
			return
		}
		try {
			const result = await checkUpdate(engine, policy)
			if (!manual && result.kind !== 'current') await languageReady(15_000)
			if (result.kind === 'current') {
				if (manual) await prompt(t('已是最新版本。'))
			} else if (result.kind === 'manual') {
				if (
					await prompt(
						t('版本 {{version}} 已可用，请手动下载。', {
							version: result.version,
						}),
						t('打开下载'),
					)
				)
					await shell.openExternal(result.url)
			} else if (
				await prompt(
					t('版本 {{version}} 已下载，可以重启安装。', {
						version: result.version,
					}),
					t('重启安装'),
				)
			) {
				await options.quit(() => engine.quitAndInstall(false, true), canInstall)
			}
		} catch (error) {
			console.error('Novelive update check failed', error)
			if (manual) await prompt(t('检查或下载应用更新失败，请稍后重试。'))
		}
	}

	return (manual: boolean) => {
		checking ??= check(manual).finally(() => {
			checking = undefined
		})
		return checking
	}
}
