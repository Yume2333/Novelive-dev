import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect, test } from '@playwright/test'
import sharp from 'sharp'
import { build } from 'vite'

const require = createRequire(
	new URL('../../apps/desktop/package.json', import.meta.url),
)

test('M1b fixed scene renders two host resources from the built Electron renderer', async () => {
	const result = await build({
		configFile: false,
		logLevel: 'silent',
		build: {
			write: false,
			lib: {
				entry: fileURLToPath(
					new URL(
						'../fixtures/production-contract/renderer.ts',
						import.meta.url,
					),
				),
				name: 'fixedSceneFixture',
				formats: ['iife'],
			},
		},
	})
	const [bundle] = Array.isArray(result) ? result : [result]
	if (!bundle || !('output' in bundle)) {
		throw new Error('Expected one fixed scene bundle')
	}
	const fixture = bundle.output.find((entry) => entry.type === 'chunk')
	if (!fixture) throw new Error('Missing fixed scene bundle')

	const profile = await mkdtemp(join(tmpdir(), 'novelive-fixed-scene-'))
	try {
		async function cacheImage(name: string, path: string[], color: string) {
			const folder = join(profile, 'cache', ...path)
			await mkdir(folder, { recursive: true })
			await sharp({
				create: { width: 32, height: 128, channels: 3, background: color },
			})
				.png()
				.toFile(join(folder, name))
		}
		await Promise.all([
			cacheImage('dusk.png', ['room'], '#203060'),
			cacheImage('calm.png', ['traveler', 'coat'], '#e06030'),
		])
		const app = await electron.launch({
			executablePath: require('electron'),
			args: ['apps/desktop', `--user-data-dir=${profile}`],
			env: {
				...process.env,
				ELECTRON_RENDERER_URL: '',
				NL_REPLAY: 'strict',
			},
		})
		try {
			const page = await app.firstWindow()
			await expect(page).toHaveURL(/^file:.*\/out\/renderer\/index\.html$/)
			await page.addScriptTag({ content: fixture.code })
			const stage = page.locator('#fixed-scene')
			const canvas = stage.locator('canvas')
			await expect
				.poll(async () =>
					(await canvas.isVisible()) ? 'canvas' : await stage.textContent(),
				)
				.toBe('canvas')
			const pixels = await sharp(await canvas.screenshot())
				.raw()
				.toBuffer({ resolveWithObject: true })
			const at = (x: number, y: number) => {
				const offset = (y * pixels.info.width + x) * pixels.info.channels
				return Array.from(pixels.data.subarray(offset, offset + 3))
			}
			expect(at(5, 5)).toEqual([32, 48, 96])
			expect(at(480, 270)).toEqual([224, 96, 48])
		} finally {
			await app.close()
		}
	} finally {
		await rm(profile, { recursive: true, force: true })
	}
})
