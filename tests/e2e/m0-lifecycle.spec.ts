import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const require = createRequire(
	new URL('../../apps/desktop/package.json', import.meta.url),
)

test('M0 creator lifecycle and protocol recovers an interrupted generation and confines cache images', async () => {
	const profile = await mkdtemp(join(tmpdir(), 'novelive-lifecycle-'))
	try {
		const cache = join(profile, 'cache')
		await mkdir(cache)
		const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="9"/>'
		await writeFile(join(cache, '样图.svg'), svg)
		await writeFile(join(profile, 'outside.svg'), svg)
		await symlink(join(profile, 'outside.svg'), join(cache, 'outside.svg'))
		const app = await electron.launch({
			executablePath: require('electron'),
			args: ['apps/desktop', `--user-data-dir=${profile}`],
			env: { ...process.env, NL_E2E: '1', NL_REPLAY: 'strict' },
		})
		try {
			const page = await app.firstWindow()
			const state = () => page.evaluate(() => window.novelive.host.appState())
			await expect.poll(async () => (await state()).creator).toBe('ready')
			const initial = await state()
			const receive = (url: string) =>
				page.evaluate(async (source) => {
					const image = new Image()
					image.src = source.startsWith('novelive:')
						? source
						: window.novelive.resourceUrl(source)
					await image.decode().catch(() => {})
					return image.naturalWidth
				}, url)
			expect(await receive('样图.svg')).toBe(8)
			expect(await receive('outside.svg')).toBe(0)
			expect(await receive('novelive://cache/%2e%2e%2foutside.svg')).toBe(0)
			expect(
				await page.evaluate(
					() => window.novelive.call('debug.sqliteSmoke', {}).promise,
				),
			).toEqual({ ok: true, journalMode: 'wal', value: 1 })
			expect(
				await page.evaluate(
					() => window.novelive.call('debug.sharpSmoke', {}).promise,
				),
			).toEqual({ ok: true })

			const pid = await app.evaluate(
				({ app }) =>
					app
						.getAppMetrics()
						.find(
							(item) =>
								item.name === 'Novelive Creator' ||
								item.serviceName === 'Novelive Creator',
						)?.pid,
			)
			expect(pid).toBeDefined()
			if (!pid) throw new Error('No creator process')
			process.kill(pid, 'SIGSTOP')
			const outcome = page.evaluate(() =>
				window.novelive
					.call('events.list', {
						scope: 'app',
						scopeId: 'app',
						afterSeq: 0,
					})
					.promise.catch((error) => error.code),
			)
			await page.evaluate(() => new Promise(requestAnimationFrame))
			process.kill(pid, 'SIGKILL')
			expect(await outcome).toBe('creator_down')
			await expect
				.poll(state)
				.toMatchObject({ creator: 'ready', generation: initial.generation + 1 })
			expect(
				await page.evaluate(
					() =>
						window.novelive.call('events.list', {
							scope: 'app',
							scopeId: 'app',
							afterSeq: 0,
						}).promise,
				),
			).toMatchObject({
				gap: false,
				snapshot: { ready: true, generation: initial.generation + 1 },
			})

			await page.evaluate(() => window.novelive.host.restartCreator())
			await expect
				.poll(state)
				.toMatchObject({ creator: 'ready', generation: initial.generation + 2 })
		} finally {
			await app.close()
		}
	} finally {
		await rm(profile, { recursive: true, force: true })
	}
})

test('M0 creator lifecycle and protocol stops after three failed handshakes until manually restarted', async () => {
	const profile = await mkdtemp(join(tmpdir(), 'novelive-breaker-'))
	try {
		const app = await electron.launch({
			executablePath: require('electron'),
			args: ['apps/desktop', `--user-data-dir=${profile}`],
			env: { ...process.env, NL_E2E: '0' },
		})
		try {
			const page = await app.firstWindow()
			const state = () => page.evaluate(() => window.novelive.host.appState())
			await expect.poll(async () => (await state()).creator).toBe('ready')
			const initial = (await state()).generation
			const original = await app.evaluate(({ utilityProcess }) => {
				const fork = utilityProcess.fork
				Object.defineProperty(utilityProcess, 'testOriginalFork', {
					value: fork,
					configurable: true,
				})
				utilityProcess.fork = (_entry, args, options) =>
					fork('/nonexistent/novelive-test-entry.js', args, options)
				return typeof fork
			})
			expect(original).toBe('function')
			for (let attempt = 1; attempt <= 3; attempt++) {
				await page.reload()
				await expect.poll(state).toMatchObject({
					creator: 'failed',
					generation: initial + attempt,
					breakerOpen: attempt === 3,
				})
			}
			await page.reload()
			expect(await state()).toMatchObject({
				creator: 'failed',
				generation: initial + 3,
				breakerOpen: true,
			})
			await app.evaluate(({ utilityProcess }) => {
				utilityProcess.fork = Reflect.get(utilityProcess, 'testOriginalFork')
				Reflect.deleteProperty(utilityProcess, 'testOriginalFork')
			})
			await page.evaluate(() => window.novelive.host.restartCreator())
			await expect.poll(state).toMatchObject({
				creator: 'ready',
				generation: initial + 4,
				breakerOpen: false,
			})
			expect(
				await page.evaluate(() =>
					window.novelive
						.call('debug.sqliteSmoke', {})
						.promise.catch((error) => error.code),
				),
			).toBe('unsupported')
		} finally {
			await app.close()
		}
	} finally {
		await rm(profile, { recursive: true, force: true })
	}
})
