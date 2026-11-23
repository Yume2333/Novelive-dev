import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	_electron as electron,
	expect,
	type Page,
	test,
} from '@playwright/test'
import sharp from 'sharp'
import {
	candidateColors,
	installProjection,
	workId,
} from '../fixtures/creation-ui/projection'

const require = createRequire(
	new URL('../../apps/desktop/package.json', import.meta.url),
)

async function launch(profile: string) {
	const app = await electron.launch({
		executablePath: require('electron'),
		args: ['apps/desktop', `--user-data-dir=${profile}`],
		env: { ...process.env, ELECTRON_RENDERER_URL: '', NL_REPLAY: 'strict' },
	})
	const page = await app.firstWindow()
	await expect(page.getByText('创作端已就绪')).toBeAttached()
	return { app, page }
}

async function capture(page: Page, name: string) {
	const evidence = process.env.NL_CREATION_UI_EVIDENCE
	if (evidence)
		await page.screenshot({
			path: join(evidence, `07-${name}.jpg`),
			type: 'jpeg',
			quality: 75,
		})
}

test('M1b creation surfaces show the two gates, blocked chapters and live records', async () => {
	const profile = await mkdtemp(join(tmpdir(), 'novelive-creation-ui-'))
	try {
		const cache = join(profile, 'cache', 'creation-ui')
		await mkdir(cache, { recursive: true })
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
		const { app, page } = await launch(profile)
		try {
			const fixture = await installProjection(app)
			await page.evaluate((id) => {
				location.hash = `#/work/${id}`
			}, workId)
			await expect(
				page.getByRole('heading', { name: '白塔来信' }),
			).toBeVisible()
			await expect(
				page.getByRole('navigation', { name: '作品导航' }).getByRole('link'),
			).toHaveText(['概览', '游玩', '制作', '编辑', '设定集'])
			await page.getByRole('link', { name: '选择主视觉' }).click()
			const matting = page
				.getByRole('status')
				.filter({ hasText: '本地去背景不可用' })
			await expect(matting).toBeVisible()
			const dismissMatting = page.getByRole('button', { name: '关闭提示' })
			await expect(dismissMatting.locator('svg')).toHaveAttribute(
				'stroke-width',
				'1.8',
			)
			await page.getByRole('button', { name: '关闭提示' }).click()
			await expect(matting).toHaveCount(0)
			const main = page.getByRole('group', { name: '主视觉', exact: true })
			await expect(main.getByRole('radio')).toHaveCount(3)
			await expect
				.poll(() =>
					main
						.locator('img')
						.evaluateAll((images) =>
							images.every(
								(image) =>
									image instanceof HTMLImageElement &&
									image.complete &&
									image.naturalWidth > 0,
							),
						),
				)
				.toBe(true)
			const confirm = page.getByRole('button', { name: '确认并制作第一章' })
			await expect(confirm).toBeDisabled()
			await main.getByText('方案 2').click()
			await expect(confirm).toBeDisabled()
			await capture(page, 'visual-confirmation')
			await page
				.getByRole('group', { name: '守塔人 · 旧外套' })
				.getByText('方案 3')
				.click()
			const references = page.getByRole('group', {
				name: '补充画风参考（最多两张）',
			})
			await references.getByText('方案 1').click()
			await references.getByText('方案 2').click()
			await expect(
				references.getByRole('checkbox', { name: '方案 3' }),
			).toBeDisabled()
			await confirm.click()
			await expect(
				page.getByRole('heading', { name: '制作', exact: true }),
			).toBeVisible()
			await expect(page.getByText('写剧本', { exact: true })).toBeVisible()
			expect(await fixture.calls('production.confirmVisual')).toEqual([
				{
					workId,
					mainVisualId: 'visual-2',
					characters: [
						{
							characterId: 'keeper',
							costumeId: 'coat',
							candidateId: 'portrait-3',
						},
					],
					supplementalIds: ['reference-1', 'reference-2'],
				},
			])

			await fixture.publish('first')
			await page.getByRole('link', { name: '确认第一章' }).click()
			await expect(
				page.getByRole('region', { name: '第一章成品' }),
			).toContainText('已发布')
			await expect(
				page.getByRole('region', { name: '第一章成品' }),
			).toContainText('需要处理')
			await expect(
				page.getByRole('link', { name: '试玩第一章' }),
			).toHaveAttribute('href', `#/work/${workId}/play`)
			expect(await fixture.calls('production.continue')).toEqual([])
			await capture(page, 'first-confirmation')
			await page.getByRole('button', { name: '继续制作' }).click()
			const failed = page.getByRole('listitem', { name: '潮汐' })
			await expect(failed).toContainText('写手请求超时')
			await expect(
				page.getByRole('region', { name: '制作状态' }),
			).toContainText('待确认')
			await expect(page.getByRole('button', { name: '继续制作' })).toHaveCount(
				0,
			)
			await failed.hover()
			await failed.getByRole('button', { name: '运行记录' }).click()
			const records = failed.getByRole('region', { name: '章节运行记录' })
			await expect(records).toContainText('第二章写手请求超时')
			await expect(records).not.toContainText('第一章剧本生成完成')
			await expect(records).not.toContainText('其他作品的记录')
			await records.getByText('详情', { exact: true }).click()
			await expect(records.getByText('重试将重新运行写剧本')).toBeVisible()
			await capture(page, 'production-records')
			await failed.getByRole('button', { name: '重试' }).click()
			await expect(records).toContainText('重试已启动')
			await expect(failed).toContainText('出图')
			expect(await fixture.calls('production.retryChapter')).toEqual([
				{ workId, chapterId: 'two' },
			])
			await page.getByRole('button', { name: '立即停止' }).click()
			await expect(
				page.getByRole('region', { name: '制作状态' }),
			).toContainText('已停止')
			await page.getByRole('button', { name: '继续制作' }).click()
			await expect(failed).toContainText('出图')
			await fixture.publish('finished')
			await expect(failed).toContainText('已发布')
			await expect(
				page.getByRole('region', { name: '制作状态' }),
			).toContainText('已发布 2 / 2 章')
		} finally {
			await app.close()
		}
	} finally {
		await rm(profile, { recursive: true, force: true })
	}
})

test('M1b creation surfaces persist role models and writer presets through the creator', async () => {
	const profile = await mkdtemp(join(tmpdir(), 'novelive-creation-settings-'))
	try {
		const { app, page } = await launch(profile)
		try {
			await page.getByRole('link', { name: '设置' }).click()
			const advanced = page.getByRole('button', { name: '高级设置' })
			await advanced.click()
			const roles = page.getByRole('region', { name: '角色模型配置' })
			await expect(roles.getByRole('combobox')).toHaveCount(10)
			await expect(
				roles.getByRole('combobox', { name: 'EPUB 插图筛选' }),
			).toHaveValue('visual')
			const writer = roles.getByRole('combobox', { name: '写手模型' })
			await expect(writer).toHaveValue('writing')
			await writer.selectOption('main')
			await expect(writer).toHaveValue('main')
			const presets = page.getByRole('region', { name: '写手预设' })
			await presets.getByRole('button', { name: '新建预设' }).click()
			const editor = page.getByRole('form', { name: '编辑写手预设' })
			await editor.getByLabel('预设名称').fill('灯塔文风')
			await editor.getByLabel('文风说明').fill('短句，克制留白。')
			await editor.getByLabel('温度').fill('0.7')
			await editor.getByRole('button', { name: '添加替换规则' }).click()
			await editor.getByLabel('查找 1').fill('……')
			await editor.getByLabel('替换为 1').fill('…')
			await editor.getByRole('button', { name: '保存预设' }).click()
			await presets.getByRole('button', { name: '设为默认' }).click()
			await expect(presets).toContainText('灯塔文风全局默认')

			await page.reload()
			await advanced.click()
			await expect(writer).toHaveValue('main')
			await expect(presets).toContainText('灯塔文风全局默认')
			await presets
				.getByText('灯塔文风', { exact: true })
				.locator('..')
				.getByRole('button', { name: '编辑' })
				.click()
			await expect(editor.getByLabel('文风说明')).toHaveValue(
				'短句，克制留白。',
			)
			await expect(editor.getByLabel('温度')).toHaveValue('0.7')
			await expect(editor.getByLabel('替换为 1')).toHaveValue('…')
			await expect(editor.getByLabel('查找 1')).toHaveValue('……')
			await editor.getByRole('button', { name: '取消' }).click()
			await presets
				.getByText('写手预设', { exact: true })
				.scrollIntoViewIfNeeded()
			await capture(page, 'advanced-settings')
		} finally {
			await app.close()
		}
	} finally {
		await rm(profile, { recursive: true, force: true })
	}
})
