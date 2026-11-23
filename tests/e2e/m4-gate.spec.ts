import { spawn } from 'node:child_process'
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
	type ElectronApplication,
	_electron as electron,
	expect,
	type Page,
	test,
} from '@playwright/test'
import { bibleRevision } from '../../packages/creator/src/bible/editing'
import type {
	CommandInput,
	CommandOutput,
	commands,
} from '../../packages/creator/src/contract'
import { Project } from '../../packages/creator/src/project'
import { readBible } from '../../packages/creator/src/synthesis/patch'
import { projectFiles } from '../../packages/format/src/model'
import { writeFormatBooks } from '../fixtures/cassettes/m4-gate/books'
import {
	configuration,
	directory,
	first,
	joined,
	other,
} from '../fixtures/cassettes/m4-gate/fixture'

const require = createRequire(
	new URL('../../apps/desktop/package.json', import.meta.url),
)
const evidence = '.workflow/evidence/m4-longform'
const capture = (page: Page, name: string) =>
	page.screenshot({
		path: `${evidence}/gate-${name}.png`,
		animations: 'disabled',
	})
const json = async (path: string) => JSON.parse(await readFile(path, 'utf8'))
async function call<K extends keyof typeof commands>(
	page: Page,
	command: K,
	input: CommandInput<K>,
): Promise<CommandOutput<K>> {
	return page.evaluate(
		({ command, input }) =>
			window.novelive.call(command, input as CommandInput<K>).promise,
		{ command, input },
	) as Promise<CommandOutput<K>>
}
async function pick(app: ElectronApplication, answers: string[]) {
	await app.evaluate(({ dialog, BrowserWindow }, paths) => {
		dialog.showOpenDialog = async () => ({
			canceled: false,
			filePaths: [paths.shift() ?? ''],
		})
		dialog.showMessageBox = async () => ({
			response: 1,
			checkboxChecked: false,
		})
		BrowserWindow.getAllWindows()[0].setContentSize(1280, 1000)
	}, answers)
}
async function importBook(
	app: ElectronApplication,
	page: Page,
	source: string,
	folder: string,
	joinExisting = false,
) {
	await pick(app, [source, folder])
	await page.evaluate(() => {
		location.hash = '/import'
	})
	await page.getByRole('button', { name: '选择原文', exact: true }).click()
	if (joinExisting) {
		await page.getByLabel('加入已有系列').check()
		await page.getByRole('button', { name: '选择已有工程' }).click()
	} else await page.getByRole('button', { name: '选择文件夹' }).click()
	await page.getByRole('button', { name: '导入', exact: true }).click()
}
async function launch(root: string, production = false) {
	const app = await electron.launch({
		executablePath: require('electron'),
		args: ['apps/desktop', `--user-data-dir=${join(root, 'profile')}`],
		env: {
			...process.env,
			ELECTRON_RENDERER_URL: '',
			NL_E2E: '1',
			NL_REPLAY: 'strict',
			NL_REPLAY_MISSING_LOG: join(root, 'missing.log'),
			...(production
				? {
						NL_PRODUCTION_CASSETTE_DIR: directory,
						NL_REPLAY_REBIND_IDS: '1',
						NL_REPLAY_DELAY_MS: '80',
					}
				: {}),
		},
	})
	const page = await app.firstWindow()
	await expect(page.getByRole('status')).toHaveText('创作端已就绪')
	return { app, page }
}

test.describe('M4 longform and queue', () => {
	test('W1 five formats, EPUB fallback, notes, manual illustrations and scanned PDF', async () => {
		test.setTimeout(90_000)
		const root = await mkdtemp(join(homedir(), '.m4-gate-formats-'))
		const projects = join(root, 'projects')
		await mkdir(projects)
		const books = await writeFormatBooks(root)
		const { app, page } = await launch(root)
		try {
			for (const book of books) {
				await importBook(app, page, book.path, projects)
				await expect(
					page.getByRole('heading', { name: '核对导入' }),
				).toBeVisible()
				const projectDir = join(projects, book.name)
				const report = await json(join(projectDir, 'source/import-report.json'))
				expect(report.structure.volumes).toHaveLength(1)
				expect(report.structure.volumes[0].chapters).toHaveLength(1)
				expect(
					report.structure.volumes[0].chapters[0].paragraphs.length,
				).toBeGreaterThan(0)
				const images = page
					.getByRole('group', { name: '插图参考（最多 3 张）' })
					.getByRole('checkbox')
				if (book.name === 'docx' || book.name.startsWith('epub')) {
					await expect(images).toHaveCount(2)
					await expect(images.first()).not.toBeChecked()
					expect(report.references).toEqual([])
					await images.first().check()
				}
				await capture(page, `w1-${book.name}`)
				await page.getByRole('button', { name: '确认', exact: true }).click()
				await expect(page).toHaveURL(/#\/work\//)
				using project = await Project.open(projectDir)
				const series = await project.read(projectFiles.series)
				const volume = await project.read(
					projectFiles.volume(series.volumeIds[0]),
				)
				const work = await project.read(
					projectFiles.work(volume.volumeId, volume.workIds[0]),
				)
				expect(work.chapterIds).toHaveLength(1)
				const text = (
					await project.readFile(projectFiles.chapterText(work.chapterIds[0]))
				).toString()
				expect(text).not.toMatch(/Translator note|www\.example/)
				expect(text).toContain('Last body sentence.')
				expect(
					(
						await project.readFile(
							projectFiles.chapterNotes(work.chapterIds[0]),
						)
					).toString(),
				).toContain('Translator note')
				expect(
					await readFile(
						join(
							projectDir,
							'source',
							`original.${book.name.startsWith('epub') ? 'epub' : book.name}`,
						),
					),
				).toEqual(await readFile(book.path))
				const saved = await json(join(projectDir, 'source/import-report.json'))
				expect(saved.selectedIllustrations).toHaveLength(
					book.name === 'docx' || book.name.startsWith('epub') ? 1 : 0,
				)
			}
			await importBook(app, page, join(root, 'scan.pdf'), projects)
			await expect(
				page.getByText(/扫描版 PDF 无可提取文字，暂不支持 OCR/),
			).toBeVisible()
			await capture(page, 'w1-scanned-pdf')
		} finally {
			await app.close()
			await rm(root, { recursive: true, force: true })
		}
	})

	test('W2–W3 continuous series, scheduling, crash recovery, waiting notifications and actual usage', async () => {
		test.setTimeout(180_000)
		const root = await mkdtemp(join(homedir(), '.m4-gate-production-'))
		const projects = join(root, 'projects')
		await mkdir(projects)
		for (const [name, text] of [
			['纸船.txt', first],
			['远行.md', joined],
			['山路.txt', other],
		])
			await writeFile(join(root, name), text)
		const { app, page } = await launch(root, true)
		try {
			await app.evaluate(({ app, Notification, ipcMain, powerSaveBlocker }) => {
				const state = {
					notices: [] as Electron.Notification[],
					waits: [] as unknown[],
					started: [] as number[],
					stopped: [] as number[],
				}
				Object.assign(app, { m4: state })
				Notification.isSupported = () => true
				Notification.prototype.show = function () {
					state.notices.push(this)
				}
				ipcMain.on('novelive:player-waiting', (_event, workId) =>
					state.waits.push(workId),
				)
				const start = powerSaveBlocker.start.bind(powerSaveBlocker)
				const stop = powerSaveBlocker.stop.bind(powerSaveBlocker)
				powerSaveBlocker.start = (type) => {
					const id = start(type)
					state.started.push(id)
					return id
				}
				powerSaveBlocker.stop = (id) => {
					state.stopped.push(id)
					return stop(id)
				}
			})
			await call(page, 'config.update', configuration)
			const projectA = join(projects, '纸船')
			await importBook(app, page, join(root, '纸船.txt'), projects)
			await page.getByRole('button', { name: '跳过核对' }).click()
			const a = (await json(join(projectA, 'volumes/v0001/volume.json')))
				.workIds[0] as string
			const snapshot = (workId: string) =>
				call(page, 'production.get', { workId })
			const queue = () => call(page, 'production.getQueue', {})
			const visual = async (workId: string) => {
				await page.evaluate((id) => {
					location.hash = `/work/${id}/confirm/visual`
				}, workId)
				await expect(
					page
						.getByRole('navigation', { name: '作品导航' })
						.getByRole('link', { name: '概览', exact: true }),
				).toHaveAttribute('href', `#/work/${workId}`)
				await expect(
					page
						.getByRole('group', { name: '主视觉', exact: true })
						.getByRole('radio'),
				).toHaveCount(3, { timeout: 30_000 })
			}
			const confirm = async (workId: string) => {
				await page
					.getByRole('group', { name: '主视觉', exact: true })
					.getByRole('radio')
					.first()
					.check()
				await page.getByRole('button', { name: '确认并制作第一章' }).click()
				await expect
					.poll(async () => (await snapshot(workId)).phase)
					.not.toBe('confirm-visual')
			}
			await visual(a)
			await confirm(a)
			await expect
				.poll(async () => (await snapshot(a)).phase, { timeout: 40_000 })
				.toBe('confirm-first')
			const protectedFiles = [
				'assets/style/main-visual.webp',
				'volumes/v0001/volume.json',
				`volumes/v0001/works/${a}/work.json`,
			]
			const bibleFiles = async (dir: string): Promise<string[]> =>
				(
					await Promise.all(
						(
							await readdir(dir, { withFileTypes: true })
						).map(async (entry) =>
							entry.isDirectory()
								? bibleFiles(join(dir, entry.name))
								: [join(dir, entry.name)],
						),
					)
				).flat()
			const saved = new Map<string, Buffer>()
			for (const path of [
				...protectedFiles.map((path) => join(projectA, path)),
				...(await bibleFiles(join(projectA, 'bible'))),
			])
				saved.set(path, await readFile(path))
			await importBook(app, page, join(root, '远行.md'), projectA, true)
			await expect(page.getByRole('region', { name: '新增卷' })).toContainText(
				'第二卷 远行',
			)
			for (const [path, bytes] of saved)
				expect(await readFile(path)).toEqual(bytes)
			const series = await json(join(projectA, 'series.json'))
			expect(series.volumeIds).toHaveLength(2)
			const v2 = series.volumeIds[1] as string
			const a2 = (await json(join(projectA, `volumes/${v2}/volume.json`)))
				.workIds[0] as string
			await page.getByRole('link', { name: '书库', exact: true }).click()
			await importBook(app, page, join(root, '山路.txt'), projects)
			await page.getByRole('button', { name: '跳过核对' }).click()
			const projectB = join(projects, '山路')
			const b = (await json(join(projectB, 'volumes/v0001/volume.json')))
				.workIds[0] as string
			await visual(b)
			expect(
				(await queue()).inactive
					.filter((work) => work.status === 'awaiting_confirm')
					.map((work) => work.link.workId)
					.sort(),
			).toEqual([a, b].sort())
			await confirm(b)
			expect((await snapshot(a2)).visual).toBeNull()
			expect((await snapshot(a2)).phase).not.toBe('confirm-visual')
			expect(await readFile(join(projectA, protectedFiles[0]))).toEqual(
				saved.get(join(projectA, protectedFiles[0])),
			)
			await call(page, 'production.continue', { workId: a })
			const ordered = await queue()
			expect(ordered.active?.link.workId).toBe(b)
			expect(ordered.queued.map((work) => work.link.workId)).toEqual([a, a2])
			await page.getByRole('button', { name: /全局制作状态/ }).click()
			await page
				.getByRole('list', { name: '排队中' })
				.getByRole('listitem')
				.last()
				.hover()
			await page.getByRole('button', { name: /提前/ }).last().click()
			expect((await queue()).queued.map((work) => work.link.workId)).toEqual([
				a2,
				a,
			])
			await capture(page, 'w2-reordered')
			const before = await page.evaluate(() => window.novelive.host.appState())
			await app.evaluate(({ app }) => {
				const child = app
					.getAppMetrics()
					.find((metric) => metric.name === 'Novelive Creator')
				if (!child) throw new Error('Creator missing')
				process.kill(child.pid, 'SIGKILL')
			})
			await expect
				.poll(
					async () =>
						(await page.evaluate(() => window.novelive.host.appState()))
							.generation,
				)
				.toBeGreaterThan(before.generation)
			await expect(page.getByText('创作端已就绪')).toBeAttached()
			await expect
				.poll(
					async () =>
						(await queue()).inactive.filter(
							(work) => work.status === 'paused' && work.reason === 'crashed',
						).length,
				)
				.toBe(3)
			await expect(page.getByText('异常退出后已暂停').first()).toBeVisible()
			const paused = await Promise.all([a, a2, b].map(snapshot))
			const frozen = await queue()
			await page.waitForTimeout(650)
			expect(await queue()).toEqual(frozen)
			expect(await Promise.all([a, a2, b].map(snapshot))).toEqual(paused)
			await capture(page, 'w2-crashed-paused')
			await page.getByRole('button', { name: '关闭制作队列' }).click()
			for (const id of [b, a2]) {
				await call(page, 'production.continue', { workId: id })
				await expect
					.poll(async () => (await snapshot(id)).phase, { timeout: 40_000 })
					.toBe('confirm-first')
				await call(page, 'production.continue', { workId: id })
				await expect
					.poll(async () => (await snapshot(id)).phase, { timeout: 40_000 })
					.toBe('done')
			}
			await page.evaluate((id) => {
				location.hash = `/work/${id}/play`
			}, a)
			await expect(page.locator('canvas')).toBeVisible()
			await expect(page.locator('.nl-text-display')).toHaveText(
				'一只纸船驶向灯火。',
			)
			expect(
				await readFile(join(projectA, 'source/original.txt'), 'utf8'),
			).toBe(first)
			for (let i = 0; i < 3; i++)
				await page.locator('canvas').click({ position: { x: 20, y: 20 } })
			await expect(page.locator('.nl-chapter-wait')).toContainText('下一章')
			await expect
				.poll(() =>
					app.evaluate(
						({ app }) =>
							(app as typeof app & { m4: { waits: unknown[] } }).m4.waits,
					),
				)
				.toContain(a)
			await capture(page, 'w3-real-player-waiting')
			await app.evaluate(({ BrowserWindow }) =>
				BrowserWindow.getAllWindows()[0].hide(),
			)
			await call(page, 'production.continue', { workId: a })
			await expect
				.poll(async () => (await snapshot(a)).phase, { timeout: 40_000 })
				.toBe('done')
			const noticeTitles = () =>
				app.evaluate(({ app }) =>
					(
						app as typeof app & { m4: { notices: Electron.Notification[] } }
					).m4.notices
						.filter((notice) => notice.body.startsWith('纸船'))
						.map((notice) => notice.title),
				)
			await expect.poll(noticeTitles).toContain('新章已就绪')
			await expect.poll(noticeTitles).toContain('制作完成')
			await page.evaluate(() => {
				location.hash = '/usage'
			})
			await expect(
				page.getByRole('heading', { name: '用量', exact: true }),
			).toBeVisible()
			await app.evaluate(({ app }) =>
				(
					app as typeof app & { m4: { notices: Electron.Notification[] } }
				).m4.notices
					.find((notice) => notice.title === '新章已就绪')
					?.emit('click'),
			)
			await expect(page).toHaveURL(new RegExp(`#/work/${a}/play$`))
			await expect
				.poll(() =>
					app.evaluate(({ BrowserWindow }) =>
						BrowserWindow.getAllWindows()[0].isVisible(),
					),
				)
				.toBe(true)
			for (const project of [projectA, projectB]) {
				using db = new DatabaseSync(join(project, 'project.db'), {
					readOnly: true,
				})
				expect(db.prepare('SELECT count(*) AS n FROM chapter').get()?.n).toBe(
					project === projectA ? 3 : 2,
				)
				expect(
					db
						.prepare('SELECT user_state FROM chapter')
						.all()
						.every((row) => row.user_state === 'published'),
				).toBe(true)
			}
			const usage = await call(page, 'usage.list', {})
			expect(
				usage.records.some(
					({ usage }) => usage.kind === 'text' && usage.inputTokens > 0,
				),
			).toBe(true)
			expect(
				usage.records.some(
					({ usage }) => usage.kind === 'image' && usage.imageCount > 0,
				),
			).toBe(true)
			await page.evaluate(() => {
				location.hash = '/usage'
			})
			await expect(
				page.getByRole('region', { name: '已发生用量' }),
			).toContainText('devin-swe-2')
			await expect(
				page.getByRole('region', { name: '已发生用量' }),
			).toContainText('fixture-art-image')
			await capture(page, 'w3-actual-usage')
			{
				using project = await Project.open(projectA)
				const bible = await readBible(project)
				project.database
					.prepare(
						'INSERT INTO proposal(proposal_id, work_id, kind, prompt, payload, created_at) VALUES (?, ?, ?, ?, ?, 0)',
					)
					.run(
						'河岸过期提醒',
						a,
						'bible',
						'河岸过期提醒',
						JSON.stringify({
							chapterIds: [],
							payload: {
								kind: 'bible',
								volumeId: 'v0001',
								expectedRevision: bibleRevision(bible),
								changes: [
									{
										kind: 'location',
										op: 'update',
										entry: { ...bible.location[0], description: '雨后的河岸' },
									},
								],
							},
						}),
					)
			}
			await page.evaluate((id) => {
				location.hash = `/work/${id}/bible?volume=v0001`
			}, a)
			await page
				.getByRole('article', { name: '河岸过期提醒', exact: true })
				.getByRole('button', { name: '接受候选' })
				.click()
			await expect(
				page.getByRole('status').filter({ hasText: '已接受候选' }),
			).toContainText('已标记过期')
			await page.evaluate(() => {
				location.hash = '/usage'
			})
			await expect(
				page.getByRole('region', { name: '过期素材' }),
			).toContainText('gate-room/day')
			await page
				.getByRole('region', { name: '过期素材' })
				.scrollIntoViewIfNeeded()
			await capture(page, 'w2-stale-image-reminder')
			await expect
				.poll(() =>
					app.evaluate(({ app, powerSaveBlocker }) => {
						const state = (
							app as typeof app & {
								m4: { started: number[]; stopped: number[] }
							}
						).m4
						return {
							started: state.started.length > 0,
							allStopped: state.started.every(
								(id) =>
									state.stopped.includes(id) && !powerSaveBlocker.isStarted(id),
							),
						}
					}),
				)
				.toEqual({ started: true, allStopped: true })
			expect(
				await readFile(join(root, 'missing.log'), 'utf8').catch(() => ''),
			).toBe('')
		} catch (error) {
			console.error(
				'M4 strict misses:',
				await readFile(join(root, 'missing.log'), 'utf8').catch(() => '(none)'),
			)
			console.error('M4 project retained:', root)
			throw error
		} finally {
			await app.close()
		}
	})

	test('W3 real host no-tray, tray reopen and same-profile second instance', async () => {
		const root = await mkdtemp(join(homedir(), '.m4-gate-host-'))
		await writeFile(join(root, 'gdbus'), '#!/bin/sh\necho "(<false>,)"\n', {
			mode: 0o755,
		})
		const profile = join(root, 'profile')
		const env = {
			...process.env,
			NL_E2E: '1',
			ELECTRON_RENDERER_URL: '',
			NL_REPLAY: 'strict',
			PATH: `${root}:${process.env.PATH}`,
		}
		const app = await electron.launch({
			executablePath: require('electron'),
			args: ['apps/desktop', `--user-data-dir=${profile}`],
			env,
		})
		try {
			const page = await app.firstWindow()
			await expect(page.getByRole('status')).toHaveText('创作端已就绪')
			const before = await page.evaluate(() => window.novelive.host.appState())
			await app.evaluate(({ app, BrowserWindow, Tray }) => {
				const state = app as typeof app & {
					m4Host: { minimize: number; tray?: Electron.Tray }
				}
				state.m4Host = { minimize: 0 }
				const minimize = BrowserWindow.prototype.minimize
				BrowserWindow.prototype.minimize = function () {
					state.m4Host.minimize++
					minimize.call(this)
				}
				const isDestroyed = Tray.prototype.isDestroyed
				Tray.prototype.isDestroyed = function () {
					state.m4Host.tray = this
					return isDestroyed.call(this)
				}
			})
			await app.evaluate(({ BrowserWindow }) =>
				BrowserWindow.getAllWindows()[0].close(),
			)
			await expect
				.poll(() =>
					app.evaluate(
						({ app }) =>
							(app as typeof app & { m4Host: { minimize: number } }).m4Host
								.minimize,
					),
				)
				.toBe(1)
			expect(
				await app.evaluate(({ BrowserWindow }) =>
					BrowserWindow.getAllWindows()[0].isVisible(),
				),
			).toBe(true)
			expect(await call(page, 'debug.sqliteSmoke', {})).toMatchObject({
				ok: true,
			})
			await writeFile(join(root, 'gdbus'), '#!/bin/sh\necho "(<true>,)"\n', {
				mode: 0o755,
			})
			await app.evaluate(({ BrowserWindow }) =>
				BrowserWindow.getAllWindows()[0].close(),
			)
			await expect
				.poll(() =>
					app.evaluate(({ BrowserWindow }) =>
						BrowserWindow.getAllWindows()[0].isVisible(),
					),
				)
				.toBe(false)
			await app.evaluate(({ app }) =>
				(
					app as typeof app & { m4Host: { tray: Electron.Tray } }
				).m4Host.tray.emit('click'),
			)
			await expect
				.poll(() =>
					app.evaluate(({ BrowserWindow }) =>
						BrowserWindow.getAllWindows()[0].isVisible(),
					),
				)
				.toBe(true)
			await app.evaluate(({ BrowserWindow }) =>
				BrowserWindow.getAllWindows()[0].hide(),
			)
			const duplicate = spawn(
				require('electron'),
				['apps/desktop', `--user-data-dir=${profile}`],
				{ env, stdio: 'ignore' },
			)
			try {
				await expect.poll(() => duplicate.exitCode).toBe(0)
			} finally {
				if (duplicate.exitCode === null) duplicate.kill()
			}
			await expect
				.poll(() =>
					app.evaluate(({ BrowserWindow }) => {
						const window = BrowserWindow.getAllWindows()[0]
						return window.isVisible() && window.isFocused()
					}),
				)
				.toBe(true)
			expect(
				(await page.evaluate(() => window.novelive.host.appState())).generation,
			).toBe(before.generation)
			await capture(page, 'w3-host-reopened')
		} finally {
			await app.close()
			await rm(root, { recursive: true, force: true })
		}
	})
})
