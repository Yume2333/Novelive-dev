import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { Project } from '../../packages/creator/src/project'
import { joinSeries } from '../../packages/creator/src/project/series'
import { configuration } from '../fixtures/cassettes/m1b-gate/fixture'

const require = createRequire(
	new URL('../../apps/desktop/package.json', import.meta.url),
)

test('M4 global production drawer shows paused rows, refetches and reorders a seeded two-work queue', async () => {
	const root = await mkdtemp(join(tmpdir(), 'novelive-global-queue-'))
	const profile = join(root, 'profile')
	const projectDir = join(root, 'project')
	await mkdir(join(profile, 'projects'), { recursive: true })
	const works = []
	const chapters = []
	{
		using project = await Project.create(projectDir, {
			formatVersion: 1,
			seriesId: 'series',
			title: '队列工程',
			volumeIds: [],
		})
		for (const title of ['排队甲', '排队乙']) {
			const result = await joinSeries(project, {
				title,
				language: 'zh-CN',
				chapters: [{ title: '第一章', paragraphs: ['她推开了门。'] }],
			})
			project.tasks.registerWork({ workId: result.workId, title })
			project.database
				.prepare(
					"UPDATE work SET status = 'paused', pause_reason = 'crashed' WHERE work_id = ?",
				)
				.run(result.workId)
			await writeFile(join(profile, 'projects', result.workId), projectDir)
			works.push(result.workId)
			chapters.push(result.chapterIds[0])
		}
	}
	const app = await electron.launch({
		executablePath: require('electron'),
		args: ['apps/desktop', `--user-data-dir=${profile}`],
		env: { ...process.env, ELECTRON_RENDERER_URL: '', NL_REPLAY: 'strict' },
	})
	try {
		await app.evaluate(({ BrowserWindow }) =>
			BrowserWindow.getAllWindows()[0].setContentSize(1280, 900),
		)
		const page = await app.firstWindow()
		await expect(
			page.getByRole('status').filter({ hasText: /^创作端已就绪$/ }),
		).toHaveText('创作端已就绪')
		await page.evaluate(
			(patch) => window.novelive.call('config.update', patch).promise,
			{
				models: {
					...configuration.models,
					fast: { ...configuration.models.fast, model: '' },
				},
			},
		)
		await page.getByRole('button', { name: /全局制作状态/ }).click()
		const drawer = page.getByRole('dialog', { name: '制作队列' })
		await expect(drawer.getByText('异常退出后已暂停')).toHaveCount(2)
		await expect(drawer.getByRole('link', { name: '排队甲' })).toBeVisible()
		const first = drawer
			.getByRole('listitem')
			.filter({ has: page.getByRole('link', { name: '排队甲' }) })
		await first.getByRole('button', { name: '继续制作' }).click()
		await expect(drawer.getByRole('alert')).toHaveText(
			'模型配置无效，请在设置中检查接口地址、API Key、模型名和上下文长度。',
		)
		await page.evaluate(
			(patch) => window.novelive.call('config.update', patch).promise,
			configuration,
		)
		const sequel = drawer
			.getByRole('listitem')
			.filter({ has: page.getByRole('link', { name: '排队乙' }) })
		await sequel.getByRole('button', { name: '继续制作' }).click()
		await expect(drawer.getByRole('alert')).toHaveText(
			'请先继续制作前卷：排队甲',
		)
		await expect(drawer.getByText('异常退出后已暂停')).toHaveCount(2)
		{
			using project = await Project.open(projectDir)
			const insertChapter = project.database.prepare(
				'INSERT INTO chapter(work_id, chapter_id, ord) VALUES (?, ?, 1)',
			)
			for (const [index, workId] of works.entries())
				insertChapter.run(workId, chapters[index])
			project.database
				.prepare("UPDATE work SET pause_reason = 'stopped' WHERE work_id = ?")
				.run(works[0])
		}
		const before = await page.evaluate(() => window.novelive.host.appState())
		await page.evaluate(() => window.novelive.host.restartCreator())
		await expect
			.poll(
				async () =>
					(await page.evaluate(() => window.novelive.host.appState()))
						.generation,
			)
			.toBeGreaterThan(before.generation)
		await expect(drawer.getByText('异常退出后已暂停')).toHaveCount(1)
		await expect(drawer.getByText('已暂停', { exact: true })).toHaveCount(1)
		await page
			.getByRole('dialog', { name: '制作队列' })
			.getByRole('button', { name: '关闭', exact: true })
			.click()
		for (const workId of works)
			await page.evaluate(
				(workId) => window.novelive.call('production.get', { workId }).promise,
				workId,
			)
		{
			using project = await Project.open(projectDir)
			project.database
				.prepare("UPDATE work SET status = 'queued', pause_reason = NULL")
				.run()
		}
		await page.getByRole('button', { name: /全局制作状态/ }).click()
		const queued = drawer.getByRole('list', { name: '排队中' })
		await expect(queued.getByRole('link')).toHaveText(['排队甲', '排队乙'])
		await drawer.getByRole('button', { name: '提前：排队乙' }).click()
		await expect(queued.getByRole('link')).toHaveText(['排队乙', '排队甲'])
		const order = await page.evaluate(
			() => window.novelive.call('production.getQueue', {}).promise,
		)
		expect(order.queued.map((item) => item.title)).toEqual(['排队乙', '排队甲'])
		await page.screenshot({
			path: '.workflow/evidence/m4-longform/b1-production-queue.png',
			animations: 'disabled',
		})
		await page.keyboard.press('Escape')
		await expect(drawer).not.toBeVisible()
	} finally {
		await app.evaluate(({ dialog }) => {
			dialog.showMessageBox = async () => ({
				response: 1,
				checkboxChecked: false,
			})
		})
		await app.close()
		await rm(root, { recursive: true, force: true })
	}
})
