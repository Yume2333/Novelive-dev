import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
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
import { promisify } from 'node:util'
import {
	type ElectronApplication,
	_electron as electron,
	expect,
	type Page,
	test,
} from '@playwright/test'
import sharp from 'sharp'
import { installedProgressKey } from '../../packages/creator/src/contract'
import { Project } from '../../packages/creator/src/project'
import { projectFiles } from '../../packages/format/src/model'
import { openPackage } from '../../packages/format/src/package/codec'
import {
	playerRef,
	playerScript,
	playerWorkId,
	seedPlayerProject,
} from '../fixtures/minimal-player'

const require = createRequire(
	new URL('../../apps/desktop/package.json', import.meta.url),
)
const executablePath = process.env.NL_M5_EXECUTABLE ?? require('electron')
const args = process.env.NL_M5_EXECUTABLE ? [] : ['apps/desktop']
const evidence = process.env.NL_M5_EVIDENCE

async function launch(profile: string, env: NodeJS.ProcessEnv, path?: string) {
	const app = await electron.launch({
		executablePath,
		args: [
			...args,
			'--no-sandbox',
			`--user-data-dir=${profile}`,
			...(path ? [path] : []),
		],
		env: Object.fromEntries(
			Object.entries(env).filter(
				(entry): entry is [string, string] => entry[1] !== undefined,
			),
		),
	})
	const page = await app.firstWindow()
	await expect(page.getByText('创作端已就绪')).toBeAttached()
	return { app, page }
}

async function saveTo(app: ElectronApplication, path: string) {
	await app.evaluate(({ dialog }, filePath) => {
		dialog.showSaveDialog = async () => ({ canceled: false, filePath })
	}, path)
}

async function capture(page: Page, name: string) {
	if (evidence) await page.screenshot({ path: join(evidence, `${name}.png`) })
}

test('M5 share and play offline: publish, launch, migrate saves, and fork', async () => {
	test.setTimeout(150_000)
	const directory = await mkdtemp(join(tmpdir(), 'novelive-m5-share-'))
	const documents = join(directory, 'Documents')
	const xdgConfig = join(directory, 'xdg-config')
	const xdgData = join(directory, 'xdg-data')
	const env = {
		...process.env,
		ELECTRON_RENDERER_URL: '',
		NL_REPLAY: 'strict',
		XDG_CONFIG_HOME: xdgConfig,
		XDG_DATA_HOME: xdgData,
	}
	const authorDir = join(directory, 'author')
	const readerDir = join(directory, 'reader')
	const root = join(directory, 'project')
	const release1 = join(directory, 'first.novelive')
	const release2 = join(directory, 'second.novelive')
	const readerKey = installedProgressKey(playerWorkId, 1)
	const authorBinding = join(authorDir, 'projects', playerWorkId)
	const opened = new Set<ElectronApplication>()
	try {
		await mkdir(xdgConfig, { recursive: true })
		await mkdir(documents, { recursive: true })
		await writeFile(
			join(xdgConfig, 'user-dirs.dirs'),
			`XDG_DOCUMENTS_DIR="${documents}"\n`,
		)
		await mkdir(join(authorDir, 'projects'), { recursive: true })
		await writeFile(authorBinding, root)
		const png = (background: string) =>
			sharp({ create: { width: 32, height: 128, channels: 3, background } })
				.png()
				.toBuffer()
		await seedPlayerProject(root, await png('#203060'), await png('#e06030'))
		const workFile = projectFiles.work(playerRef.volumeId, playerWorkId)
		{
			using project = await Project.open(root)
			const assets = projectFiles.assetRegistry({ level: 'series' })
			const registry = await project.read(assets)
			for (const name of ['room', 'traveler'])
				await project.writeFile(
					`assets/${name}.webp`,
					await sharp(await project.readFile(`assets/${name}.png`))
						.webp({ lossless: true })
						.toBuffer(),
				)
			await project.write(assets, {
				...registry,
				entries: registry.entries.map((entry) => ({
					...entry,
					path: entry.path.replace(/\.png$/, '.webp'),
				})),
			})
			const work = await project.read(workFile)
			await project.write(workFile, {
				...work,
				version: 0,
				derivedFrom: {
					workId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
					version: 1,
				},
			})
			await project.writeFile(
				'source/original.txt',
				'Synthetic acceptance source',
			)
			await project.writeFile('candidates/private.txt', 'Excluded private data')
			project.tasks.registerWork({ workId: playerWorkId, title: work.title })
			project.database
				.prepare("UPDATE work SET status = 'done' WHERE work_id = ?")
				.run(playerWorkId)
			project.database
				.prepare(
					"INSERT INTO chapter (work_id, chapter_id, ord, user_state, placeholder) VALUES (?, ?, 0, 'published', 1)",
				)
				.run(playerWorkId, playerRef.chapterId)
			project.tasks.enqueue({
				taskId: 'first',
				workId: playerWorkId,
				kind: 'chapter',
				refId: playerRef.chapterId,
			})
			project.database
				.prepare(
					"UPDATE task SET status = 'done', phase = 'done' WHERE task_id = 'first'",
				)
				.run()
		}
		const author = await launch(authorDir, env)
		opened.add(author.app)
		await author.page.getByRole('link', { name: '黄昏' }).click()
		async function exportThroughUi(
			page: Page,
			app: ElectronApplication,
			path: string,
			version: number,
			scope?: string,
			includeSource = false,
		) {
			await saveTo(app, path)
			await page.getByRole('button', { name: '更多', exact: true }).click()
			await page.getByRole('menuitem', { name: '导出作品包' }).click()
			if (scope) await page.getByRole('radio', { name: scope }).check()
			if (includeSource)
				await page.getByRole('checkbox', { name: '包含原文' }).check()
			await page.getByRole('button', { name: '检查导出内容' }).click()
			await expect(
				page.getByRole('dialog').getByText('占位图', { exact: false }),
			).toBeVisible()
			if (version === 1 && path === release1)
				await capture(page, 'export-warning')
			await page.getByRole('button', { name: '导出 .novelive' }).click()
			await expect(
				page.getByRole('dialog').getByText(`v${version}`, { exact: false }),
			).toBeVisible()
			await page.keyboard.press('Escape')
			using archive = await openPackage(path)
			expect(archive.works[0].work).toMatchObject({ version, formatVersion: 1 })
			expect([...archive.entries()].includes('source/original.txt')).toBe(
				includeSource,
			)
			expect(
				[...archive.entries()].some(
					(entry) => entry.startsWith('candidates/') || entry === 'project.db',
				),
			).toBe(false)
			return archive.works[0].work
		}
		await exportThroughUi(author.page, author.app, release1, 1)
		{
			using project = await Project.open(root)
			await project.writeFile(
				projectFiles.scene(playerRef, 'aaaabbbb'),
				playerScript.replace('你好，世界。', '新版你好，世界。'),
			)
		}
		await exportThroughUi(author.page, author.app, release2, 2)
		await exportThroughUi(
			author.page,
			author.app,
			join(directory, 'volume.novelive'),
			3,
			'整卷',
			true,
		)
		await exportThroughUi(
			author.page,
			author.app,
			join(directory, 'series.novelive'),
			4,
			'整个系列',
		)
		expect(
			JSON.parse(await readFile(join(root, workFile.path), 'utf8')).version,
		).toBe(4)
		await author.app.close()
		opened.delete(author.app)

		const reader = await launch(readerDir, env, release1)
		opened.add(reader.app)
		const { app, page } = reader
		await expect(
			page.getByRole('dialog').getByText('v1 · 新作品'),
		).toBeVisible()
		await capture(page, 'open-package')
		await page.getByRole('button', { name: '导入', exact: true }).click()
		await expect(page.getByText('已导入或更新 1 部作品。')).toBeVisible()
		await page.keyboard.press('Escape')
		await rm(release1)
		await page.getByRole('link', { name: /黄昏/ }).click()
		await expect(page.locator('.nl-text-display')).toHaveText('你好，世界。')
		await expect(page.locator('.nl-player canvas')).toBeVisible()
		const pixel = await sharp(
			await page.locator('.nl-player canvas').screenshot(),
		)
			.raw()
			.toBuffer()
		expect([...pixel.subarray(0, 3)]).toEqual([32, 48, 96])
		await capture(page, 'offline-playback')
		await page.keyboard.press('Escape')
		await page.getByRole('button', { name: '快速存档' }).click()
		await expect(page.getByText('存档成功')).toBeVisible()
		await page.evaluate(async (key) => {
			const api = window.novelive.host.progress
			if (!api) throw new Error('Progress IPC unavailable')
			const progress = await api.load(key)
			if (!progress?.saves[0]) throw new Error('Quick save is missing')
			const entry = structuredClone(progress.saves[0])
			entry.slot = { kind: 'manual', slot: 1 }
			entry.snapshot.position.sentenceId = 'ffff'
			await api.save(key, {
				...progress,
				read: [...progress.read, entry.snapshot.position],
				saves: [...progress.saves, entry],
			})
		}, readerKey)
		const prior = await page.evaluate(
			(key) => window.novelive.host.progress?.load(key),
			readerKey,
		)
		assert(prior, 'Version 1 progress is missing')
		await page.keyboard.press('Escape')
		await page.getByRole('button', { name: '返回书库' }).click()
		await expect(page.getByRole('heading', { name: '书库' })).toBeVisible()
		const playerCache = join(readerDir, 'cache', 'player')
		await rm(playerCache, { recursive: true })
		await promisify(execFile)(
			executablePath,
			[...args, '--no-sandbox', `--user-data-dir=${readerDir}`, release2],
			{ env, timeout: 15_000 },
		)
		await expect(
			page.getByRole('dialog').getByText('v1 → v2', { exact: false }),
		).toBeVisible()
		await capture(page, 'update-review')
		await page.getByRole('button', { name: '确认导入与更新' }).click()
		await expect(page.getByText('已导入或更新 1 部作品。')).toBeVisible()
		await expect(readdir(playerCache)).rejects.toMatchObject({ code: 'ENOENT' })
		const currentKey = installedProgressKey(playerWorkId, 2)
		const migrated = await page.evaluate(
			(key) => window.novelive.host.progress?.load(key),
			currentKey,
		)
		expect(migrated?.read).toEqual(prior?.read.slice(0, -1))
		expect(migrated?.saves.map((entry) => entry.slot)).toEqual([
			{ kind: 'quick' },
		])
		const legacy = await page.evaluate(
			(key) => window.novelive.host.progress?.listLegacy?.(key),
			currentKey,
		)
		expect(legacy?.[0]).toMatchObject({
			version: 1,
			saves: [{ slot: { kind: 'manual', slot: 1 } }],
		})
		const installed = await readdir(join(readerDir, 'installed-works'))
		expect(installed).toHaveLength(2)
		if (process.platform === 'linux') {
			const trashed = await readdir(join(xdgData, 'Trash', 'files'))
			expect(trashed).toEqual([expect.stringMatching(/\.novelive$/)])
		}
		await expect(
			page.evaluate(
				({ key, prior }) => window.novelive.host.progress?.save(key, prior),
				{ key: readerKey, prior },
			),
		).rejects.toThrow('作品版本已更新')

		await app.evaluate(({ dialog }, root) => {
			dialog.showOpenDialog = async () => ({
				canceled: false,
				filePaths: [root],
			})
		}, directory)
		await page.getByRole('button', { name: '导入为工程' }).click()
		await expect(
			page.getByText('已导入为新工程，可以在书库中编辑。'),
		).toBeVisible()
		await page.keyboard.press('Escape')
		await page.getByRole('tab', { name: '我的工程' }).click()
		await page
			.getByRole('region', { name: '我的工程' })
			.getByRole('link', { name: '黄昏' })
			.click()
		const fork = join(directory, 'fork.novelive')
		await saveTo(app, fork)
		await page.getByRole('button', { name: '更多', exact: true }).click()
		await page.getByRole('menuitem', { name: '导出作品包' }).click()
		await page.getByRole('button', { name: '检查导出内容' }).click()
		await expect(
			page.getByText('检查完成，没有使用占位图的章节。'),
		).toBeVisible()
		await page.getByRole('button', { name: '导出 .novelive' }).click()
		await expect(
			page.getByRole('dialog').getByText('v1', { exact: false }),
		).toBeVisible()
		using forked = await openPackage(fork)
		expect(forked.works[0].work.workId).not.toBe(playerWorkId)
		expect(forked.works[0].work.derivedFrom).toEqual({
			workId: playerWorkId,
			version: 2,
		})
		const openedEditor = await page.evaluate(
			(input) => window.novelive.call('editor.open', input).promise,
			{ workId: forked.works[0].work.workId, chapterId: playerRef.chapterId },
		)
		expect(openedEditor.chapter.paragraphs).toEqual([{ id: 'p0001', text: '' }])
		expect(openedEditor.chapter.scenes[0].nvs).toContain('你好，世界。')
	} finally {
		await Promise.allSettled([...opened].map((app) => app.close()))
		await rm(directory, { recursive: true, force: true })
	}
})
