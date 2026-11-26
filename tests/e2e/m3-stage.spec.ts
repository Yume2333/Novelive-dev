import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import sharp from 'sharp'
import { Project } from '../../packages/creator/src/project'
import { projectFiles } from '../../packages/format/src/model'
import { compileScript } from '../../packages/format/src/script'
import type { StageSnapshot } from '../../packages/player/src/contract'
import {
	playerRef,
	playerWorkId,
	seedPlayerProject,
} from '../fixtures/minimal-player'
import { context } from '../fixtures/script/context'

const require = createRequire(
	new URL('../../apps/desktop/package.json', import.meta.url),
)

type StageHarness = {
	StageTest: typeof import('../../packages/player/src/stage') &
		typeof import('../../packages/ui/src/pages/player/controls/minimal-controller') &
		Pick<
			typeof import('../../packages/player/src/progress'),
			'PlaybackProgress'
		> &
		Pick<
			typeof import('../../packages/ui/src/pages/player/controls/controller'),
			'defaultPlayerSettings' | 'schedulePlayback'
		>
	controls: ReturnType<
		typeof import('../../packages/ui/src/pages/player/controls/minimal-controller').minimalControlsController
	>
	latest: StageSnapshot
	player: NonNullable<
		Awaited<
			ReturnType<
				typeof import('../../packages/player/src/stage').mountMinimalPlayer
			>
		>
	>
	saved: StageSnapshot
	abort: AbortController
	autoplayBusyAtRender: boolean
	preview: import('../../packages/player/src/stage').PixiStage
	mounting: ReturnType<
		typeof import('../../packages/player/src/stage').mountMinimalPlayer
	>
}

test('M3 save stage renders WebP thumbnails and restores state, replay actions and text', async () => {
	test.setTimeout(120_000)
	const { build } = await import(require.resolve('vite'))
	const entry = resolve('packages/player/src/stage/index.ts')
	const bundle = await build({
		configFile: false,
		logLevel: 'error',
		plugins: [
			{
				name: 'stage-controls-regression',
				transform(source: string, id: string) {
					if (id === entry)
						return `${source}\nexport { PlaybackProgress }\nexport { minimalControlsController } from ${JSON.stringify(resolve('packages/ui/src/pages/player/controls/minimal-controller.ts'))}\nexport { defaultPlayerSettings, schedulePlayback } from ${JSON.stringify(resolve('packages/ui/src/pages/player/controls/controller.ts'))}`
				},
			},
		],
		build: {
			write: false,
			lib: {
				entry,
				name: 'StageTest',
				formats: ['iife'],
			},
			rollupOptions: { output: { inlineDynamicImports: true } },
		},
	})
	const compiled = compileScript(
		'scene 夜\nsource p0001\n@bg room/dusk transition none\n@show traveler/coat/calm center\n: First #0001\n@camera sway duration 0.4\n@wait 0.01 #0005\n@hide center transition none\n@show traveler/coat/calm center transition none\n@move center left duration 0.2\n: Second #0002\n@camera reset duration 0.4\n@filter brightness value 0.5\n: Dim #0003\n@wait #0006\n: Auto #0004',
		{ ...context, paragraphIds: ['p0001'], sceneIds: ['aaaabbbb'] },
	)
	if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
	const last = compiled.scenes[0].beats.at(-1)
	if (!last) throw new Error('Missing automatic sentence fixture')
	last.advance = { kind: 'delay', seconds: 1 }
	const background = (
		await sharp({
			create: { width: 960, height: 540, channels: 3, background: '#203060' },
		})
			.png()
			.toBuffer()
	).toString('base64')
	const portrait = (
		await sharp({
			create: { width: 160, height: 540, channels: 3, background: '#e06030' },
		})
			.png()
			.toBuffer()
	).toString('base64')
	const directory = await mkdtemp(join(tmpdir(), 'novelive-m3-stage-'))
	const app = await electron.launch({
		executablePath: require('electron'),
		args: [
			'apps/desktop',
			'--enable-unsafe-swiftshader',
			'--use-gl=angle',
			'--use-angle=swiftshader',
			`--user-data-dir=${join(directory, 'profile')}`,
		],
		env: { ...process.env, NL_REPLAY: 'strict', ELECTRON_RENDERER_URL: '' },
	})
	try {
		await app.evaluate(({ BrowserWindow }) =>
			BrowserWindow.getAllWindows()[0].setContentSize(960, 540),
		)
		const page = await app.firstWindow()
		await expect(
			page.getByRole('status').filter({ hasText: /^创作端已就绪$/ }),
		).toHaveText('创作端已就绪')
		await page.evaluate(
			(Array.isArray(bundle) ? bundle[0] : bundle).output[0].code,
		)
		await page.evaluate(
			async ({ scenes, background, portrait }) => {
				const runtime = globalThis as unknown as StageHarness
				const host = document.createElement('div')
				host.className = 'nl-player'
				host.style.setProperty('--player-text-delay', '0ms')
				document.body.replaceChildren(host)
				runtime.abort = new AbortController()
				const player = await runtime.StageTest.mountMinimalPlayer(
					host,
					scenes,
					{
						resolveAsset: (id) => {
							if (id === 'room/undrawn')
								throw new Error('Undrawn earlier background')
							return `data:image/png;base64,${id === 'room/dusk' ? background : portrait}`
						},
					},
					runtime.abort.signal,
					(error) => {
						throw error
					},
					{},
					undefined,
					{
						chapterId: 'chapter',
						initialActions: [
							{
								type: 'action',
								name: 'bg',
								args: { transition: 'none' },
								assets: [{ id: 'room/undrawn' }],
								line: 1,
								col: 1,
							},
							{
								type: 'action',
								name: 'shake',
								args: { strength: 1, duration: 999 },
								assets: [],
								line: 1,
								col: 1,
							},
						],
					},
				)
				if (!player?.snapshot) throw new Error('Missing stage snapshot')
				runtime.player = player
				runtime.saved = player.snapshot
			},
			{ scenes: compiled.scenes, background, portrait },
		)
		await expect(page.locator('.nl-player-text .nl-text-display')).toHaveText(
			'First',
		)
		console.log(
			'Default renderer:',
			await page
				.locator('canvas')
				.evaluate((canvas) =>
					(canvas as HTMLCanvasElement).getContext('2d') ? 'canvas' : 'webgl',
				),
		)
		const capture = async () =>
			Buffer.from(
				await page.evaluate(async () =>
					Array.from(
						await (globalThis as unknown as StageHarness).player.thumbnail(),
					),
				),
			)
		const before = await capture()
		expect(await sharp(before).metadata()).toMatchObject({
			format: 'webp',
			width: 480,
			height: 270,
		})
		const portraitPixel = await sharp(before)
			.extract({ left: 240, top: 135, width: 1, height: 1 })
			.removeAlpha()
			.raw()
			.toBuffer()
		for (const [channel, expected] of [224, 96, 48].entries())
			expect(Math.abs(portraitPixel[channel] - expected)).toBeLessThanOrEqual(4)
		await page.locator('canvas').click({ position: { x: 20, y: 100 } })
		await expect(page.locator('.nl-player-text .nl-text-display')).toHaveCount(
			0,
		)
		await expect(page.locator('.nl-player-text .nl-text-display')).toHaveText(
			'Second',
		)
		await expect(page.locator('.nl-player-stage')).toHaveAttribute(
			'aria-busy',
			'false',
		)
		await page.evaluate(async () => {
			const { player } = globalThis as unknown as StageHarness
			const settled = player.progress.history.entries.at(-1)
			if (!settled) throw new Error('Missing settled sentence history')
			await player.restore(settled)
		})
		expect(
			await page.evaluate(
				() =>
					(globalThis as unknown as StageHarness).player.state.sprites.center
						?.transform.x,
			),
		).toBe(240)
		expect(
			await page.evaluate(
				() =>
					(globalThis as unknown as StageHarness).player.progress.history
						.entries.length,
			),
		).toBe(2)
		await page.evaluate(async () => {
			const { player, saved } = globalThis as unknown as StageHarness
			await player.restore(saved)
		})
		await expect(page.locator('.nl-player-text .nl-text-display')).toHaveText(
			'First',
		)
		await page.evaluate(async () => {
			const { player, saved } = globalThis as unknown as StageHarness
			await player.restore(saved)
		})
		await page.locator('canvas').click({ position: { x: 20, y: 100 } })
		await expect(page.locator('.nl-player-text .nl-text-display')).toHaveText(
			'Second',
		)
		await expect(page.locator('.nl-player-stage')).toHaveAttribute(
			'aria-busy',
			'false',
		)
		await page.locator('canvas').click({ position: { x: 20, y: 100 } })
		await expect(page.locator('.nl-player-text .nl-text-display')).toHaveText(
			'Dim',
		)
		await expect
			.poll(async () => {
				const shot = sharp(await page.screenshot())
				const { width = 960, height = 540 } = await shot.metadata()
				return [
					...(await shot
						.extract({
							left: Math.round((20 / 960) * width),
							top: Math.round((100 / 540) * height),
							width: 1,
							height: 1,
						})
						.removeAlpha()
						.raw()
						.toBuffer()),
				]
			})
			.toEqual([16, 24, 48])
		await expect(page.locator('.nl-player-stage')).toHaveAttribute(
			'aria-busy',
			'false',
		)
		await page.evaluate(async () => {
			const { player, saved } = globalThis as unknown as StageHarness
			await player.restore(saved)
		})
		expect(
			await page.evaluate(() => {
				const { player, saved } = globalThis as unknown as StageHarness
				return JSON.stringify(player.state) === JSON.stringify(saved.stage)
			}),
		).toBe(true)
		expect(
			(
				await sharp(await capture())
					.raw()
					.toBuffer()
			).equals(await sharp(before).raw().toBuffer()),
		).toBe(true)
		await page.evaluate(async () => {
			const { player, saved } = globalThis as unknown as StageHarness
			const snapshot = structuredClone(saved)
			snapshot.active = [
				{ restore: 'skip-relative' },
				{ restore: 'restart-text' },
				{
					restore: 'replay-state',
					action: {
						type: 'action',
						line: 1,
						col: 1,
						name: 'filter',
						args: { effect: 'brightness', value: 0.5 },
						assets: [],
					},
				},
			]
			await player.restore(snapshot)
		})
		expect(
			await page.evaluate(
				() => (globalThis as unknown as StageHarness).player.state.filter,
			),
		).toEqual({ effect: 'brightness', value: 0.5 })
		await expect(page.locator('.nl-player-text .nl-text-display')).toHaveText(
			'First',
		)
		await page.evaluate(() =>
			(globalThis as unknown as StageHarness).player.restore(
				(globalThis as unknown as StageHarness).saved,
			),
		)
		await page.locator('canvas').click({ position: { x: 20, y: 100 } })
		await expect(page.locator('.nl-player-text .nl-text-display')).toHaveText(
			'Second',
		)
		await expect(page.locator('.nl-player-stage')).toHaveAttribute(
			'aria-busy',
			'false',
		)
		await page.locator('canvas').click({ position: { x: 20, y: 100 } })
		await expect(page.locator('.nl-player-text .nl-text-display')).toHaveText(
			'Dim',
		)
		await expect(page.locator('.nl-player-stage')).toHaveAttribute(
			'aria-busy',
			'false',
		)
		const lastSentence = await page.evaluate(
			() => (globalThis as unknown as StageHarness).player.snapshot,
		)
		await page.locator('canvas').click({ position: { x: 20, y: 100 } })
		await expect(page.locator('.nl-player-text .nl-text-display')).toHaveCount(
			0,
		)
		await expect(page.locator('.nl-player-stage')).toHaveAttribute(
			'aria-busy',
			'false',
		)
		expect(
			await page.evaluate(
				() => (globalThis as unknown as StageHarness).player.snapshot,
			),
		).toEqual(lastSentence)
		await page.locator('canvas').click({ position: { x: 20, y: 100 } })
		await expect(page.locator('.nl-player-text .nl-text-display')).toHaveText(
			'Auto',
		)
		await expect(page.locator('.nl-player-stage')).toHaveAttribute(
			'aria-busy',
			'false',
		)
		await page.evaluate(async () => {
			const { player } = globalThis as unknown as StageHarness
			if (!player.snapshot)
				throw new Error('Missing automatic sentence snapshot')
			await player.restore(player.snapshot)
		})
		await expect(page.locator('.nl-player-overlay')).toHaveText('本章结束')
		await page.evaluate(() =>
			(globalThis as unknown as StageHarness).abort.abort(),
		)
		await page.evaluate(
			({ scenes, background, portrait }) => {
				const runtime = globalThis as unknown as StageHarness
				const scene = scenes[0]
				const first = scene.beats[0]
				scene.beats = [
					{
						...first,
						actions: [
							first.actions[0],
							{
								type: 'action',
								name: 'move',
								args: {
									slot: 'center',
									target: 'left',
									duration: 1,
									easing: 'linear',
								},
								assets: [],
								line: 1,
								col: 1,
							},
						],
					},
				]
				const host = document.createElement('div')
				host.className = 'nl-player'
				host.style.setProperty('--player-text-delay', '0ms')
				document.body.replaceChildren(host)
				runtime.abort = new AbortController()
				const commit = runtime.StageTest.PixiStage.prototype.commit
				runtime.StageTest.PixiStage.prototype.commit = function (...args) {
					const animation = commit.apply(this, args)
					if (args[2]?.some((action) => action.name === 'move')) {
						runtime.preview = this
						this.app.ticker.stop()
						this.app.render()
						runtime.StageTest.PixiStage.prototype.commit = commit
					}
					return animation
				}
				runtime.mounting = runtime.StageTest.mountMinimalPlayer(
					host,
					[scene],
					{
						resolveAsset: (id) => {
							if (id === 'room/undrawn')
								throw new Error('Undrawn earlier background')
							return `data:image/png;base64,${id === 'room/dusk' ? background : portrait}`
						},
					},
					runtime.abort.signal,
					(error) => {
						throw error
					},
					{},
					undefined,
					{
						initialActions: [
							{
								type: 'action',
								name: 'bg',
								args: { transition: 'none' },
								assets: [{ id: 'room/undrawn' }],
								line: 1,
								col: 1,
							},
							{
								type: 'action',
								name: 'show',
								args: { slot: 'center', transition: 'none' },
								assets: [{ id: 'traveler/coat/calm' }],
								line: 1,
								col: 1,
							},
						],
					},
				)
			},
			{ scenes: compiled.scenes, background, portrait },
		)
		await expect(page.locator('.nl-player-text .nl-text-display')).toHaveText(
			'First',
		)
		const previewPixel = async (x: number) => {
			const point = await page.evaluate(async (x) => {
				await new Promise<void>((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
				)
				const { preview } = globalThis as unknown as StageHarness
				preview.app.render()
				const bounds = preview.app.canvas.getBoundingClientRect()
				// page.screenshot() captures device pixels, so convert the
				// CSS-space point by devicePixelRatio.
				const dpr = devicePixelRatio
				return {
					left: Math.round(
						(bounds.left +
							preview.app.stage.x +
							x * preview.app.stage.scale.x) *
							dpr,
					),
					top: Math.round(
						(bounds.top +
							preview.app.stage.y +
							270 * preview.app.stage.scale.y) *
							dpr,
					),
				}
			}, x)
			return [
				...(await sharp(await page.screenshot())
					.extract({ ...point, width: 1, height: 1 })
					.removeAlpha()
					.raw()
					.toBuffer()),
			]
		}
		expect(await previewPixel(480)).toEqual([224, 96, 48])
		expect(await previewPixel(240)).toEqual([32, 48, 96])
		await page.evaluate(() => {
			const { preview } = globalThis as unknown as StageHarness
			;(preview as unknown as { tick(seconds: number): void }).tick(0.5)
			preview.app.render()
		})
		expect(await previewPixel(360)).toEqual([224, 96, 48])
		expect(await previewPixel(480)).toEqual([32, 48, 96])
		await page.evaluate(async () => {
			const runtime = globalThis as unknown as StageHarness
			runtime.preview.complete()
			runtime.preview.app.render()
			await runtime.mounting
		})
		expect(await previewPixel(240)).toEqual([224, 96, 48])
		await page.evaluate(() =>
			(globalThis as unknown as StageHarness).abort.abort(),
		)
		await page.evaluate(
			async ({ scenes, background, portrait }) => {
				const runtime = globalThis as unknown as StageHarness
				const scene = scenes[0]
				const first = scene.beats[0]
				const second = scene.beats.find((beat) => beat.line?.id === '0002')
				if (first.line?.type !== 'text' || second?.line?.type !== 'text')
					throw new Error('Missing animated sentence fixtures')
				scene.beats = [
					{
						...first,
						line: { ...first.line, kind: 'caption' },
						advance: { kind: 'auto' },
					},
					{
						...second,
						actions: second.actions.map((action) =>
							action.name === 'move'
								? { ...action, args: { ...action.args, duration: 1 } }
								: action,
						),
						line: {
							...second.line,
							kind: 'caption',
							content: [
								{ type: 'text', text: 'Unread' },
								{ type: 'pause', seconds: 30 },
							],
						},
						advance: { kind: 'auto' },
					},
				]
				const host = document.createElement('div')
				host.className = 'nl-player'
				host.style.setProperty('--player-text-delay', '0ms')
				document.body.replaceChildren(host)
				runtime.abort = new AbortController()
				const firstPosition = {
					chapterId: 'chapter',
					sceneId: scene.scene.id ?? '',
					sentenceId: '0001',
				}
				const progress = new runtime.StageTest.PlaybackProgress(
					(a, b) => a.sentenceId.localeCompare(b.sentenceId),
					{ mainline: firstPosition, read: [firstPosition], saves: [] },
				)
				runtime.controls = runtime.StageTest.minimalControlsController(
					host,
					'chapter',
					[scene],
					'main',
					progress,
					runtime.abort.signal,
				)
				const commit = runtime.StageTest.PixiStage.prototype.commit
				runtime.StageTest.PixiStage.prototype.commit = function (...args) {
					const animation = commit.apply(this, args)
					if (args[2]?.some((action) => action.name === 'move')) {
						runtime.preview = this
						this.app.ticker.stop()
						runtime.StageTest.PixiStage.prototype.commit = commit
					}
					return animation
				}
				const player = await runtime.StageTest.mountMinimalPlayer(
					host,
					[scene],
					{
						resolveAsset: (id) =>
							`data:image/png;base64,${id === 'room/dusk' ? background : portrait}`,
					},
					runtime.abort.signal,
					(error) => {
						throw error
					},
					{},
					runtime.controls.rendered,
					{
						chapterId: 'chapter',
						onSnapshot(saved) {
							runtime.latest = saved
							progress.record(saved)
						},
					},
				)
				if (!player) throw new Error('Missing animated player')
				runtime.player = player
				runtime.controls.advance(true)
			},
			{ scenes: compiled.scenes, background, portrait },
		)
		await expect(page.locator('.nl-text-display')).toHaveText('Unread')
		await expect(page.locator('.nl-player-stage')).toHaveAttribute(
			'aria-busy',
			'true',
		)
		const duringAnimation = await page.evaluate(() => {
			const runtime = globalThis as unknown as StageHarness
			runtime.saved = structuredClone(runtime.latest)
			const frame = runtime.controls.frame()
			runtime.controls.advance(true)
			return {
				frame,
				saved: runtime.saved,
				history: runtime.player.progress.history.entries,
			}
		})
		expect(duringAnimation.frame).toMatchObject({
			position: { sentenceId: '0002' },
			read: false,
			scripted: true,
		})
		expect(duringAnimation.saved.position.sentenceId).toBe('0002')
		expect(duringAnimation.saved.active).toEqual([
			{ restore: 'skip-relative' },
			{
				restore: 'replay-state',
				action: expect.objectContaining({ name: 'show' }),
			},
			{ restore: 'skip-relative' },
			{ restore: 'restart-text' },
		])
		expect(duringAnimation.history).toHaveLength(2)
		expect(duringAnimation.history.at(-1)).toEqual(duringAnimation.saved)
		await expect(page.locator('.nl-player-text')).toHaveAttribute(
			'data-text-finished',
			'false',
		)
		await expect(page.locator('.nl-player-text')).toHaveAttribute(
			'data-page',
			'1',
		)
		await page.evaluate(() =>
			(globalThis as unknown as StageHarness).preview.complete(),
		)
		await expect(page.locator('.nl-player-stage')).toHaveAttribute(
			'aria-busy',
			'false',
		)
		await page.evaluate(async () => {
			const runtime = globalThis as unknown as StageHarness
			await runtime.player.restore(runtime.saved)
			runtime.preview.app.render()
		})
		await expect(page.locator('.nl-text-display')).toHaveText('Unread')
		expect(await previewPixel(240)).toEqual([224, 96, 48])
		expect(
			await page.evaluate(
				() =>
					(globalThis as unknown as StageHarness).player.state.sprites.center
						?.transform.x,
			),
		).toBe(240)
		await page.evaluate(() =>
			(globalThis as unknown as StageHarness).abort.abort(),
		)
		await page.evaluate(
			async ({ scenes, background, portrait }) => {
				const runtime = globalThis as unknown as StageHarness
				const scene = scenes[0]
				const first = scene.beats[0]
				const second = scene.beats.find((beat) => beat.line?.id === '0002')
				if (first.line?.type !== 'text' || second?.line?.type !== 'text')
					throw new Error('Missing autoplay fixtures')
				runtime.autoplayBusyAtRender = false
				scene.beats = [
					first,
					{
						...second,
						actions: second.actions.map((action) =>
							action.name === 'move'
								? { ...action, args: { ...action.args, duration: 60 } }
								: action,
						),
						advance: { kind: 'click' },
					},
					{
						...first,
						actions: [],
						line: {
							...first.line,
							id: '0003',
							content: [{ type: 'text', text: 'Autoplay completed' }],
						},
					},
				]
				const host = document.createElement('div')
				host.className = 'nl-player'
				host.style.setProperty('--player-text-delay', '0ms')
				document.body.replaceChildren(host)
				runtime.abort = new AbortController()
				const progress = new runtime.StageTest.PlaybackProgress((a, b) =>
					a.sentenceId.localeCompare(b.sentenceId),
				)
				runtime.controls = runtime.StageTest.minimalControlsController(
					host,
					'chapter',
					[scene],
					'main',
					progress,
					runtime.abort.signal,
				)
				const settings = {
					...runtime.StageTest.defaultPlayerSettings,
					autoPlaySpeedMultiplier: 0.25,
				}
				let cancel = () => {}
				const unsubscribe = runtime.controls.subscribe(() => {
					cancel()
					cancel = runtime.StageTest.schedulePlayback(
						runtime.controls,
						settings,
						true,
						false,
					)
				})
				runtime.abort.signal.addEventListener(
					'abort',
					() => {
						cancel()
						unsubscribe()
					},
					{ once: true },
				)
				const commit = runtime.StageTest.PixiStage.prototype.commit
				runtime.StageTest.PixiStage.prototype.commit = function (...args) {
					const animation = commit.apply(this, args)
					if (args[2]?.some((action) => action.name === 'move')) {
						runtime.preview = this
						this.app.ticker.stop()
						runtime.StageTest.PixiStage.prototype.commit = commit
					}
					return animation
				}
				const player = await runtime.StageTest.mountMinimalPlayer(
					host,
					[scene],
					{
						resolveAsset: (id) =>
							`data:image/png;base64,${id === 'room/dusk' ? background : portrait}`,
					},
					runtime.abort.signal,
					(error) => {
						throw error
					},
					{},
					runtime.controls.rendered,
					{
						chapterId: 'chapter',
						onSnapshot(saved) {
							runtime.latest = saved
							progress.record(saved)
							if (saved.position.sentenceId === '0002')
								runtime.autoplayBusyAtRender =
									host
										.querySelector('.nl-player-stage')
										?.getAttribute('aria-busy') === 'true'
						},
					},
				)
				if (!player) throw new Error('Missing autoplay player')
				runtime.player = player
			},
			{ scenes: compiled.scenes, background, portrait },
		)
		await expect
			.poll(() =>
				page.evaluate(() =>
					(
						globalThis as unknown as StageHarness
					).player.progress.history.entries.map(
						(entry) => entry.position.sentenceId,
					),
				),
			)
			.toEqual(['0001', '0002', '0003'])
		expect(
			await page.evaluate(
				() => (globalThis as unknown as StageHarness).autoplayBusyAtRender,
			),
		).toBe(true)
		await page.evaluate(() =>
			(globalThis as unknown as StageHarness).abort.abort(),
		)
	} finally {
		await app.close()
		await rm(directory, { recursive: true, force: true })
	}
})

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
				(effect) =>
					[
						`@camera reset duration 0.4\n@filter ${effect} value 0.5`,
						effect,
					] as [string, string],
			),
			['@filter none\n@hide traveler', '空场'],
			['@cg cg-test\n@filter sepia value 0.5', '合成基准'],
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
			await page.locator('.nl-player').evaluate((host) => {
				host.style.setProperty('--player-text-delay', '0ms')
				host.dispatchEvent(new Event('novelive:player-settings'))
			})
			const text = page.locator('.nl-player-text .nl-text-display')
			const canvas = page.locator('.nl-player canvas')
			let panelWithoutParticles = Buffer.alloc(0)
			async function panelPixels() {
				const shot = sharp(
					await page.locator('.nl-player-textbox').screenshot(),
				)
				const { width = 0, height = 0 } = await shot.metadata()
				return shot
					.extract({
						left: Math.floor(width / 2),
						top: 8,
						width: Math.floor(width / 2) - 8,
						// Sample the upper half so the quick menu strip stays out of it.
						height: Math.floor(height / 2),
					})
					.removeAlpha()
					.raw()
					.toBuffer()
			}
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
				// setContentSize resolves before the compositor applies the new
				// size; wait until the viewport actually reaches it.
				await page.waitForFunction(
					(size) => innerWidth === size.width && innerHeight === size.height,
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
				await expect(page.locator('.nl-player-stage')).toHaveAttribute(
					'aria-busy',
					'false',
				)
				await expect(page.locator('.nl-player-text')).toHaveAttribute(
					'data-text-finished',
					'true',
				)
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
				if (label === '合成基准') {
					panelWithoutParticles = await panelPixels()
					// 柔边对话框是对舞台的实时半透明渐变复合（原型设计），
					// 面板颜色随高度渐变，不可能在整面上逐像素同色；
					// 静态场景下面板必须逐帧稳定——任何合成噪声、
					// 动画渗漏或错位都会破坏逐字节一致。
					expect((await panelPixels()).equals(panelWithoutParticles)).toBe(true)
				}
				if (label === '合成演出') {
					// 粒子按设计会透过渐变上缘微弱显影，逐像素不变已不再成立；
					// 但 scrim 必须把粒子压成稀疏微弱的显影——偏离基线超过 8 的
					// 采样点不得超过 2%（实测约 0.4%，若 scrim 丢失或粒子层
					// 错误地盖到对话框上方，偏离采样会成片出现）。
					for (let frame = 0; frame < 3; frame++) {
						const current = await panelPixels()
						expect(current.length).toBe(panelWithoutParticles.length)
						let deviating = 0
						for (let i = 0; i < current.length; i++)
							if (Math.abs(current[i] - panelWithoutParticles[i]) > 8)
								deviating++
						expect(deviating / current.length).toBeLessThan(0.02)
					}
					await page.screenshot({ path: `${evidence}/stage-composite.png` })
				}
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
