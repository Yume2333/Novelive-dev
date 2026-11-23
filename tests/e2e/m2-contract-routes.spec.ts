import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const require = createRequire(
	new URL('../../apps/desktop/package.json', import.meta.url),
)

test('M2 contract routes mount the editor and Bible without loading production', async () => {
	const profile = await mkdtemp(join(tmpdir(), 'novelive-m2-routes-'))
	try {
		const app = await electron.launch({
			executablePath: require('electron'),
			args: ['apps/desktop', `--user-data-dir=${profile}`],
			env: { ...process.env, NL_E2E: '1', NL_REPLAY: 'strict' },
		})
		try {
			const page = await app.firstWindow()
			await expect(page.getByText('创作端已就绪')).toBeAttached()
			const work = '/work/f947f6e9-b854-4b16-b322-6aad47eb5df8'
			for (const [path, title] of [
				['edit', '编辑器'],
				['bible', '设定集'],
			]) {
				await page.evaluate((hash) => {
					window.location.hash = hash
				}, `${work}/${path}`)
				await expect(
					page.getByRole('heading', { name: title, exact: true }),
				).toBeVisible()
			}
			await page.goBack()
			await expect(
				page.getByRole('heading', { name: '编辑器', exact: true }),
			).toBeVisible()
		} finally {
			await app.close()
		}
	} finally {
		await rm(profile, { recursive: true, force: true })
	}
})
