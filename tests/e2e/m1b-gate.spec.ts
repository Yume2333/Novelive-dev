import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
	_electron as electron,
	expect,
	type Page,
	test,
} from '@playwright/test'
import {
	combineCassettes,
	configuration,
	original,
} from '../fixtures/cassettes/m1b-gate/fixture'

const require = createRequire(
	new URL('../../apps/desktop/package.json', import.meta.url),
)

async function capture(page: Page, name: string) {
	const nativeScroll = await page.evaluate(() =>
		[...document.querySelectorAll<HTMLElement>('*')]
			.filter(
				(el) => el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1,
			)
			.filter((el) => {
				const style = getComputedStyle(el)
				return (
					['auto', 'scroll'].includes(style.overflowY) &&
					style.scrollbarWidth !== 'none' &&
					getComputedStyle(el, '::-webkit-scrollbar').display !== 'none'
				)
			})
			.map((el) => el.className),
	)
	expect(nativeScroll).toEqual([])
	const evidence = process.env.NL_M1B_GATE_EVIDENCE
	if (evidence)
		await page.screenshot({
			path: join(evidence, `${name}.png`),
			animations: 'disabled',
		})
}

test('M1b make and play publishes through both confirmation points in real Electron', async () => {
	test.setTimeout(75_000)
	const root = await mkdtemp(join(tmpdir(), 'novelive-m1b-gate-'))
	try {
		const source = join(root, '纸船与灯火.txt')
		const projects = join(root, 'projects')
		const cassette = join(root, 'cassette')
		await mkdir(projects)
		await mkdir(cassette)
		await writeFile(source, original)
		await combineCassettes(cassette)
		const app = await electron.launch({
			executablePath: require('electron'),
			args: ['apps/desktop', `--user-data-dir=${join(root, 'profile')}`],
			env: {
				...process.env,
				ELECTRON_RENDERER_URL: '',
				NL_REPLAY: 'strict',
				NL_CASSETTE_DIR: cassette,
				NL_REPLAY_DELAY_MS: '35',
			},
		})
		try {
			await app.evaluate(
				({ dialog, BrowserWindow }, answers) => {
					dialog.showOpenDialog = async () => ({
						canceled: false,
						filePaths: [answers.shift() ?? ''],
					})
					BrowserWindow.getAllWindows()[0].setContentSize(1280, 800)
				},
				[source, projects],
			)
			const page = await app.firstWindow()
			await expect(page.getByText('创作端已就绪')).toBeAttached()
			await page.evaluate(
				(patch) => window.novelive.call('config.update', patch).promise,
				configuration,
			)
			await page.getByRole('link', { name: '导入原文' }).click()
			await page.getByRole('button', { name: '选择原文' }).click()
			await page.getByRole('button', { name: '选择文件夹' }).click()
			await page.getByRole('button', { name: '导入', exact: true }).click()
			await expect(
				page.getByRole('heading', { name: '核对导入' }),
			).toBeVisible()
			await capture(page, '01-import')
			const project = join(projects, '纸船与灯火')
			function published() {
				using db = new DatabaseSync(join(project, 'project.db'), {
					readOnly: true,
				})
				return db
					.prepare(
						"SELECT chapter_id FROM chapter WHERE user_state = 'published' ORDER BY ord",
					)
					.all()
					.map(({ chapter_id }) => chapter_id)
			}
			expect(await readFile(join(project, 'source/original.txt'), 'utf8')).toBe(
				original,
			)
			await page.getByRole('button', { name: '跳过核对' }).click()
			await page
				.getByRole('link', { name: '选择主视觉' })
				.click({ timeout: 25_000 })
			await expect(
				page.getByRole('heading', { name: '确认角色与主视觉' }),
			).toBeVisible()
			const visuals = page.getByRole('group', { name: '主视觉', exact: true })
			const costume = page.getByRole('group', { name: /Ada/ })
			await expect(visuals.getByRole('radio')).toHaveCount(3)
			await expect(costume.getByRole('radio')).toHaveCount(3)
			await expect
				.poll(() =>
					page
						.locator('fieldset img')
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
			await visuals.getByRole('radio').first().check()
			await costume.getByRole('radio').first().check()
			await capture(page, '02-confirm-visual')
			await page.getByRole('button', { name: '确认并制作第一章' }).click()
			await page.getByRole('button', { name: '立即停止' }).click()
			await page.getByRole('button', { name: '继续制作' }).click()
			await page
				.getByRole('link', { name: '确认第一章' })
				.click({ timeout: 20_000 })
			await expect(page.getByText(/确认点 2/)).toBeVisible()
			await expect(page.getByText('已发布', { exact: true })).toBeVisible()
			expect(published()).toEqual(['ch0001'])
			await capture(page, '03-confirm-first')
			await page.getByRole('link', { name: '试玩第一章' }).click()
			await expect(page.getByText('暮色中，一只纸船从桥下漂过。')).toBeVisible()
			await expect(page.locator('canvas')).toBeVisible()
			await capture(page, '04-play-chapter-one')
			await page.goBack()
			await page.getByRole('button', { name: '继续制作' }).click()
			const second = page.getByRole('listitem').filter({ hasText: '灯火' })
			await expect(second.getByRole('button', { name: '重试' })).toBeVisible()
			await expect(second.getByText(/\[invalid_config\]/)).toBeVisible()
			await second.getByRole('button', { name: '重试' }).click()
			await expect(second.getByText('已发布', { exact: true })).toBeVisible({
				timeout: 20_000,
			})
			await expect(second.getByText('需要处理', { exact: true })).toBeVisible()
			await expect(second.getByText('1 张图用了占位图')).toBeVisible()
			await expect(second.getByText(/\[invalid_config\]/)).toHaveCount(0)
			await expect(
				page.getByText('1 章需要处理', { exact: true }),
			).toBeVisible()
			await expect(page.getByText(/制作已暂停/)).toHaveCount(0)
			await second.getByRole('button', { name: '运行记录' }).click()
			await expect(
				second
					.getByRole('region', { name: '章节运行记录' })
					.getByText('运行失败'),
			).toBeVisible()
			await capture(page, '05-chapter-two-published')
			expect(published()).toEqual(['ch0001', 'ch0002'])
			const registry = JSON.parse(
				await readFile(join(project, 'assets/asset-registry.json'), 'utf8'),
			)
			expect(registry.entries).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ id: 'room/day', status: 'drawn' }),
					expect.objectContaining({ id: 'room/night', status: 'placeholder' }),
				]),
			)
		} finally {
			await app.close()
		}
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})
