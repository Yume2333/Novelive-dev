import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { Project } from '../../packages/creator/src/project'
import {
	defaultWorkSettings,
	formatVersion,
	projectFiles,
} from '../../packages/format/src/model'

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
			await expect(page.getByText('创作端已就绪')).toBeAttached()
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
