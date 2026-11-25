import { readFileSync } from 'node:fs'
import type { ElectronApplication, Page } from '@playwright/test'
import { expect } from '@playwright/test'

const locales = ['zh-CN', 'zh-TW', 'en', 'ja'] as const
type Locale = (typeof locales)[number]
const load = (locale: Locale, ns: string): Record<string, string> =>
	JSON.parse(
		readFileSync(`packages/ui/src/locales/${locale}/${ns}.json`, 'utf8'),
	)
const text = (locale: Locale, ns: string, key: string) => load(locale, ns)[key]

/**
 * Raw i18n keys are the zh-CN source strings. Per locale, a key proves a
 * missing translation when it appears verbatim and either its translation
 * differs from the key or the key is absent from that locale's catalog
 * (i18next then falls back and emits the raw key). A key equal to its
 * translation is legitimately visible, so it is excluded. Built across the
 * union of namespaces so a leaked key from any surface is caught.
 */
const namespaces = [
	'agent',
	'bible',
	'components',
	'confirm',
	'editor',
	'import',
	'library',
	'main',
	'player',
	'production',
	'settings',
	'shell',
	'usage',
	'welcome',
	'work',
] as const
const shouldTranslate: Record<Locale, string[]> = Object.fromEntries(
	locales.map((locale) => {
		const keys = new Set<string>()
		for (const ns of namespaces) {
			const source = load('zh-CN', ns)
			const target = load(locale, ns)
			for (const key of Object.keys(source))
				if (!(key in target) || target[key] !== key) keys.add(key)
		}
		return [locale, [...keys]]
	}),
) as Record<Locale, string[]>

const pages = [
	['书库', 'library'],
	['用量', 'usage'],
	['设置', 'settings'],
] as const

const MESSAGES = 'noveliveUpdateCheckMessages'
const OPENED = 'noveliveAboutOpened'
const SOURCE_URL = 'https://github.com/Yume2333/Novelive-dev'

async function overflowing(page: Page) {
	return page.evaluate(() =>
		[...document.querySelectorAll('nav a, nav button, h1, h2, label, button')]
			.filter((element) => {
				const box = element.getBoundingClientRect()
				// Horizontal overflow = truncated/clipped text. Headings report
				// scrollHeight > clientHeight from line-height alone, so height is
				// not a clipping signal; width is.
				return box.width > 0 && element.scrollWidth > element.clientWidth + 1
			})
			.map((element) => element.textContent?.trim()),
	)
}

/**
 * Visible text must be translated, never a raw i18n key left untranslated for
 * the current locale, and never a `{{placeholder}}` whose interpolation value
 * failed to reach the UI. Checks text nodes plus the user-facing attributes
 * that leak keys the same way: title, aria-label, placeholder and alt.
 */
async function missingI18n(page: Page, rawKeys: readonly string[]) {
	return page.evaluate((keys) => {
		const raw = new Set(keys)
		const failures: string[] = []
		const inspect = (value: string | null | undefined, where: string) => {
			const found = value?.trim()
			if (!found) return
			if (raw.has(found)) failures.push(`raw key ${where}: ${found}`)
			if (/\{\{\w+\}\}/.test(found))
				failures.push(`placeholder ${where}: ${found}`)
		}
		const visible = (element: Element) => {
			const box = element.getBoundingClientRect()
			const style = getComputedStyle(element)
			return (
				box.width > 0 &&
				box.height > 0 &&
				style.visibility !== 'hidden' &&
				style.display !== 'none'
			)
		}
		const walk = (root: Document | ShadowRoot) => {
			const iterator = document.createTreeWalker(
				root instanceof Document ? root.body : root,
				NodeFilter.SHOW_TEXT,
			)
			for (let node = iterator.nextNode(); node; node = iterator.nextNode())
				if (node.parentElement && visible(node.parentElement))
					inspect(node.textContent, 'text')
			for (const element of root.querySelectorAll(
				'[title], [aria-label], [placeholder], [alt]',
			))
				if (visible(element))
					for (const name of [
						'title',
						'aria-label',
						'placeholder',
						'alt',
					] as const)
						inspect(element.getAttribute(name), name)
			for (const host of root.querySelectorAll('*'))
				if (host.shadowRoot) walk(host.shadowRoot)
		}
		walk(document)
		return failures
	}, rawKeys)
}

async function aboutSurfaces(page: Page, locale: Locale) {
	const about = page.getByRole('region', {
		name: text(locale, 'settings', '关于'),
	})
	await expect(about).toBeVisible()
	await expect(about).toContainText('AGPL-3.0')
	await expect(about).toContainText(
		text(locale, 'settings', '把小说改编为视觉小说并直接游玩。'),
	)
	const button = (key: string) =>
		about.getByRole('button', { name: text(locale, 'settings', key) })

	// License and source-code buttons call `shell.openPath`/`shell.openExternal`
	// in the main process; the helper stubs record their targets so the clicks
	// exercise the real path without touching the desktop or the network.
	await button('开源许可').click()
	await button('源代码').click()
	// Dev checkout: packaged === false, so no third-party notices entry.
	await expect(button('第三方许可')).toHaveCount(0)

	const check = button('检查更新')
	await check.click()
	// The offline policy resolves to the localized "no update source" prompt
	// that the stub captures instead of showing a blocking native dialog; the
	// control returns to a usable state afterwards.
	await expect(check).toBeEnabled()
	// A failed surface writes the failure into the page alert; none must exist.
	await expect(page.getByRole('alert')).toHaveCount(0)
}

/**
 * Runs an already-launched Electron `page` through zh-CN, zh-TW, en and ja,
 * checking on the Library/Usage/Settings pages that no raw i18n key or
 * `{{placeholder}}` leaks into the visible UI, then exercises the About
 * license/version block and the offline update check. The update check must
 * degrade to the localized "no update source" prompt — never a paid or
 * network dependency.
 *
 * `app` must be the `ElectronApplication` the page came from. The helper
 * installs main-process stubs so `dialog.showMessageBox`, `shell.openPath`
 * and `shell.openExternal` resolve without touching the desktop or the
 * network, while recording what the app tried to open. It returns the
 * update-prompt message shown for each locale.
 */
export async function verifyLocalesAndAboutSurfaces(
	page: Page,
	app: ElectronApplication,
): Promise<string[]> {
	await app.evaluate(
		({ dialog, shell }, keys) => {
			const [messagesKey, openedKey] = keys
			const messages: string[] = []
			const opened: { path?: string; url?: string }[] = []
			;(globalThis as Record<string, unknown>)[messagesKey] = messages
			;(globalThis as Record<string, unknown>)[openedKey] = opened
			const readMessage = (options: unknown) =>
				typeof options === 'object' && options !== null && 'message' in options
					? String(options.message)
					: ''
			dialog.showMessageBox = ((
				windowOrOptions: unknown,
				options?: unknown,
			) => {
				messages.push(
					readMessage(options === undefined ? windowOrOptions : options),
				)
				return Promise.resolve({ response: 0, checkboxChecked: false })
			}) as typeof dialog.showMessageBox
			shell.openPath = async (path: string) => {
				opened.push({ path })
				return ''
			}
			shell.openExternal = async (url: string) => {
				opened.push({ url })
			}
		},
		[MESSAGES, OPENED],
	)
	const readState = () =>
		app.evaluate(
			(_electron, keys) => {
				const [messagesKey, openedKey] = keys
				const read = <T>(
					value: unknown,
					pick: (item: unknown) => T | undefined,
				) =>
					Array.isArray(value)
						? value.map(pick).filter((item): item is T => item !== undefined)
						: []
				return {
					messages: read(
						(globalThis as Record<string, unknown>)[messagesKey],
						(item) => (typeof item === 'string' ? item : undefined),
					),
					opened: read(
						(globalThis as Record<string, unknown>)[openedKey],
						(item) =>
							typeof item === 'object' && item !== null
								? (item as { path?: string; url?: string })
								: undefined,
					),
				}
			},
			[MESSAGES, OPENED],
		)

	const shown: string[] = []
	let previous: Locale = 'zh-CN'
	for (const locale of locales) {
		// Scope to the global navigation landmark — a work nav (概览/游玩/…) can
		// coexist and zh-TW 設定 is a substring of 設定集, so exact + landmark both
		// are needed to target the right link.
		const nav = page.getByRole('navigation', {
			name: text(previous, 'shell', '全局导航'),
		})
		await nav
			.getByRole('link', {
				name: text(previous, 'shell', '设置'),
				exact: true,
			})
			.click()
		await page
			.getByLabel(text(previous, 'settings', '界面语言'), { exact: true })
			.selectOption(locale)
		await expect(page.locator('html')).toHaveAttribute('lang', locale)

		const pagesNav = page.getByRole('navigation', {
			name: text(locale, 'shell', '全局导航'),
		})
		for (const [key, name] of pages) {
			const label = text(locale, 'shell', key)
			await pagesNav.getByRole('link', { name: label, exact: true }).click()
			await expect(page.getByRole('heading', { level: 1 })).toHaveText(
				name === 'usage' ? text(locale, 'usage', '用量统计') : label,
			)
			expect(await overflowing(page), `${locale} ${name} overflow`).toEqual([])
			expect(
				await missingI18n(page, shouldTranslate[locale]),
				`${locale} ${name} missing i18n`,
			).toEqual([])
		}

		const before = (await readState()).messages.length
		await aboutSurfaces(page, locale)
		const { messages, opened } = await readState()
		// License button opened the repo LICENSE file; source button opened the
		// repository URL. Assert the real targets, not just that the stub ran.
		expect(
			opened.some((entry) => entry.path?.endsWith('LICENSE')),
			`${locale} license openPath`,
		).toBe(true)
		expect(
			opened.some((entry) => entry.url === SOURCE_URL),
			`${locale} source openExternal`,
		).toBe(true)
		// The manual check resolves to the localized "no update source" prompt;
		// confirm the stub captured it (one new message since this locale).
		const latest = messages.slice(before)
		expect(latest, `${locale} update-check message`).toEqual([
			text(locale, 'main', '未配置应用更新源。'),
		])
		shown.push(...latest)
		previous = locale
	}

	// Restore zh-CN so the caller's app is left in the launched state.
	await page
		.getByLabel(text('ja', 'settings', '界面语言'), {
			exact: true,
		})
		.selectOption('zh-CN')
	await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
	return shown
}
