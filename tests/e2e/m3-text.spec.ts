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
			await expect(
				page.getByRole('status').filter({ hasText: /^创作端已就绪$/ }),
			).toHaveText('创作端已就绪')
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
			expect(geometry.height).toBeGreaterThanOrEqual(geometry.lineHeight * 3)
			expect(geometry.height).toBeLessThan(geometry.lineHeight * 4)
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
			// 记录自动翻页句的停留：本页末字揭示完成到 data-page 变 2 的真实间隔，
			// 必须满足 dwell 下界（(1200+80×页字数)×0.85）且在上界内翻页。
			const dwellDelta = await page.evaluate(() => {
				const { promise, resolve } = Promise.withResolvers<number>()
				const overlay = document.querySelector('.nl-player-overlay')
				if (!overlay) throw new Error('Missing player overlay')
				let completeAt = 0
				let count = 0
				const check = () => {
					const viewport = overlay.querySelector<HTMLElement>('.nl-player-text')
					if (
						!viewport
							?.querySelector('.nl-text-display')
							?.textContent?.startsWith('自动翻页')
					)
						return
					const revealed = Number(viewport.dataset.revealed)
					if (viewport.dataset.page === '1' && revealed > count) {
						completeAt = performance.now()
						count = revealed
					}
					if (completeAt && viewport.dataset.page === '2') {
						observer.disconnect()
						resolve((performance.now() - completeAt) / (1200 + 80 * count))
					}
				}
				const observer = new MutationObserver(check)
				observer.observe(overlay, {
					subtree: true,
					childList: true,
					attributes: true,
					attributeFilter: ['data-page', 'data-revealed'],
				})
				check()
				return promise
			})
			expect(dwellDelta).toBeGreaterThanOrEqual(0.85)
			expect(dwellDelta).toBeLessThan(2)
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

test('M3 text typography: page clip boundary keeps every rendered line whole, including ruby-inflated lines', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'novelive-m3-clip-'))
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
			// 在长句中段插入 ruby，翻页边界必然落在不同行高的行上；点击补全后逐页检查裁剪窗口。
			await project.writeFile(
				projectFiles.scene(playerRef, 'aaaabbbb'),
				`scene 空屋\nsource p0001\n: {speed 5}{ruby chūn tiān}春天{/ruby}${'山川与河流，正在等待春天。'.repeat(3)}{ruby sì jì}四季{/ruby}依旧流转${'，风吹过山谷与田野'.repeat(12)}。{/speed}\n`,
			)
		}
		const app = await electron.launch({
			executablePath: require('electron'),
			args: ['apps/desktop', `--user-data-dir=${join(directory, 'profile')}`],
			env: { ...process.env, ELECTRON_RENDERER_URL: '', NL_REPLAY: 'strict' },
		})
		try {
			const page = await app.firstWindow()
			await expect(
				page.getByRole('status').filter({ hasText: /^创作端已就绪$/ }),
			).toHaveText('创作端已就绪')
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
			const advance = () => page.mouse.click(20, 20)
			await advance() // 慢速揭示下首击只补全第一页，不翻页
			const pages = Number(await text.getAttribute('data-pages'))
			expect(pages).toBeGreaterThan(1)
			// 逐页断言：每个字形行要么完整落在裁剪窗口内、要么完整落在窗口外，
			// 不允许半行露出；ruby 基字行把 rt 也算进行高。
			const audit = () =>
				text.evaluate((host) => {
					const clip = host
						.querySelector('.nl-text-window')
						?.getBoundingClientRect()
					if (!clip) throw new Error('Missing clip window')
					const lines = new Map<
						number,
						{ top: number; bottom: number; first: number; last: number }
					>()
					for (const glyph of host.querySelectorAll<HTMLElement>(
						'.nl-text-display [data-glyph]',
					)) {
						const rect = glyph.getBoundingClientRect()
						const key = Math.round(rect.top)
						const line = lines.get(key) ?? {
							top: rect.top,
							bottom: rect.bottom,
							first: Number(glyph.dataset.glyph),
							last: Number(glyph.dataset.glyph),
						}
						line.top = Math.min(line.top, rect.top)
						line.bottom = Math.max(line.bottom, rect.bottom)
						line.first = Math.min(line.first, Number(glyph.dataset.glyph))
						line.last = Math.max(line.last, Number(glyph.dataset.glyph))
						lines.set(key, line)
					}
					// 把每个 rt 归并进其 ruby 基字所在行（rt 渲染在基字上方，visibility 不影响布局）
					for (const rt of host.querySelectorAll<HTMLElement>(
						'.nl-text-display rt',
					)) {
						const base = rt
							.closest('ruby')
							?.querySelector<HTMLElement>('[data-glyph]')
							?.getBoundingClientRect()
						if (!base) continue
						const line = lines.get(Math.round(base.top))
						if (!line) continue
						const rect = rt.getBoundingClientRect()
						line.top = Math.min(line.top, rect.top)
						line.bottom = Math.max(line.bottom, rect.bottom)
					}
					const sorted = [...lines.values()].sort((a, b) => a.top - b.top)
					return {
						clip: { top: clip.top, bottom: clip.bottom },
						lines: sorted,
					}
				})
			let sawInflatedLine = false
			let boundary = 0
			for (let p = 1; p <= pages; p++) {
				await expect(text).toHaveAttribute('data-page', String(p))
				// 等本页揭示自然完成（speed 5 约 0.2s/页），data-revealed 停在页末字
				await expect
					.poll(
						async () => {
							const before = await text.getAttribute('data-revealed')
							await page.waitForTimeout(150)
							const after = await text.getAttribute('data-revealed')
							return before === after
						},
						{ timeout: 10000 },
					)
					.toBe(true)
				const { clip, lines } = await audit()
				const lineHeight = await text.evaluate((host) =>
					Number.parseFloat(getComputedStyle(host).lineHeight),
				)
				const inside = lines.filter(
					(line) =>
						line.top >= clip.top - 0.5 && line.bottom <= clip.bottom + 0.5,
				)
				const outside = lines.filter(
					(line) =>
						line.bottom <= clip.top + 0.5 || line.top >= clip.bottom - 0.5,
				)
				expect(
					inside.length + outside.length,
					`page ${p}: a line straddles the clip window`,
				).toBe(lines.length)
				// 归属校验：窗口内行的字形必须恰好覆盖本页应显示的
				// [本页首字, 页末字] 区间——既不漏行也不串页。
				const pageEnd = Number(await text.getAttribute('data-revealed'))
				expect(inside[0]?.first).toBe(boundary)
				expect(inside.at(-1)?.last).toBe(pageEnd - 1)
				boundary = pageEnd
				// 非末页完整可见的行不超过三行（下一页首行不许提前露出，
				// 标点收尾的两行页仍合法）。
				if (p < pages) expect(inside.length).toBeLessThanOrEqual(3)
				for (const line of inside)
					if (line.bottom - line.top > lineHeight + 1) sawInflatedLine = true
				if (p < pages) {
					await advance()
					// 若首击只补全了本页揭示，再击一次翻页
					if ((await text.getAttribute('data-page')) === String(p)) {
						await advance()
					}
				}
			}
			// 确认本句确实覆盖了行高被 ruby 撑大的分页边界，否则此断言无意义。
			expect(sawInflatedLine).toBe(true)
		} finally {
			await app.close()
		}
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})
