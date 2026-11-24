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
	test.setTimeout(330_000)
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
	project.database
		.prepare("UPDATE work SET status = 'done' WHERE work_id = ?")
		.run(workId)
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
			{ useInnerText: true },
		)
		await capture(page, '01-source-and-preview')
		await page.getByRole('button', { name: '让 Agent 重写本场景' }).click()
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
		await page.getByRole('button', { name: 'Novelive Agent' }).click()
		const agent = page.getByRole('complementary', { name: 'Agent' })
		const composer = agent.getByRole('textbox', { name: '给 Agent 发消息' })
		await expect(agent.getByText('无法读取会话')).toHaveCount(0)
		await expect(composer).toBeEnabled()
		await capture(page, '03-agent-loaded')
		const prompt =
			'先输出 text 代码块，内容仅为「纸船与灯火」。对当前位置调用 propose_rewrite_scene 一次：instruction=将第一句改为「暮色里，一只纸船缓缓漂过。」并在结尾增加「远处传来笛声。」保留第二句及所有演出指令, reason=增加声音。确认后只回复「已生成，请勾选差异」。'
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
		await expect(
			agent.locator('pre').filter({ hasText: '纸船与灯火' }),
		).toBeVisible()
		await expect(script).not.toContainText('笛声')
		const codeBlock = agent.locator('[data-streamdown="code-block"]').filter({
			hasText: '纸船与灯火',
		})
		await expect(codeBlock.getByRole('button')).toHaveCount(2)
		expect(
			await codeBlock.evaluate((block) => {
				const header = block.querySelector(
					'[data-streamdown="code-block-header"]',
				) as HTMLElement
				const actions = block.querySelector(
					'[data-streamdown="code-block-actions"]',
				) as HTMLElement
				const body = block.querySelector(
					'[data-streamdown="code-block-body"]',
				) as HTMLElement
				const pre = block.querySelector('pre') as HTMLElement
				const headerBounds = header.getBoundingClientRect()
				const actionsBounds = actions.getBoundingClientRect()
				return {
					surface:
						getComputedStyle(block).backgroundColor !== 'rgba(0, 0, 0, 0)',
					border: parseFloat(getComputedStyle(block).borderTopWidth) > 0,
					padding: parseFloat(getComputedStyle(body).paddingTop) > 0,
					headerAligned:
						Math.abs(
							headerBounds.y +
								headerBounds.height / 2 -
								actionsBounds.y -
								actionsBounds.height / 2,
						) < 2,
					iconButtons: [...actions.querySelectorAll('button')].every(
						(button) =>
							getComputedStyle(button).borderTopWidth === '0px' &&
							button.clientWidth === 32,
					),
					wrap: getComputedStyle(pre).whiteSpace === 'pre-wrap',
					cjkFont: getComputedStyle(pre).fontFamily.includes('Noto Sans SC'),
				}
			}),
		).toEqual({
			surface: true,
			border: true,
			padding: true,
			headerAligned: true,
			iconButtons: true,
			wrap: true,
			cjkFont: true,
		})
		await capture(page, '04-agent-cjk-confirm')
		await card.getByRole('button', { name: '确认', exact: true }).click()
		const chatDiff = card.getByRole('region', { name: '重写差异' })
		await expect(chatDiff.getByRole('checkbox')).not.toHaveCount(0, {
			timeout: 95_000,
		})
		await expect(
			agent.getByText('已生成，请勾选差异', { exact: true }),
		).toBeVisible({ timeout: 95_000 })
		await expect(
			agent.getByRole('button', { name: '停止', exact: true }),
		).toHaveCount(0, { timeout: 95_000 })
		await page.getByRole('button', { name: 'Novelive Agent' }).click()
		await page.getByRole('button', { name: 'Novelive Agent' }).click()
		await expect(chatDiff).toBeVisible()
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
		await capture(page, '05-agent-rewrite-selected')
		const beforeAgent = (
			await script.locator('.cm-line').allTextContents()
		).join('\n')
		await script.fill(beforeAgent.replace('桥下很安静', '未保存的桥下修改'))
		await chatDiff.getByRole('button', { name: '应用勾选差异' }).click()
		await expect(
			page.getByText('章节已更新，当前修改已保留；放弃修改后加载新版本'),
		).toBeVisible()
		await expect(script).toContainText('未保存的桥下修改')
		await script.fill(beforeAgent)
		await expect(
			page.getByRole('button', { name: '放弃修改', exact: true }),
		).toBeEnabled()
		await page.getByRole('button', { name: '放弃修改', exact: true }).click()
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
		await app.evaluate(({ BrowserWindow }) =>
			BrowserWindow.getAllWindows()[0].setContentSize(1440, 1000),
		)
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
		await page.getByRole('button', { name: 'Novelive Agent' }).click()
		await expect(page.getByText('已确认', { exact: true })).toBeVisible()
		await expect(page.getByRole('region', { name: '重写差异' })).toHaveCount(0)
		await capture(page, '06-reopened-persisted')
		await page.getByRole('button', { name: 'Novelive Agent' }).click()
		await page.evaluate(
			(patch) => window.novelive.call('config.update', patch).promise,
			configuration,
		)
		await page.evaluate(() => {
			const decode = HTMLImageElement.prototype.decode
			HTMLImageElement.prototype.decode = async function () {
				await decode.call(this)
				document.body.dataset.previewImageSrc = this.currentSrc
			}
		})
		await page.getByRole('button', { name: '从当前句预览' }).click()
		await expect(page.locator('canvas')).toBeVisible()
		await expect(page.locator('.nl-player-text')).toContainText('暮色里')
		const previewBefore = await page
			.locator('body')
			.getAttribute('data-preview-image-src')
		expect(previewBefore).toMatch(/^novelive:\/\/cache\//)
		const imageBefore = await page.evaluate(
			(workId) =>
				window.novelive.call('editor.imageRevision', {
					workId,
					assetId: 'ada/uniform/neutral',
				}).promise,
			workId,
		)
		await page.getByRole('textbox', { name: '重绘要求' }).fill('光线更柔和')
		const beforeImage = (
			await page
				.getByRole('textbox', { name: 'NVS 剧本' })
				.locator('.cm-line')
				.allTextContents()
		).join('\n')
		await page
			.getByRole('textbox', { name: 'NVS 剧本' })
			.fill(beforeImage.replace('桥下很安静', '桥下依然很安静'))
		await page.getByRole('textbox', { name: 'NVS 剧本' }).press('Control+Home')
		await page.getByRole('button', { name: '保存当前句', exact: true }).click()
		await expect(
			page.getByRole('button', { name: '撤销', exact: true }),
		).toBeEnabled()
		await page.evaluate(() => {
			const observer = new MutationObserver(() => {
				if (
					document.querySelector(
						'[role="status"][aria-label="正在生成图片"] svg',
					)
				)
					document.body.dataset.imageLoadingObserved = 'true'
			})
			observer.observe(document.body, { childList: true, subtree: true })
		})
		await page
			.getByRole('button', { name: '出一张，直接替换', exact: true })
			.click()
		await expect
			.poll(async () => {
				const diagnostics = await readFile(missingLog, 'utf8').catch(() => '')
				if (diagnostics) throw new Error(diagnostics)
				const alerts = await page.getByRole('alert').allTextContents()
				if (alerts.length) throw new Error(alerts.join('\n'))
				return (
					await page.evaluate(
						(workId) =>
							window.novelive.call('editor.history', { workId }).promise,
						workId,
					)
				).entries.filter((entry) => entry.kind === 'image').length
			})
			.toBe(1)
		const imageAfter = await page.evaluate(
			(workId) =>
				window.novelive.call('editor.imageRevision', {
					workId,
					assetId: 'ada/uniform/neutral',
				}).promise,
			workId,
		)
		expect(imageAfter.revision).not.toBe(imageBefore.revision)
		const replacedPreview = await page.evaluate(async (workId) => {
			const asset = await window.novelive.call('production.resolveAsset', {
				workId,
				assetId: 'ada/uniform/neutral',
			}).promise
			return asset && window.novelive.resourceUrl(asset.cachePath)
		}, workId)
		expect(replacedPreview).not.toBe(previewBefore)
		expect(replacedPreview?.split('/').at(-1)).not.toBe(
			previewBefore?.split('/').at(-1),
		)
		await expect(page.locator('body')).toHaveAttribute(
			'data-preview-image-src',
			replacedPreview as string,
		)
		const imageStatus = page.getByRole('status', { name: '图片已替换' })
		await expect(imageStatus).toHaveText('图片已替换')
		expect(
			await imageStatus.evaluate(
				(node) => !!node.closest('[aria-busy="true"]'),
			),
		).toBe(false)
		await expect(page.locator('body')).toHaveAttribute(
			'data-image-loading-observed',
			'true',
		)
		await expect(
			page.getByRole('button', { name: '撤销', exact: true }),
		).toBeEnabled()
		await page.getByRole('button', { name: '撤销', exact: true }).click()
		await expect(
			page.getByRole('textbox', { name: 'NVS 剧本' }),
		).not.toContainText('依然')
		await expect(page.locator('canvas')).toBeVisible()
		await expect(page.locator('.nl-player-text')).toContainText('暮色里')
		await capture(page, '07-image-redrawn')
		await page
			.getByRole('combobox', { name: '图片', exact: true })
			.selectOption('ada/uniform/neutral')
		await expect(
			page.getByRole('region', { name: '场景图片' }).getByRole('status'),
		).toHaveCount(0)
		await page.getByRole('textbox', { name: '重绘要求' }).fill('')
		await page
			.getByRole('button', { name: '多出几张再挑', exact: true })
			.click()
		const candidates = page.getByRole('region', { name: '候选图片' })
		await expect(candidates.getByRole('img')).toHaveCount(2)
		await expect
			.poll(() =>
				candidates
					.getByRole('img')
					.evaluateAll((images) =>
						images.every(
							(image) => (image as HTMLImageElement).naturalWidth > 0,
						),
					),
			)
			.toBe(true)
		const selectedImage = await candidates
			.getByRole('img')
			.nth(1)
			.getAttribute('src')
		await candidates
			.getByRole('button', { name: '选择版本 2', exact: true })
			.click()
		await expect(candidates).toHaveCount(0)
		await expect(
			page.getByRole('region', { name: '场景图片' }).getByRole('status'),
		).toHaveCount(0)
		await expect
			.poll(async () =>
				(await page.locator('body').getAttribute('data-preview-image-src'))
					?.split('/')
					.at(-1),
			)
			.toBe(selectedImage?.split('/').at(-1))
		await expect
			.poll(
				async () =>
					(
						await page.evaluate(
							(workId) =>
								window.novelive.call('editor.history', { workId }).promise,
							workId,
						)
					).entries.filter((entry) => entry.kind === 'image').length,
			)
			.toBe(2)
		await expect(page.locator('.nl-player-text')).toContainText('暮色里')
		await capture(page, '08-image-candidate-applied')
	} finally {
		await app.close()
		await rm(root, { recursive: true, force: true })
	}
})
