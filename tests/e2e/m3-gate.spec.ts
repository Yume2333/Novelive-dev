import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import sharp from 'sharp'
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
const paragraph = '山川与河流，正在等待春天。'.repeat(28)
const opening = `春天tiān山谷${paragraph}`
const secondRef = { ...playerRef, chapterId: 'ch2' }

test('M3 full playback restores the staged sentence from real slots and continues across chapters', async () => {
	test.setTimeout(120_000)
	const directory = await mkdtemp(join(tmpdir(), 'novelive-m3-gate-'))
	const root = join(directory, 'project')
	const profile = join(directory, 'profile')
	const packaged = process.env.NL_GATE_APPIMAGE
	const evidence = resolve('.workflow/evidence/m3')
	const png = (background: string, width: number, height: number) =>
		sharp({ create: { width, height, channels: 3, background } })
			.png()
			.toBuffer()
	try {
		await seedPlayerProject(
			root,
			await png('#203060', 960, 540),
			await png('#e06030', 160, 540),
		)
		using project = await Project.open(root)
		const work = projectFiles.work(playerRef.volumeId, playerWorkId)
		await project.write(work, {
			...(await project.read(work)),
			chapterIds: ['ch1', 'ch2'],
		})
		const ch1 = projectFiles.chapter(playerRef)
		await project.write(projectFiles.chapter(secondRef), {
			...(await project.read(ch1)),
			chapterId: 'ch2',
			title: '晨光',
		})
		const registry = projectFiles.assetRegistry({ level: 'series' })
		const current = await project.read(registry)
		current.entries.push({
			id: 'cg-test',
			type: 'cg',
			path: 'assets/cg.png',
			aliases: [],
			status: 'drawn',
		})
		await project.write(registry, current)
		await project.writeFile('assets/cg.png', await png('#408020', 960, 540))
		await project.writeFile(
			projectFiles.scene(playerRef, 'aaaabbbb'),
			`scene 暮色
source p0001
@bg room/dusk transition none
@show traveler/coat/calm center transition none
@cg cg-test
@fg cg-test
@zoom 1.2 target left duration 0.05
@particle sakura intensity 0.8
@filter brightness value 0.5
@mask letterbox strength 0.6
traveler: 春{wait 2}{ruby tiān}天{/ruby}{wave}山谷{/wave}{speed 0.2}${paragraph}{/speed} #0001
@cg none
@fg none
@camera reset duration 0.05
@particle none
@mask none
@filter none
listener (inner): 演出已经清除。 #0002
`,
		)
		await project.writeFile(
			projectFiles.scene(secondRef, 'aaaabbbb'),
			'scene 晨光\nsource p0001\n: 晨光来了。 #0003\n: 继续前行。 #0004\n',
		)
		project.database
			.prepare(
				"INSERT INTO work (work_id, title, status, queue_pos, created_at) VALUES (?, ?, 'done', 0, 0)",
			)
			.run(playerWorkId, '黄昏')
		project.database
			.prepare(
				"INSERT INTO chapter (work_id, chapter_id, ord, user_state) VALUES (?, 'ch1', 1, 'published'), (?, 'ch2', 2, 'producing')",
			)
			.run(playerWorkId, playerWorkId)
		await mkdir(join(profile, 'projects'), { recursive: true })
		await writeFile(join(profile, 'projects', playerWorkId), root)
		await writeFile(
			join(profile, 'projects', 'missing'),
			join(directory, 'missing'),
		)
		await mkdir(evidence, { recursive: true })

		async function launch(published: number) {
			const start = performance.now()
			const app = await electron.launch({
				executablePath: packaged || require('electron'),
				args: [
					...(packaged ? [] : ['apps/desktop']),
					'--enable-unsafe-swiftshader',
					'--use-gl=angle',
					'--use-angle=swiftshader',
					`--user-data-dir=${profile}`,
				],
				env: {
					...process.env,
					ELECTRON_RENDERER_URL: '',
					NL_REPLAY: 'strict',
				},
			})
			try {
				const page = await app.firstWindow()
				await expect(page.getByRole('status')).toHaveText('创作端已就绪')
				if (packaged)
					console.log(
						`AppImage creator ready: ${Math.round(performance.now() - start)} ms`,
					)
				await expect(page.getByRole('alert')).toHaveText('有 1 部作品无法读取')
				const work = page.getByRole('link', { name: '黄昏', exact: true })
				await expect(work).toHaveAccessibleDescription(
					`已发布 ${published} / 2 章`,
				)
				await work.click()
				await page.getByRole('link', { name: '游玩', exact: true }).click()
				return { app, page }
			} catch (error) {
				await app.close()
				throw error
			}
		}
		const { app, page } = await launch(1)
		try {
			const player = page.getByRole('main', { name: '播放器' })
			const viewport = player.locator('.nl-player-text')
			const text = viewport.locator('.nl-text-display')
			const stage = player.locator('.nl-player-stage')
			const canvas = stage.locator('canvas')
			const idle = () => expect(stage).toHaveAttribute('aria-busy', 'false')
			const advance = async () => {
				await idle()
				await canvas.click({ position: { x: 25, y: 25 } })
			}
			const button = (name: string) =>
				page.getByRole('button', { name, exact: true })
			const menu = async (name: string) => {
				await page.keyboard.press('Escape')
				await button(name).click()
			}
			const settings = () => menu('设置')
			const instant = page.getByLabel('瞬间显示')
			const status = (message: string) =>
				expect(player.getByRole('status')).toHaveText(message)
			const snapshot = (kind: 'quick' | 'manual') =>
				page.evaluate(
					async ({ id, kind }) =>
						(await window.novelive.host.progress?.load(id))?.saves.find(
							(entry) => entry.slot.kind === kind,
						)?.snapshot,
					{ id: playerWorkId, kind },
				)
			const pixel = async (x: number, y: number) => {
				const { data, info } = await sharp(await stage.screenshot())
					.removeAlpha()
					.raw()
					.toBuffer({ resolveWithObject: true })
				const index =
					(Math.floor(y * info.height) * info.width +
						Math.floor(x * info.width)) *
					3
				return [...data.subarray(index, index + 3)]
			}

			await expect(text).toHaveText(opening)
			await expect(text.locator('ruby rt')).toHaveText('tiān')
			await expect(text.locator('[data-mark="wave"]')).toHaveCSS(
				'color',
				'rgb(255, 0, 0)',
			)
			await expect(viewport).toHaveAttribute('data-revealed', '1')
			await idle()
			await settings()
			await instant.check()
			await page.keyboard.press('Escape')
			await expect
				.poll(async () => Number(await viewport.getAttribute('data-revealed')))
				.toBeGreaterThan(4)
			await advance()
			await expect(viewport).toHaveAttribute('data-page', '2')
			await settings()
			await instant.uncheck()
			await expect(viewport).toHaveAttribute('data-page', '1')
			await instant.check()
			await page.keyboard.press('Escape')

			for (const [ratio, width, height] of [
				['16-10', 1280, 800],
				['4-3', 1024, 768],
				['phone', 960, 440],
				['21-9', 1680, 720],
			] as const) {
				await app.evaluate(
					({ BrowserWindow }, size) =>
						BrowserWindow.getAllWindows()[0].setContentSize(
							size.width,
							size.height,
						),
					{ width, height },
				)
				await expect
					.poll(async () => (await stage.boundingBox())?.width)
					.toBe(width)
				await expect
					.poll(async () => (await stage.boundingBox())?.height)
					.toBe(height)
				await expect
					.poll(async () => (await canvas.boundingBox())?.width)
					.toBeGreaterThanOrEqual(width - 1)
				await expect
					.poll(async () => (await canvas.boundingBox())?.height)
					.toBeGreaterThanOrEqual(height - 1)
				if (!packaged)
					await page.screenshot({ path: join(evidence, `gate-${ratio}.png`) })
			}
			const compositePixel = await pixel(0.8, 0.25)
			await expect.poll(() => pixel(0.5, 0.01)).toEqual([0, 0, 0])
			await expect
				.poll(async () => Number(await viewport.getAttribute('data-revealed')))
				.toBeGreaterThan(4)
			await advance()
			await expect(viewport).toHaveAttribute('data-page', '2')
			await menu('快速存档')
			await status('存档成功')
			const saved = await snapshot('quick')
			expect(saved?.stage).toMatchObject({
				cg: 'cg-test',
				foreground: 'cg-test',
				camera: { zoom: { scale: 1.2, target: 'left' } },
				particle: { effect: 'sakura', intensity: 0.8 },
				mask: { shape: 'letterbox', strength: 0.6 },
				filter: { effect: 'brightness', value: 0.5 },
			})
			await menu('存档')
			await expect(page.locator('.nl-save-grid button')).toHaveCount(60)
			await button('存档槽位 1').click()
			await status('存档成功')
			expect(await snapshot('manual')).toEqual(saved)
			const pages = Number(await viewport.getAttribute('data-pages'))
			for (let page = 2; page <= pages; page++) await advance()
			await expect(text).toHaveText('演出已经清除。')
			await idle()
			await expect.poll(() => pixel(0.5, 0.01)).not.toEqual([0, 0, 0])
			await menu('快速读档')
			await expect(text).toHaveText(opening)
			await expect(viewport).toHaveAttribute('data-page', '1')
			await idle()
			await expect.poll(() => pixel(0.5, 0.01)).toEqual([0, 0, 0])
			await expect.poll(() => pixel(0.8, 0.25)).toEqual(compositePixel)
			await menu('读档')
			const thumbnail = page.getByAltText('槽位 1 缩略图')
			await expect(thumbnail).toHaveJSProperty('naturalWidth', 480)
			await expect(thumbnail).toHaveJSProperty('naturalHeight', 270)
			if (!packaged)
				await page.screenshot({ path: join(evidence, 'gate-save-slots.png') })
			await button('读档槽位 1').click()
			await status('读档完成')
			await expect(viewport).toHaveAttribute('data-page', '1')
			await page.keyboard.press('Escape')
			await page.getByLabel('跳过已读').check()
			await page.keyboard.press('Escape')
			const wait = player
				.getByRole('status')
				.filter({ hasText: '下一章 · 晨光' })
			await expect(wait).toContainText('制作中')
			if (!packaged)
				await page.screenshot({ path: join(evidence, 'gate-chapter-wait.png') })
			project.database
				.prepare(
					"UPDATE chapter SET user_state = 'published' WHERE chapter_id = 'ch2'",
				)
				.run()
			await button('下一章已就绪，点击开始').click()
			await expect(text).toHaveText('晨光来了。')
			const mainline = await player.getAttribute('data-mainline')
			expect(mainline).toContain('ch2')
			await menu('历史记录')
			await button('后退一句').click()
			await expect(text).toHaveText('演出已经清除。')
			await menu('历史记录')
			await button('前进一句').click()
			await expect(text).toHaveText('晨光来了。')
			await menu('历史记录')
			await button('后退一句').click()
			await expect(text).toHaveText('演出已经清除。')
			await advance()
			await button('下一章已就绪，点击开始').click()
			await expect(text).toHaveText('晨光来了。')
			await menu('历史记录')
			await expect(button('前进一句')).toBeDisabled()
			await button('返回菜单').click()
			await button('章节').click()
			await page.getByRole('button', { name: /空屋/ }).click()
			await expect(player).toHaveAttribute('data-mode', 'reread')
			await expect(player).toHaveAttribute('data-mainline', mainline ?? '')
			await expect(player.getByRole('alert')).toHaveCount(0)
		} finally {
			await app.close()
		}
		const restarted = await launch(2)
		try {
			await expect(restarted.page.locator('.nl-text-display')).toHaveText(
				'晨光来了。',
			)
			await restarted.page.keyboard.press('Escape')
			await restarted.page
				.getByRole('button', { name: '设置', exact: true })
				.click()
			await expect(restarted.page.getByLabel('瞬间显示')).not.toBeChecked()
		} finally {
			await restarted.app.close()
		}
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})
