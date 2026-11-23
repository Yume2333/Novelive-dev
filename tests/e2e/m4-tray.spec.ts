import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import ts from 'typescript'

const require = createRequire(
	new URL('../../apps/desktop/package.json', import.meta.url),
)

test('M4 desktop lifecycle keeps the real creator alive without a tray and reopens on activation', async () => {
	const profile = mkdtempSync(join(tmpdir(), 'novelive-tray-'))
	writeFileSync(join(profile, 'gdbus'), '#!/bin/sh\necho "(<false>,)"\n', {
		mode: 0o755,
	})
	const desktop = await electron.launch({
		executablePath: require('electron'),
		args: ['apps/desktop', `--user-data-dir=${profile}`],
		env: {
			...process.env,
			PATH: `${profile}:${process.env.PATH}`,
			NL_E2E: '1',
			NL_REPLAY: 'strict',
		},
	})
	try {
		const page = await desktop.firstWindow()
		await expect(page.getByRole('status')).toHaveText('创作端已就绪')
		const before = await page.evaluate(() => window.novelive.host.appState())
		await desktop.evaluate(({ BrowserWindow }) => {
			BrowserWindow.getAllWindows()[0].close()
		})
		expect(
			await desktop.evaluate(
				({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
			),
		).toBe(1)
		expect(
			await page.evaluate(
				() => window.novelive.call('debug.sqliteSmoke', {}).promise,
			),
		).toMatchObject({ ok: true })
		expect(
			(await page.evaluate(() => window.novelive.host.appState())).generation,
		).toBe(before.generation)
		await desktop.evaluate(({ app }) => app.emit('activate'))
		await expect(
			page.getByRole('heading', { name: '书库', exact: true }),
		).toBeVisible()
		writeFileSync(join(profile, 'gdbus'), '#!/bin/sh\necho "(<true>,)"\n', {
			mode: 0o755,
		})
		await desktop.evaluate(({ BrowserWindow }) => {
			BrowserWindow.getAllWindows()[0].close()
		})
		await expect
			.poll(() =>
				desktop.evaluate(({ BrowserWindow }) =>
					BrowserWindow.getAllWindows()[0].isVisible(),
				),
			)
			.toBe(false)
		await desktop.evaluate(({ app }) => app.emit('activate'))
		expect(
			await desktop.evaluate(({ BrowserWindow }) =>
				BrowserWindow.getAllWindows()[0].isVisible(),
			),
		).toBe(true)
	} finally {
		await desktop.close()
		rmSync(profile, { recursive: true, force: true })
	}
})

test('M4 desktop lifecycle confirms active quit, cancels safely and cleans up only on acceptance', async () => {
	const source = ts.transpileModule(
		readFileSync('apps/desktop/src/main/tray/index.ts', 'utf8'),
		{
			compilerOptions: {
				module: ts.ModuleKind.CommonJS,
				target: ts.ScriptTarget.ES2022,
			},
		},
	).outputText
	const profile = mkdtempSync(join(tmpdir(), 'novelive-quit-'))
	const desktop = await electron.launch({
		executablePath: require('electron'),
		args: ['apps/desktop', `--user-data-dir=${profile}`],
		env: { ...process.env, NL_REPLAY: 'strict' },
	})
	try {
		await desktop.firstWindow()
		const result = await desktop.evaluate(
			async ({ app, dialog, Menu }, code) => {
				app.removeAllListeners('before-quit')
				const defaultMenu = Menu.getApplicationMenu()
				const exported: {
					installLifecycle?: (options: {
						window(): undefined
						active(): boolean
						cleanup(): void
					}) => unknown
				} = {}
				const load = process
					.getBuiltinModule('module')
					.createRequire(`${process.cwd()}/package.json`)
				new Function('require', 'exports', code)(load, exported)
				let cleaned = 0
				let prompts = 0
				let response = 0
				let quits = 0
				dialog.showMessageBox = async () => {
					prompts += 1
					return { response, checkboxChecked: false }
				}
				const realQuit = app.quit
				app.quit = () => {
					quits += 1
				}
				exported.installLifecycle?.({
					window: () => undefined,
					active: () => true,
					cleanup: () => {
						cleaned += 1
					},
				})
				const menuPreserved = Menu.getApplicationMenu() === defaultMenu
				const requestQuit = () =>
					app.emit('before-quit', { preventDefault() {} } as Electron.Event)
				requestQuit()
				await new Promise((resolve) => setImmediate(resolve))
				const cancelled = { cleaned, prompts, quits }
				response = 1
				requestQuit()
				await new Promise((resolve) => setImmediate(resolve))
				app.quit = realQuit
				return {
					menuPreserved,
					cancelled,
					accepted: { cleaned, prompts, quits },
				}
			},
			source,
		)
		expect(result).toEqual({
			menuPreserved: true,
			cancelled: { cleaned: 0, prompts: 1, quits: 0 },
			accepted: { cleaned: 1, prompts: 2, quits: 1 },
		})
	} finally {
		await desktop.evaluate(({ BrowserWindow }) => {
			for (const window of BrowserWindow.getAllWindows())
				window.removeAllListeners('close')
		})
		await desktop.close()
		rmSync(profile, { recursive: true, force: true })
	}
})

test('M4 desktop lifecycle validates notifications, strips tags, limits text and locates all four destinations', async () => {
	const profile = mkdtempSync(join(tmpdir(), 'novelive-notify-'))
	const desktop = await electron.launch({
		executablePath: require('electron'),
		args: ['apps/desktop', `--user-data-dir=${profile}`],
		env: { ...process.env, NL_REPLAY: 'strict' },
	})
	try {
		const page = await desktop.firstWindow()
		await page.waitForLoadState('domcontentloaded')
		const result = await desktop.evaluate(
			async ({ BrowserWindow, ipcMain, Notification }) => {
				const notices: Electron.Notification[] = []
				Notification.isSupported = () => true
				Notification.prototype.show = function () {
					notices.push(this)
				}
				const window = BrowserWindow.getAllWindows()[0]
				const locations: string[] = []
				const send = window.webContents.send.bind(window.webContents)
				window.webContents.send = (channel, ...args) => {
					if (channel === 'novelive:locate') locations.push(args[0])
					send(channel, ...args)
				}
				const event = { sender: window.webContents }
				const snapshot = {
					workId: '11111111-1111-4111-8111-111111111111',
					title: `<b>${'书'.repeat(990)}</b>`,
					phase: 'confirm-visual',
					status: 'confirm',
					chapters: [
						{ chapterId: 'chapter', priority: false, status: 'waiting' },
					],
					visual: null,
				}
				const publish = () =>
					ipcMain.emit('novelive:production-event', event, {
						type: 'production.snapshot',
						payload: structuredClone(snapshot),
					})
				ipcMain.emit('novelive:production-event', event, null)
				ipcMain.emit('novelive:production-event', event, {
					type: 'production.snapshot',
					payload: { ...snapshot, title: 'x'.repeat(1001) },
				})
				ipcMain.emit('novelive:player-waiting', event, 42)
				ipcMain.emit(
					'novelive:production-event',
					{ sender: null },
					{ type: 'production.snapshot', payload: snapshot },
				)
				publish()
				publish()
				snapshot.phase = 'confirm-first'
				publish()
				snapshot.phase = 'producing'
				snapshot.status = 'producing'
				Object.assign(snapshot, { blockedChapterId: 'chapter' })
				publish()
				ipcMain.emit('novelive:player-waiting', event, snapshot.workId)
				window.hide()
				snapshot.chapters[0].status = 'published'
				publish()
				snapshot.phase = 'done'
				publish()
				const text = notices.map((notice) => ({
					title: notice.title,
					body: notice.body,
				}))
				for (const notice of notices) notice.emit('click')
				return { text, locations, visible: window.isVisible() }
			},
		)
		expect(result.text.map((item) => item.title)).toEqual([
			'等待确认',
			'等待确认',
			'需要处理',
			'新章已就绪',
			'制作完成',
		])
		for (const notice of result.text) {
			expect(notice.body).not.toContain('<')
			expect(notice.body.length).toBeLessThanOrEqual(1000)
		}
		expect(result.locations).toEqual([
			'/work/11111111-1111-4111-8111-111111111111/confirm/visual',
			'/work/11111111-1111-4111-8111-111111111111/confirm/first',
			'/work/11111111-1111-4111-8111-111111111111/production',
			'/work/11111111-1111-4111-8111-111111111111/play',
			'/work/11111111-1111-4111-8111-111111111111',
		])
		expect(result.visible).toBe(true)
		await expect
			.poll(() => page.evaluate(() => location.hash))
			.toBe('#/work/11111111-1111-4111-8111-111111111111')
	} finally {
		await desktop.close()
		rmSync(profile, { recursive: true, force: true })
	}
})

const nativeMode = process.env.NL_M4_NATIVE_HOST

function trayProperty(property: string) {
	return execFileSync(
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
			property,
		],
		{ encoding: 'utf8' },
	)
}

function desktopScreenshot(name: string) {
	const directory = process.env.NL_M4_NATIVE_EVIDENCE
	if (directory)
		execFileSync('import', ['-window', 'root', join(directory, `${name}.png`)])
}

test('M4 native desktop lifecycle minimizes without a tray or reopens through the real tray', async () => {
	test.skip(!nativeMode, 'Requires an isolated Linux desktop and session bus')
	const profile = mkdtempSync(join(tmpdir(), 'novelive-native-tray-'))
	const desktop = await electron.launch({
		executablePath: require('electron'),
		args: ['apps/desktop', `--user-data-dir=${profile}`],
		env: { ...process.env, NL_E2E: '1', NL_REPLAY: 'strict' },
	})
	try {
		const page = await desktop.firstWindow()
		await expect(page.getByRole('status')).toHaveText('创作端已就绪')
		const before = await page.evaluate(() => window.novelive.host.appState())
		await desktop.evaluate(({ BrowserWindow }) =>
			BrowserWindow.getAllWindows()[0].close(),
		)
		if (nativeMode === 'no-tray') {
			const names = execFileSync(
				'gdbus',
				[
					'call',
					'--session',
					'--dest',
					'org.freedesktop.DBus',
					'--object-path',
					'/org/freedesktop/DBus',
					'--method',
					'org.freedesktop.DBus.ListNames',
				],
				{ encoding: 'utf8' },
			)
			expect(names).not.toContain('org.kde.StatusNotifierWatcher')
			await expect
				.poll(() =>
					desktop.evaluate(({ BrowserWindow }) =>
						BrowserWindow.getAllWindows()[0].isMinimized(),
					),
				)
				.toBe(true)
			desktopScreenshot('08-native-no-tray')
		} else {
			expect(trayProperty('IsStatusNotifierHostRegistered')).toContain('true')
			await expect
				.poll(() =>
					desktop.evaluate(({ BrowserWindow }) =>
						BrowserWindow.getAllWindows()[0].isVisible(),
					),
				)
				.toBe(false)
			const itemPattern = /'([^/']+)(\/[^']+)?'/
			await expect
				.poll(() => trayProperty('RegisteredStatusNotifierItems'))
				.toMatch(itemPattern)
			const item = itemPattern.exec(
				trayProperty('RegisteredStatusNotifierItems'),
			)
			if (!item) throw new Error('Electron did not register a tray item')
			desktopScreenshot('08-native-tray')
			execFileSync('gdbus', [
				'call',
				'--session',
				'--dest',
				item[1],
				'--object-path',
				item[2] ?? '/StatusNotifierItem',
				'--method',
				'org.kde.StatusNotifierItem.Activate',
				'0',
				'0',
			])
			await expect
				.poll(() =>
					desktop.evaluate(({ BrowserWindow }) =>
						BrowserWindow.getAllWindows()[0].isVisible(),
					),
				)
				.toBe(true)
		}
		expect(
			(await page.evaluate(() => window.novelive.host.appState())).generation,
		).toBe(before.generation)
	} finally {
		await desktop.close()
		rmSync(profile, { recursive: true, force: true })
	}
})

test('M4 native desktop lifecycle delivers and activates new-chapter and completion notifications', async () => {
	test.skip(nativeMode !== 'tray', 'Requires Dunst on an isolated desktop bus')
	const profile = mkdtempSync(join(tmpdir(), 'novelive-native-notify-'))
	const desktop = await electron.launch({
		executablePath: require('electron'),
		args: ['apps/desktop', `--user-data-dir=${profile}`],
		env: { ...process.env, NL_REPLAY: 'strict' },
	})
	const workId = '11111111-1111-4111-8111-111111111111'
	try {
		const page = await desktop.firstWindow()
		await page.getByRole('heading', { name: '书库', exact: true }).waitFor()
		for (const phase of ['producing', 'done'] as const) {
			execFileSync('dunstctl', ['close-all'])
			await desktop.evaluate(
				({ BrowserWindow, ipcMain, Notification }, { phase, workId }) => {
					if (!Notification.isSupported())
						throw new Error('Native notifications are not available')
					const window = BrowserWindow.getAllWindows()[0]
					const event = { sender: window.webContents }
					const publish = (status: 'waiting' | 'published') =>
						ipcMain.emit('novelive:production-event', event, {
							type: 'production.snapshot',
							payload: {
								workId,
								title: '<b>纸船</b>',
								phase: status === 'waiting' ? 'producing' : phase,
								status:
									status === 'waiting' || phase === 'producing'
										? 'producing'
										: 'idle',
								chapters: [{ chapterId: 'chapter', priority: false, status }],
								chapterTitles: { chapter: '灯火' },
								visual: null,
							},
						})
					publish('waiting')
					if (phase === 'producing')
						ipcMain.emit('novelive:player-waiting', event, workId)
					window.hide()
					publish('published')
				},
				{ phase, workId },
			)
			try {
				await expect
					.poll(
						() =>
							spawnSync(
								'xdotool',
								['search', '--onlyvisible', '--class', 'Dunst'],
								{
									encoding: 'utf8',
								},
							).status,
						{ timeout: 3000 },
					)
					.toBe(0)
			} finally {
				desktopScreenshot(
					phase === 'producing'
						? '08-native-new-chapter'
						: '08-native-completion',
				)
			}
			execFileSync('dunstctl', ['action'])
			await expect
				.poll(() => page.evaluate(() => location.hash))
				.toBe(`#/work/${workId}${phase === 'producing' ? '/play' : ''}`)
			expect(
				await desktop.evaluate(({ BrowserWindow }) =>
					BrowserWindow.getAllWindows()[0].isVisible(),
				),
			).toBe(true)
		}
	} finally {
		await desktop.close()
		rmSync(profile, { recursive: true, force: true })
	}
})
