import type { AppUpdater, UpdateInfo } from 'electron-updater'

export function updatePolicy(
	packaged: boolean,
	platform: NodeJS.Platform,
	appImage: boolean,
	source?: string,
) {
	const feed = source && updateUrl(source)
	if (!packaged || !feed) return
	if (!feed.pathname.endsWith('/')) feed.pathname += '/'
	const common = { feed: feed.href }
	if (platform === 'win32') return { ...common, mode: 'nsis' } as const
	if (platform === 'linux' && appImage)
		return { ...common, mode: 'appimage' } as const
	if (platform === 'darwin') return { ...common, mode: 'dmg' } as const
	if (platform === 'linux') return { ...common, mode: 'deb' } as const
}

function updateUrl(input: string, base?: string) {
	try {
		const url = new URL(input, base)
		if (url.username || url.password) return
		if (
			url.protocol === 'https:' ||
			(url.protocol === 'http:' &&
				['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
		)
			return url
	} catch {
		return
	}
}

export type UpdatePolicy = NonNullable<ReturnType<typeof updatePolicy>>

export function manualDownload(info: UpdateInfo, policy: UpdatePolicy) {
	for (const file of info.files ?? []) {
		const url = updateUrl(file.url, policy.feed)
		if (url?.pathname.toLowerCase().endsWith(`.${policy.mode}`)) return url.href
	}
	return policy.feed
}

export async function checkUpdate(
	updater: Pick<AppUpdater, 'checkForUpdates' | 'downloadUpdate'>,
	policy: UpdatePolicy,
) {
	const result = await updater.checkForUpdates()
	if (!result?.isUpdateAvailable) return { kind: 'current' } as const
	const { updateInfo } = result
	if (policy.mode === 'deb' || policy.mode === 'dmg')
		return {
			kind: 'manual',
			version: updateInfo.version,
			url: manualDownload(updateInfo, policy),
		} as const
	await updater.downloadUpdate()
	return { kind: 'ready', version: updateInfo.version } as const
}
