import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import sharp from 'sharp'
import { createServer } from 'vite'

const require = createRequire(
	new URL('../../apps/desktop/package.json', import.meta.url),
)

test('M1b fixed scene renders two host resources in Electron', async () => {
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
		const vite = await createServer({
			configFile: false,
			server: { host: '127.0.0.1', port: 0 },
		})
		try {
			await vite.listen()
			const url = vite.resolvedUrls?.local[0]
			if (!url) throw new Error('Fixed scene server did not start')
			const app = await electron.launch({
				executablePath: require('electron'),
				args: ['apps/desktop', `--user-data-dir=${profile}`],
				env: {
					...process.env,
					ELECTRON_RENDERER_URL: `${url}tests/fixtures/production-contract/`,
					NL_REPLAY: 'strict',
				},
			})
			try {
				const page = await app.firstWindow()
				const canvas = page.locator('canvas')
				await expect
					.poll(async () =>
						(await canvas.isVisible())
							? 'canvas'
							: await page.locator('main').textContent(),
					)
					.toBe('canvas')
				const pixels = await sharp(await canvas.screenshot())
					.raw()
					.toBuffer({ resolveWithObject: true })
				const at = (x: number, y: number) =>
					Array.from(
						pixels.data.subarray(
							(y * pixels.info.width + x) * pixels.info.channels,
							(y * pixels.info.width + x) * pixels.info.channels + 3,
						),
					)
				expect(at(5, 5)).toEqual([32, 48, 96])
				expect(at(480, 270)).toEqual([224, 96, 48])
			} finally {
				await app.close()
			}
		} finally {
			await vite.close()
		}
	} finally {
		await rm(profile, { recursive: true, force: true })
	}
})
