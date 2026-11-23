import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import sharp from 'sharp'
import { Project } from '../../packages/creator/src/project'
import { projectFiles } from '../../packages/format/src/model'
import {
	defaultPlayerSettings,
	dwellMilliseconds,
	schedulePlayback,
} from '../../packages/ui/src/pages/player/controls/controller'
import {
	type ControlsProgress,
	recordReachedSentence,
} from '../../packages/ui/src/pages/player/controls/minimal-controller'
import {
	playerRef,
	playerScript,
	playerWorkId,
	seedPlayerProject,
} from '../fixtures/minimal-player'

const require = createRequire(
	new URL('../../apps/desktop/package.json', import.meta.url),
)

test.describe('M3 player controls', () => {
	test('controller uses contract dwell and never skips unread or a wait', async () => {
		expect(dwellMilliseconds(10, 2)).toBe(4000)
		const progress: ControlsProgress = {
			read: new Set(),
			readChapters: new Set(),
			chapterIds: ['ch1', 'ch2', 'ch3'],
			mainline: null,
		}
		const ahead = { chapterId: 'ch3', sceneId: 'scene', sentenceId: 'line' }
		recordReachedSentence(progress, ahead, 'main', 2)
		recordReachedSentence(progress, { ...ahead, chapterId: 'ch2' }, 'main', 3)
		recordReachedSentence(progress, { ...ahead, chapterId: 'ch1' }, 'reread', 0)
		expect(progress.mainline).toEqual(ahead)
		let advances = 0
		let frame = {
			position: null,
			characters: 10,
			read: false,
			ready: true,
			ended: false,
		}
		const controller = {
			mode: 'main' as const,
			frame: () => frame,
			subscribe: () => () => {},
			advance: () => {
				advances++
			},
			applySettings: () => {},
		}
		schedulePlayback(
			controller,
			{ ...defaultPlayerSettings, skipRead: true },
			false,
			false,
		)()
		expect(advances).toBe(0)
		frame = { ...frame, read: true }
		const cancel = schedulePlayback(
			controller,
			{ ...defaultPlayerSettings, skipRead: true },
			false,
			false,
		)
		await expect.poll(() => advances).toBe(1)
		cancel()
		frame = { ...frame, ready: false }
		schedulePlayback(controller, defaultPlayerSettings, true, false)()
		expect(advances).toBe(1)
		frame = { ...frame, read: false, ready: true, characters: 0 }
		const cancelUnread = schedulePlayback(
			controller,
			{
				...defaultPlayerSettings,
				skipRead: true,
				autoPlaySpeedMultiplier: 0.25,
			},
			true,
			false,
		)
		await new Promise((resolve) => setTimeout(resolve, 350))
		expect(advances).toBe(1)
		cancelUnread()
		const cancelAuto = schedulePlayback(
			controller,
			{ ...defaultPlayerSettings, autoPlaySpeedMultiplier: 0.25 },
			true,
			false,
		)
		await expect.poll(() => advances).toBe(2)
		cancelAuto()
		expect(dwellMilliseconds(0, 1)).toBe(1200)
		schedulePlayback(controller, defaultPlayerSettings, true, true)()
		expect(advances).toBe(2)
	})

	for (const scenario of ['settings and reread', 'chapter wait'] as const) {
		test(`${scenario} in the real Electron player`, async () => {
			const directory = await mkdtemp(join(tmpdir(), 'novelive-m3-controls-'))
			const root = join(directory, 'project')
			const png = await sharp({
				create: { width: 32, height: 128, channels: 3, background: '#203060' },
			})
				.png()
				.toBuffer()
			await seedPlayerProject(root, png, png)
			if (scenario === 'chapter wait') {
				using project = await Project.open(root)
				await project.writeFile(
					projectFiles.scene(playerRef, 'aaaabbbb'),
					playerScript.replace('source p0001', 'source p0001\n@wait 0.01'),
				)
			}
			{
				using project = await Project.open(root)
				const file = projectFiles.work('v1', playerWorkId)
				await project.write(file, {
					...(await project.read(file)),
					chapterIds: ['ch1', 'ch2'],
				})
				await project.write(
					projectFiles.chapter({ ...playerRef, chapterId: 'ch2' }),
					{
						...(await project.read(projectFiles.chapter(playerRef))),
						chapterId: 'ch2',
						title: '晨光',
					},
				)
				await project.writeFile(
					projectFiles.scene({ ...playerRef, chapterId: 'ch2' }, 'aaaabbbb'),
					playerScript.replace('你好，世界。', '第二章开始。'),
				)
				project.database
					.prepare(
						'INSERT INTO work (work_id, title, queue_pos, created_at) VALUES (?, ?, 0, 0)',
					)
					.run(playerWorkId, '测试')
				project.database
					.prepare(
						"INSERT INTO chapter (work_id, chapter_id, ord, user_state) VALUES (?, 'ch1', 1, 'published'), (?, 'ch2', 2, 'producing')",
					)
					.run(playerWorkId, playerWorkId)
			}
			const app = await electron.launch({
				executablePath: require('electron'),
				args: ['apps/desktop', `--user-data-dir=${join(directory, 'profile')}`],
				env: { ...process.env, ELECTRON_RENDERER_URL: '', NL_REPLAY: 'strict' },
			})
			try {
				const page = await app.firstWindow()
				await expect(page.getByRole('status')).toHaveText('创作端已就绪')
				await app.evaluate(({ dialog }, path) => {
					dialog.showOpenDialog = async () => ({
						canceled: false,
						filePaths: [path],
					})
				}, root)
				await page.evaluate((id) => {
					window.location.hash = `/work/${id}/play`
				}, playerWorkId)
				await page.getByRole('button', { name: '打开本地工程' }).click()
				const canvas = page.locator('.nl-player canvas')
				const text = page.locator('.nl-player-text')
				await expect(text).toHaveText('你好，世界。')
				const advance = () => canvas.click({ position: { x: 20, y: 20 } })
				async function range(label: string, value: number) {
					const input = page.getByRole('slider', { name: label, exact: true })
					const min = Number(await input.getAttribute('min'))
					const step = Number(await input.getAttribute('step'))
					await input.press('Home')
					for (let index = 0; index < Math.round((value - min) / step); index++)
						await input.press('ArrowRight')
				}
				if (scenario === 'settings and reread') {
					await page.keyboard.press('Escape')
					await expect(
						page.getByRole('dialog', { name: '系统菜单' }),
					).toBeVisible()
					await page.getByLabel('自动播放', { exact: true }).check()
					await expect(
						page.getByLabel('自动播放', { exact: true }),
					).toBeChecked()
					await page.getByLabel('自动播放', { exact: true }).uncheck()
					await page.keyboard.press('Escape')
					await expect(page.getByRole('dialog')).toHaveCount(0)
					await canvas.click({ button: 'right', position: { x: 20, y: 20 } })
					await page.getByRole('button', { name: '设置', exact: true }).click()
					await range('字号', 36)
					await range('对话框不透明度', 0.5)
					await page
						.getByRole('slider', { name: '文字速度（毫秒 / 字）', exact: true })
						.press('End')
					await page.getByLabel('瞬间显示').check()
					await range('自动播放倍率', 2)
					await page.getByLabel('对话框样式').selectOption('paper')
					await expect(page.locator('.nl-player-textbox')).toHaveCSS(
						'font-size',
						'36px',
					)
					await expect(page.locator('.nl-player-surface')).toHaveAttribute(
						'data-dialogue-style',
						'paper',
					)
					await expect(page.locator('.nl-player-surface')).toHaveCSS(
						'--player-dialogue-opacity',
						'0.5',
					)
					await expect(page.locator('.nl-player-surface')).toHaveCSS(
						'--player-text-delay',
						'0ms',
					)
					await page.getByLabel('全屏', { exact: true }).click()
					await expect
						.poll(() => page.evaluate(() => !!document.fullscreenElement))
						.toBe(true)
					await expect(page.getByLabel('全屏', { exact: true })).toBeChecked()
					await page.getByLabel('全屏', { exact: true }).click()
					await expect
						.poll(() => page.evaluate(() => !!document.fullscreenElement))
						.toBe(false)
					await page.getByRole('button', { name: '返回菜单' }).click()
					await page.getByRole('button', { name: '隐藏界面' }).click()
					await expect(page.locator('.nl-player-overlay')).toBeHidden()
					await advance()
					await expect(text).toHaveText('你好，世界。')
					await page.keyboard.press('Escape')
					await page.getByRole('button', { name: '隐藏界面' }).click()
					await page.keyboard.press('a')
					await expect(page.locator('.nl-player-overlay')).toBeVisible()
					await advance()
					await expect(text).toHaveText('我在想什么？')
					const mainline = await page
						.getByRole('main')
						.getAttribute('data-mainline')
					await page.keyboard.press('Escape')
					await page.getByRole('button', { name: '章节', exact: true }).click()
					await expect(
						page.getByRole('button', { name: /晨光/ }),
					).toBeDisabled()
					await page.getByRole('button', { name: /空屋/ }).click()
					await expect(text).toHaveText('你好，世界。')
					await expect(page.getByRole('main')).toHaveAttribute(
						'data-mode',
						'reread',
					)
					await expect(page.getByRole('main')).toHaveAttribute(
						'data-mainline',
						mainline ?? '',
					)
					await page.keyboard.press('Escape')
					await page.getByLabel('跳过已读').check()
					await page.keyboard.press('Escape')
					await expect(text).toHaveText('风从窗边吹过。')
					await page.keyboard.press('Escape')
					await expect(page.getByLabel('跳过已读')).toBeChecked()
					await mkdir('.workflow/evidence/m3-playback', { recursive: true })
					await page.screenshot({
						path: '.workflow/evidence/m3-playback/05-controls-menu.png',
					})
					await page
						.locator('.nl-controls-backdrop')
						.click({ position: { x: 5, y: 5 } })
					await expect(page.getByRole('dialog')).toHaveCount(0)
					await page.keyboard.press('Escape')
					await page.getByRole('button', { name: '在编辑器中打开这里' }).click()
					await expect(page).toHaveURL(
						/\/edit\?chapterId=ch1&sceneId=.+&lineId=.+/,
					)
				} else {
					await page.evaluate(() => {
						window.addEventListener('novelive:player-waiting', (event) => {
							document.body.dataset.playerWaiting = JSON.stringify(
								(event as CustomEvent<string | null>).detail,
							)
						})
					})
					for (let index = 0; index < 6; index++) await advance()
					await expect(page.getByRole('status')).toContainText('下一章 · 晨光')
					await expect(page.getByRole('status')).toContainText('制作中')
					await expect(page.locator('body')).toHaveAttribute(
						'data-player-waiting',
						JSON.stringify(playerWorkId),
					)
					await page.evaluate(() => {
						window.location.hash = '/'
					})
					await expect(page.locator('body')).toHaveAttribute(
						'data-player-waiting',
						'null',
					)
					await page.evaluate((id) => {
						window.location.hash = `/work/${id}/play`
					}, playerWorkId)
					await page.getByRole('button', { name: '打开本地工程' }).click()
					await expect(text).toHaveText('你好，世界。')
					for (let index = 0; index < 6; index++) await advance()
					await expect(page.locator('body')).toHaveAttribute(
						'data-player-waiting',
						JSON.stringify(playerWorkId),
					)
					await app.evaluate(({ BrowserWindow }) => {
						BrowserWindow.getAllWindows()[0].hide()
					})
					{
						using project = await Project.open(root)
						project.database
							.prepare(
								"UPDATE chapter SET user_state = 'published' WHERE chapter_id = 'ch2'",
							)
							.run()
					}
					await expect(text).toHaveText('第二章开始。', { timeout: 15000 })
					await expect(page.locator('body')).toHaveAttribute(
						'data-player-waiting',
						'null',
					)
					await app.evaluate(({ BrowserWindow }) =>
						BrowserWindow.getAllWindows()[0].show(),
					)
					await expect(
						page.getByRole('button', { name: '下一章已就绪，点击开始' }),
					).toBeVisible()
					await page
						.getByRole('button', { name: '下一章已就绪，点击开始' })
						.click()
					await expect(text).toHaveText('第二章开始。')
					await advance()
					await expect(text).toHaveText('我在想什么？')
				}
			} finally {
				await app.close()
				await rm(directory, { recursive: true, force: true })
			}
		})
	}
})
