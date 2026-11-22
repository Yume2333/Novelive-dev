import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import sharp from 'sharp'
import { playerWorkId, seedPlayerProject } from '../fixtures/minimal-player'

const require = createRequire(
	new URL('../../apps/desktop/package.json', import.meta.url),
)

test('M1b minimal player renders local compiled beats and advances all four text kinds', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'novelive-minimal-player-'))
	try {
		const root = join(directory, 'project')
		const png = (color: string) =>
			sharp({
				create: { width: 32, height: 128, channels: 3, background: color },
			})
				.png()
				.toBuffer()
		await seedPlayerProject(root, await png('#203060'), await png('#e06030'))
		const app = await electron.launch({
			executablePath: require('electron'),
			args: ['apps/desktop', `--user-data-dir=${join(directory, 'profile')}`],
			env: { ...process.env, ELECTRON_RENDERER_URL: '', NL_REPLAY: 'strict' },
		})
		try {
			const page = await app.firstWindow()
			await expect(page).toHaveURL(/^file:.*\/out\/renderer\/index\.html$/)
			await expect(page.getByRole('status')).toHaveText('创作端已就绪')
			await app.evaluate(({ dialog }, path) => {
				dialog.showOpenDialog = async () => ({
					canceled: false,
					filePaths: [path],
				})
			}, root)
			await page.evaluate((id) => {
				window.location.hash = `/work/${id}/play`
			}, playerWorkId)
			await page.getByRole('button', { name: '打开本地工程' }).click()
			const canvas = page.locator('.nl-player canvas')
			const text = page.locator('.nl-player-textbox')
			await expect(text).toHaveAttribute('data-kind', 'dialogue')
			await expect(text.locator('.nl-player-name')).toHaveText('旅人')
			await expect(text.locator('.nl-player-text')).toHaveText('你好，世界。')
			await expect(page.locator('aside')).toHaveCount(0)
			async function at(x: number, y: number) {
				const pixels = await sharp(await canvas.screenshot())
					.raw()
					.toBuffer({ resolveWithObject: true })
				const offset =
					(Math.floor(pixels.info.height * y) * pixels.info.width +
						Math.floor(pixels.info.width * x)) *
					pixels.info.channels
				return Array.from(pixels.data.subarray(offset, offset + 3))
			}
			await expect.poll(() => at(0.02, 0.02)).toEqual([32, 48, 96])
			await expect.poll(() => at(0.5, 0.4)).toEqual([224, 96, 48])
			const evidence = '.workflow/evidence/m1b-production'
			await mkdir(evidence, { recursive: true })
			await page.screenshot({ path: `${evidence}/05-minimal-player.png` })
			const advance = () => canvas.click({ position: { x: 20, y: 20 } })
			await advance()
			await expect(text).toHaveAttribute('data-kind', 'inner')
			await expect(text.locator('.nl-player-name')).toHaveText('听者')
			await expect(text.locator('.nl-player-text')).toHaveText('我在想什么？')
			await expect(text).toHaveCSS('font-style', 'italic')
			await advance()
			await expect(text).toHaveAttribute('data-kind', 'narration')
			await expect(text.locator('.nl-player-name')).toHaveCount(0)
			await expect(text).toHaveText('风从窗边吹过。')
			await advance()
			await expect(text).toHaveCount(0)
			await expect(
				page.locator('.nl-player-caption[data-kind="caption"]'),
			).toHaveText('黄昏时分')
			await advance()
			await expect(text).toHaveText('屋子静了。')
			await expect.poll(() => at(0.5, 0.4)).toEqual([32, 48, 96])
			await advance()
			await expect(page.locator('.nl-player-overlay')).toHaveText('本章结束')
		} finally {
			await app.close()
		}
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})
