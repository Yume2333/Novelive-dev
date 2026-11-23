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
