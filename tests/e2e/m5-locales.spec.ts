import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	_electron as electron,
	expect,
	type Page,
	test,
} from '@playwright/test'

const require = createRequire(
	new URL('../../apps/desktop/package.json', import.meta.url),
)
const locales = ['zh-CN', 'zh-TW', 'en', 'ja'] as const
type Locale = (typeof locales)[number]
const text = (locale: Locale, ns: 'shell' | 'settings', key: string) =>
	JSON.parse(
		readFileSync(`packages/ui/src/locales/${locale}/${ns}.json`, 'utf8'),
	)[key] as string
const pages = [
	['书库', 'library'],
	['用量', 'usage'],
	['设置', 'settings'],
] as const

async function launch(profile: string) {
	const app = await electron.launch({
		executablePath: require('electron'),
		args: ['apps/desktop', `--user-data-dir=${profile}`],
		env: { ...process.env, NL_E2E: '1', NL_REPLAY: 'strict' },
	})
	return { app, page: await app.firstWindow() }
}

async function overflowing(page: Page) {
	return page.evaluate(() =>
		[...document.querySelectorAll('nav a, nav button, h1, h2, label, button')]
			.filter((element) => {
				const box = element as HTMLElement
				return (
					box.offsetParent !== null &&
					box.scrollWidth > box.clientWidth + 1 &&
					getComputedStyle(box).overflowX !== 'visible'
				)
			})
			.map((element) => element.textContent?.trim()),
	)
}

test('M5 locales switch the interface through four languages and persist', async () => {
	test.setTimeout(120_000)
	const profile = await mkdtemp(join(tmpdir(), 'novelive-locales-'))
	try {
		let { app, page } = await launch(profile)
		await expect(page.getByText('创作端已就绪')).toBeAttached()
		let previous: Locale = 'zh-CN'
		for (const locale of [...locales.slice(1), 'zh-CN'] as const) {
			await page
				.getByRole('link', { name: text(previous, 'shell', '设置') })
				.click()
			await page
				.getByLabel(text(previous, 'settings', '界面语言'), { exact: true })
				.selectOption(locale)
			await expect(page.locator('html')).toHaveAttribute('lang', locale)
			for (const [key, name] of pages) {
				const label = text(locale, 'shell', key)
				await page.getByRole('link', { name: label, exact: true }).click()
				await expect(page.getByRole('heading', { level: 1 })).toHaveText(label)
				expect(await overflowing(page), `${locale} ${name}`).toEqual([])
				await page.screenshot({
					path: `.workflow/evidence/m5/localization/${locale}-${name}.png`,
				})
			}
			if (locale === 'ja') {
				await app.close()
				;({ app, page } = await launch(profile))
				await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
				await expect(
					page.getByText(text('ja', 'shell', '创作端已就绪')),
				).toBeAttached()
			}
			previous = locale
		}
		await expect(page.getByText('创作端已就绪')).toBeAttached()
		await app.close()
	} finally {
		await rm(profile, { recursive: true, force: true })
	}
})
