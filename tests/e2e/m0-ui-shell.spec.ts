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
			await expect(page.getByRole('heading', { name: '书库' })).toBeVisible()
			await expect(page.getByText('还没有作品')).toBeVisible()
			await expect(nav.getByRole('link', { name: '书库' })).toHaveAttribute(
				'aria-current',
				'page',
			)
			await expect(page.getByRole('status')).toHaveText('创作端已就绪')
			await expect(page.getByRole('button', { name: '新建' })).toHaveCount(0)
			await expect(
				page.getByRole('button', { name: '导入作品包' }),
			).toHaveCount(0)
			await page.getByRole('button', { name: '亮色' }).click()
			await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
			await page.screenshot({
				path: test.info().outputPath('library-light.png'),
			})
			await nav.getByRole('link', { name: '用量' }).click()
			await expect(page.getByRole('heading', { name: '用量' })).toBeVisible()
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
			await expect(page.getByRole('heading', { name: '设置' })).toBeVisible()
			await page.reload()
			await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
			await nav.getByRole('link', { name: '书库' }).click()
			await expect(page.getByText('还没有作品')).toBeVisible()
		} finally {
			await app.close()
		}
	} finally {
		await rm(profile, { recursive: true, force: true })
	}
})
