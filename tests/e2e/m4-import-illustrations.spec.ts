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
import { illustratedBook } from '../fixtures/source/illustrations'

const require = createRequire(
	new URL('../../apps/desktop/package.json', import.meta.url),
)

for (const format of ['epub', 'docx'] as const) {
	test(`M4 illustration selection persists only the chosen ${format} candidate in real Electron`, async () => {
		const root = await mkdtemp(join(tmpdir(), 'novelive-illustrations-'))
		const projects = join(root, 'projects')
		const source = join(root, `插图.${format}`)
		const missing = join(root, 'missing.jsonl')
		await mkdir(projects)
		await writeFile(source, await illustratedBook(format, 4))
		const app = await electron.launch({
			executablePath: require('electron'),
			args: ['apps/desktop', `--user-data-dir=${join(root, 'profile')}`],
			env: {
				...process.env,
				ELECTRON_RENDERER_URL: '',
				NL_REPLAY: 'strict',
				NL_REPLAY_MISSING_LOG: missing,
			},
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
				[source, projects],
			)
			const page = await app.firstWindow()
			await expect(page.getByRole('status')).toHaveText('创作端已就绪')
			await page.getByRole('link', { name: '导入原文' }).click()
			await page.getByRole('button', { name: '选择原文', exact: true }).click()
			await page.getByRole('button', { name: '选择文件夹' }).click()
			await page.getByRole('button', { name: '导入', exact: true }).click()
			await expect(
				page.getByRole('heading', { name: '核对导入' }),
			).toBeVisible()
			const candidates = page.getByRole('group', {
				name: '插图参考（最多 3 张）',
			})
			const checks = candidates.getByRole('checkbox')
			await expect(checks).toHaveCount(4)
			for (const check of await checks.all())
				await expect(check).not.toBeChecked()
			await expect
				.poll(() =>
					candidates
						.locator('img')
						.evaluateAll((images) =>
							images.every(
								(image) => (image as HTMLImageElement).naturalWidth > 0,
							),
						),
				)
				.toBe(true)
			await checks.nth(0).check()
			await checks.nth(1).check()
			await checks.nth(2).check()
			await expect(checks.nth(3)).toBeDisabled()
			await checks.nth(0).uncheck()
			await checks.nth(2).uncheck()
			await expect(checks.nth(3)).toBeEnabled()
			await candidates.scrollIntoViewIfNeeded()
			await page.screenshot({
				path: `.workflow/evidence/m4-longform/a2-${format}-selection.png`,
				animations: 'disabled',
			})
			await page
				.getByRole('button', {
					name: format === 'epub' ? '确认' : '跳过核对',
					exact: true,
				})
				.click()
			const projectDir = join(projects, '插图')
			await expect
				.poll(
					async () =>
						JSON.parse(
							await readFile(
								join(projectDir, 'source/import-report.json'),
								'utf8',
							),
						).selectedIllustrations,
				)
				.toEqual(['illustration-2'])
			const report = JSON.parse(
				await readFile(join(projectDir, 'source/import-report.json'), 'utf8'),
			)
			expect(report.references).toEqual([
				'source/references/illustration-2.png',
			])
			expect(await readdir(join(projectDir, 'source/references'))).toEqual([
				'illustration-2.png',
			])
			expect(
				(await readFile(join(projectDir, report.references[0])))
					.subarray(0, 8)
					.toString('hex'),
			).toBe('89504e470d0a1a0a')
			expect(await readFile(missing, 'utf8').catch(() => '')).toBe('')
		} finally {
			await app.close()
			await rm(root, { recursive: true, force: true })
		}
	})
}
