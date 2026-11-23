import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	_electron as electron,
	expect,
	type Locator,
	test,
} from '@playwright/test'
import sharp from 'sharp'
import { replaceMarkSuggestions } from '../../packages/creator/src/editor/marks'
import { Project } from '../../packages/creator/src/project'
import { projectFiles } from '../../packages/format/src/model'
import {
	playerRef,
	playerWorkId,
	seedPlayerProject,
} from '../fixtures/minimal-player'

const require = createRequire(
	new URL('../../apps/desktop/package.json', import.meta.url),
)
const evidence = '.workflow/evidence/m3-playback'

async function expectMarks(text: Locator) {
	const display = text.locator('.nl-text-display')
	const layout = text.locator('.nl-text-layout')
	await expect(display).toHaveText('萤火照亮了夜空。')
	for (const layer of [display, layout]) {
		const mark = layer.locator('[data-mark-style="glow"]')
		await expect(mark).toHaveCount(2)
		await expect(mark.nth(0)).toHaveText('萤')
		await expect(mark.nth(1)).toHaveText('火')
		await expect(mark.nth(0)).toHaveCSS('color', 'rgb(255, 204, 102)')
		const stretch = layer.locator('[data-mark-style="wave"]')
		await expect(stretch).toHaveCount(1)
		await expect(stretch).toHaveText('夜空')
		await expect(stretch).toHaveCSS('color', 'rgb(142, 232, 255)')
		await expect(layer.locator('[data-mark="unsafe"]')).not.toHaveAttribute(
			'style',
		)
	}
	await expect(layout).toHaveCSS('visibility', 'hidden')
	await expect(display.locator('[data-glyph]').first()).toHaveCSS(
		'visibility',
		'visible',
	)
}

test('M3 custom marks render an accepted per-glyph mark and a run mark in preview and playback', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'novelive-custom-marks-'))
	const root = join(directory, 'project')
	const profile = join(directory, 'profile')
	try {
		const png = await sharp({
			create: { width: 32, height: 32, channels: 3, background: '#203060' },
		})
			.png()
			.toBuffer()
		await seedPlayerProject(root, png, png)
		{
			using project = await Project.open(root)
			const workFile = projectFiles.work(playerRef.volumeId, playerWorkId)
			const work = await project.read(workFile)
			await project.write(workFile, {
				...work,
				settings: {
					...work.settings,
					customMarks: {
						wave: {
							css: 'color: #8ee8ff; text-decoration: underline',
							perChar: false,
						},
						unsafe: { css: 'color: red; } body { opacity: 0', perChar: false },
						large: {
							css: 'font-size: 72px; letter-spacing: 0.04em',
							perChar: true,
						},
						shift: {
							css: 'color: navy; transform: translateY(500px)',
							perChar: false,
						},
						char: { css: 'color: teal', perChar: false },
						huge: { css: 'font-size: 190px', perChar: false },
					},
				},
			})
			project.database
				.prepare(
					'INSERT INTO work (work_id, title, queue_pos, created_at) VALUES (?, ?, 0, 0)',
				)
				.run(playerWorkId, work.title)
			await replaceMarkSuggestions(project, playerRef.volumeId, playerRef, [
				{
					name: 'glow',
					css: 'color: #fc6 !important; color: red; text-shadow: 0 0 5px #f75; animation: spin 1s',
					perChar: true,
				},
			])
			await project.writeFile(
				projectFiles.chapterText(playerRef.chapterId),
				'萤火照亮了夜空。',
			)
			await project.writeFile(
				projectFiles.scene(playerRef, 'aaaabbbb'),
				'scene 夜空\nsource p0001\n@bg room/dusk\n: 萤火{unsafe}照亮了{/unsafe}{wave}夜空{/wave}。 #0001\n' +
					': {speed 100}前{large}大字{/large}后{/speed} #0002\n' +
					`: {speed 100}{shift}${'山川'.repeat(20)}{/shift}{/speed} #0003\n` +
					': {speed 100}萤火{wave}夜空{/wave}{/speed} #0004\n' +
					': {speed 100}{char}名字{/char}{/speed} #0005\n' +
					`: {speed 100}{shout}{large}${'大声'.repeat(20)}{/large}{/shout}{/speed} #0006\n` +
					`: {speed 100}${'小字'.repeat(36)}{huge}巨{/huge}{/speed} #0007\n`,
			)
		}
		await mkdir(join(profile, 'projects'), { recursive: true })
		await writeFile(join(profile, 'projects', playerWorkId), root)
		const app = await electron.launch({
			executablePath: require('electron'),
			args: ['apps/desktop', `--user-data-dir=${profile}`],
			env: { ...process.env, ELECTRON_RENDERER_URL: '', NL_REPLAY: 'strict' },
		})
		try {
			const page = await app.firstWindow()
			await expect(page.getByRole('status')).toHaveText('创作端已就绪')
			await page.evaluate(({ workId, chapterId }) => {
				window.location.hash = `/work/${workId}/edit?chapterId=${chapterId}`
			}, playerRef)
			const accept = page.getByRole('button', { name: '接受标记' })
			await expect(accept).toBeEnabled()
			const proposedStyle = page
				.getByRole('region', { name: '新标记提议' })
				.locator('code')
			await expect(proposedStyle).toContainText('text-shadow')
			await expect(proposedStyle).not.toContainText('animation')
			await accept.click()
			await expect(accept).toHaveCount(0)
			await page.getByRole('button', { name: '快捷位置', exact: true }).click()
			const line = page.getByRole('menuitem', { name: /^4 ·/ })
			await expect(line).toBeVisible()
			await line.click()
			const script = page.getByRole('textbox', { name: 'NVS 剧本' })
			await script.press('End')
			await script.press('Shift+Home')
			await page.keyboard.insertText(
				': {glow}萤火{/glow}{unsafe}照亮了{/unsafe}{wave}夜空{/wave}。 #0001',
			)
			const save = page.getByRole('button', { name: '保存当前句' })
			await expect(save).toBeEnabled()
			await save.click()
			await expect(save).toBeDisabled()
			await page.getByRole('button', { name: '快捷位置', exact: true }).click()
			await page.getByRole('menuitem', { name: /^7 ·/ }).click()
			await script.press('End')
			await script.press('Shift+Home')
			await page.keyboard.insertText(
				': {speed 100}{glow}萤火{wave}夜空{/wave}{/glow}{/speed} #0004',
			)
			await expect(save).toBeEnabled()
			await save.click()
			await expect(save).toBeDisabled()
			await page.getByRole('button', { name: '快捷位置', exact: true }).click()
			await line.click()
			await page.getByRole('button', { name: '从当前句预览' }).click()
			const preview = page.locator('.editor-stage .nl-player-text')
			await expectMarks(preview)
			await expect(preview).toHaveAttribute('data-text-finished', 'true')
			await page.screenshot({ path: `${evidence}/08-custom-mark-preview.png` })

			await page.evaluate((id) => {
				window.location.hash = `/work/${id}/play`
			}, playerWorkId)
			const playback = page.locator('.nl-player .nl-player-text')
			await expectMarks(playback)
			await expect(playback).toHaveAttribute('data-text-finished', 'true')
			await page.screenshot({ path: `${evidence}/08-custom-mark-playback.png` })
			const advance = () =>
				page.locator('.nl-player canvas').click({ position: { x: 20, y: 20 } })
			const display = playback.locator('.nl-text-display')
			await advance()
			await expect(display).toHaveText('前大字后')
			await expect(playback).toHaveAttribute('data-text-finished', 'true')
			const large = display.locator('[data-mark-style="large"]').first()
			const fits = await large.evaluate((element) => {
				const glyph = element.getBoundingClientRect()
				const clip = element.closest('.nl-text-window')?.getBoundingClientRect()
				return !!clip && clip.top <= glyph.top && clip.bottom >= glyph.bottom
			})
			expect
				.soft(fits, 'enlarged glyph is inside the visible text window')
				.toBe(true)

			await advance()
			await expect(display).toHaveText('山川'.repeat(20))
			const shift = display.locator('[data-mark-style="shift"]')
			const shiftStyle = await shift.evaluate((element) => ({
				transform: getComputedStyle(element).transform,
				lines: new Set(
					Array.from(element.querySelectorAll('[data-glyph]'), (glyph) =>
						Math.round(glyph.getBoundingClientRect().top),
					),
				).size,
			}))
			expect
				.soft(
					shiftStyle.transform,
					'unsafe to paginate translations are ignored',
				)
				.toBe('none')
			expect
				.soft(shiftStyle.lines, 'run still wraps after dropping the transform')
				.toBeGreaterThan(1)
			await expect(playback).toHaveAttribute('data-text-finished', 'true')
			await advance()
			await expect(display).toHaveText('萤火夜空')
			const innerGlyph = display
				.locator('[data-mark-style="wave"] [data-glyph]')
				.first()
			expect
				.soft(
					await innerGlyph.evaluate(
						(element) =>
							getComputedStyle(element.firstElementChild ?? element).color,
					),
					'innermost mark supplies glyph color',
				)
				.toBe('rgb(142, 232, 255)')
			await expect(playback).toHaveAttribute('data-text-finished', 'true')
			await advance()
			await expect(display).toHaveText('名字')
			await expect
				.soft(display.locator('[data-mark-style="char"]'))
				.toHaveCSS('color', 'rgb(0, 128, 128)', { timeout: 1000 })
			await expect(playback).toHaveAttribute('data-text-finished', 'true')
			await advance()
			await expect(display).toHaveText('大声'.repeat(20))
			expect
				.soft(
					Number(await playback.getAttribute('data-pages')),
					'large custom glyphs under shout paginate',
				)
				.toBeGreaterThan(1)

			await page.evaluate(({ workId, chapterId }) => {
				window.location.hash = `/work/${workId}/edit?chapterId=${chapterId}`
			}, playerRef)
			const stage = page.locator('.editor-stage')
			await stage.evaluate((element) => {
				element.style.height = '220px'
			})
			async function expectRevealedPreviewGlyph(
				line: number,
				character: string,
			) {
				await page
					.getByRole('button', { name: '快捷位置', exact: true })
					.click()
				await page
					.getByRole('menuitem', { name: new RegExp(`^${line} ·`) })
					.click()
				await page.getByRole('button', { name: '从当前句预览' }).click()
				const glyph = stage.locator('.nl-text-display [data-glyph]').first()
				await expect(glyph).toHaveText(character)
				await expect(glyph).toHaveCSS('visibility', 'visible')
				const inside = await glyph.evaluate((glyph) => {
					const rect = glyph.getBoundingClientRect()
					const win = glyph.closest('.nl-text-window')?.getBoundingClientRect()
					const viewport = glyph
						.closest('.editor-stage')
						?.getBoundingClientRect()
					return (
						!!win &&
						!!viewport &&
						rect.top >= Math.max(win.top, viewport.top) &&
						rect.bottom <= Math.min(win.bottom, viewport.bottom)
					)
				})
				expect(inside, `preview line ${line} first glyph is not clipped`).toBe(
					true,
				)
			}
			await expectRevealedPreviewGlyph(9, '大')
			await expectRevealedPreviewGlyph(10, '小')
		} finally {
			await app.close()
		}
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})
