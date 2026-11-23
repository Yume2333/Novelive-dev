import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

test('M3 stage directions render the direction set and four landscape fill crops in Electron', async () => {
	test.setTimeout(120_000)
	const directory = await mkdtemp(join(tmpdir(), 'novelive-m3-stage-'))
	const root = join(directory, 'project')
	const png = (color: string, width = 960, height = 540) =>
		sharp({ create: { width, height, channels: 3, background: color } })
			.png()
			.toBuffer()
	try {
		await seedPlayerProject(
			root,
			await png('#203060'),
			await png('#e06030', 160, 540),
		)
		using project = await Project.open(root)
		const registry = await project.read(
			projectFiles.assetRegistry({ level: 'series' }),
		)
		registry.entries.push(
			{
				id: 'cg-test',
				type: 'cg',
				path: 'assets/cg.png',
				aliases: [],
				status: 'drawn',
			},
			{
				id: 'traveler/coat/smile',
				type: 'expression',
				path: 'assets/smile.png',
				aliases: [],
				status: 'drawn',
			},
			{
				id: 'traveler/dress/calm',
				type: 'character',
				path: 'assets/dress.png',
				aliases: [],
				status: 'drawn',
			},
		)
		await project.write(
			projectFiles.assetRegistry({ level: 'series' }),
			registry,
		)
		await project.writeFile('assets/cg.png', await png('#408020'))
		await project.writeFile('assets/smile.png', await png('#30c0a0', 160, 540))
		await project.writeFile('assets/dress.png', await png('#b040d0', 200, 540))
		const cues: [string, string][] = [
			[
				'@bg room/dusk transition none\n@show traveler/coat/calm center',
				'基准',
			],
			['@move center left duration 0.05', '移动'],
			['@face traveler/smile duration 0.05', '表情'],
			['@costume traveler/dress duration 0.05', '造型'],
			['@cg cg-test', 'CG'],
			['@cg none\n@fg cg-test', '前景'],
			['@fg none', '清除'],
			['@zoom 1.2 target left duration 0.05', '对焦'],
			['@camera push-in duration 0.05', '推镜'],
			['@camera pull-out duration 0.05', '拉镜'],
			[
				'@camera sway duration 0.05\n@shake strength strong duration 0.05',
				'摇镜震动',
			],
			['@camera reset duration 0.05', '复位'],
			...['rain', 'snow', 'sakura'].map(
				(effect) =>
					[`@particle ${effect} intensity 0.8 speed 1 angle 20`, effect] as [
						string,
						string,
					],
			),
			['@particle none\n@mask letterbox strength 0.6', '宽银幕'],
			['@mask vignette strength 0.8', '暗角'],
			['@mask none', '无遮罩'],
			...['blur', 'brightness', 'sepia', 'glitch'].map(
				(effect) => [`@filter ${effect} value 0.5`, effect] as [string, string],
			),
			['@filter none\n@hide traveler', '空场'],
			[
				'@cg cg-test\n@particle sakura intensity 0.8\n@filter sepia value 0.5',
				'合成演出',
			],
		]
		await project.writeFile(
			projectFiles.scene(playerRef, 'aaaabbbb'),
			`scene 舞台\nsource p0001\n${cues.map(([action, label]) => `${action}\n: ${label}。`).join('\n')}\n`,
		)
		const app = await electron.launch({
			executablePath: require('electron'),
			args: [
				'apps/desktop',
				'--enable-unsafe-swiftshader',
				'--use-gl=angle',
				'--use-angle=swiftshader',
				`--user-data-dir=${join(directory, 'profile')}`,
			],
			env: { ...process.env, ELECTRON_RENDERER_URL: '', NL_REPLAY: 'strict' },
		})
		try {
			const page = await app.firstWindow()
			const errors: string[] = []
			page.on('pageerror', (error) => {
				errors.push(error.message)
				console.error(error.stack)
			})
			page.on('console', (message) => {
				if (message.type() === 'error') console.error(message.text())
			})
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
			const canvas = page.locator('.nl-player canvas')
			async function pixel(x: number, y: number) {
				const shot = await sharp(
					await page.locator('.nl-player-stage').screenshot(),
				)
					.raw()
					.toBuffer({ resolveWithObject: true })
				const offset =
					(Math.floor(shot.info.height * y) * shot.info.width +
						Math.floor(shot.info.width * x)) *
					shot.info.channels
				return [...shot.data.subarray(offset, offset + 3)]
			}
			await expect(text).toHaveText('基准。')
			const evidence =
				process.env.NL_STAGE_SHOTS ?? '.workflow/evidence/m3-playback'
			await mkdir(evidence, { recursive: true })
			for (const [name, width, height] of [
				['16-10', 1280, 800],
				['4-3', 1024, 768],
				['phone', 960, 440],
				['21-9', 1680, 720],
			] as const) {
				await app.evaluate(
					({ BrowserWindow }, size) => {
						BrowserWindow.getAllWindows()[0].setContentSize(
							size.width,
							size.height,
						)
					},
					{ width, height },
				)
				await expect.poll(() => pixel(0.02, 0.02)).toEqual([32, 48, 96])
				await expect.poll(() => pixel(0.5, 0.4)).toEqual([224, 96, 48])
				const bounds = await canvas.boundingBox()
				expect(bounds?.width).toBeGreaterThanOrEqual(width - 1)
				expect(bounds?.height).toBeGreaterThanOrEqual(height - 1)
				await page.screenshot({ path: `${evidence}/stage-${name}.png` })
			}
			for (const [, label] of cues.slice(1)) {
				await canvas.click({ position: { x: 30, y: 100 } })
				await expect(text).toHaveText(`${label}。`)
				if (label === '移动')
					await expect.poll(() => pixel(0.25, 0.4)).toEqual([224, 96, 48])
				if (label === '表情')
					await expect.poll(() => pixel(0.25, 0.4)).toEqual([48, 192, 160])
				if (label === '造型')
					await expect.poll(() => pixel(0.25, 0.4)).toEqual([176, 64, 208])
				if (label === 'CG' || label === '前景')
					await expect.poll(() => pixel(0.5, 0.4)).toEqual([64, 128, 32])
				if (label === '宽银幕')
					await expect.poll(() => pixel(0.5, 0.01)).toEqual([0, 0, 0])
				if (label === 'brightness')
					await expect.poll(() => pixel(0.8, 0.3)).toEqual([16, 24, 48])
				if (['sakura', '暗角', 'glitch'].includes(label))
					await page.screenshot({ path: `${evidence}/stage-${label}.png` })
				if (label === '合成演出')
					await page.screenshot({ path: `${evidence}/stage-composite.png` })
				if (label === '空场')
					await expect.poll(() => pixel(0.25, 0.4)).toEqual([32, 48, 96])
			}
			await expect(page.getByRole('alert')).toHaveCount(0)
			expect(errors).toEqual([])
		} finally {
			await app.close()
		}
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})
