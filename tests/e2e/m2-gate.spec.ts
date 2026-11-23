import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
	_electron as electron,
	expect,
	type Page,
	test,
} from '@playwright/test'
import { configuration } from '../fixtures/cassettes/m1b-gate/fixture'
import {
	chapterId,
	directory,
	instruction,
	revisionProject,
	sceneId,
} from '../fixtures/cassettes/m2-revisions/fixture'

const require = createRequire(
	new URL('../../apps/desktop/package.json', import.meta.url),
)
const evidence = resolve('.workflow/evidence/m2')
const chatDirectory = resolve(
	process.env.NL_CHAT_CASSETTE_DIR ?? 'tests/fixtures/cassettes/m2-gate',
)

async function capture(page: Page, name: string) {
	await page.evaluate(() => document.fonts.ready)
	expect(
		await page.evaluate(() =>
			[...document.querySelectorAll<HTMLElement>('*')]
				.filter((el) => {
					const style = getComputedStyle(el)
					return (
						el.clientHeight > 0 &&
						el.scrollHeight > el.clientHeight + 1 &&
						['auto', 'scroll'].includes(style.overflowY) &&
						style.scrollbarWidth !== 'none' &&
						getComputedStyle(el, '::-webkit-scrollbar').display !== 'none'
					)
				})
				.map((el) => el.className),
		),
	).toEqual([])
	await page.screenshot({
		path: join(evidence, `${name}.png`),
		animations: 'disabled',
	})
}

test('M2 revise a work through editor and Agent in real Electron', async () => {
	test.setTimeout(180_000)
	const recording = process.env.NL_REPLAY === 'record'
	if (
		recording &&
		(!process.env.NL_IMAGE_BASE_URL ||
			!process.env.NL_IMAGE_API_KEY ||
			!process.env.NL_CHAT_CASSETTE_DIR ||
			!process.env.NL_USAGE_CSV)
	)
		throw new Error(
			'Recording requires private NL_CHAT_CASSETTE_DIR and NL_USAGE_CSV, NL_IMAGE_BASE_URL and NL_IMAGE_API_KEY',
		)
	const root = await mkdtemp(join(tmpdir(), 'novelive-m2-gate-'))
	await mkdir(evidence, { recursive: true })
	const fixture = await revisionProject(root, { mode: 'strict', directory })
	const { workId, project } = fixture
	project.database
		.prepare(
			"INSERT INTO chapter (work_id, chapter_id, ord, user_state) VALUES (?, ?, 0, 'published')",
		)
		.run(workId, chapterId)
	const projectDir = project.root
	project.close()
	const profile = join(root, 'profile')
	const missingLog = join(root, 'missing-replay.txt')
	const launch = () =>
		electron.launch({
			executablePath: require('electron'),
			args: ['apps/desktop', `--user-data-dir=${profile}`],
			env: {
				...process.env,
				ELECTRON_RENDERER_URL: '',
				NL_REPLAY: recording ? 'record' : 'strict',
				NL_CHAT_CASSETTE_DIR: chatDirectory,
				NL_PRODUCTION_CASSETTE_DIR: chatDirectory,
				NL_PRODUCTION_FALLBACK_DIR: directory,
				NL_REPLAY_MISSING_LOG: missingLog,
			},
		})
	let app = await launch()
	try {
		await app.evaluate(({ BrowserWindow }) =>
			BrowserWindow.getAllWindows()[0].setContentSize(1440, 1000),
		)
		const dataDir = await app.evaluate(({ app }) => app.getPath('userData'))
		await mkdir(join(dataDir, 'projects'), { recursive: true })
		await writeFile(join(dataDir, 'projects', workId), projectDir)
		let page = await app.firstWindow()
		await expect(page.getByText('创作端已就绪')).toBeAttached()
		const endpoint = new URL(
			recording
				? (process.env.NL_IMAGE_BASE_URL as string)
				: 'https://relay.invalid/v1',
		)
		if (endpoint.pathname === '/') endpoint.pathname = '/v1'
		await page.evaluate(
			(patch) => window.novelive.call('config.update', patch).promise,
			{
				...configuration,
				models: {
					...configuration.models,
					main: {
						...configuration.models.main,
						model: 'gemini-3.8-flash',
						contextWindow: 12_000,
						maxOutputTokens: 1024,
						baseUrl: endpoint.href,
						apiKey: recording
							? (process.env.NL_IMAGE_API_KEY as string)
							: 'offline-placeholder',
					},
				},
			},
		)
		const openEditor = async () => {
			await page.evaluate((id) => {
				window.location.hash = `/work/${id}/edit`
			}, workId)
			await expect(
				page.getByRole('textbox', { name: 'NVS 剧本' }),
			).toContainText('纸船')
		}
		await openEditor()
		await page.getByRole('button', { name: '原文对照' }).click()
		await expect(
			page.getByRole('button', { name: /p0001 · 暮色中/ }),
		).toBeVisible()
		await page.getByRole('button', { name: /p0001 · 暮色中/ }).click()
		await page.getByRole('button', { name: '快捷位置', exact: true }).click()
		await page.getByRole('menuitem').filter({ hasText: '#0001' }).click()
		await page.getByRole('button', { name: '从当前句预览' }).click()
		await expect(page.locator('.nl-player-text')).toHaveText(
			'暮色中，一只纸船从桥下漂过。',
		)
		await capture(page, '01-source-and-preview')
		await page.getByRole('textbox', { name: '重写要求' }).fill(instruction)
		await page.getByRole('button', { name: '重写场景', exact: true }).click()
		const diffs = page.getByRole('region', { name: '重写差异' })
		await expect(diffs.getByRole('checkbox')).not.toHaveCount(0)
		for (const box of await diffs.getByRole('checkbox').all())
			await box.uncheck()
		await expect(
			diffs.getByRole('button', { name: '应用勾选差异' }),
		).toBeDisabled()
		await diffs
			.locator('label')
			.filter({ hasText: '慢慢' })
			.getByRole('checkbox')
			.check()
		await capture(page, '02-editor-rewrite')
		await diffs.getByRole('button', { name: '应用勾选差异' }).click()
		const script = page.getByRole('textbox', { name: 'NVS 剧本' })
		await expect(script).toContainText('慢慢')
		await expect(script).not.toContainText('笛声')
		await page.evaluate(
			(connection) =>
				window.novelive.call('config.update', {
					models: {
						writing: {
							...connection,
							model: 'gemini-3.8-flash',
							maxOutputTokens: 1024,
						},
					},
				}).promise,
			{
				baseUrl: endpoint.href,
				apiKey: recording
					? (process.env.NL_IMAGE_API_KEY as string)
					: 'offline-placeholder',
			},
		)
		await page.getByRole('button', { name: 'Agent', exact: true }).click()
		const agent = page.getByRole('complementary', { name: 'Agent' })
		const composer = agent.getByRole('textbox', { name: '给 Agent 发消息' })
		await expect(agent.getByText('无法读取会话')).toHaveCount(0)
		await expect(composer).toBeEnabled()
		await capture(page, '03-agent-loaded')
		const prompt = `先输出 text 代码块，内容仅为「纸船与灯火」。调用 propose_rewrite_scene 一次：chapterId=${chapterId}, sceneId=${sceneId}, instruction=将第一句改为「暮色里，一只纸船缓缓漂过。」并在结尾增加「远处传来笛声。」保留第二句及所有演出指令, reason=增加声音。确认后只回复「已生成，请勾选差异」。`
		await composer.fill(prompt)
		await agent.getByRole('button', { name: '发送', exact: true }).click()
		const card = agent.getByRole('region', { name: '确认卡' })
		await expect
			.poll(
				async () => {
					const diagnostics = await readFile(missingLog, 'utf8').catch(() => '')
					const missing = diagnostics.match(
						/Missing strict replay cassette:[^\n]+/,
					)
					if (missing) throw new Error(missing[0])
					return card
						.getByRole('button', { name: '确认', exact: true })
						.isVisible()
				},
				{ timeout: 95_000 },
			)
			.toBe(true)
		await expect(agent.locator('pre')).toContainText('纸船与灯火')
		await expect(script).not.toContainText('笛声')
		await capture(page, '04-agent-cjk-confirm')
		await card.getByRole('button', { name: '确认', exact: true }).click()
		const chatDiff = card.getByRole('region', { name: '重写差异' })
		await expect(chatDiff.getByRole('checkbox')).not.toHaveCount(0)
		await expect(
			agent.getByText('已生成，请勾选差异', { exact: true }),
		).toBeVisible()
		await expect(
			agent.getByRole('button', { name: '停止', exact: true }),
		).toHaveCount(0)
		for (const box of await chatDiff.getByRole('checkbox').all())
			await box.uncheck()
		await expect(
			chatDiff.getByRole('button', { name: '应用勾选差异' }),
		).toBeDisabled()
		await chatDiff
			.locator('label')
			.filter({ hasText: '笛声' })
			.getByRole('checkbox')
			.check()
		await chatDiff.getByRole('button', { name: '应用勾选差异' }).click()
		await expect(script).toContainText('笛声')
		await expect(script).toContainText('慢慢')
		await expect(script).not.toContainText('缓缓')
		await capture(page, '05-agent-rewrite-applied')
		const history = await page.evaluate(
			(target) => window.novelive.call('editor.history', target).promise,
			{ workId, chapterId },
		)
		expect(
			history.entries.filter((entry) => entry.kind === 'rewrite'),
		).toHaveLength(2)
		await app.close()
		app = await launch()
		page = await app.firstWindow()
		await expect(page.getByText('创作端已就绪')).toBeAttached()
		await openEditor()
		await expect(page.getByRole('textbox', { name: 'NVS 剧本' })).toContainText(
			'笛声',
		)
		const reopened = await page.evaluate(
			(target) => window.novelive.call('editor.history', target).promise,
			{ workId, chapterId },
		)
		expect(reopened).toEqual(history)
		await page.getByRole('button', { name: 'Agent', exact: true }).click()
		await expect(page.getByText('已确认', { exact: true })).toBeVisible()
		await capture(page, '06-reopened-persisted')
	} finally {
		await app.close()
		await rm(root, { recursive: true, force: true })
	}
})
