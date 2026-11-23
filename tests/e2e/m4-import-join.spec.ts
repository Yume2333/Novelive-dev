import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const require = createRequire(
	new URL('../../apps/desktop/package.json', import.meta.url),
)

test('M4 wizard joins a second book to an existing series in real Electron', async () => {
	const root = await mkdtemp(join(tmpdir(), 'novelive-join-ui-'))
	const projects = join(root, 'projects')
	const first = join(root, '已有系列.md')
	const second = join(root, '第二本.md')
	const projectDir = join(projects, '已有系列')
	await mkdir(projects)
	await writeFile(first, '# 第一卷\n\n## 第一章\n\n她推开门。')
	await writeFile(
		second,
		'# 第二卷 远行\n\n## 第二章\n\n她离开门前。\n\n# 第三卷 归来\n\n## 第三章\n\n她回到门前。',
	)
	const app = await electron.launch({
		executablePath: require('electron'),
		args: ['apps/desktop', `--user-data-dir=${join(root, 'profile')}`],
		env: { ...process.env, ELECTRON_RENDERER_URL: '', NL_REPLAY: 'strict' },
	})
	try {
		await app.evaluate(
			({ dialog, BrowserWindow }, answers) => {
				dialog.showOpenDialog = async () => ({
					canceled: false,
					filePaths: [answers.shift() ?? ''],
				})
				BrowserWindow.getAllWindows()[0].setContentSize(1280, 1000)
			},
			[first, projects, second, root, projectDir],
		)
		const page = await app.firstWindow()
		await expect(page.getByRole('status')).toHaveText('创作端已就绪')
		await page.getByRole('link', { name: '导入原文' }).click()
		await page.getByRole('button', { name: '选择原文', exact: true }).click()
		await page.getByRole('button', { name: '选择文件夹' }).click()
		await page.getByRole('button', { name: '导入', exact: true }).click()
		await expect(page.getByRole('heading', { name: '核对导入' })).toBeVisible()
		await page.getByRole('button', { name: '确认', exact: true }).click()
		await expect(page).toHaveURL(/#\/work\/[0-9a-f-]+$/)
		await page.getByRole('link', { name: '书库', exact: true }).click()
		await page.getByRole('link', { name: '导入原文' }).click()
		await page.getByRole('button', { name: '选择原文', exact: true }).click()
		await page.getByRole('radio', { name: '加入已有系列' }).check()
		await expect(page.getByRole('textbox', { name: '作品名' })).toHaveCount(0)
		await page.getByRole('button', { name: '选择已有工程' }).click()
		await expect(page.getByRole('alert')).toHaveText(
			'请选择有效的 Novelive 工程文件夹',
		)
		await expect(
			page.getByRole('button', { name: '导入', exact: true }),
		).toBeDisabled()
		await page.getByRole('button', { name: '选择已有工程' }).click()
		await expect(
			page.getByRole('combobox', { name: '系列', exact: true }),
		).toHaveValue('series')
		const before = JSON.parse(
			await readFile(join(projectDir, 'series.json'), 'utf8'),
		)
		const original = await readFile(join(projectDir, 'source/original.md'))
		await page.getByRole('button', { name: '导入', exact: true }).click()
		await expect(
			page.getByRole('heading', { name: '已加入系列' }),
		).toBeVisible()
		await expect(page.getByRole('region', { name: '新增卷' })).toContainText(
			'第二卷 远行',
		)
		await expect(page.getByRole('region', { name: '新增卷' })).toContainText(
			'第三卷 归来',
		)
		await expect(
			page
				.getByRole('region', { name: '新增卷' })
				.getByText('1 章', { exact: true }),
		).toHaveCount(2)
		await page.screenshot({
			path: '.workflow/evidence/m4-longform/a3-joined-volumes.png',
			animations: 'disabled',
		})
		const after = JSON.parse(
			await readFile(join(projectDir, 'series.json'), 'utf8'),
		)
		expect(after.volumeIds.slice(0, before.volumeIds.length)).toEqual(
			before.volumeIds,
		)
		expect(after.volumeIds).toHaveLength(before.volumeIds.length + 2)
		for (const volumeId of after.volumeIds.slice(before.volumeIds.length)) {
			const volume = JSON.parse(
				await readFile(
					join(projectDir, `volumes/${volumeId}/volume.json`),
					'utf8',
				),
			)
			for (const workId of volume.workIds) {
				expect(
					await readFile(join(root, 'profile/projects', workId), 'utf8'),
				).toBe(projectDir)
			}
			expect(
				await readFile(
					join(projectDir, `source/imports/${volumeId}/original.md`),
				),
			).toEqual(await readFile(second))
		}
		expect(await readFile(join(projectDir, 'source/original.md'))).toEqual(
			original,
		)
		expect(await readdir(projects)).toEqual(['已有系列'])
		await page.getByRole('button', { name: '进入作品' }).click()
		await expect(page).toHaveURL(/#\/work\/[0-9a-f-]+$/)
	} finally {
		await app.close()
		await rm(root, { recursive: true, force: true })
	}
})
