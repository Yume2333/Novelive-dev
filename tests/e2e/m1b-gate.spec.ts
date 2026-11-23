import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
	_electron as electron,
	expect,
	type Page,
	test,
} from '@playwright/test'
import {
	combineCassettes,
	configuration,
	original,
	recoveredWriter,
	rejectedWriter,
} from '../fixtures/cassettes/m1b-gate/fixture'

const require = createRequire(
	new URL('../../apps/desktop/package.json', import.meta.url),
)

async function capture(page: Page, name: string) {
	const nativeScroll = await page.evaluate(() =>
		[...document.querySelectorAll<HTMLElement>('*')]
			.filter(
				(el) => el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1,
			)
			.filter((el) => {
				const style = getComputedStyle(el)
				return (
					['auto', 'scroll'].includes(style.overflowY) &&
					style.scrollbarWidth !== 'none' &&
					getComputedStyle(el, '::-webkit-scrollbar').display !== 'none'
				)
			})
			.map((el) => el.className),
	)
	expect(nativeScroll).toEqual([])
	const evidence = process.env.NL_M1B_GATE_EVIDENCE
	if (evidence)
		await page.screenshot({
			path: join(evidence, `${name}.png`),
			animations: 'disabled',
		})
}

test('M1b make and play publishes through both confirmation points in real Electron', async () => {
	test.setTimeout(75_000)
	const root = await mkdtemp(join(tmpdir(), 'novelive-m1b-gate-'))
	try {
		const source = join(root, '纸船与灯火.txt')
		const projects = join(root, 'projects')
		const cassette = join(root, 'cassette')
		await mkdir(projects)
		await mkdir(cassette)
		await writeFile(source, original)
		await combineCassettes(cassette)
		const app = await electron.launch({
			executablePath: require('electron'),
			args: ['apps/desktop', `--user-data-dir=${join(root, 'profile')}`],
			env: {
				...process.env,
				ELECTRON_RENDERER_URL: '',
				NL_REPLAY: 'strict',
				NL_CASSETTE_DIR: cassette,
				NL_REPLAY_DELAY_MS: '35',
			},
		})
		try {
			await app.evaluate(
				({ dialog, BrowserWindow }, answers) => {
					dialog.showOpenDialog = async () => ({
						canceled: false,
						filePaths: [answers.shift() ?? ''],
					})
					BrowserWindow.getAllWindows()[0].setContentSize(1280, 800)
				},
				[source, projects],
			)
			const page = await app.firstWindow()
			const setWritingModel = (model: string) =>
				page.evaluate(
					(model) =>
						window.novelive.call('config.update', {
							models: { writing: { model } },
						}).promise,
					model,
				)
			await expect(page.getByText('创作端已就绪')).toBeAttached()
			await page.evaluate(
				(patch) => window.novelive.call('config.update', patch).promise,
				configuration,
			)
			await page.getByRole('link', { name: '导入原文' }).click()
			await page.getByRole('button', { name: '选择原文' }).click()
			await page.getByRole('button', { name: '选择文件夹' }).click()
			await page.getByRole('button', { name: '导入', exact: true }).click()
			await expect(
				page.getByRole('heading', { name: '核对导入' }),
			).toBeVisible()
			await capture(page, '01-import')
			const project = join(projects, '纸船与灯火')
			function published() {
				using db = new DatabaseSync(join(project, 'project.db'), {
					readOnly: true,
				})
				return db
					.prepare(
						"SELECT chapter_id FROM chapter WHERE user_state = 'published' ORDER BY ord",
					)
					.all()
					.map(({ chapter_id }) => chapter_id)
			}
			expect(await readFile(join(project, 'source/original.txt'), 'utf8')).toBe(
				original,
			)
			await page.getByRole('button', { name: '跳过核对' }).click()
			await page
				.getByRole('link', { name: '选择主视觉' })
				.click({ timeout: 25_000 })
			await expect(
				page.getByRole('heading', { name: '确认角色与主视觉' }),
			).toBeVisible()
			const visuals = page.getByRole('group', { name: '主视觉', exact: true })
			const costume = page.getByRole('group', { name: /Ada/ })
			await expect(visuals.getByRole('radio')).toHaveCount(3)
			await expect(costume.getByRole('radio')).toHaveCount(3)
			await expect
				.poll(() =>
					page
						.locator('fieldset img')
						.evaluateAll((images) =>
							images.every(
								(image) =>
									image instanceof HTMLImageElement &&
									image.complete &&
									image.naturalWidth > 0,
							),
						),
				)
				.toBe(true)
			await visuals.getByRole('radio').first().check()
			await costume.getByRole('radio').first().check()
			await capture(page, '02-confirm-visual')
			await page.getByRole('button', { name: '确认并制作第一章' }).click()
			await page.getByRole('button', { name: '立即停止' }).click()
			await page.getByRole('button', { name: '继续制作' }).click()
			await page
				.getByRole('link', { name: '确认第一章' })
				.click({ timeout: 20_000 })
			await expect(page.getByText(/确认点 2/)).toBeVisible()
			await expect(page.getByText('已发布', { exact: true })).toBeVisible()
			expect(published()).toEqual(['ch0001'])
			await capture(page, '03-confirm-first')
			const priorUrl = await page.evaluate(() => location.hash)
			const workId = priorUrl.match(/\/work\/([^/?]+)/)?.[1]
			expect(workId).toBeTruthy()
			const firstChapter = { workId: workId as string, chapterId: 'ch0001' }
			const editorUrl = `#/work/${workId}/edit?chapterId=ch0001`
			await page.evaluate((hash) => {
				location.hash = hash
			}, editorUrl)
			const banners = page.getByRole('region', { name: '新标记提议' })
			const dusk = banners.filter({ hasText: 'dusk-glow' })
			const boat = banners.filter({ hasText: 'boat-trail' })
			await expect(dusk.getByText('逐字')).toBeVisible()
			await expect(dusk.getByText('color: #aabbff;')).toBeVisible()
			await expect(boat.getByText('整段')).toBeVisible()
			const marks = page.getByRole('combobox', { name: '文本标记' })
			await expect(marks.locator('option[value="dusk-glow"]')).toHaveCount(0)
			await expect(dusk).toBeInViewport()
			await expect(boat).toBeInViewport()
			await capture(page, '06-editor-pending-marks')
			await dusk.getByRole('button', { name: '接受标记' }).click()
			await expect(dusk).toHaveCount(0)
			await expect(marks.locator('option[value="dusk-glow"]')).toHaveCount(1)
			await boat.getByRole('button', { name: '拒绝标记' }).click()
			await expect(banners).toHaveCount(0)
			await expect(marks.locator('option[value="boat-trail"]')).toHaveCount(0)
			const reopened = await page.evaluate(
				(target) => window.novelive.call('editor.open', target).promise,
				firstChapter,
			)
			expect(reopened.chapter.markSuggestions).toEqual([])
			expect(reopened.settings.customMarks).toEqual({
				'dusk-glow': { css: 'color: #aabbff;', perChar: true },
			})
			await capture(page, '07-editor-marks-resolved')
			await page.evaluate((hash) => {
				location.hash = hash
			}, priorUrl)
			await page.getByRole('link', { name: '试玩第一章' }).click()
			await expect(
				page.locator('.nl-text-display').filter({
					hasText: '暮色中，一只纸船从桥下漂过。',
				}),
			).toBeVisible()
			await expect(page.locator('canvas')).toBeVisible()
			await capture(page, '04-play-chapter-one')
			await page.goBack()
			await setWritingModel(rejectedWriter)
			await page.getByRole('button', { name: '继续制作' }).click()
			const second = page.getByRole('listitem').filter({ hasText: '灯火' })
			await expect(second.getByRole('button', { name: '重试' })).toBeVisible()
			await expect(second.getByText(/\[invalid_config\]/)).toBeVisible()
			await setWritingModel(recoveredWriter)
			await second.getByRole('button', { name: '重试' }).click()
			await expect(second.getByText('已发布', { exact: true })).toBeVisible({
				timeout: 20_000,
			})
			await expect(second.getByText('需要处理', { exact: true })).toBeVisible()
			await expect(second.getByText('1 张图用了占位图')).toBeVisible()
			await expect(second.getByText(/\[invalid_config\]/)).toHaveCount(0)
			await expect(
				page.getByText('1 章需要处理', { exact: true }),
			).toBeVisible()
			await expect(page.getByText(/制作已暂停/)).toHaveCount(0)
			await second.getByRole('button', { name: '运行记录' }).click()
			await expect(
				second
					.getByRole('region', { name: '章节运行记录' })
					.getByText('运行失败'),
			).toBeVisible()
			await capture(page, '05-chapter-two-published')
			expect(published()).toEqual(['ch0001', 'ch0002'])
			const registry = JSON.parse(
				await readFile(join(project, 'assets/asset-registry.json'), 'utf8'),
			)
			expect(registry.entries).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ id: 'room/day', status: 'drawn' }),
					expect.objectContaining({ id: 'room/night', status: 'placeholder' }),
				]),
			)
		} finally {
			await app.close()
		}
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test('M1b Electron refuses a zero-budget production request before transport', async () => {
	const root = await mkdtemp(join(tmpdir(), 'novelive-m1b-spend-'))
	let providerCalls = 0
	const provider = createServer((_request, response) => {
		providerCalls++
		response.writeHead(400).end('Unexpected provider request')
	})
	try {
		await new Promise<void>((resolve, reject) => {
			provider.once('error', reject)
			provider.listen(0, '127.0.0.1', resolve)
		})
		const address = provider.address()
		if (!address || typeof address === 'string')
			throw new Error('Missing stub address')
		const baseUrl = `http://127.0.0.1:${address.port}/v1`
		const projects = join(root, 'projects')
		const source = join(root, '纸船与灯火.txt')
		await mkdir(projects)
		await writeFile(source, original)
		const app = await electron.launch({
			executablePath: require('electron'),
			args: ['apps/desktop', `--user-data-dir=${join(root, 'profile')}`],
			env: {
				...process.env,
				ELECTRON_RENDERER_URL: '',
				NL_REPLAY: 'record',
				NL_PRODUCTION_CASSETTE_DIR: join(root, 'cassette'),
				NL_PRODUCTION_FALLBACK_DIR: '',
				NL_IMAGE_BASE_URL: baseUrl,
				NL_IMAGE_API_KEY: 'offline-placeholder',
				NL_RUN_TOKEN_CAP: '0',
				NL_RUN_IMAGE_CAP: '0',
			},
		})
		try {
			const page = await app.firstWindow()
			await expect(page.getByText('创作端已就绪')).toBeAttached()
			await page
				.evaluate(
					async ({ configuration, baseUrl, projects, source }) => {
						const models = {
							fast: { ...configuration.models.fast, baseUrl },
							main: { ...configuration.models.main, baseUrl },
							writing: { ...configuration.models.writing, baseUrl },
							visual: { ...configuration.models.visual, baseUrl },
							image: { ...configuration.models.image, baseUrl },
						}
						await window.novelive.call('config.update', { models }).promise
						return window.novelive.call('import.txt', {
							folder: projects,
							sourcePath: source,
							title: '纸船与灯火',
							encoding: 'utf-8',
							references: [],
						}).promise
					},
					{ configuration, baseUrl, projects, source },
				)
				.then(async (imported) => {
					if (imported.status !== 'ready')
						throw new Error('Fixture import failed')
					const result = await page.evaluate(async (workId) => {
						try {
							await window.novelive.call('production.get', { workId }).promise
							return null
						} catch (error) {
							return error
						}
					}, imported.workId)
					expect(result).toMatchObject({
						code: 'invalid_config',
						message: expect.stringContaining('超出工程预算'),
					})
				})
			expect(providerCalls).toBe(0)
		} finally {
			await app.close()
		}
	} finally {
		if (provider.listening)
			await new Promise<void>((resolve) => provider.close(() => resolve()))
		await rm(root, { recursive: true, force: true })
	}
})

test('M1b creation surfaces an unresolved synthesis and does not redispatch after reopening', async () => {
	const root = await mkdtemp(join(tmpdir(), 'novelive-m1b-synthesis-'))
	const fallback = join(root, 'fallback')
	const projects = join(root, 'projects')
	const source = join(root, '纸船与灯火.txt')
	const director = 'loopback-unresolved-synthesis'
	const calls: string[] = []
	const provider = createServer(async (request, response) => {
		const chunks = []
		for await (const chunk of request) chunks.push(chunk)
		const { model } = JSON.parse(Buffer.concat(chunks).toString())
		calls.push(`${request.url}: ${model}`)
		response
			.writeHead(503, { 'content-type': 'application/json' })
			.end(JSON.stringify({ error: { message: 'Service unavailable' } }))
	})
	try {
		await Promise.all([
			mkdir(fallback),
			mkdir(projects),
			writeFile(source, original),
		])
		await combineCassettes(fallback)
		await new Promise<void>((resolve, reject) => {
			provider.once('error', reject)
			provider.listen(0, '127.0.0.1', resolve)
		})
		const address = provider.address()
		if (!address || typeof address === 'string')
			throw new Error('Missing stub address')
		const baseUrl = `http://127.0.0.1:${address.port}/v1`
		const launch = () =>
			electron.launch({
				executablePath: require('electron'),
				args: ['apps/desktop', `--user-data-dir=${join(root, 'profile')}`],
				env: {
					...process.env,
					ELECTRON_RENDERER_URL: '',
					NL_REPLAY: 'record',
					NL_CASSETTE_DIR: join(root, 'cassette'),
					NL_PRODUCTION_CASSETTE_DIR: '',
					NL_PRODUCTION_FALLBACK_DIR: fallback,
					NL_IMAGE_BASE_URL: baseUrl,
					NL_IMAGE_API_KEY: 'offline-placeholder',
					NL_RUN_TOKEN_CAP: '1000000',
					NL_RUN_IMAGE_CAP: '0',
					NL_USAGE_CSV: '',
				},
			})
		const expectProductionError = async (page: Page, workId: string) => {
			await page.evaluate((id) => {
				location.hash = `/work/${id}/production`
			}, workId)
			await expect(page.getByRole('alert')).toContainText(
				'Model request outcome unknown; not retried automatically (HTTP 503: provider did not return a usable response)',
			)
		}
		const getPage = async (app: Awaited<ReturnType<typeof launch>>) => {
			await app.evaluate(({ dialog }) => {
				dialog.showMessageBox = async () => ({
					response: 1,
					checkboxChecked: false,
				})
			})
			const page = await app.firstWindow()
			await expect(page.getByText('创作端已就绪')).toBeAttached()
			return page
		}
		const app = await launch()
		let workId: string
		try {
			const page = await getPage(app)
			const imported = await page.evaluate(
				async ({ models, baseUrl, director, projects, source }) => {
					await window.novelive.call('config.update', {
						models: {
							fast: { ...models.fast, baseUrl },
							main: { ...models.main, baseUrl, model: director },
							writing: { ...models.writing, baseUrl },
							visual: { ...models.visual, baseUrl },
							image: { ...models.image, baseUrl },
						},
					}).promise
					return window.novelive.call('import.txt', {
						folder: projects,
						sourcePath: source,
						title: '纸船与灯火',
						encoding: 'utf-8',
						references: [],
					}).promise
				},
				{ models: configuration.models, baseUrl, director, projects, source },
			)
			if (imported.status !== 'ready') throw new Error('Fixture import failed')
			workId = imported.workId
			await expectProductionError(page, workId)
			expect(calls).toEqual([`/v1/chat/completions: ${director}`])
		} finally {
			await app.close()
		}
		const reopened = await launch()
		try {
			await expectProductionError(await getPage(reopened), workId)
			expect(calls).toEqual([`/v1/chat/completions: ${director}`])
		} finally {
			await reopened.close()
		}
	} finally {
		if (provider.listening)
			await new Promise<void>((resolve) => provider.close(() => resolve()))
		await rm(root, { recursive: true, force: true })
	}
})

test('M1b creation surfaces a writing budget pause and resumes without repeat dispatch', async () => {
	test.setTimeout(75_000)
	const root = await mkdtemp(join(tmpdir(), 'novelive-m1b-soft-stop-'))
	const cassette = join(root, 'cassette')
	const fallback = join(root, 'fallback')
	const projects = join(root, 'projects')
	const source = join(root, '纸船与灯火.txt')
	const project = join(projects, '纸船与灯火')
	const writer = 'loopback-writing-budget'
	const malformedAttempts = 3
	const script = 'scene 纸船\nsource p0001\n\n: 暮色中，一只纸船从桥下漂过。'
	const calls: unknown[] = []
	const unexpected: string[] = []
	const provider = createServer(async (request, response) => {
		if (request.url !== '/v1/chat/completions') {
			unexpected.push(request.url ?? '')
			response.writeHead(400).end('Unexpected provider request')
			return
		}
		const chunks = []
		for await (const chunk of request) chunks.push(chunk)
		const body = JSON.parse(Buffer.concat(chunks).toString())
		if (body.model !== writer) {
			unexpected.push(`${request.url}: ${body.model}`)
			response.writeHead(400).end('Unexpected provider request')
			return
		}
		calls.push(body.messages)
		if (calls.length <= malformedAttempts) {
			response.writeHead(200, { 'content-type': 'application/json' }).end('{')
			return
		}
		const initial = calls.length === malformedAttempts + 1
		if (calls.length === malformedAttempts + 2) {
			response
				.writeHead(503, { 'content-type': 'application/json' })
				.end(JSON.stringify({ error: { message: 'Service unavailable' } }))
			return
		}
		const events = [
			{
				choices: [
					{
						index: 0,
						delta: {
							role: 'assistant',
							content: initial ? script.replace('p0001', 'p9999') : script,
						},
						finish_reason: null,
					},
				],
			},
			{ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
			{
				choices: [],
				usage: {
					prompt_tokens: initial ? 79_900 : 100,
					completion_tokens: 100,
				},
			},
		]
		response
			.writeHead(200, { 'content-type': 'text/event-stream' })
			.end(
				events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') +
					'data: [DONE]\n\n',
			)
	})
	try {
		await Promise.all([
			mkdir(projects),
			mkdir(cassette),
			mkdir(fallback),
			writeFile(source, original),
		])
		await combineCassettes(fallback)
		await new Promise<void>((resolve, reject) => {
			provider.once('error', reject)
			provider.listen(0, '127.0.0.1', resolve)
		})
		const address = provider.address()
		if (!address || typeof address === 'string')
			throw new Error('Missing stub address')
		const baseUrl = `http://127.0.0.1:${address.port}/v1`
		const launch = (cap: string) =>
			electron.launch({
				executablePath: require('electron'),
				args: ['apps/desktop', `--user-data-dir=${join(root, 'profile')}`],
				env: {
					...process.env,
					ELECTRON_RENDERER_URL: '',
					NL_REPLAY: 'record',
					NL_CASSETTE_DIR: cassette,
					NL_PRODUCTION_CASSETTE_DIR: '',
					NL_PRODUCTION_FALLBACK_DIR: fallback,
					NL_IMAGE_BASE_URL: baseUrl,
					NL_IMAGE_API_KEY: 'offline-placeholder',
					NL_RUN_TOKEN_CAP: cap,
					NL_RUN_TOKEN_SOFT_FRACTION: '0.8',
					NL_RUN_IMAGE_CAP: '0',
					NL_USAGE_CSV: '',
				},
			})
		const openQueue = async (page: Page) => {
			await page.getByRole('button', { name: /^全局制作状态：/ }).click()
			return page.getByRole('dialog', { name: '制作队列' })
		}
		const close = async (app: Awaited<ReturnType<typeof launch>>) => {
			await app.evaluate(({ dialog }) => {
				dialog.showMessageBox = async () => ({
					response: 1,
					checkboxChecked: false,
				})
			})
			await app.close()
		}
		const app = await launch('100000')
		try {
			await app.evaluate(
				({ dialog }, answers) => {
					dialog.showOpenDialog = async () => ({
						canceled: false,
						filePaths: [answers.shift() ?? ''],
					})
				},
				[source, projects],
			)
			const page = await app.firstWindow()
			await expect(page.getByText('创作端已就绪')).toBeAttached()
			await page.evaluate(
				({ models }) =>
					window.novelive.call('config.update', { models }).promise,
				{
					models: {
						fast: { ...configuration.models.fast, baseUrl },
						main: { ...configuration.models.main, baseUrl },
						writing: {
							...configuration.models.writing,
							baseUrl,
							model: writer,
						},
						visual: { ...configuration.models.visual, baseUrl },
						image: { ...configuration.models.image, baseUrl },
					},
				},
			)
			await page.getByRole('link', { name: '导入原文' }).click()
			await page.getByRole('button', { name: '选择原文' }).click()
			await page.getByRole('button', { name: '选择文件夹' }).click()
			await page.getByRole('button', { name: '导入', exact: true }).click()
			await page.getByRole('button', { name: '跳过核对' }).click()
			await page
				.getByRole('link', { name: '选择主视觉' })
				.click({ timeout: 25_000 })
			await page
				.getByRole('group', { name: '主视觉', exact: true })
				.getByRole('radio')
				.first()
				.check()
			await page
				.getByRole('group', { name: /Ada/ })
				.getByRole('radio')
				.first()
				.check()
			await page.getByRole('button', { name: '确认并制作第一章' }).click()
			const retry = page.getByRole('button', { name: '重试' })
			await expect(retry).toBeVisible()
			expect(calls).toHaveLength(malformedAttempts)
			await retry.click()
			await expect(page.getByText(/软停止线 80000 tokens/)).toBeVisible()
			const queue = await openQueue(page)
			await expect(queue.getByText('已暂停：模型预算不足')).toBeVisible()
			await queue
				.getByRole('listitem')
				.filter({ hasText: '已暂停：模型预算不足' })
				.hover()
			expect(calls).toHaveLength(malformedAttempts + 1)
			expect(calls[malformedAttempts]).toEqual(calls[0])
			expect(unexpected).toEqual([])
			expect(
				(await readFile(join(cassette, 'cassette.jsonl'), 'utf8'))
					.trim()
					.split('\n'),
			).toHaveLength(malformedAttempts + 1)
			await capture(page, '08-writing-budget-paused')
		} finally {
			await close(app)
		}
		const resumed = await launch('200000')
		try {
			const page = await resumed.firstWindow()
			await expect(page.getByText('创作端已就绪')).toBeAttached()
			const queue = await openQueue(page)
			await expect(queue.getByText('已暂停：模型预算不足')).toBeVisible()
			await queue
				.getByRole('listitem')
				.filter({ hasText: '已暂停：模型预算不足' })
				.hover()
			await queue.getByRole('button', { name: '继续制作' }).click()
			await expect
				.poll(() =>
					readFile(
						join(project, 'source/production/ch0001/draft.nvs'),
						'utf8',
					).catch(() => ''),
				)
				.toContain('暮色中，一只纸船从桥下漂过。')
			await expect
				.poll(() => {
					using db = new DatabaseSync(join(project, 'project.db'), {
						readOnly: true,
					})
					return db
						.prepare(
							"SELECT status FROM run_step WHERE purpose = 'write' ORDER BY rowid DESC LIMIT 1",
						)
						.get()
				})
				.toEqual({ status: 'completed' })
			expect(calls).toHaveLength(malformedAttempts + 3)
			expect(calls.at(-1)).toEqual(calls.at(-2))
			expect(JSON.stringify(calls.at(-1))).toContain(
				'Repair only the supplied scene',
			)
			expect(unexpected).toEqual([])
			await capture(page, '09-writing-budget-resumed')
		} finally {
			await close(resumed)
		}
	} finally {
		if (provider.listening)
			await new Promise<void>((resolve) => provider.close(() => resolve()))
		await rm(root, { recursive: true, force: true })
	}
})
