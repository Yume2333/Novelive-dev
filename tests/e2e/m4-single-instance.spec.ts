import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const require = createRequire(
	new URL('../../apps/desktop/package.json', import.meta.url),
)

test('M4 same-profile second instance exits and focuses the hidden original; distinct profiles remain independent', async () => {
	const root = await mkdtemp(join(tmpdir(), 'novelive-single-instance-'))
	const profile = join(root, 'primary')
	const env = { ...process.env, ELECTRON_RENDERER_URL: '', NL_REPLAY: 'strict' }
	const executablePath = require('electron') as string
	const first = await electron.launch({
		executablePath,
		args: ['apps/desktop', `--user-data-dir=${profile}`],
		env,
	})
	let duplicate: ChildProcess | undefined
	let independent: Awaited<ReturnType<typeof electron.launch>> | undefined
	try {
		const page = await first.firstWindow()
		await expect(page.getByRole('status')).toHaveText('创作端已就绪')
		const before = await page.evaluate(() => window.novelive.host.appState())
		await first.evaluate(({ BrowserWindow }) =>
			BrowserWindow.getAllWindows()[0].hide(),
		)
		expect(
			await first.evaluate(({ BrowserWindow }) =>
				BrowserWindow.getAllWindows()[0].isVisible(),
			),
		).toBe(false)
		duplicate = spawn(
			executablePath,
			['apps/desktop', `--user-data-dir=${profile}`],
			{ env, stdio: 'ignore' },
		)
		await expect.poll(() => duplicate?.exitCode).toBe(0)
		await expect
			.poll(() =>
				first.evaluate(({ BrowserWindow }) => {
					const window = BrowserWindow.getAllWindows()[0]
					return {
						visible: window.isVisible(),
						focused: window.isFocused(),
						minimized: window.isMinimized(),
					}
				}),
			)
			.toEqual({ visible: true, focused: true, minimized: false })
		expect(
			await first.evaluate(
				({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
			),
		).toBe(1)
		expect(
			await page.evaluate(() => window.novelive.host.appState()),
		).toMatchObject({ creator: 'ready', generation: before.generation })
		independent = await electron.launch({
			executablePath,
			args: ['apps/desktop', `--user-data-dir=${join(root, 'independent')}`],
			env,
		})
		const otherPage = await independent.firstWindow()
		await expect(otherPage.getByRole('status')).toHaveText('创作端已就绪')
		expect(
			await independent.evaluate(({ app }) => app.getPath('userData')),
		).not.toBe(profile)
	} finally {
		if (duplicate?.exitCode === null) duplicate.kill()
		await independent?.close()
		await first.close()
		await rm(root, { recursive: true, force: true })
	}
})
