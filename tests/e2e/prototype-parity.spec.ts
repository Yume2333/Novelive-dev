import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ClientFrame, CommandOutput } from '@novelive/creator/contract'
import { _electron as electron, expect, test } from '@playwright/test'
import sharp from 'sharp'
import { Project } from '../../packages/creator/src/project'
import {
	defaultWorkSettings,
	formatVersion,
	projectFiles,
} from '../../packages/format/src/model'
import {
	candidateColors,
	installProjection,
	workId,
} from '../fixtures/creation-ui/projection'
import { playerWorkId, seedPlayerProject } from '../fixtures/minimal-player'

const require = createRequire(
	new URL('../../apps/desktop/package.json', import.meta.url),
)

test('prototype welcome saves the shared model form with reachable completion', async () => {
	const profile = await mkdtemp(join(tmpdir(), 'novelive-welcome-scroll-'))
	try {
		const app = await electron.launch({
			executablePath: require('electron'),
			args: ['apps/desktop', `--user-data-dir=${profile}`],
			env: { ...process.env, NL_REPLAY: 'strict', ELECTRON_RENDERER_URL: '' },
		})
		try {
			await app.evaluate(({ BrowserWindow }) => {
				BrowserWindow.getAllWindows()[0]?.setContentSize(1000, 700)
			})
			const page = await app.firstWindow()
			await expect(
				page.getByText('创作端已就绪', { exact: true }),
			).toBeAttached()
			await page.evaluate(async () => {
				await window.novelive.call('config.update', {
					models: {
						main: {
							inheritFast: false,
							format: 'anthropic-messages',
							baseUrl: 'https://independent.invalid',
							model: 'independent-main',
							apiKey: 'offline-fixture-key',
						},
					},
				}).promise
				location.hash = '/welcome'
			})
			await page.getByRole('button', { name: '继续', exact: true }).click()
			await page.getByRole('button', { name: '继续', exact: true }).click()
			await page.getByLabel('快速模型', { exact: true }).fill('offline-model')
			await page
				.getByLabel('接口地址', { exact: true })
				.fill('https://shared.invalid')
			const finish = page.getByRole('button', { name: '完成，进入书库' })
			await finish.scrollIntoViewIfNeeded()
			await expect(finish).toBeInViewport()
			await finish.click()
			await expect(
				page.getByRole('heading', { name: '书库', exact: true }),
			).toBeVisible()
			expect(
				await page.evaluate(async () => {
					const config = await window.novelive.call('config.get', {}).promise
					return 'models' in config ? config.models.fast.model : undefined
				}),
			).toBe('offline-model')
			expect(
				await page.evaluate(async () => {
					const config = await window.novelive.call('config.get', {}).promise
					return 'models' in config ? config.models.main : undefined
				}),
			).toMatchObject({
				inheritFast: false,
				format: 'anthropic-messages',
				baseUrl: 'https://independent.invalid',
				model: 'independent-main',
				apiKeyMasked: '••••',
			})
		} finally {
			await app.close()
		}
	} finally {
		await rm(profile, { recursive: true, force: true })
	}
})

test('prototype sidebar resolves a replaced recent package to its installed version', async () => {
	const profile = await mkdtemp(join(tmpdir(), 'novelive-package-recent-'))
	const workId = '3d6404ce-00cb-4de7-88a9-eb4aac4e31cf'
	try {
		await mkdir(join(profile, 'installed-works'))
		await writeFile(
			join(profile, 'installed-works/library.json'),
			JSON.stringify([
				{
					workId,
					version: 2,
					title: '升级后的作品',
					installation: join(profile, 'installed-works/v2'),
					chapters: 1,
					published: 1,
				},
			]),
		)
		const app = await electron.launch({
			executablePath: require('electron'),
			args: ['apps/desktop', `--user-data-dir=${profile}`],
			env: { ...process.env, NL_REPLAY: 'strict', ELECTRON_RENDERER_URL: '' },
		})
		try {
			const page = await app.firstWindow()
			await page.evaluate((id) => {
				localStorage.setItem('novelive.recentWork', `package:${id}:1`)
			}, workId)
			await page.reload()
			await expect(
				page
					.getByRole('navigation', { name: '作品导航' })
					.getByRole('link', { name: '游玩' }),
			).toHaveAttribute('href', `#/package/${workId}/2`)
			await expect(
				page.locator('aside').getByText('升级后的作品', { exact: true }),
			).toBeVisible()
		} finally {
			await app.close()
		}
	} finally {
		await rm(profile, { recursive: true, force: true })
	}
})

test('prototype sidebar switches from a project to an installed work', async () => {
	const root = await mkdtemp(join(tmpdir(), 'novelive-package-switch-'))
	const directory = join(root, 'project')
	const profile = join(root, 'profile')
	const projectWorkId = '00000000-0000-0000-0000-000000000114'
	const packageWorkId = '6f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b'
	try {
		using project = await Project.create(directory, {
			formatVersion,
			seriesId: 'switch',
			title: '切换验收',
			volumeIds: ['v1'],
		})
		await project.write(projectFiles.volume('v1'), {
			formatVersion,
			volumeId: 'v1',
			title: '第一卷',
			workIds: [projectWorkId],
		})
		await project.write(projectFiles.work('v1', projectWorkId), {
			formatVersion,
			workId: projectWorkId,
			title: '工程作品',
			chapterIds: [],
			version: 1,
			minReaderVersion: 1,
			appVersion: '0.1.0',
			language: 'zh-CN',
			settings: defaultWorkSettings(),
		})
		project.tasks.registerWork({ workId: projectWorkId, title: '工程作品' })
		await mkdir(join(profile, 'projects'), { recursive: true })
		await writeFile(join(profile, 'projects', projectWorkId), directory)
		await mkdir(join(profile, 'installed-works'))
		await writeFile(
			join(profile, 'installed-works/library.json'),
			JSON.stringify([
				{
					workId: packageWorkId,
					version: 3,
					title: '导入的作品包',
					installation: join(profile, 'installed-works/v3'),
					chapters: 2,
					published: 2,
				},
			]),
		)
		const app = await electron.launch({
			executablePath: require('electron'),
			args: ['apps/desktop', `--user-data-dir=${profile}`],
			env: { ...process.env, NL_REPLAY: 'strict', ELECTRON_RENDERER_URL: '' },
		})
		try {
			await app.evaluate(({ BrowserWindow }) => {
				BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800)
			})
			const page = await app.firstWindow()
			await expect(page.getByText('创作端已就绪')).toBeAttached()
			await page.evaluate((id) => {
				location.hash = `/work/${id}`
			}, projectWorkId)
			const sidebar = page.locator('aside')
			await expect(sidebar.getByText('工程作品', { exact: true })).toBeVisible()
			await sidebar.getByRole('button', { name: '换一部作品' }).click()
			await page.getByRole('menuitem', { name: '导入的作品包 · v3' }).click()
			await expect(page).toHaveURL(new RegExp(`#/package/${packageWorkId}/3$`))
			// Package selection in the switcher now navigates straight into the
			// player (task 02); returning to the library must surface the package
			// as the sidebar's recent work.
			await page.evaluate(() => {
				location.hash = '/'
			})
			await expect(page).toHaveURL(/#\/$/)
			const play = page
				.getByRole('navigation', { name: '作品导航' })
				.getByRole('link', { name: '游玩' })
			await expect(play).toHaveAttribute('href', `#/package/${packageWorkId}/3`)
			await expect(
				sidebar.getByText('导入的作品包', { exact: true }),
			).toBeVisible()
			await expect(sidebar.getByText('工程作品', { exact: true })).toHaveCount(
				0,
			)
			await page.screenshot({
				path: '.workflow/evidence/prototype-parity/shell-library/shell-package-switch-production-light-1280x800.png',
			})
			await page.reload()
			await expect(play).toHaveAttribute('href', `#/package/${packageWorkId}/3`)
			await play.click()
			await expect(page).toHaveURL(new RegExp(`#/package/${packageWorkId}/3$`))
		} finally {
			await app.close()
		}
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test('authoring flow pages capture matched-viewport parity evidence', async () => {
	test.setTimeout(120_000)
	const profile = await mkdtemp(join(tmpdir(), 'novelive-parity-authoring-'))
	const evidence = '.workflow/evidence/prototype-parity/authoring-flow'
	try {
		const cache = join(profile, 'cache', 'creation-ui')
		await mkdir(cache, { recursive: true })
		const sharp = (await import('sharp')).default
		await Promise.all(
			['visual', 'portrait', 'reference'].flatMap((prefix) =>
				candidateColors.map((background, index) =>
					sharp({
						create: {
							width: prefix === 'portrait' ? 80 : 160,
							height: prefix === 'portrait' ? 120 : 90,
							channels: 3,
							background,
						},
					})
						.png()
						.toFile(join(cache, `${prefix}-${index + 1}.png`)),
				),
			),
		)
		const app = await electron.launch({
			executablePath: require('electron'),
			args: ['apps/desktop', `--user-data-dir=${profile}`],
			env: { ...process.env, NL_REPLAY: 'strict', ELECTRON_RENDERER_URL: '' },
		})
		try {
			await app.evaluate(({ BrowserWindow }) => {
				BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 1000)
			})
			const page = await app.firstWindow()
			await expect(page.getByText('创作端已就绪')).toBeAttached()
			const fixture = await installProjection(app)
			const shot = async (name: string) => {
				await page.screenshot({
					path: `${evidence}/${name}-1280x1000-result.jpg`,
					type: 'jpeg',
					quality: 90,
					animations: 'disabled',
				})
			}
			for (const theme of ['light', 'dark'] as const) {
				await page.evaluate((value) => {
					document.documentElement.dataset.theme = value
				}, theme)
				await page.waitForTimeout(260)
				await fixture.publish('beforeVisual')
				await page.evaluate((id) => {
					location.hash = `#/work/${id}`
				}, workId)
				await expect(
					page.getByRole('heading', { name: '白塔来信' }),
				).toBeVisible()
				await expect(
					page.getByText('雾海纪行 · 第 1 卷 · 灯塔卷'),
				).toBeVisible()
				await shot(`work-${theme}`)

				await page.evaluate((id) => {
					location.hash = `#/work/${id}/confirm/visual`
				}, workId)
				await expect(
					page.getByText('雾海纪行 · 第 1 卷 · 确认点 1 / 2'),
				).toBeVisible()
				await shot(`confirm-visual-${theme}`)

				await fixture.publish('first')
				await page.evaluate((id) => {
					location.hash = `#/work/${id}/confirm/first`
				}, workId)
				await expect(
					page.getByText('雾海纪行 · 第 1 卷 · 确认点 2 / 2'),
				).toBeVisible()
				await expect(
					page.getByText('第 1 章 · 灯塔 · 2 个场景', { exact: false }),
				).toBeVisible()
				await shot(`confirm-first-${theme}`)
				await page.getByRole('button', { name: '更多', exact: true }).click()
				await expect(
					page.getByRole('menuitem', { name: '进编辑器修改' }),
				).toBeVisible()
				await page.keyboard.press('Escape')
				await page.evaluate((id) => {
					location.hash = `#/work/${id}/production`
				}, workId)
				await expect(
					page
						.getByRole('main')
						.getByText('雾海纪行 · 第 1 卷', { exact: true }),
				).toBeVisible()
				await expect(page.getByText('第 1 卷 · 灯塔卷 · 共 2 章')).toBeVisible()
				await shot(`production-${theme}`)
			}
		} finally {
			await app.close()
		}
	} finally {
		await rm(profile, { recursive: true, force: true })
	}
})

test('import wizard pages capture matched-viewport parity evidence', async () => {
	test.setTimeout(180_000)
	const workspace = await mkdtemp(join(tmpdir(), 'novelive-parity-import-'))
	const evidence = '.workflow/evidence/prototype-parity/authoring-flow'
	try {
		const source = join(workspace, 'books', '风.txt')
		const projects = join(workspace, 'projects')
		await mkdir(join(workspace, 'books'), { recursive: true })
		await mkdir(projects)
		await writeFile(
			source,
			`${await readFile(new URL('../fixtures/source/txt/multivolume.txt', import.meta.url), 'utf8')}\nChapter One 余波\n`,
		)
		const app = await electron.launch({
			executablePath: require('electron'),
			args: ['apps/desktop', `--user-data-dir=${join(workspace, 'profile')}`],
			env: { ...process.env, NL_REPLAY: 'strict', ELECTRON_RENDERER_URL: '' },
		})
		try {
			await app.evaluate(({ BrowserWindow }) => {
				BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 1000)
			})
			const page = await app.firstWindow()
			await expect(page.getByText('创作端已就绪')).toBeAttached()
			const shot = async (name: string) => {
				for (const theme of ['light', 'dark'] as const) {
					await page.evaluate((value) => {
						document.documentElement.dataset.theme = value
					}, theme)
					await page.waitForTimeout(260)
					await page.screenshot({
						path: `${evidence}/${name}-${theme}-1280x1000-result.jpg`,
						type: 'jpeg',
						quality: 90,
						animations: 'disabled',
					})
				}
				await page.evaluate(() => {
					document.documentElement.dataset.theme = 'light'
				})
				await page.waitForTimeout(260)
			}
			await app.evaluate(
				({ dialog }, queue) => {
					dialog.showOpenDialog = async () => {
						const filePaths = queue.shift() ?? []
						return { canceled: !filePaths.length, filePaths }
					}
				},
				[[source], [projects]],
			)
			await page.evaluate(() => {
				location.hash = '#/import'
			})
			await expect(
				page.getByRole('heading', { name: '新建工程' }),
			).toBeVisible()
			await page.getByRole('button', { name: '选择原文' }).click()
			await expect(page.getByLabel('作品名')).toHaveValue('风')
			await page.getByRole('button', { name: '选择文件夹' }).click()
			await expect(page.getByText(/projects$/)).toBeVisible()
			await shot('import-step1')
			await page.getByRole('button', { name: '下一步', exact: true }).click()
			await expect(
				page.locator('[aria-current="step"]', { hasText: '核对信息' }),
			).toBeVisible()
			await expect(
				page.getByRole('group', { name: /^第 \d+ 章$/ }).first(),
			).toBeVisible()
			await shot('import-step2')
			await page.getByRole('button', { name: '下一步', exact: true }).click()
			await expect(
				page.locator('[aria-current="step"]', { hasText: '插图与参考' }),
			).toBeVisible()
			await shot('import-step3')
		} finally {
			await app.close()
		}
	} finally {
		await rm(workspace, { recursive: true, force: true })
	}
})

test('welcome model step captures matched-viewport parity evidence', async () => {
	test.setTimeout(90_000)
	const profile = await mkdtemp(join(tmpdir(), 'novelive-parity-welcome-'))
	const evidence = '.workflow/evidence/prototype-parity/shell-library'
	try {
		const app = await electron.launch({
			executablePath: require('electron'),
			args: ['apps/desktop', `--user-data-dir=${profile}`],
			env: { ...process.env, NL_REPLAY: 'strict', ELECTRON_RENDERER_URL: '' },
		})
		try {
			await app.evaluate(({ BrowserWindow }) => {
				BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900)
			})
			const page = await app.firstWindow()
			await expect(
				page.getByText('创作端已就绪', { exact: true }),
			).toBeAttached()
			await page.evaluate(() => {
				location.hash = '/welcome'
			})
			await page.getByRole('button', { name: '继续', exact: true }).click()
			await page.getByRole('button', { name: '继续', exact: true }).click()
			await expect(
				page.getByRole('heading', { name: '模型配置' }),
			).toBeVisible()
			for (const theme of ['light', 'dark'] as const) {
				await page.evaluate((value) => {
					document.documentElement.dataset.theme = value
				}, theme)
				await page.waitForTimeout(260)
				await page.screenshot({
					path: `${evidence}/welcome-models-production-${theme}-1440x900.png`,
					animations: 'disabled',
				})
			}
		} finally {
			await app.close()
		}
	} finally {
		await rm(profile, { recursive: true, force: true })
	}
})

async function compositePlayerAgentShot(
	file: string,
	productionScreenshot: Buffer,
) {
	const existing = await readFile(file)
	const left = await sharp(existing)
		.extract({ left: 0, top: 0, width: 650, height: 400 })
		.toBuffer()
	const right = await sharp(productionScreenshot).resize(640, 400).toBuffer()
	await sharp({
		create: {
			width: 1290,
			height: 400,
			channels: 4,
			background: { r: 255, g: 0, b: 255, alpha: 1 },
		},
	})
		.composite([
			{ input: left, left: 0, top: 0 },
			{ input: right, left: 650, top: 0 },
		])
		.png()
		.toFile(file)
}

test('player soft, paper and history capture matched-viewport parity evidence', async () => {
	test.setTimeout(120_000)
	const directory = await mkdtemp(join(tmpdir(), 'novelive-parity-player-'))
	const root = join(directory, 'project')
	const profile = join(directory, 'profile')
	const evidence = '.workflow/evidence/prototype-parity/player-agent'
	try {
		const png = (background: string, width: number, height: number) =>
			sharp({ create: { width, height, channels: 3, background } })
				.png()
				.toBuffer()
		await seedPlayerProject(
			root,
			await png('#2e4057', 960, 540),
			await png('#d0b090', 320, 540),
		)
		await mkdir(join(profile, 'projects'), { recursive: true })
		await writeFile(join(profile, 'projects', playerWorkId), root)
		const app = await electron.launch({
			executablePath: require('electron'),
			args: ['apps/desktop', `--user-data-dir=${profile}`],
			env: { ...process.env, NL_REPLAY: 'strict', ELECTRON_RENDERER_URL: '' },
		})
		try {
			await app.evaluate(({ BrowserWindow }) => {
				BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800)
			})
			const page = await app.firstWindow()
			await expect(
				page.getByText('创作端已就绪', { exact: true }),
			).toBeAttached()
			await page.evaluate((id) => {
				location.hash = `#/work/${id}/play`
			}, playerWorkId)
			await expect(page.locator('.nl-player-text .nl-text-display')).toHaveText(
				'你好，世界。',
			)
			await expect(page.locator('.nl-player-text')).toHaveAttribute(
				'data-text-finished',
				'true',
			)
			const shotPair = async (name: string) => {
				for (const theme of ['light', 'dark'] as const) {
					await page.evaluate((value) => {
						document.documentElement.dataset.theme = value
					}, theme)
					await page.waitForTimeout(260)
					await compositePlayerAgentShot(
						`${evidence}/${name}-${theme}-1280x800.png`,
						await page.screenshot({ animations: 'disabled' }),
					)
				}
				await page.evaluate(() => {
					document.documentElement.dataset.theme = 'light'
				})
				await page.waitForTimeout(260)
			}
			await shotPair('player-soft')
			await page.keyboard.press('Escape')
			await page.getByRole('button', { name: '设置', exact: true }).click()
			await page.getByRole('button', { name: '浅色纸笺', exact: true }).click()
			await page.keyboard.press('Escape')
			await shotPair('player-paper')
			await page.keyboard.press('Escape')
			await page.getByRole('button', { name: '历史记录', exact: true }).click()
			await expect(page.locator('.nl-history-chapter')).toHaveCount(1)
			await shotPair('player-history')
		} finally {
			await app.close()
		}
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})

test('agent drawer captures matched-viewport parity evidence', async () => {
	test.setTimeout(90_000)
	const profile = await mkdtemp(join(tmpdir(), 'novelive-parity-agent-'))
	const evidence = '.workflow/evidence/prototype-parity/player-agent'
	const chatWorkId = '5c1d7d3e-2f0b-4b8e-9a51-8f3c2b6d9e10'
	const at = '2026-11-23T08:00:00.000Z'
	type Snapshot = CommandOutput<'chat.get'>
	type Entry = Snapshot['entries'][number]
	const msg = (
		id: string,
		parentId: string | null,
		role: 'user' | 'assistant',
		parts: Extract<Entry, { kind: 'message' }>['parts'],
	): Entry => ({ id, parentId, at, kind: 'message', role, parts })
	const keeper: Snapshot = {
		session: {
			workId: chatWorkId,
			sessionId: 'keeper',
			title: '守塔人设定',
			updatedAt: at,
		},
		headId: 'a1b',
		headIds: ['a1', 'a1b'],
		status: 'idle',
		entries: [
			msg('u1', null, 'user', [
				{ type: 'text', text: '守塔人的年龄写得前后不一' },
			]),
			msg('a1', 'u1', 'assistant', [
				{ type: 'reasoning', text: '先查设定集里的年龄条目。' },
				{
					type: 'tool',
					id: 'tool-1',
					name: 'read_bible',
					input: '{"entry":"守塔人","field":"年龄"}',
					result: '{"年龄":"五十八岁","来源":"第一章"}',
				},
				{
					type: 'subtask',
					id: 'sub-1',
					label: '核对第二章称呼',
					role: 'reviewer',
					status: 'done',
				},
				{
					type: 'text',
					text: '设定集写的是**五十八岁**，第二章误写成六十岁。',
				},
			]),
			msg('u1b', null, 'user', [
				{ type: 'text', text: '守塔人的年龄统一成六十岁' },
			]),
			msg('a1b', 'u1b', 'assistant', [
				{ type: 'text', text: '好的，我会把设定集和第一章都改成六十岁。' },
			]),
		],
	}
	try {
		const app = await electron.launch({
			executablePath: require('electron'),
			args: ['apps/desktop', `--user-data-dir=${profile}`],
			env: { ...process.env, NL_REPLAY: 'strict', ELECTRON_RENDERER_URL: '' },
		})
		try {
			await app.evaluate(({ BrowserWindow }) => {
				BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800)
			})
			const page = await app.firstWindow()
			await expect(
				page.getByText('创作端已就绪', { exact: true }),
			).toBeAttached()
			await app.evaluate(
				({ BrowserWindow, MessageChannelMain }, fixture) => {
					const window = BrowserWindow.getAllWindows()[0]
					const { port1, port2 } = new MessageChannelMain()
					const generation = 200
					port1.on('message', ({ data }: { data: ClientFrame }) => {
						if (data.type !== 'call') return
						const base = { generation, requestId: data.requestId }
						const respond = (result: unknown) =>
							port1.postMessage({ ...base, type: 'result', result })
						const input = data.payload as Record<string, string>
						switch (data.command) {
							case 'production.get':
								respond({
									workId: fixture.chatWorkId,
									chapterTitles: { two: '潮汐' },
								})
								break
							case 'chat.list':
								respond({ sessions: [fixture.keeper.session] })
								break
							case 'chat.get':
								respond({
									...fixture.keeper,
									headId: input.headId ?? fixture.keeper.headId,
								})
								break
							default:
								port1.postMessage({
									...base,
									type: 'error',
									error: { code: 'unsupported', message: 'Test projection' },
								})
						}
					})
					port1.start()
					window.webContents.postMessage('novelive:port', generation, [port2])
					window.webContents.send('novelive:ready', { generation })
				},
				{ chatWorkId, keeper },
			)
			await page.evaluate((id) => {
				location.hash = `#/work/${id}/bible`
			}, chatWorkId)
			await page.keyboard.press('Control+J')
			const panel = page.getByRole('complementary', { name: 'Novelive Agent' })
			await expect(panel).toBeVisible()
			await panel
				.getByRole('navigation', { name: '分支' })
				.getByRole('button', { name: '上一个分支' })
				.click()
			await panel.getByRole('button', { name: /读取设定集/ }).click()
			await panel.getByRole('button', { name: '详细信息' }).first().click()
			await expect(panel.getByText('"field": "年龄"')).toBeVisible()
			for (const theme of ['light', 'dark'] as const) {
				await page.evaluate((value) => {
					document.documentElement.dataset.theme = value
				}, theme)
				await page.waitForTimeout(260)
				await compositePlayerAgentShot(
					`${evidence}/agent-${theme}-1280x800.png`,
					await page.screenshot({ animations: 'disabled' }),
				)
			}
		} finally {
			await app.close()
		}
	} finally {
		await rm(profile, { recursive: true, force: true })
	}
})
