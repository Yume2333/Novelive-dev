import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ShareRequest, ShareResponse } from '@novelive/creator/contract'
import { _electron as electron, expect, test } from '@playwright/test'
import { build } from 'vite'

const require = createRequire(
	new URL('../../apps/desktop/package.json', import.meta.url),
)
const workId = '3d6404ce-00cb-4de7-88a9-eb4aac4e31cf'
const newId = '406f9aeb-88cb-494d-b4c8-e4c223884409'
const olderId = '3f8328ae-e231-4814-91a8-144e97c7cfae'
const work = { workId, version: 2 }
const title = '测试作品'
const projectRoot = '/projects/book'
const volumeId = 'vol_1'
const packagePath = '/import/book.novelive'
const copyPath = '/projects/copy'
const exportPath = '/export/book.novelive'
const results = {
	previewExport: {
		ok: true,
		result: {
			operation: 'previewExport',
			warnings: [{ workId, chapterId: 'ch_1', title: '需要处理的第一章' }],
		},
	},
	export: { ok: true, result: { operation: 'export', works: [work] } },
	inspectImport: {
		ok: true,
		result: {
			operation: 'inspectImport',
			works: [
				{ relation: 'update', work, title, installedVersion: 1 },
				{
					relation: 'new',
					work: { workId: newId, version: 1 },
					title: '新作品',
				},
				{
					relation: 'older',
					work: { workId: olderId, version: 1 },
					title: '旧作品',
					installedVersion: 3,
				},
			],
		},
	},
	import: {
		ok: true,
		result: {
			operation: 'import',
			works: [work, { workId: newId, version: 1 }],
		},
	},
	importAsProject: {
		ok: true,
		result: {
			operation: 'importAsProject',
			projectRoot: copyPath,
			workIds: [newId],
		},
	},
} satisfies Record<ShareRequest['operation'], ShareResponse>

test('M5 share surfaces confirm overwrite after adding the package extension', async () => {
	const profile = await mkdtemp(join(tmpdir(), 'novelive-share-picker-'))
	try {
		const stem = join(profile, '作品')
		const destination = `${stem}.novelive`
		await writeFile(destination, 'existing work')
		const app = await electron.launch({
			executablePath: require('electron'),
			args: ['apps/desktop', `--user-data-dir=${profile}`],
			env: { ...process.env, ELECTRON_RENDERER_URL: '', NL_REPLAY: 'strict' },
		})
		try {
			const page = await app.firstWindow()
			await app.evaluate(
				({ dialog }, paths) => {
					let confirms = 0
					dialog.showSaveDialog = async () => ({
						canceled: false,
						filePath: paths.shift() ?? '',
					})
					dialog.showMessageBox = async () => ({
						response: confirms++ === 1 ? 1 : 0,
						checkboxChecked: false,
					})
				},
				[stem, stem, destination, join(profile, '新作品')],
			)
			const pick = () =>
				page.evaluate(() => window.novelive.pickPackageDestination?.())
			expect(await pick()).toBeNull()
			expect(await pick()).toBe(destination)
			expect(await pick()).toBe(destination)
			expect(await pick()).toBe(join(profile, '新作品.novelive'))
		} finally {
			await app.close()
		}
	} finally {
		await rm(profile, { recursive: true, force: true })
	}
})

test('M5 share surfaces review export, approve updates and import as a project in Electron', async () => {
	const profile = await mkdtemp(join(tmpdir(), 'novelive-share-ui-'))
	try {
		const app = await electron.launch({
			executablePath: require('electron'),
			args: ['apps/desktop', `--user-data-dir=${profile}`],
			env: { ...process.env, ELECTRON_RENDERER_URL: '', NL_REPLAY: 'strict' },
		})
		try {
			const desktop = await app.firstWindow()
			await expect(desktop).toHaveURL(/^file:.*\/out\/renderer\/index\.html$/)
			const [page] = await Promise.all([
				app.waitForEvent('window'),
				app.evaluate(({ BrowserWindow }) => {
					const window = new BrowserWindow({ width: 1100, height: 800 })
					void window.loadURL('about:blank')
				}),
			])
			const requests: ShareRequest[] = []
			await page.exposeFunction(
				'recordShareRequest',
				(request: ShareRequest) => {
					requests.push(request)
				},
			)
			await page.addInitScript(
				({
					workId,
					title,
					volumeId,
					projectRoot,
					packagePath,
					exportPath,
					copyPath,
					results,
				}) => {
					let picked = 0
					let destinationPicked = 0
					let exports = 0
					Object.assign(window, {
						novelive: {
							call(command: string) {
								const data = {
									'library.list': {
										works: [{ workId, title, published: 1, chapters: 1 }],
										unreadableCount: 0,
									},
									'production.get': {
										workId,
										title,
										exportTarget: { projectRoot, volumeId },
										phase: 'done',
										chapters: [],
										visual: null,
									},
									'production.getQueue': {
										active: null,
										queued: [],
										inactive: [],
									},
								}
								return {
									promise: Promise.resolve(data[command as keyof typeof data]),
									cancel() {},
								}
							},
							on: () => () => {},
							pickFiles: async (kind: string) =>
								kind === 'package'
									? [
											++picked === 1
												? '/import/unsupported.novelive'
												: packagePath,
										]
									: [],
							pickPackageDestination: async () =>
								++destinationPicked === 1 ? null : exportPath,
							pickFolder: async () => copyPath,
							host: {
								appState: async () => ({ creator: 'ready' }),
								share: {
									async call(request: ShareRequest) {
										await (
											window as unknown as {
												recordShareRequest(request: ShareRequest): Promise<void>
											}
										).recordShareRequest(request)
										if (
											request.operation === 'inspectImport' &&
											request.packagePath !== packagePath
										) {
											return {
												ok: false,
												error: {
													code: 'unsupported_format',
													message: '不支持此作品包格式',
												},
											}
										}
										if (request.operation === 'export' && ++exports === 1) {
											return {
												ok: false,
												error: {
													code: 'write_failed',
													message: '无法写入作品包',
												},
											}
										}
										if (request.operation === 'inspectImport' && picked === 4) {
											return {
												ok: true,
												result: {
													operation: 'inspectImport',
													works: results.inspectImport.result.works.map(
														(entry) =>
															entry.relation === 'update'
																? {
																		...entry,
																		relation: 'older',
																		installedVersion: 3,
																	}
																: entry.relation === 'new'
																	? {
																			...entry,
																			relation: 'current',
																			installedVersion: entry.work.version,
																		}
																	: entry,
													),
												},
											} satisfies ShareResponse
										}
										return results[request.operation]
									},
								},
							},
						},
					})
				},
				{
					workId,
					title,
					volumeId,
					projectRoot,
					packagePath,
					exportPath,
					copyPath,
					results,
				},
			)
			await page.goto(desktop.url())

			const pick = page.getByRole('button', { name: '导入作品包' })
			const preview = page.getByRole('dialog', { name: '导入作品包' })
			const glass = await page.evaluate(() =>
				getComputedStyle(document.documentElement)
					.getPropertyValue('--panel-70')
					.trim(),
			)
			await expect(pick).toHaveCSS('background-color', glass)
			await pick.click()
			await expect(preview.getByRole('alert')).toHaveText('不支持此作品包格式')
			await preview.getByRole('button', { name: '关闭' }).click()
			await pick.click()
			await expect(preview.getByText('v1 → v2 · 可更新')).toBeVisible()
			await expect(
				preview.getByText('不会替换', { exact: false }),
			).toBeVisible()
			await page.keyboard.press('Escape')
			await expect(preview).toBeHidden()
			expect(requests.map((request) => request.operation)).toEqual([
				'inspectImport',
				'inspectImport',
			])
			await pick.click()
			await preview.getByRole('button', { name: '确认导入与更新' }).click()
			await expect(preview.getByRole('status')).toHaveText(
				'已导入或更新 2 部作品。',
			)
			expect(requests.at(-1)).toEqual({
				operation: 'import',
				packagePath,
				approvedUpdates: [{ workId, installedVersion: 1, incomingVersion: 2 }],
			})
			await preview.getByRole('button', { name: '导入为工程' }).click()
			await expect(preview.getByRole('status')).toHaveText(
				'已导入为新工程，可以在书库中编辑。',
			)
			expect(requests.at(-1)).toEqual({
				operation: 'importAsProject',
				packagePath,
				destination: copyPath,
			})
			await preview.getByRole('button', { name: '关闭' }).click()

			await pick.click()
			await expect(preview.getByText('v1 · 已导入')).toBeVisible()
			await expect(
				preview.getByText('v2 · 已安装较新的 v3，不会替换'),
			).toBeVisible()
			await expect(
				preview.getByRole('button', { name: '确认导入与更新' }),
			).toBeHidden()
			await preview
				.getByRole('button', { name: '导入为工程' })
				.click({ timeout: 5000 })
			await expect(preview.getByRole('status')).toHaveText(
				'已导入为新工程，可以在书库中编辑。',
			)
			expect(requests.at(-1)).toEqual({
				operation: 'importAsProject',
				packagePath,
				destination: copyPath,
			})
			await preview.getByRole('button', { name: '关闭' }).click()

			await page.getByRole('link', { name: title }).click()
			await page.getByRole('button', { name: '导出作品包' }).click()
			const dialog = page.getByRole('dialog', { name: '导出作品包' })
			const review = dialog.getByRole('button', { name: '检查导出内容' })
			await expect(
				dialog.getByRole('radio', { name: '单部作品' }),
			).toBeChecked()
			await expect(
				dialog.getByRole('checkbox', { name: '包含原文' }),
			).not.toBeChecked()
			await review.click()
			await expect(dialog.getByText('需要处理的第一章')).toBeVisible()
			expect(requests.at(-1)).toEqual({
				operation: 'previewExport',
				projectRoot,
				scope: { level: 'work', volumeId, workId },
				includeSource: false,
			})
			await dialog.getByRole('radio', { name: '整卷', exact: true }).check()
			await expect(dialog.getByText('需要处理的第一章')).toBeHidden()
			await review.click()
			await expect(dialog.getByText('需要处理的第一章')).toBeVisible()
			expect(requests.at(-1)).toEqual({
				operation: 'previewExport',
				projectRoot,
				scope: { level: 'volume', volumeId },
				includeSource: false,
			})
			await dialog.getByRole('radio', { name: '整个系列' }).check()
			await dialog.getByRole('checkbox', { name: '包含原文' }).check()
			await review.click()
			await expect(dialog.getByText('需要处理的第一章')).toBeVisible()
			const exportButton = dialog.getByRole('button', {
				name: '导出 .novelive',
			})
			await exportButton.click()
			await expect(exportButton).toBeEnabled()
			expect(requests.some((request) => request.operation === 'export')).toBe(
				false,
			)
			await expect(dialog.getByText('已导出', { exact: false })).toBeHidden()
			await exportButton.click()
			await expect(dialog.getByRole('alert')).toHaveText('无法写入作品包')
			await expect(dialog.getByText('已导出', { exact: false })).toBeHidden()
			await exportButton.click()
			await expect(dialog.getByRole('status')).toHaveText(
				'已导出 1 部作品（v2）。',
			)
			expect(requests.slice(-3)).toEqual([
				{
					operation: 'previewExport',
					projectRoot,
					scope: { level: 'series' },
					includeSource: true,
				},
				{
					operation: 'export',
					projectRoot,
					scope: { level: 'series' },
					includeSource: true,
					destination: exportPath,
				},
				{
					operation: 'export',
					projectRoot,
					scope: { level: 'series' },
					includeSource: true,
					destination: exportPath,
				},
			])
			await dialog.getByRole('button', { name: '关闭' }).click()

			const bundle = await build({
				configFile: false,
				logLevel: 'silent',
				define: { 'process.env.NODE_ENV': JSON.stringify('production') },
				build: {
					write: false,
					lib: {
						entry: fileURLToPath(
							new URL('../fixtures/m5-legacy-saves.tsx', import.meta.url),
						),
						name: 'legacySavesFixture',
						formats: ['iife'],
					},
				},
			})
			const [output] = Array.isArray(bundle) ? bundle : [bundle]
			if (!output || !('output' in output))
				throw new Error('Missing legacy saves fixture output')
			const fixture = output.output.find((entry) => entry.type === 'chunk')
			if (!fixture) throw new Error('Missing legacy saves fixture bundle')
			for (const asset of output.output) {
				if (asset.type === 'asset' && asset.fileName.endsWith('.css'))
					await page.addStyleTag({ content: String(asset.source) })
			}
			await page.addScriptTag({ content: fixture.code })
			const legacy = page.getByRole('region', { name: '旧版本存档' })
			await expect(legacy).toBeVisible()
			const deleteSave = legacy.getByRole('button', { name: '删除 v1 槽位 1' })
			await legacy.getByRole('heading', { name: '旧版本存档' }).hover()
			await expect(deleteSave).toHaveCSS('opacity', '0')
			await deleteSave.hover()
			await expect(deleteSave).toHaveCSS('opacity', '1')
			await legacy.getByRole('heading', { name: '旧版本存档' }).hover()
			await deleteSave.focus()
			await expect(deleteSave).toHaveCSS('opacity', '1')
			await deleteSave.press('Enter')
			await legacy.getByRole('button', { name: '取消' }).click()
			await expect(
				legacy.getByRole('region', { name: '版本 v1' }),
			).toBeVisible()
			await legacy.getByRole('button', { name: '删除 v1 槽位 1' }).click()
			await legacy.getByRole('button', { name: '确认删除' }).click()
			await expect(legacy.getByRole('region', { name: '版本 v1' })).toBeHidden()
			await expect(
				legacy.getByRole('region', { name: '版本 v2' }),
			).toBeVisible()
			await expect(page.locator('[data-removed]')).toHaveAttribute(
				'data-removed',
				JSON.stringify({
					workId: 'work',
					version: 1,
					slot: { kind: 'manual', slot: 1 },
				}),
			)
			await expect(
				page.getByRole('button', { name: '读档槽位 1', exact: true }),
			).toBeEnabled()
		} finally {
			await app.close()
		}
	} finally {
		await rm(profile, { recursive: true, force: true })
	}
})
