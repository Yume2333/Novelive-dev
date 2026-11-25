import assert from 'node:assert/strict'
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { text as streamText } from 'node:stream/consumers'
import {
	type ElectronApplication,
	_electron as electron,
	expect,
	type Page,
	test,
} from '@playwright/test'
import { installedProgressKey } from '../../packages/creator/src/contract'
import { openPackage } from '../../packages/format/src/package/codec'
import {
	combineCassettes,
	configuration,
	original,
	recoveredWriter,
} from '../fixtures/cassettes/m1b-gate/fixture'
import { verifyLocalesAndAboutSurfaces } from './support/m5-locales-surface'

const require = createRequire(
	new URL('../../apps/desktop/package.json', import.meta.url),
)
const executablePath = require('electron') as string

async function launch(
	profile: string,
	env: NodeJS.ProcessEnv,
	opened: Set<ElectronApplication>,
): Promise<{ app: ElectronApplication; page: Page }> {
	const app = await electron.launch({
		executablePath,
		args: ['apps/desktop', '--no-sandbox', `--user-data-dir=${profile}`],
		env: Object.fromEntries(
			Object.entries(env).filter(
				(entry): entry is [string, string] => entry[1] !== undefined,
			),
		),
	})
	opened.add(app)
	const page = await app.firstWindow()
	await expect(page.getByText('创作端已就绪')).toBeAttached()
	await app.evaluate(({ BrowserWindow }) => {
		BrowserWindow.getAllWindows()[0].setContentSize(1280, 900)
	})
	return { app, page }
}

async function stubOpenDialog(app: ElectronApplication, answers: string[]) {
	await app.evaluate(({ dialog }, paths) => {
		dialog.showOpenDialog = async () => {
			const next = paths.shift()
			return { canceled: !next, filePaths: next ? [next] : [] }
		}
	}, answers)
}

async function stubSaveDialog(app: ElectronApplication, filePath: string) {
	await app.evaluate(({ dialog }, destination) => {
		dialog.showSaveDialog = async () => ({
			canceled: false,
			filePath: destination,
		})
	}, filePath)
}

test('M5 full delivery: creation, confirmations, edit, share, update, re-export and locales', async () => {
	test.setTimeout(180_000)
	const root = await mkdtemp(join(tmpdir(), 'novelive-m5-delivery-'))
	const homeDir = join(root, 'home')
	const documents = join(root, 'Documents')
	const xdgConfig = join(root, 'xdg-config')
	const xdgData = join(root, 'xdg-data')
	const source = join(root, '纸船与灯火.txt')
	const projects = join(root, 'projects')
	const forkParent = join(root, 'fork-projects')
	const cassette = join(root, 'cassette')
	const authorDir = join(root, 'author')
	const readerDir = join(root, 'reader')
	const v1Path = join(root, 'paper-boat-v1.novelive')
	const v2Path = join(root, 'paper-boat-v2.novelive')
	const forkPath = join(root, 'paper-boat-fork.novelive')
	const opened = new Set<ElectronApplication>()

	const baseEnv: NodeJS.ProcessEnv = {
		...process.env,
		ELECTRON_RENDERER_URL: '',
		HOME: homeDir,
		XDG_CONFIG_HOME: xdgConfig,
		XDG_DATA_HOME: xdgData,
		NL_REPLAY: 'strict',
		NL_CASSETTE_DIR: undefined,
		NL_UPDATE_URL: undefined,
		NL_PRODUCTION_CASSETTE_DIR: undefined,
		NL_PRODUCTION_FALLBACK_DIR: undefined,
	}
	const authorEnv: NodeJS.ProcessEnv = {
		...baseEnv,
		NL_CASSETTE_DIR: cassette,
	}
	const readerEnv: NodeJS.ProcessEnv = { ...baseEnv }

	try {
		await Promise.all([
			mkdir(homeDir, { recursive: true }),
			mkdir(documents, { recursive: true }),
			mkdir(xdgConfig, { recursive: true }),
			mkdir(xdgData, { recursive: true }),
			mkdir(projects, { recursive: true }),
			mkdir(forkParent, { recursive: true }),
			mkdir(cassette, { recursive: true }),
			writeFile(source, original),
		])
		await writeFile(
			join(xdgConfig, 'user-dirs.dirs'),
			`XDG_DOCUMENTS_DIR="${documents}"\n`,
		)
		await combineCassettes(cassette)

		const v1Line = '暮色中，一只纸船从桥下漂过（v1修订）。'
		const v2Line = '暮色中，一只纸船从桥下漂过（v2更新）。'
		let workId = ''

		// 1. Creation + two confirmations (character/visual; playable chapter)
		// 2. Editing in real Editor UI and persistence verification
		// 3. Export v1 .novelive and verify private scratch exclusion
		{
			const author = await launch(authorDir, authorEnv, opened)
			const { app, page } = author
			await page.evaluate(
				(patch) => window.novelive.call('config.update', patch).promise,
				configuration,
			)
			await stubOpenDialog(app, [source, projects])
			await page.getByRole('link', { name: '新建工程' }).click()
			await page.getByRole('button', { name: '选择原文' }).click()
			await page.getByRole('button', { name: '选择文件夹' }).click()
			await page.getByRole('button', { name: '下一步', exact: true }).click()
			await expect(
				page.locator('[aria-current="step"]', { hasText: '核对信息' }),
			).toBeVisible()
			await page.getByRole('button', { name: '跳过核对' }).click()
			await page.getByRole('button', { name: '开始制作' }).click()

			// Confirmation point 1: visual style & major character costume
			await page
				.getByRole('link', { name: '选择主视觉' })
				.click({ timeout: 25_000 })
			await expect(
				page.getByRole('heading', { name: /角色设定 \/ 主视觉/ }),
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
			await page.getByRole('button', { name: '确认并制作第一章' }).click()

			// Confirmation point 2: playable first chapter
			await page
				.getByRole('link', { name: '确认第一章' })
				.click({ timeout: 25_000 })
			await expect(page.getByText(/确认点 2/)).toBeVisible()
			await expect(page.getByText(/已发布，可以试玩/)).toBeVisible()
			const hash = await page.evaluate(() => location.hash)
			const matched = hash.match(/\/work\/([^/?]+)/)?.[1]
			assert(matched, `Expected workId in route hash: ${hash}`)
			workId = matched

			await page.getByRole('link', { name: '试玩第一章' }).click()
			await expect(page.locator('.nl-text-display')).toHaveText(
				'暮色中，一只纸船从桥下漂过。',
			)
			await expect(page.locator('.nl-player canvas')).toBeVisible()
			await page.goBack()

			// Accept proposed custom mark so ch0002 production matches cassette rules
			await page.getByRole('button', { name: '更多', exact: true }).click()
			await page.getByRole('menuitem', { name: '进编辑器修改' }).click()
			const banners = page.getByRole('region', { name: '新标记提议' })
			await banners
				.filter({ hasText: 'dusk-glow' })
				.getByRole('button', { name: '接受标记' })
				.click()
			await banners
				.filter({ hasText: 'boat-trail' })
				.getByRole('button', { name: '拒绝标记' })
				.click()
			await expect(banners).toHaveCount(0)
			await page.goBack()

			await page.evaluate(
				(model) =>
					window.novelive.call('config.update', {
						models: { writing: { model } },
					}).promise,
				recoveredWriter,
			)
			await page.getByRole('button', { name: '继续制作' }).click()
			const secondChapter = page
				.getByRole('listitem')
				.filter({ hasText: '灯火' })
			await expect(
				secondChapter.getByText('已发布', { exact: true }),
			).toBeVisible({
				timeout: 25_000,
			})

			// Step 2: Open editor, apply real script edit, verify persistence
			await page
				.getByRole('navigation', { name: '作品导航' })
				.getByRole('link', { name: '编辑', exact: true })
				.click()
			await expect(
				page.getByRole('heading', { name: '编辑器', exact: true }),
			).toBeVisible()

			const lineInput = page.getByRole('textbox', { name: '文本', exact: true })
			await lineInput.fill(v1Line)
			await page.getByRole('button', { name: '保存当前句' }).first().click()
			await expect(
				page.getByRole('button', { name: '保存当前句' }),
			).toHaveCount(0)

			await page.reload()
			await expect(page.getByText('创作端已就绪')).toBeAttached()
			await expect(
				page.locator('.editor-sentence-trigger').filter({ hasText: v1Line }),
			).toBeVisible()

			// Step 3: Export v1 .novelive via real UI path and verify private scratch exclusion
			const projectDir = join(projects, '纸船与灯火')
			await writeFile(
				join(projectDir, 'candidates', 'private-scratch.txt'),
				'private scratch',
			)
			await page
				.getByRole('navigation', { name: '作品导航' })
				.getByRole('link', { name: '概览', exact: true })
				.click()
			await stubSaveDialog(app, v1Path)
			await page.getByRole('button', { name: '更多', exact: true }).click()
			await page.getByRole('menuitem', { name: '导出作品包' }).click()
			await page.getByRole('button', { name: '检查导出内容' }).click()
			await expect(
				page.getByRole('dialog').getByText('占位图', { exact: false }),
			).toBeVisible()
			await page.getByRole('button', { name: '导出 .novelive' }).click()
			await expect(
				page.getByRole('dialog').getByText('v1', { exact: false }),
			).toBeVisible()
			await page.keyboard.press('Escape')

			using v1Archive = await openPackage(v1Path)
			expect(v1Archive.works[0].work).toMatchObject({
				workId,
				version: 1,
				formatVersion: 1,
			})
			const v1Entries = [...v1Archive.entries()]
			expect(
				v1Entries.some(
					(entry) =>
						entry === 'project.db' ||
						entry.startsWith('candidates/') ||
						entry.startsWith('source/') ||
						entry.startsWith('.novelive/'),
				),
			).toBe(false)
			const ch1Scene = v1Entries.find(
				(entry) =>
					entry.includes('/chapters/ch0001/') && entry.endsWith('.nvs'),
			)
			assert(ch1Scene, 'Expected chapter 1 scene in exported v1 archive')
			expect(await streamText(await v1Archive.openEntry(ch1Scene))).toContain(
				v1Line,
			)

			await app.close()
			opened.delete(app)
		}

		// 4. Fresh reader profile (no models configured): import v1, delete source, play offline, save progress
		const reader = await launch(readerDir, readerEnv, opened)
		const readerConfig = await reader.page.evaluate(
			() => window.novelive.call('config.get', {}).promise,
		)
		assert('models' in readerConfig, 'Expected readable initial reader config')
		expect(readerConfig.models.fast.model).toBe('')
		expect(readerConfig.models.main.model).toBe('')
		expect(readerConfig.models.writing.model).toBe('')
		expect(readerConfig.models.visual.model).toBe('')
		expect(readerConfig.models.image.model).toBe('')

		await stubOpenDialog(reader.app, [v1Path])
		await reader.page.getByRole('button', { name: '导入作品包' }).click()
		await expect(
			reader.page.getByRole('dialog').getByText('v1 · 新作品'),
		).toBeVisible()
		await reader.page.getByRole('button', { name: '导入', exact: true }).click()
		await expect(reader.page.getByText('已导入或更新 1 部作品。')).toBeVisible()
		await reader.page.keyboard.press('Escape')
		await rm(v1Path)

		await reader.page.getByRole('link', { name: /纸船与灯火/ }).click()
		await expect(reader.page.locator('.nl-text-display')).toHaveText(v1Line)
		await expect(reader.page.locator('.nl-player canvas')).toBeVisible()
		await reader.page.keyboard.press('Escape')
		await reader.page.getByRole('button', { name: '快速存档' }).click()
		await expect(reader.page.getByText('存档成功')).toBeVisible()

		const v1Key = installedProgressKey(workId, 1)
		await reader.page.evaluate(async (key) => {
			const api = window.novelive.host.progress
			if (!api) throw new Error('Progress IPC unavailable')
			const progress = await api.load(key)
			if (!progress?.saves[0]) throw new Error('Quick save is missing')
			const obsolete = structuredClone(progress.saves[0])
			obsolete.slot = { kind: 'manual', slot: 1 }
			obsolete.snapshot.position.sentenceId = 'ffff'
			await api.save(key, {
				...progress,
				read: [...progress.read, obsolete.snapshot.position],
				saves: [...progress.saves, obsolete],
			})
		}, v1Key)
		const priorProgress = await reader.page.evaluate(
			(key) => window.novelive.host.progress?.load(key),
			v1Key,
		)
		assert(priorProgress, 'Version 1 progress is missing')
		await reader.page.keyboard.press('Escape')
		await reader.page.getByRole('button', { name: '返回书库' }).click()
		await expect(
			reader.page.getByRole('heading', { name: '书库' }),
		).toBeVisible()

		// 5. Work update & save migration: export v2 from author, update in reader
		{
			const author = await launch(authorDir, authorEnv, opened)
			const { app, page } = author
			await page.getByRole('link', { name: /纸船与灯火/ }).click()
			await page
				.getByRole('navigation', { name: '作品导航' })
				.getByRole('link', { name: '编辑', exact: true })
				.click()
			const lineInput = page.getByRole('textbox', { name: '文本', exact: true })
			await expect(lineInput).toHaveValue(v1Line)
			await lineInput.fill(v2Line)
			await page.getByRole('button', { name: '保存当前句' }).first().click()
			await expect(
				page.getByRole('button', { name: '保存当前句' }),
			).toHaveCount(0)

			await page
				.getByRole('navigation', { name: '作品导航' })
				.getByRole('link', { name: '概览', exact: true })
				.click()
			await stubSaveDialog(app, v2Path)
			await page.getByRole('button', { name: '更多', exact: true }).click()
			await page.getByRole('menuitem', { name: '导出作品包' }).click()
			await page.getByRole('button', { name: '检查导出内容' }).click()
			await expect(
				page.getByRole('dialog').getByText('占位图', { exact: false }),
			).toBeVisible()
			await page.getByRole('button', { name: '导出 .novelive' }).click()
			await expect(
				page.getByRole('dialog').getByText('v2', { exact: false }),
			).toBeVisible()
			await page.keyboard.press('Escape')
			await app.close()
			opened.delete(app)
		}

		await stubOpenDialog(reader.app, [v2Path])
		await reader.page.getByRole('button', { name: '导入作品包' }).click()
		await expect(
			reader.page.getByRole('dialog').getByText('v1 → v2', { exact: false }),
		).toBeVisible()
		await reader.page.getByRole('button', { name: '确认导入与更新' }).click()
		await expect(reader.page.getByText('已导入或更新 1 部作品。')).toBeVisible()
		await reader.page.keyboard.press('Escape')

		const installed = await readdir(join(readerDir, 'installed-works'))
		expect(installed).toHaveLength(2)
		if (process.platform === 'linux') {
			const trashed = await readdir(join(xdgData, 'Trash', 'files'))
			expect(trashed).toEqual([expect.stringMatching(/\.novelive$/)])
		}

		const v2Key = installedProgressKey(workId, 2)
		const migrated = await reader.page.evaluate(
			(key) => window.novelive.host.progress?.load(key),
			v2Key,
		)
		expect(migrated?.read).toEqual(priorProgress.read.slice(0, -1))
		expect(migrated?.saves.map((entry) => entry.slot)).toEqual([
			{ kind: 'quick' },
		])
		const legacy = await reader.page.evaluate(
			(key) => window.novelive.host.progress?.listLegacy?.(key),
			v2Key,
		)
		expect(legacy?.[0]).toMatchObject({
			version: 1,
			saves: [{ slot: { kind: 'manual', slot: 1 } }],
		})
		await expect(
			reader.page.evaluate(
				({ key, prior }) => window.novelive.host.progress?.save(key, prior),
				{ key: v1Key, prior: priorProgress },
			),
		).rejects.toThrow('作品版本已更新')

		// Play v2, advance past chapter 1 to chapter 2, then quick-load back to migrated v1 position
		await reader.page.getByRole('link', { name: /纸船与灯火/ }).click()
		await expect(reader.page.locator('.nl-text-display')).toHaveText(v2Line)
		const readerStage = reader.page.locator('.nl-player-stage')
		const readerCanvas = readerStage.locator('canvas')
		await expect(readerStage).toHaveAttribute('aria-busy', 'false')
		await expect(reader.page.locator('.nl-player-text')).toHaveAttribute(
			'data-text-finished',
			'true',
		)
		await readerCanvas.click({ position: { x: 25, y: 25 } })
		const nextChapterButton = reader.page.getByRole('button', {
			name: '下一章已就绪，点击开始',
		})
		await expect(nextChapterButton).toBeVisible()
		await nextChapterButton.click()
		await expect(reader.page.locator('.nl-text-display')).toHaveText(
			'桥边的灯亮了，纸船继续向前漂。',
		)
		await reader.page.keyboard.press('Escape')
		await reader.page.getByRole('button', { name: '快速读档' }).click()
		await expect(reader.page.locator('.nl-text-display')).toHaveText(v2Line)
		await reader.page.keyboard.press('Escape')
		await reader.page.getByRole('button', { name: '读档', exact: true }).click()
		const legacyPanel = reader.page.getByRole('region', {
			name: '旧版本存档',
		})
		await expect(legacyPanel).toBeVisible()
		await expect(
			legacyPanel.getByRole('region', { name: '版本 v1' }),
		).toBeVisible()
		await reader.page.getByRole('button', { name: '返回菜单' }).click()
		await reader.page.getByRole('button', { name: '返回书库' }).click()
		await expect(
			reader.page.getByRole('heading', { name: '书库' }),
		).toBeVisible()

		// 6. Import package as a new creator project and re-export with a new work identity
		await stubOpenDialog(reader.app, [v2Path, forkParent])
		await reader.page.getByRole('button', { name: '导入作品包' }).click()
		await expect(
			reader.page.getByRole('dialog').getByText('v2 · 已导入'),
		).toBeVisible()
		await reader.page.getByRole('button', { name: '导入为工程' }).click()
		await expect(
			reader.page.getByText('已导入为新工程，可以在书库中编辑。'),
		).toBeVisible()
		await reader.page.keyboard.press('Escape')

		await reader.page.getByRole('tab', { name: '我的工程' }).click()
		await reader.page
			.getByRole('tabpanel', { name: '我的工程' })
			.getByRole('link', { name: '纸船与灯火' })
			.click()
		await stubSaveDialog(reader.app, forkPath)
		await reader.page.getByRole('button', { name: '更多', exact: true }).click()
		await reader.page.getByRole('menuitem', { name: '导出作品包' }).click()
		await reader.page.getByRole('button', { name: '检查导出内容' }).click()
		await reader.page.getByRole('button', { name: '导出 .novelive' }).click()
		await expect(
			reader.page.getByRole('dialog').getByText('v1', { exact: false }),
		).toBeVisible()
		await reader.page.keyboard.press('Escape')

		using forkedArchive = await openPackage(forkPath)
		expect(forkedArchive.works[0].work.workId).not.toBe(workId)
		expect(forkedArchive.works[0].work.version).toBe(1)
		expect(forkedArchive.works[0].work.derivedFrom).toEqual({
			workId,
			version: 2,
		})
		const forkedEntries = [...forkedArchive.entries()]
		const forkedScene = forkedEntries.find(
			(entry) => entry.includes('/chapters/ch0001/') && entry.endsWith('.nvs'),
		)
		assert(forkedScene, 'Expected chapter 1 scene in forked archive')
		expect(
			await streamText(await forkedArchive.openEntry(forkedScene)),
		).toContain(v2Line)

		// Verify author project root matches on-disk expectations
		expect(
			JSON.parse(
				await readFile(
					join(
						projects,
						'纸船与灯火',
						'volumes',
						'v0001',
						'works',
						workId,
						'work.json',
					),
					'utf8',
				),
			).version,
		).toBe(2)

		// 7. Multi-locale & update metadata surfaces
		await verifyLocalesAndAboutSurfaces(reader.page, reader.app)

		await reader.app.close()
		opened.delete(reader.app)
	} finally {
		await Promise.allSettled([...opened].map((app) => app.close()))
		await rm(root, { recursive: true, force: true })
	}
})
