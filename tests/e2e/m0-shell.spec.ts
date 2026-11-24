import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const require = createRequire(
	new URL('../../apps/desktop/package.json', import.meta.url),
)

async function launch(e2e: boolean) {
	const data = mkdtempSync(join(tmpdir(), 'novelive-e2e-'))
	const env = { ...process.env, NL_REPLAY: 'strict', NL_E2E: e2e ? '1' : '0' }
	try {
		const desktop = await electron.launch({
			executablePath: require('electron'),
			args: ['apps/desktop', `--user-data-dir=${data}`],
			env,
		})
		return {
			desktop,
			async close() {
				try {
					await desktop.close()
				} finally {
					rmSync(data, { recursive: true, force: true })
				}
			},
		}
	} catch (error) {
		rmSync(data, { recursive: true, force: true })
		throw error
	}
}

test('M0 desktop shell renders the empty library and connects to a real creator', async () => {
	const run = await launch(true)
	try {
		const page = await run.desktop.firstWindow()
		await expect(
			page.getByRole('heading', { name: '书库', exact: true }),
		).toBeVisible()
		await expect(page.getByText('书库还是空的')).toBeVisible()
		await expect(page.getByRole('status')).toHaveText('创作端已就绪')

		const result = await page.evaluate(async () => {
			const state = await window.novelive.host.appState()
			const events = await window.novelive.call('events.list', {
				scope: 'app',
				scopeId: 'app',
				afterSeq: 0,
			}).promise
			const sqlite = await window.novelive.call('debug.sqliteSmoke', {}).promise
			const sharp = await window.novelive.call('debug.sharpSmoke', {}).promise
			return { state, events, sqlite, sharp }
		})
		expect(result.state.creator).toBe('ready')
		expect(result.events.snapshot).toEqual({
			generation: result.state.generation,
			ready: true,
		})
		expect(result.sqlite).toEqual({ ok: true, journalMode: 'wal', value: 1 })
		expect(result.sharp.ok).toBe(true)
		await page.screenshot({ path: test.info().outputPath('empty-library.png') })
	} finally {
		await run.close()
	}
})

test('M0 desktop shell does not register debug commands without NL_E2E', async () => {
	const run = await launch(false)
	try {
		const page = await run.desktop.firstWindow()
		await expect(page.getByRole('status')).toHaveText('创作端已就绪')
		for (const command of ['debug.sqliteSmoke', 'debug.sharpSmoke'] as const) {
			const result = await page.evaluate(
				(name) =>
					window.novelive.call(name, {}).promise.catch((error) => error),
				command,
			)
			expect(result).toMatchObject({ code: 'unsupported' })
		}
	} finally {
		await run.close()
	}
})
