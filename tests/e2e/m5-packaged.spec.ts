import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
	type ElectronApplication,
	_electron as electron,
	expect,
	test,
} from '@playwright/test'
import sharp from 'sharp'
import { Project } from '../../packages/creator/src/project'
import { exportProject } from '../../packages/creator/src/share/project'
import { projectFiles } from '../../packages/format/src/model'
import {
	playerRef,
	playerWorkId,
	seedPlayerProject,
} from '../fixtures/minimal-player'

const executablePath = process.env.NL_M5_EXECUTABLE

function metadataFileName(platform: NodeJS.Platform) {
	if (platform === 'darwin') return 'latest-mac.yml'
	if (platform === 'win32') return 'latest.yml'
	return 'latest-linux.yml'
}

function buildUpdateYaml(
	version: string,
	platform: NodeJS.Platform,
	arch: string,
) {
	const sha512 = Buffer.alloc(64, 1).toString('base64')
	const releaseDate = '2026-11-25T00:00:00.000Z'
	if (platform === 'darwin') {
		const zipName = `Novelive-${version}-mac-${arch}.zip`
		const dmgName = `Novelive-${version}-mac-${arch}.dmg`
		return [
			`version: ${version}`,
			'files:',
			`  - url: ${zipName}`,
			`    sha512: ${sha512}`,
			'    size: 1024',
			`  - url: ${dmgName}`,
			`    sha512: ${sha512}`,
			'    size: 1024',
			`path: ${zipName}`,
			`sha512: ${sha512}`,
			`releaseDate: '${releaseDate}'`,
			'',
		].join('\n')
	}
	if (platform === 'win32') {
		const exeName = `Novelive-${version}-win-${arch}.exe`
		return [
			`version: ${version}`,
			'files:',
			`  - url: ${exeName}`,
			`    sha512: ${sha512}`,
			'    size: 1024',
			`path: ${exeName}`,
			`sha512: ${sha512}`,
			`releaseDate: '${releaseDate}'`,
			'',
		].join('\n')
	}
	const appImageName = `Novelive-${version}-linux-${arch}.AppImage`
	return [
		`version: ${version}`,
		'files:',
		`  - url: ${appImageName}`,
		`    sha512: ${sha512}`,
		'    size: 1024',
		`path: ${appImageName}`,
		`sha512: ${sha512}`,
		`releaseDate: '${releaseDate}'`,
		'',
	].join('\n')
}

async function createFixturePackage(root: string, destination: string) {
	const png = (background: string) =>
		sharp({ create: { width: 32, height: 128, channels: 3, background } })
			.png()
			.toBuffer()
	await seedPlayerProject(root, await png('#203060'), await png('#e06030'))
	const workFile = projectFiles.work(playerRef.volumeId, playerWorkId)
	{
		using project = await Project.open(root)
		const assets = projectFiles.assetRegistry({ level: 'series' })
		const registry = await project.read(assets)
		for (const name of ['room', 'traveler']) {
			await project.writeFile(
				`assets/${name}.webp`,
				await sharp(await project.readFile(`assets/${name}.png`))
					.webp({ lossless: true })
					.toBuffer(),
			)
		}
		await project.write(assets, {
			...registry,
			entries: registry.entries.map((entry) => ({
				...entry,
				path: entry.path.replace(/\.png$/, '.webp'),
			})),
		})
		const work = await project.read(workFile)
		await project.write(workFile, { ...work, version: 0 })
		project.tasks.registerWork({ workId: playerWorkId, title: work.title })
		project.database
			.prepare("UPDATE work SET status = 'done' WHERE work_id = ?")
			.run(playerWorkId)
		project.database
			.prepare(
				"INSERT INTO chapter (work_id, chapter_id, ord, user_state, placeholder) VALUES (?, ?, 0, 'published', 0)",
			)
			.run(playerWorkId, playerRef.chapterId)
	}
	await exportProject({
		projectRoot: root,
		scope: {
			level: 'work',
			volumeId: playerRef.volumeId,
			workId: playerWorkId,
		},
		destination,
	})
}

async function cleanupInstalledArchives(
	userDataDir: string,
	actualDocumentsDir?: string,
) {
	if (!actualDocumentsDir) return
	try {
		const raw = await readFile(
			join(userDataDir, 'installed-works', 'library.json'),
			'utf8',
		)
		const entries: unknown = JSON.parse(raw)
		if (!Array.isArray(entries)) return
		const archiveDir = join(actualDocumentsDir, 'Novelive', '导入的作品')
		for (const entry of entries) {
			if (
				entry &&
				typeof entry === 'object' &&
				'installation' in entry &&
				typeof entry.installation === 'string'
			) {
				await rm(join(archiveDir, `${entry.installation}.novelive`), {
					force: true,
				}).catch(() => {})
			}
		}
	} catch {
		// No installed-works index written.
	}
}

test.describe('M5 packaged application smoke verification', () => {
	test.skip(
		!executablePath,
		'Set NL_M5_EXECUTABLE to run against a packaged Novelive binary',
	)

	test('verifies packaged about, licenses, .novelive import, offline playback, and update policy', async () => {
		test.setTimeout(150_000)
		if (!executablePath) return

		const desktopPkg = JSON.parse(
			await readFile('apps/desktop/package.json', 'utf8'),
		) as { version: string }
		const expectedVersion = desktopPkg.version
		const metadataName = metadataFileName(process.platform)
		const metadataPath = process.env.NL_M5_UPDATE_METADATA
		const initialMetadata = metadataPath
			? await readFile(metadataPath, 'utf8')
			: buildUpdateYaml(expectedVersion, process.platform, process.arch)

		const directory = await mkdtemp(join(tmpdir(), 'novelive-m5-packaged-'))
		const userDataDir = join(directory, 'user-data')
		const homeDir = process.env.NL_M5_HOME ?? join(directory, 'home')
		const documentsDir = join(homeDir, 'Documents')
		const xdgConfig = join(directory, 'xdg-config')
		const xdgData = join(directory, 'xdg-data')
		const projectRoot = join(directory, 'project')
		const fixturePath = join(directory, 'fixture.novelive')

		let servedMetadata = initialMetadata
		const requests: { method: string; url: string; pathname: string }[] = []
		const server = createServer((req, res) => {
			const url = req.url ?? '/'
			const pathname = new URL(url, 'http://127.0.0.1').pathname
			requests.push({ method: req.method ?? 'GET', url, pathname })
			if (pathname === `/${metadataName}`) {
				res.writeHead(200, { 'content-type': 'text/yaml; charset=utf-8' })
				res.end(servedMetadata)
				return
			}
			res.writeHead(404)
			res.end('Not found')
		})

		let desktopApp: ElectronApplication | undefined
		let actualDocumentsDir: string | undefined
		try {
			await mkdir(documentsDir, { recursive: true })
			await mkdir(xdgConfig, { recursive: true })
			await writeFile(
				join(xdgConfig, 'user-dirs.dirs'),
				`XDG_DOCUMENTS_DIR="${documentsDir}"\n`,
			)
			await createFixturePackage(projectRoot, fixturePath)
			const listening = Promise.withResolvers<void>()
			server.listen(0, '127.0.0.1', listening.resolve)
			await listening.promise
			const { port } = server.address() as AddressInfo
			const feedUrl = `http://127.0.0.1:${port}/`

			desktopApp = await electron.launch({
				executablePath,
				args: ['--no-sandbox', `--user-data-dir=${userDataDir}`, fixturePath],
				env: Object.fromEntries(
					Object.entries({
						...process.env,
						ELECTRON_RENDERER_URL: '',
						NL_REPLAY: 'strict',
						NL_UPDATE_URL: feedUrl,
						HOME: homeDir,
						XDG_CONFIG_HOME: xdgConfig,
						XDG_DATA_HOME: xdgData,
					}).filter(
						(entry): entry is [string, string] => entry[1] !== undefined,
					),
				),
			})

			const page = await desktopApp.firstWindow()
			actualDocumentsDir = await desktopApp.evaluate(({ app }) =>
				app.getPath('documents'),
			)
			await expect(page.getByText('创作端已就绪')).toBeAttached({
				timeout: 30_000,
			})
			const about = await page.evaluate(() =>
				window.novelive.host.about?.info(),
			)
			expect(about).toEqual({ version: expectedVersion, packaged: true })

			const resourcesPath = await desktopApp.evaluate(
				() => process.resourcesPath,
			)
			const packagedLicenses: Record<string, number> = {}
			for (const name of ['LICENSE.txt', 'THIRD_PARTY_NOTICES.txt']) {
				const info = await stat(join(resourcesPath, 'licenses', name))
				if (!info.isFile() || info.size === 0) {
					throw new Error(`Missing or empty packaged license: ${name}`)
				}
				packagedLicenses[name] = info.size
			}
			expect(packagedLicenses['LICENSE.txt']).toBeGreaterThan(0)
			expect(packagedLicenses['THIRD_PARTY_NOTICES.txt']).toBeGreaterThan(0)

			// Startup update metadata check against local feed
			await expect
				.poll(
					() =>
						requests.some(
							(req) =>
								req.method === 'GET' && req.pathname === `/${metadataName}`,
						),
					{ timeout: 15_000 },
				)
				.toBe(true)

			// Verify .novelive auto-open import and offline playback after deleting source archive
			await expect(
				page.getByRole('dialog').getByText('v1 · 新作品'),
			).toBeVisible({ timeout: 15_000 })
			await page.getByRole('button', { name: '导入', exact: true }).click()
			await expect(page.getByText('已导入或更新 1 部作品。')).toBeVisible()
			await page.keyboard.press('Escape')
			await rm(fixturePath)

			await page.getByRole('link', { name: /黄昏/ }).click()
			await expect(page.locator('.nl-text-display')).toHaveText('你好，世界。')
			await expect(page.locator('.nl-player canvas')).toBeVisible()
			const pixel = await sharp(
				await page.locator('.nl-player canvas').screenshot(),
			)
				.raw()
				.toBuffer()
			expect([...pixel.subarray(0, 3)]).toEqual([32, 48, 96])

			await page.keyboard.press('Escape')
			await page.getByRole('button', { name: '返回书库' }).click()
			await expect(
				page.getByRole('heading', { name: '书库', exact: true }),
			).toBeVisible()

			// Spy on dialog.showMessageBox and shell.openExternal for manual update checks
			await desktopApp.evaluate(({ dialog, shell }) => {
				const state = {
					response: 0,
					dialogs: [] as {
						title?: string
						message: string
						buttons?: string[]
					}[],
					externalUrls: [] as string[],
				}
				Reflect.set(globalThis, '__nlUpdateVerifyState', state)
				dialog.showMessageBox = (async (
					first: Electron.BaseWindow | Electron.MessageBoxOptions,
					second?: Electron.MessageBoxOptions,
				) => {
					const opts = second ?? ('message' in first ? first : undefined)
					if (opts) {
						state.dialogs.push({
							title: opts.title,
							message: opts.message,
							buttons: opts.buttons,
						})
					}
					return { response: state.response, checkboxChecked: false }
				}) as typeof dialog.showMessageBox
				shell.openExternal = async (url: string) => {
					state.externalUrls.push(url)
				}
			})

			await page.getByRole('link', { name: '设置' }).click()
			await expect(page.getByRole('button', { name: '检查更新' })).toBeVisible()

			// Give the startup background checkUpdates(false) a brief moment to settle
			// so manual checkUpdates(true) is not coalesced with the startup check.
			await page.waitForTimeout(300)

			const beforeSameVersion = requests.filter(
				(req) => req.pathname === `/${metadataName}`,
			).length
			await page.getByRole('button', { name: '检查更新' }).click()
			await expect
				.poll(
					() =>
						requests.filter((req) => req.pathname === `/${metadataName}`)
							.length > beforeSameVersion,
					{ timeout: 15_000 },
				)
				.toBe(true)

			await expect
				.poll(async () =>
					desktopApp?.evaluate(() => {
						const state = Reflect.get(globalThis, '__nlUpdateVerifyState') as {
							dialogs: { message: string }[]
						}
						return state.dialogs.map((entry) => entry.message)
					}),
				)
				.toContain('已是最新版本。')

			let manualPromptMessage: string | undefined
			let manualPromptUrl: string | undefined

			if (process.platform === 'darwin') {
				const newerVersion = '99.0.0'
				servedMetadata = buildUpdateYaml(
					newerVersion,
					process.platform,
					process.arch,
				)
				await desktopApp.evaluate(() => {
					const state = Reflect.get(globalThis, '__nlUpdateVerifyState') as {
						response: number
						dialogs: unknown[]
						externalUrls: string[]
					}
					state.dialogs.length = 0
					state.externalUrls.length = 0
					state.response = 1
				})

				const beforeManual = requests.filter(
					(req) => req.pathname === `/${metadataName}`,
				).length
				await page.getByRole('button', { name: '检查更新' }).click()
				await expect
					.poll(
						() =>
							requests.filter((req) => req.pathname === `/${metadataName}`)
								.length > beforeManual,
						{ timeout: 15_000 },
					)
					.toBe(true)

				const expectedPrompt = `版本 ${newerVersion} 已可用，请手动下载。`
				await expect
					.poll(async () =>
						desktopApp?.evaluate(() => {
							const state = Reflect.get(
								globalThis,
								'__nlUpdateVerifyState',
							) as {
								dialogs: { message: string; buttons?: string[] }[]
								externalUrls: string[]
							}
							return state
						}),
					)
					.toMatchObject({
						dialogs: [
							expect.objectContaining({
								message: expectedPrompt,
								buttons: ['稍后', '打开下载'],
							}),
						],
						externalUrls: [
							`${feedUrl}Novelive-${newerVersion}-mac-${process.arch}.dmg`,
						],
					})

				manualPromptMessage = expectedPrompt
				manualPromptUrl = `${feedUrl}Novelive-${newerVersion}-mac-${process.arch}.dmg`
			}

			// Ensure no installer or zip download was attempted during update checks
			const downloads = requests.filter((req) =>
				/\.(dmg|zip|exe|appimage)$/i.test(req.pathname),
			)
			expect(downloads).toEqual([])

			const reportPath = process.env.NL_M5_PACKAGED_REPORT
			if (reportPath) {
				await mkdir(dirname(reportPath), { recursive: true })
				await writeFile(
					reportPath,
					`${JSON.stringify(
						{
							platform: process.platform,
							arch: process.arch,
							about,
							packagedLicenses,
							metadataEndpoint: `/${metadataName}`,
							metadataRequests: requests.filter(
								(req) => req.pathname === `/${metadataName}`,
							).length,
							installerDownloadsAttempted: downloads.length,
							offlinePlaybackPixel: [32, 48, 96],
							manualPromptMessage,
							manualPromptUrl,
						},
						null,
						2,
					)}\n`,
				)
			}
			const dataDirStats = await stat(userDataDir)
			expect(dataDirStats.isDirectory()).toBe(true)
		} finally {
			await desktopApp?.close().catch(() => {})
			const closed = Promise.withResolvers<void>()
			server.close(() => closed.resolve())
			await closed.promise
			await cleanupInstalledArchives(userDataDir, actualDocumentsDir)
			await rm(directory, { recursive: true, force: true })
		}
	})
})
