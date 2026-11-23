import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
	ClientFrame,
	ProductionSnapshot,
} from '@novelive/creator/contract'
import { _electron as electron, expect, test } from '@playwright/test'

const require = createRequire(
	new URL('../../apps/desktop/package.json', import.meta.url),
)
const workId = '8eff3372-78ab-4d75-804b-1bd609f66f49'
const fixtures = 'tests/fixtures/source/epub/synthetic'

for (const fallback of [false, true]) {
	test(`M4 EPUB screening confirmation (${fallback ? 'fallback' : 'recommendations'})`, async () => {
		const profile = await mkdtemp(join(tmpdir(), 'novelive-epub-confirm-'))
		try {
			const cache = join(profile, 'cache')
			await mkdir(cache, { recursive: true })
			const samples = ['character', 'scene', 'irrelevant']
			await Promise.all(
				samples.map((sample) =>
					copyFile(
						join(fixtures, `${sample}.png`),
						join(cache, `${sample}.png`),
					),
				),
			)
			const candidates = samples.map((sample, index) => ({
				id: `illustration-${index + 1}`,
				cachePath: `${sample}.png`,
			}))
			const snapshot: ProductionSnapshot = {
				workId,
				title: 'EPUB 插图筛选',
				phase: 'confirm-visual',
				status: 'confirm',
				chapters: [],
				visual: {
					mainVisuals: candidates.map((candidate, index) => ({
						...candidate,
						id: `visual-${index + 1}`,
					})),
					supplemental: [],
					characters: [],
					importedIllustrations: {
						candidates,
						fallback,
						recommended: fallback ? [] : ['illustration-1', 'illustration-2'],
						selected: [],
					},
				},
			}
			const app = await electron.launch({
				executablePath: require('electron'),
				args: ['apps/desktop', `--user-data-dir=${profile}`],
				env: { ...process.env, ELECTRON_RENDERER_URL: '', NL_REPLAY: 'strict' },
			})
			try {
				const page = await app.firstWindow()
				await expect(page.getByText('创作端已就绪')).toBeAttached()
				await app.evaluate(({ BrowserWindow, MessageChannelMain }, result) => {
					const [window] = BrowserWindow.getAllWindows()
					window.setContentSize(1280, 980)
					const { port1, port2 } = new MessageChannelMain()
					const generation = 200
					port1.on('message', ({ data }: { data: ClientFrame }) => {
						if (data.type !== 'call') return
						if (data.command === 'production.get') {
							port1.postMessage({
								type: 'result',
								generation,
								requestId: data.requestId,
								result,
							})
						} else {
							port1.postMessage({
								type: 'error',
								generation,
								requestId: data.requestId,
								error: { code: 'unsupported', message: 'Test projection' },
							})
						}
					})
					port1.start()
					window.webContents.postMessage('novelive:port', generation, [port2])
					window.webContents.send('novelive:ready', { generation })
				}, snapshot)
				await page.evaluate((id) => {
					location.hash = `/work/${id}/confirm/visual`
				}, workId)
				const main = page.getByRole('group', { name: '主视觉', exact: true })
				const other = main.getByRole('radio', {
					name: 'EPUB 插图 3',
					exact: true,
				})
				if (fallback) {
					await expect(
						page.getByText('未能筛选 EPUB 插图，已显示全部插图，可手动选择。'),
					).toBeVisible()
					await expect(main.getByRole('radio')).toHaveCount(6)
					await expect(main.locator(':checked')).toHaveCount(0)
				} else {
					await expect(
						main.getByRole('radio', {
							name: '推荐 · EPUB 插图 1',
							exact: true,
						}),
					).toBeChecked()
					await expect(
						page.getByRole('checkbox', {
							name: '推荐 · EPUB 插图 2',
							exact: true,
						}),
					).toBeChecked()
					await expect(other).toHaveCount(0)
					await page.getByRole('button', { name: '显示全部 EPUB 插图' }).click()
					await expect(other).toBeVisible()
				}
				await other.check()
				await expect(other).toBeChecked()
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
				const evidence = process.env.NL_EPUB_UI_EVIDENCE
				if (evidence) {
					await page.evaluate(() => document.fonts.ready)
					await page.screenshot({
						path: join(
							evidence,
							`02-epub-${fallback ? 'fallback' : 'override'}.png`,
						),
						animations: 'disabled',
					})
				}
			} finally {
				await app.close()
			}
		} finally {
			await rm(profile, { recursive: true, force: true })
		}
	})
}
