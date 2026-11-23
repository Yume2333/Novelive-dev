import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
	_electron as electron,
	expect,
	type Locator,
	type Page,
	test,
} from '@playwright/test'
import { imageSmokeConfig } from '../fixtures/image-models/smoke-config'
import {
	smokeConnection,
	smokeProfiles,
} from '../fixtures/text-models/smoke-config'

const require = createRequire(
	new URL('../../apps/desktop/package.json', import.meta.url),
)
const baseUrl = 'https://relay.invalid'
const placeholder = 'offline-placeholder'

async function launch(
	profile: string,
	fixtures: string,
	options: { delay?: string; fault?: string } = {},
) {
	const app = await electron.launch({
		executablePath: require('electron'),
		args: ['apps/desktop', `--user-data-dir=${profile}`],
		env: {
			...process.env,
			NL_E2E: '1',
			NL_REPLAY: 'strict',
			NL_CASSETTE_DIR: resolve('tests/fixtures', fixtures),
			NL_REPLAY_DELAY_MS: options.delay ?? '',
			NL_REPLAY_FAULT: options.fault ?? '',
		},
	})
	const page = await app.firstWindow()
	await expect(page.getByText('创作端已就绪')).toBeAttached()
	await page.getByRole('link', { name: '设置' }).click()
	return { app, page }
}

const card = (page: Page, name: string) =>
	page.getByRole('region', { name, exact: true })
const testButton = (region: Locator) =>
	region.getByRole('button', { name: '测试', exact: true })

async function editText(
	region: Locator,
	title: string,
	smoke: (typeof smokeProfiles)[number],
	inherited = false,
) {
	const config = smokeConnection(smoke, baseUrl, placeholder)
	await region.getByRole('button', { name: title, exact: true }).click()
	const inherit = region.getByRole('checkbox', { name: '同快速模型' })
	if (await inherit.count()) await inherit.setChecked(inherited)
	if (!inherited) {
		await region
			.getByLabel('接口格式', { exact: true })
			.selectOption(config.format)
		await region.getByLabel('接口地址', { exact: true }).fill(config.baseUrl)
		await region.getByLabel('API Key', { exact: true }).fill(config.apiKey)
	}
	await region.getByLabel('模型名', { exact: true }).fill(config.model)
	await region
		.getByLabel('上下文长度', { exact: true })
		.fill(String(config.contextWindow))
}

test('M0 settings saves five slots and runs recorded text and vision requests', async () => {
	const profile = await mkdtemp(join(tmpdir(), 'novelive-settings-'))
	try {
		const { app, page } = await launch(profile, 'text-models/smoke')
		try {
			const fast = card(page, '快速模型')
			await editText(fast, '快速模型', smokeProfiles[2])
			await fast.getByRole('button', { name: '保存' }).click()
			await expect(fast.getByRole('status')).toHaveText('已保存')
			await expect(fast.getByLabel('API Key')).toHaveValue('••••')

			const main = card(page, '主模型')
			await editText(main, '主模型', smokeProfiles[1])
			const visual = card(page, '视觉模型')
			await editText(visual, '视觉模型', smokeProfiles[0])
			const writing = card(page, '写作模型')
			await editText(writing, '写作模型', smokeProfiles[2], true)
			await expect(writing.getByLabel('接口地址')).toBeDisabled()
			await expect(writing.getByLabel('API Key')).toHaveValue('••••')
			for (const region of [fast, main, writing, visual]) {
				await testButton(region).click()
				await expect(region.getByRole('status')).toHaveText('连接成功')
			}

			const appearance = page.getByRole('region', { name: '界面', exact: true })
			await expect(
				appearance
					.getByRole('combobox', { name: '界面语言' })
					.locator('option'),
			).toHaveText(['简体中文', '繁體中文', 'English', '日本語'])
			await appearance
				.getByRole('combobox', { name: '主题', exact: true })
				.selectOption('dark')
			await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
			const raw = await readFile(join(profile, 'config.json'), 'utf8')
			expect(raw).not.toContain(placeholder)
			expect(JSON.parse(raw)).toMatchObject({
				theme: 'dark',
				models: { writing: { inheritFast: true } },
			})
			await page.reload()
			await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
			await fast.getByRole('button', { name: '快速模型', exact: true }).click()
			await expect(fast.getByLabel('模型名')).toHaveValue(
				smokeProfiles[2].model,
			)
			await expect(fast.getByLabel('API Key')).toHaveValue('••••')
			await fast.getByLabel('接口格式').selectOption('openai-completions')
			await fast.getByLabel('兼容哪家').selectOption('openai')
			await expect(fast.getByLabel('接口地址')).toHaveValue(
				'https://api.openai.com/v1',
			)
			await fast.getByLabel('模型名').fill('gpt-4o')
			await fast.getByLabel('模型名').blur()
			await expect(fast.getByLabel('上下文长度')).toHaveValue(/^\d+$/)
			await fast.getByLabel('上下文长度').fill('8192')
			await fast.getByRole('button', { name: '保存' }).click()
			await expect(fast.getByRole('status')).toHaveText('已保存')
			await expect(fast.getByLabel('上下文长度')).toHaveValue('8192')
			const key = fast.getByLabel('API Key')
			await key.focus()
			await expect(key).toHaveValue('')
			await key.blur()
			await expect(key).toHaveValue('••••')
			await key.pressSequentially('replacement-key')
			await expect(key).toHaveValue('replacement-key')
			await fast.getByRole('button', { name: '保存' }).click()
			await expect(key).toHaveValue('••••')
			const toggle = fast.getByRole('button', { name: '快速模型', exact: true })
			await toggle.click()
			await expect(toggle).toHaveAttribute('aria-expanded', 'false')
			await expect(fast.getByRole('textbox', { name: '模型名' })).toHaveCount(0)
			await toggle.click()
			await expect(fast.getByRole('textbox', { name: '模型名' })).toHaveValue(
				'gpt-4o',
			)
		} finally {
			await app.close()
		}
	} finally {
		await rm(profile, { recursive: true, force: true })
	}
})

test('M0 settings preserves a manual context limit when inheritance keeps the catalog provider', async () => {
	const profile = await mkdtemp(join(tmpdir(), 'novelive-settings-'))
	try {
		const { app, page } = await launch(profile, 'text-models/smoke')
		try {
			await page.evaluate(
				() =>
					window.novelive.call('config.update', {
						models: {
							main: {
								model: 'gpt-4o',
								contextWindow: 8192,
								inheritFast: false,
							},
						},
					}).promise,
			)
			await page.reload()
			const main = card(page, '主模型')
			await main.getByRole('button', { name: '主模型', exact: true }).click()
			const context = main.getByLabel('上下文长度')
			await expect(context).toHaveValue('8192')
			await main.getByRole('checkbox', { name: '同快速模型' }).check()
			await page.evaluate(async () => {
				await window.novelive.call('model.suggestContextWindow', {
					model: 'gpt-4o',
					format: 'openai-completions',
					compat: 'auto',
				}).promise
			})
			await expect(context).toHaveValue('8192')
			await main.getByRole('button', { name: '保存' }).click()
			await expect(main.getByRole('status')).toHaveText('已保存')
			await expect(context).toHaveValue('8192')
		} finally {
			await app.close()
		}
	} finally {
		await rm(profile, { recursive: true, force: true })
	}
})

test('M0 settings shows recorded image capabilities and loads their protocol thumbnails', async () => {
	const profile = await mkdtemp(join(tmpdir(), 'novelive-settings-'))
	try {
		const { app, page } = await launch(profile, 'image-models/smoke')
		try {
			const image = card(page, '图片模型')
			const smoke = imageSmokeConfig(baseUrl, placeholder)
			await image.getByRole('button', { name: '图片模型' }).click()
			const sizeHint = page
				.getByRole('tooltip')
				.filter({ hasText: '超出部分由本地放大' })
			await expect(sizeHint).toBeHidden()
			await image.getByRole('button', { name: '原生长边上限说明' }).hover()
			await expect(sizeHint).toBeVisible()
			await page.keyboard.press('Escape')
			await expect(sizeHint).toBeHidden()
			const tier = image.getByLabel('放大档位', { exact: true })
			await tier.selectOption('fast')
			await image.getByRole('button', { name: '放大档位说明' }).focus()
			await expect(page.getByRole('tooltip')).toHaveText('低性能机用，画质下降')
			await page.keyboard.press('Escape')
			await tier.selectOption('anime')
			await image.getByLabel('接口地址').fill(smoke.baseUrl)
			await image.getByLabel('模型名').fill(smoke.model)
			await image.getByLabel('API Key').fill(smoke.apiKey)
			await image.getByLabel('生图质量').selectOption(smoke.quality)
			await image
				.getByLabel('原生长边上限', { exact: true })
				.selectOption(String(smoke.nativeMaxEdge))
			await image.getByLabel('后处理').selectOption('off')
			await expect(tier).toBeDisabled()
			await testButton(image).click()
			await expect(image.getByRole('status')).toHaveText('连接成功')
			for (const capability of ['文生图', '透明底', '图片编辑']) {
				const thumbnail = image.getByRole('img', {
					name: `${capability}测试缩略图`,
				})
				await expect(thumbnail).toHaveAttribute('src', /^novelive:\/\/cache\//)
				await expect
					.poll(() =>
						thumbnail.evaluate((node: HTMLImageElement) => node.naturalWidth),
					)
					.toBeGreaterThan(0)
			}
		} finally {
			await app.close()
		}
	} finally {
		await rm(profile, { recursive: true, force: true })
	}
})

test('M0 settings cancels a slow test, reports creator interruption and retests after restart', async () => {
	const profile = await mkdtemp(join(tmpdir(), 'novelive-settings-'))
	try {
		const { app, page } = await launch(profile, 'text-models/synthetic', {
			delay: '400',
		})
		try {
			const region = card(page, '视觉模型')
			await editText(region, '视觉模型', smokeProfiles[0])
			await region.getByRole('button', { name: '保存' }).click()
			await expect(region.getByRole('status')).toHaveText('已保存')
			await testButton(region).click()
			await expect(region.getByRole('status')).toHaveText('正在测试…')
			await region.getByRole('button', { name: '取消' }).click()
			await expect(region.getByRole('status')).toHaveAttribute(
				'data-error-code',
				'cancelled',
			)

			const generation = (
				await page.evaluate(() => window.novelive.host.appState())
			).generation
			await page.evaluate(() => {
				document.body.dataset.sawCreatorBanner = 'false'
				const observer = new MutationObserver(() => {
					if (
						document
							.querySelector('[role="alert"]')
							?.textContent?.includes('创作端已断开')
					) {
						document.body.dataset.sawCreatorBanner = 'true'
						observer.disconnect()
					}
				})
				observer.observe(document.body, { childList: true, subtree: true })
			})
			const pid = await app.evaluate(
				({ app }) =>
					app
						.getAppMetrics()
						.find(
							(process) =>
								process.name === 'Novelive Creator' ||
								process.serviceName === 'Novelive Creator',
						)?.pid,
			)
			if (!pid) throw new Error('No creator process')
			await testButton(region).click()
			await expect(region.getByRole('status')).toHaveText('正在测试…')
			process.kill(pid, 'SIGKILL')
			await expect(region.getByRole('status')).toHaveAttribute(
				'data-error-code',
				'creator_down',
			)
			await expect(page.locator('body')).toHaveAttribute(
				'data-saw-creator-banner',
				'true',
			)
			await expect
				.poll(() => page.evaluate(() => window.novelive.host.appState()))
				.toMatchObject({
					creator: 'ready',
					generation: generation + 1,
				})
			await testButton(region).click()
			await expect(region.getByRole('status')).toHaveText('连接成功')
		} finally {
			await app.close()
		}
	} finally {
		await rm(profile, { recursive: true, force: true })
	}
})

test('M0 settings reports exhausted disconnection in the UI', async () => {
	const profile = await mkdtemp(join(tmpdir(), 'novelive-settings-'))
	try {
		const { app, page } = await launch(profile, 'text-models/synthetic', {
			fault: 'disconnect',
		})
		try {
			const region = card(page, '视觉模型')
			await editText(region, '视觉模型', smokeProfiles[0])
			await testButton(region).click()
			await expect(region.getByRole('status')).toHaveAttribute(
				'data-error-code',
				'network',
			)
			await expect(region.getByRole('status')).toContainText(
				'检查接口地址、API Key 和模型名',
			)
		} finally {
			await app.close()
		}
	} finally {
		await rm(profile, { recursive: true, force: true })
	}
})

test('M0 settings keeps other image results when the edit endpoint is unsupported', async () => {
	const profile = await mkdtemp(join(tmpdir(), 'novelive-settings-'))
	try {
		const { app, page } = await launch(profile, 'image-models')
		try {
			await page.evaluate(
				(config) =>
					window.novelive.call('config.update', {
						models: {
							image: { ...config, model: 'gpt-image-synthetic-edit404' },
						},
					}).promise,
				imageSmokeConfig(baseUrl, placeholder),
			)
			await page.reload()
			const region = card(page, '图片模型')
			await testButton(region).click()
			await expect(region.getByRole('status')).toHaveText(
				'测试完成，请查看各项结果。',
			)
			await expect(
				region.locator('[data-error-code="unsupported"]'),
			).toContainText('图片编辑')
			await expect(
				region.getByRole('img', { name: '透明底测试缩略图' }),
			).toBeVisible()
			await expect(
				region.getByRole('img', { name: '图片编辑测试缩略图' }),
			).toHaveCount(0)
		} finally {
			await app.close()
		}
	} finally {
		await rm(profile, { recursive: true, force: true })
	}
})

test('M0 settings backs up a damaged config before resetting it', async () => {
	const profile = await mkdtemp(join(tmpdir(), 'novelive-settings-'))
	try {
		await writeFile(join(profile, 'config.json'), '{broken with local settings')
		const { app, page } = await launch(profile, 'text-models/smoke')
		try {
			const warning = page
				.getByRole('alert')
				.filter({ hasText: '配置文件无法读取' })
			await expect(warning).toContainText(join(profile, 'config.json'))
			await warning.getByRole('button', { name: '重置配置' }).click()
			await expect(card(page, '快速模型')).toBeVisible()
			const backup = (await readdir(profile)).find((name) =>
				name.startsWith('config.json.bak-'),
			)
			if (!backup) throw new Error('Missing backup')
			expect(await readFile(join(profile, backup), 'utf8')).toBe(
				'{broken with local settings',
			)
		} finally {
			await app.close()
		}
	} finally {
		await rm(profile, { recursive: true, force: true })
	}
})
