import { app, type BrowserWindow, ipcMain, shell } from 'electron'
import {
	type ShareRequest,
	type ShareResponse,
	shareRequest,
} from '../../../../packages/creator/src/contract'
import { InstalledPackages } from '../../../../packages/creator/src/share/installed'
import {
	exportProject,
	importProject,
	previewExport,
} from '../../../../packages/creator/src/share/project'
import {
	openPackage,
	PackageCodecError,
} from '../../../../packages/format/src/package/codec'
import type { FileProgressStore } from '../save-data'
import {
	type PackageWrites,
	packageProgressId,
} from '../save-data/package-writes'
import { t } from './i18n'

export async function installShareIpc(
	window: () => BrowserWindow | undefined,
	store: FileProgressStore,
	writes: PackageWrites,
	takeOpenFile: () => string | null,
) {
	const dataDir = app.getPath('userData')
	const library = await InstalledPackages.open(
		dataDir,
		app.getPath('documents'),
	)
	function allowed(event: Electron.IpcMainInvokeEvent) {
		const contents = window()?.webContents
		return (
			contents &&
			event.sender === contents &&
			event.senderFrame === contents.mainFrame
		)
	}
	let pending: Promise<unknown> = Promise.resolve()
	async function share(request: ShareRequest): Promise<ShareResponse> {
		try {
			switch (request.operation) {
				case 'previewExport':
					return {
						ok: true,
						result: {
							operation: request.operation,
							warnings: await previewExport(request),
						},
					}
				case 'export':
					return {
						ok: true,
						result: {
							operation: request.operation,
							works: await exportProject(request),
						},
					}
				case 'inspectImport':
					return {
						ok: true,
						result: {
							operation: request.operation,
							works: await library.inspectPath(request.packagePath),
						},
					}
				case 'import': {
					const works = await library.install(
						request.packagePath,
						request.approvedUpdates,
						async (migrations, publish) => {
							const workIds = migrations.map(({ workId }) => workId)
							await writes.stopAndDrain(workIds)
							try {
								for (const {
									workId,
									installedVersion,
									incomingVersion,
									chapters,
								} of migrations)
									await store.migrate({
										workId: packageProgressId(workId),
										fromVersion: installedVersion,
										toVersion: incomingVersion,
										chapters,
									})
								await publish()
							} finally {
								writes.resume(workIds)
							}
						},
						(path) => shell.trashItem(path),
					)
					return { ok: true, result: { operation: request.operation, works } }
				}
				case 'importAsProject': {
					using archive = await openPackage(request.packagePath)
					return {
						ok: true,
						result: {
							operation: request.operation,
							...(await importProject(archive, request.destination, dataDir)),
						},
					}
				}
			}
		} catch (error) {
			const code =
				error instanceof PackageCodecError ? error.code : 'write_failed'
			const message =
				code === 'unsupported_format' || code === 'unsupported_reader'
					? t('此作品包需要更新版本的 Novelive。')
					: code === 'corrupt_package'
						? t('无法检查作品包，请重新选择。')
						: code === 'write_failed'
							? t('无法写入作品包或工程，请检查磁盘空间和目录权限。')
							: t('作品包或所选范围已变更，请重新检查。')
			return { ok: false, error: { code, message } }
		}
	}
	ipcMain.handle('novelive:share', (event, input: unknown) => {
		if (!allowed(event) || !shareRequest.check(input))
			throw new Error('Invalid work package request')
		const result = pending.then(() => share(input))
		pending = result.catch(() => {})
		return result
	})
	ipcMain.handle('novelive:installed-list', (event) => {
		if (!allowed(event)) throw new Error('Invalid work package request')
		return library.list()
	})
	ipcMain.handle(
		'novelive:installed-chapter',
		(event, workId: unknown, version: unknown, chapterId: unknown) => {
			if (
				!allowed(event) ||
				typeof version !== 'number' ||
				typeof workId !== 'string' ||
				(chapterId !== undefined && typeof chapterId !== 'string')
			)
				throw new Error('Invalid work package request')
			return library.chapter(workId, version, chapterId)
		},
	)
	ipcMain.handle('novelive:take-open-package', (event) => {
		if (!allowed(event)) throw new Error('Invalid work package request')
		return takeOpenFile()
	})
	return library
}
