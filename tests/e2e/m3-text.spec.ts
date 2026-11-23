import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import sharp from 'sharp'
import { Project } from '../../packages/creator/src/project'
import { projectFiles } from '../../packages/format/src/model'
import { textTiming } from '../../packages/player/src/text/timing'
import {
	playerRef,
	playerWorkId,
	seedPlayerProject,
} from '../fixtures/minimal-player'

const require = createRequire(
	new URL('../../apps/desktop/package.json', import.meta.url),
)

test('M3 text typography timing units: empty, instant, nested speed and pauses', () => {
	expect(textTiming([], 30)).toEqual({ delays: [], trailingPause: 0 })
	expect(textTiming([{ type: 'text', text: '春🌸' }], 0)).toEqual({
		delays: [0, 0],
		trailingPause: 0,
	})
	expect(
		textTiming(
			[
				{ type: 'pause', seconds: 0.2 },
				{ type: 'open', name: 'speed', argument: '2' },
				{ type: 'text', text: '春' },
				{ type: 'open', name: 'speed', argument: '3' },
				{ type: 'text', text: '天' },
				{ type: 'close', name: 'speed' },
				{ type: 'close', name: 'speed' },
				{ type: 'text', text: '。' },
				{ type: 'pause', seconds: 1 },
			],
			60,
		),
	).toEqual({ delays: [230, 10, 60], trailingPause: 1000 })
})

test('M3 text typography: stable CJK, ruby, pauses, speed segments, tags and three-line pages', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'novelive-m3-text-'))
	const root = join(directory, 'project')
	const png = await sharp({
		create: { width: 32, height: 32, channels: 3, background: '#203060' },
	})
		.png()
		.toBuffer()
	try {
		await seedPlayerProject(root, png, png)
		{
			using project = await Project.open(root)
			await project.writeFile(
				projectFiles.scene(playerRef, 'aaaabbbb'),
				`scene 空屋\nsource p0001\n: 春{wait 2}{ruby chūn tiān}春{wait 1}天{/ruby}{speed 0.2}{b}「山川、河流与风，静静地等待旅人。」${'山川与河流，正在等待春天。'.repeat(30)}{/b}{/speed}\n: {speed 0.2}慢慢{/speed}{wait 1}{speed 10}快快快快快快快快快快{/speed} cont\n: {speed 100}${'自动翻页，风从山间吹过。'.repeat(9)}{/speed} cont\n: {speed 0.1}点击补全后等第二次点击。{/speed} cont\n: 结束。\n`,
			)
		}
		const app = await electron.launch({
			executablePath: require('electron'),
			args: ['apps/desktop', `--user-data-dir=${join(directory, 'profile')}`],
			env: { ...process.env, ELECTRON_RENDERER_URL: '', NL_REPLAY: 'strict' },
		})
		try {
			const page = await app.firstWindow()
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
			const text = page.locator('.nl-player-text')
			const display = text.locator('.nl-text-display')
			await expect(text).toHaveAttribute('data-revealed', '1')
			const rects = () =>
				display.locator('[data-glyph]').evaluateAll((nodes) =>
					nodes.map((node) => {
						const r = node.getBoundingClientRect()
						return [r.x, r.y, r.width, r.height]
					}),
				)
			const before = await rects()
			await page.waitForTimeout(250)
			await expect(text).toHaveAttribute('data-revealed', '1')
			await expect(display.locator('ruby rt')).toHaveText('chūn tiān')
			await expect(display.locator('[data-mark="b"]')).toHaveCSS(
				'font-weight',
				'700',
			)
			await expect(text).toHaveCSS('line-break', 'strict')
			await expect(text).toHaveCSS('font-family', /Noto Sans SC/)
			await expect(text).toHaveAttribute('data-revealed', '2', {
				timeout: 3000,
			})
			await expect(display.locator('ruby rt')).toHaveCSS(
				'visibility',
				'visible',
			)
			const advance = () =>
				page.locator('canvas').click({ position: { x: 20, y: 20 } })
			await advance()
			expect(await rects()).toEqual(before)
			const firstEnd = Number(await text.getAttribute('data-revealed'))
			expect(firstEnd).toBeLessThan(
				await display.locator('[data-glyph]').count(),
			)
			const pages = Number(await text.getAttribute('data-pages'))
			expect(pages).toBeGreaterThan(3)
			const geometry = await text.evaluate((host) => {
				const glyphs = Array.from(
					host.querySelectorAll<HTMLElement>('.nl-text-display [data-glyph]'),
				)
				const lines = new Map<number, string>()
				for (const glyph of glyphs) {
					const y = Math.round(glyph.getBoundingClientRect().top)
					lines.set(y, (lines.get(y) ?? '') + glyph.textContent)
				}
				return {
					lines: [...lines.values()],
					height: host.clientHeight,
					lineHeight: Number.parseFloat(getComputedStyle(host).lineHeight),
				}
			})
			expect(geometry.height).toBe(geometry.lineHeight * 3)
			for (const line of geometry.lines) {
				expect(line).not.toMatch(/^[、。，！？）」』]/)
				expect(line).not.toMatch(/[（「『]$/)
			}
			await page.screenshot({ path: test.info().outputPath('first-page.png') })
			await advance()
			await expect(text).toHaveAttribute('data-page', '2')
			await text.evaluate((host) => {
				host.style.width = '100%'
			})
			await expect(text).toHaveAttribute('data-page', '1')
			const anchorVisible = await display
				.locator(`[data-glyph="${firstEnd}"]`)
				.evaluate((glyph) => {
					const rect = glyph.getBoundingClientRect()
					const window = glyph
						.closest('.nl-text-window')
						?.getBoundingClientRect()
					return (
						window && rect.top >= window.top && rect.bottom <= window.bottom
					)
				})
			expect(anchorVisible).toBe(true)
			await text.evaluate((host) => {
				host.style.width = '78%'
			})
			await expect(text).toHaveAttribute('data-pages', String(pages))
			for (let p = 2; p <= pages; p++) {
				await advance()
				await expect(text).toHaveAttribute('data-page', String(p))
				await advance()
				if (p === 2)
					await page.screenshot({
						path: test.info().outputPath('second-page.png'),
					})
			}
			await advance()
			await expect(text).toHaveAttribute('data-revealed', '2')
			await page.waitForTimeout(250)
			await expect(text).toHaveAttribute('data-revealed', '2')
			await page.evaluate(
				() =>
					new Promise<void>((resolve) => {
						const overlay = document.querySelector('.nl-player-overlay')
						if (!overlay) throw new Error('Missing player overlay')
						const check = () => {
							const viewport =
								overlay.querySelector<HTMLElement>('.nl-player-text')
							if (
								viewport
									?.querySelector('.nl-text-display')
									?.textContent?.startsWith('自动翻页') &&
								viewport.dataset.page === '2'
							) {
								observer.disconnect()
								resolve()
							}
						}
						const observer = new MutationObserver(check)
						observer.observe(overlay, {
							subtree: true,
							childList: true,
							attributes: true,
							attributeFilter: ['data-page'],
						})
						check()
					}),
			)
			await expect(display).toHaveText('点击补全后等第二次点击。', {
				timeout: 10000,
			})
			await advance()
			await expect(text).toHaveAttribute('data-revealed', '12')
			await page.waitForTimeout(250)
			await expect(display).toHaveText('点击补全后等第二次点击。')
			await text.evaluate((host) => {
				host.style.width = '2em'
			})
			await expect
				.poll(async () => Number(await text.getAttribute('data-pages')))
				.toBeGreaterThan(1)
			const heldCharacters = await display.locator('[data-glyph]').count()
			await page.waitForTimeout(1200 + 80 * heldCharacters + 250)
			await expect(text).toHaveAttribute('data-page', '1')
			const heldPages = Number(await text.getAttribute('data-pages'))
			for (let p = 2; p <= heldPages; p++) {
				await advance()
				await expect(text).toHaveAttribute('data-page', String(p))
			}
			await advance()
			await expect(display).toHaveText('结束。', { timeout: 1000 })
		} finally {
			await app.close()
		}
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})
