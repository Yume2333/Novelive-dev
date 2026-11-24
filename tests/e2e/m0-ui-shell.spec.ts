import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const require = createRequire(
	new URL('../../apps/desktop/package.json', import.meta.url),
)

test('M0 library and usage navigate between real empty pages and switch theme without native scrollbars', async () => {
	const profile = await mkdtemp(join(tmpdir(), 'novelive-shell-'))
	try {
		const app = await electron.launch({
			executablePath: require('electron'),
			args: ['apps/desktop', `--user-data-dir=${profile}`],
			env: { ...process.env, NL_E2E: '1', NL_REPLAY: 'strict' },
		})
		try {
			const page = await app.firstWindow()
			const nav = page.getByRole('navigation', { name: '全局导航' })
			await expect(
				page.getByRole('heading', { name: '书库', exact: true }),
			).toBeVisible()
			await expect(
				page.getByRole('heading', { name: '书库还是空的' }),
			).toBeVisible()
			await expect(nav.getByRole('link', { name: '书库' })).toHaveAttribute(
				'aria-current',
				'page',
			)
			await expect(
				page.getByRole('status').filter({ hasText: /^创作端已就绪$/ }),
			).toHaveText('创作端已就绪')
			await expect(page.getByRole('button', { name: '新建' })).toHaveCount(0)
			await expect(
				page.getByRole('button', { name: '导入作品包' }),
			).toBeVisible()
			await page.getByRole('button', { name: '亮色' }).click()
			await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
			await page.screenshot({
				path: test.info().outputPath('library-light.png'),
			})
			await nav.getByRole('link', { name: '用量' }).click()
			await expect(
				page.getByRole('heading', { name: '用量', level: 1, exact: true }),
			).toBeVisible()
			await expect(page.getByText('暂无用量记录')).toBeVisible()
			await page.getByRole('button', { name: '暗色' }).click()
			await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
			for (const viewport of await page
				.locator('[data-scroll-viewport]')
				.all()) {
				await expect(viewport).toHaveCSS('scrollbar-width', 'none')
			}
			await page.screenshot({ path: test.info().outputPath('usage-dark.png') })
			await nav.getByRole('link', { name: '设置' }).click()
			await expect(
				page.getByRole('heading', { name: '设置', exact: true }),
			).toBeVisible()
			await page.reload()
			await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
			await nav.getByRole('link', { name: '书库' }).click()
			await expect(
				page.getByRole('heading', { name: '书库还是空的' }),
			).toBeVisible()
		} finally {
			await app.close()
		}
	} finally {
		await rm(profile, { recursive: true, force: true })
	}
})

test('M0 library and usage scroll overflowing content using the overlay track and thumb', async () => {
	const profile = await mkdtemp(join(tmpdir(), 'novelive-scrollbar-'))
	try {
		const app = await electron.launch({
			executablePath: require('electron'),
			args: ['apps/desktop', `--user-data-dir=${profile}`],
			env: { ...process.env, NL_E2E: '1', NL_REPLAY: 'strict' },
		})
		try {
			const page = await app.firstWindow()
			const viewport = page.locator('main [data-scroll-viewport]')
			const track = page.locator('main [data-dragging]')
			const scrollTop = () => viewport.evaluate((element) => element.scrollTop)
			await expect(
				page.getByRole('heading', { name: '书库', exact: true }),
			).toBeVisible()
			await expect(track).toHaveCount(0)
			await page.addStyleTag({ content: 'main section { min-height: 300vh; }' })
			expect(
				await viewport.evaluate((element) => element.scrollHeight),
			).toBeGreaterThan(
				await viewport.evaluate((element) => element.clientHeight),
			)
			await expect(viewport).toHaveCSS('scrollbar-width', 'none')
			await viewport.hover()
			await expect(track).toHaveCSS('opacity', '1')
			await page.emulateMedia({ reducedMotion: 'reduce' })
			await expect(track).toHaveCSS('transition-duration', '0s')

			const bounds = await track.boundingBox()
			if (!bounds) throw new Error('Missing overlay track')
			await page.mouse.click(
				bounds.x + bounds.width / 2,
				bounds.y + bounds.height * 0.7,
			)
			await expect.poll(scrollTop).toBeGreaterThan(0)

			const thumb = track.locator('div')
			await expect(thumb).toBeVisible()
			const thumbBounds = await thumb.boundingBox()
			if (!thumbBounds) throw new Error('Missing overlay thumb')
			const x = thumbBounds.x + thumbBounds.width / 2
			const y = thumbBounds.y + thumbBounds.height / 2
			const beforeDrag = await scrollTop()
			await page.mouse.move(x, y)
			await page.mouse.down()
			await expect(track).toHaveAttribute('data-dragging', 'true')
			await page.mouse.move(x, bounds.y + 8, { steps: 5 })
			await page.mouse.up()
			await expect(track).toHaveAttribute('data-dragging', 'false')
			await expect.poll(scrollTop).toBeLessThan(beforeDrag)
		} finally {
			await app.close()
		}
	} finally {
		await rm(profile, { recursive: true, force: true })
	}
})
