import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

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
			await page.evaluate(() => {
				location.hash = '/welcome'
			})
			await page.getByRole('button', { name: '继续', exact: true }).click()
			await page.getByRole('button', { name: '继续', exact: true }).click()
			await page.getByLabel('快速模型', { exact: true }).fill('offline-model')
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
