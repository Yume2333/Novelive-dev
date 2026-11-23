import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { _electron as electron, expect, test } from '@playwright/test'
import {
	bibleRevision,
	getBible,
} from '../../packages/creator/src/bible/editing'
import type { Proposal } from '../../packages/creator/src/contract'
import { Project } from '../../packages/creator/src/project'
import { readBible } from '../../packages/creator/src/synthesis/patch'
import {
	defaultWorkSettings,
	formatVersion,
	projectFiles,
} from '../../packages/format/src/model'

const require = createRequire(
	new URL('../../apps/desktop/package.json', import.meta.url),
)
const workId = 'f947f6e9-b854-4b16-b322-6aad47eb5df8'
const volumeId = 'v0001'
const scope = { level: 'series' } as const

test('M2 bible and glossary views, accepts, rejects and preserves confirmed content against stale proposals', async () => {
	const root = await mkdtemp(join(tmpdir(), 'novelive-m2-bible-'))
	const directory = join(root, 'fixture')
	const profile = join(root, 'profile')
	try {
		using project = await Project.create(directory, {
			formatVersion,
			seriesId: 'fixture',
			title: '纸船设定集',
			volumeIds: [volumeId],
		})
		await project.write(projectFiles.volume(volumeId), {
			formatVersion,
			volumeId,
			title: '第一卷',
			workIds: [workId],
		})
		await project.write(projectFiles.work(volumeId, workId), {
			formatVersion,
			workId,
			title: '纸船',
			chapterIds: ['ch01', 'ch02'],
			version: 1,
			minReaderVersion: 1,
			appVersion: '0.1.0',
			language: 'zh-CN',
			settings: defaultWorkSettings(),
		})
		for (const [chapterId, paragraphId] of [
			['ch01', 'p0001'],
			['ch02', 'p0002'],
		]) {
			await project.write(
				projectFiles.chapter({ volumeId, workId, chapterId }),
				{
					formatVersion,
					chapterId,
					title: chapterId,
					sceneIds: [],
					paragraphIds: [paragraphId],
					cg: [],
				},
			)
			await project.writeFile(
				projectFiles.chapterText(chapterId),
				'小夏和小林在桥边放下纸船。\n',
			)
		}
		project.database
			.prepare(
				'INSERT INTO work (work_id, title, queue_pos, created_at) VALUES (?, ?, 0, 0)',
			)
			.run(workId, '纸船')
		const empty = await getBible(project, { workId, volumeId })
		expect(empty.characters).toEqual([])
		expect(empty.glossary).toEqual([])
		expect(empty.proposalIds).toEqual([])
		await expect(
			getBible(project, { workId, volumeId: 'missing' }),
		).rejects.toMatchObject({ code: 'not_found' })
		const xia = {
			id: 'xia',
			name: '小夏',
			aliases: [],
			status: 'confirmed' as const,
			appearance: { description: '黑发' },
			costumes: [
				{ id: 'uniform', description: '旧制服' },
				{ id: 'casual', description: '便服' },
			],
		}
		const lin = {
			id: 'lin',
			name: '小林',
			aliases: [],
			status: 'confirmed' as const,
			costumes: [
				{ id: 'uniform', description: '旧制服' },
				{ id: 'casual', description: '便服' },
			],
		}
		const bridge = {
			id: 'bridge',
			name: '桥边',
			description: '木桥',
			status: 'confirmed' as const,
		}
		await project.write(projectFiles.character(scope, 'xia'), {
			formatVersion,
			entries: [xia],
		})
		await project.write(projectFiles.character(scope, 'lin'), {
			formatVersion,
			entries: [lin],
		})
		await project.write(projectFiles.location(scope, 'bridge'), {
			formatVersion,
			entries: [bridge],
		})
		await project.write(projectFiles.style(scope), {
			formatVersion,
			entries: [{ id: 'main', description: '水彩', status: 'confirmed' }],
		})
		await project.write(projectFiles.glossary(scope), {
			formatVersion,
			entries: [
				{
					id: 'boat',
					original: '纸船',
					written: '纸船',
					category: '物品',
					status: 'confirmed',
				},
			],
		})
		const assets = [
			'xia/uniform/base',
			'xia/uniform/happy',
			'xia/casual/base',
			'xia/casual/sad',
			'lin/uniform/base',
			'lin/uniform/happy',
			'lin/casual/base',
			'bridge/day',
			'bridge/night',
			'other/day',
			'cg-boat',
		]
		for (const key of assets)
			project.database
				.prepare(
					"INSERT INTO asset (work_id, asset_key, kind, status) VALUES (?, ?, ?, 'drawn')",
				)
				.run(
					workId,
					key,
					key.startsWith('cg-')
						? 'cg'
						: key.endsWith('/base')
							? 'base'
							: 'variant',
				)
		const initial = await readBible(project)
		const revision = bibleRevision(initial)
		const nextXia = { ...xia, appearance: { description: '银发' } }
		const nextLin = {
			...lin,
			costumes: [
				{ id: 'uniform', description: '新制服' },
				{ id: 'casual', description: '便服' },
			],
		}
		const nextBridge = { ...bridge, description: '石桥' }
		const after = structuredClone(initial)
		after.character = [nextLin, nextXia]
		after.location = [nextBridge]
		after.style = [{ id: 'main', description: '赛璐璐', status: 'confirmed' }]
		const payload: Proposal['payload'] = {
			kind: 'bible',
			volumeId,
			expectedRevision: revision,
			changes: [
				{ kind: 'character', op: 'update', entry: nextXia },
				{ kind: 'character', op: 'update', entry: nextLin },
				{ kind: 'location', op: 'update', entry: nextBridge },
				{ kind: 'style', op: 'update', entry: after.style[0] },
			],
		}
		const term = {
			id: 'boat',
			original: '纸船',
			written: '灯船',
			category: '物品',
			status: 'candidate' as const,
		}
		for (const [id, prompt, value] of [
			['accept', '更新角色与地点', payload],
			['stale-bible', '旧设定候选', payload],
			[
				'reject',
				'不采用的术语',
				{
					kind: 'glossary',
					volumeId,
					expectedRevision: revision,
					changes: [term],
				},
			],
			[
				'stale',
				'旧术语候选',
				{
					kind: 'glossary',
					volumeId,
					expectedRevision: revision,
					changes: [term],
				},
			],
			[
				'term',
				'确认术语',
				{
					kind: 'glossary',
					volumeId,
					expectedRevision: bibleRevision(after),
					changes: [term],
				},
			],
		] as const)
			project.database
				.prepare(
					'INSERT INTO proposal (proposal_id, work_id, kind, prompt, payload, created_at) VALUES (?, ?, ?, ?, ?, 0)',
				)
				.run(id, workId, value.kind, prompt, JSON.stringify(value))
		await mkdir(join(profile, 'projects'), { recursive: true })
		await writeFile(join(profile, 'projects', workId), directory)
		const app = await electron.launch({
			executablePath: require('electron'),
			args: ['apps/desktop', `--user-data-dir=${profile}`],
			env: {
				...process.env,
				ELECTRON_RENDERER_URL: '',
				NL_E2E: '1',
				NL_REPLAY: 'strict',
			},
		})
		try {
			const page = await app.firstWindow()
			await expect(page.getByText('创作端已就绪')).toBeAttached()
			await app.evaluate(({ BrowserWindow }) =>
				BrowserWindow.getAllWindows()[0].setContentSize(1440, 1000),
			)
			await page.evaluate((id) => {
				window.location.hash = `/work/${id}/bible`
			}, workId)
			await expect(
				page.getByRole('heading', { name: '设定集', exact: true }),
			).toBeVisible()
			const missing = await page.evaluate(async (workId) => {
				try {
					await window.novelive.call('proposal.get', {
						workId,
						proposalId: 'missing',
					}).promise
				} catch (error) {
					return (error as { code: string }).code
				}
			}, workId)
			expect(missing).toBe('not_found')
			const confirmed = page.getByRole('region', { name: '已登记内容' })
			await expect(
				confirmed.getByText('小夏', { exact: true }).first(),
			).toBeVisible()
			await confirmed.getByText('跨章节定位（2）').first().click()
			await expect(confirmed.getByText('ch02 · p0002').first()).toBeVisible()
			const accept = page.getByRole('article', {
				name: '更新角色与地点',
				exact: true,
			})
			await expect(accept.getByText('与已确认内容冲突').first()).toBeVisible()
			await page.screenshot({
				path: '.workflow/evidence/m2-editor/04-bible-before.png',
				fullPage: true,
			})
			await accept.getByRole('button', { name: '接受候选' }).click()
			await expect(
				page.getByText('已接受候选；', { exact: false }),
			).toBeVisible()
			await expect(confirmed.getByText('银发', { exact: false })).toBeVisible()
			using db = new DatabaseSync(join(directory, 'project.db'))
			const stale = db
				.prepare(
					"SELECT asset_key FROM asset WHERE status = 'stale' ORDER BY asset_key",
				)
				.all()
				.map(({ asset_key }) => asset_key)
			expect(stale).toEqual([
				'bridge/day',
				'bridge/night',
				'lin/uniform/base',
				'lin/uniform/happy',
				'xia/casual/base',
				'xia/casual/sad',
				'xia/uniform/base',
				'xia/uniform/happy',
			])
			const rejected = page.getByRole('article', {
				name: '不采用的术语',
				exact: true,
			})
			await rejected
				.getByRole('textbox', { name: '拒绝理由' })
				.fill('保留原作写法')
			await rejected.getByRole('button', { name: '拒绝候选' }).click()
			await expect(rejected).toHaveCount(0)
			expect(
				db
					.prepare(
						'SELECT status, feedback FROM proposal WHERE proposal_id = ?',
					)
					.get('reject'),
			).toEqual({ status: 'rejected', feedback: '保留原作写法' })
			await expect(
				page
					.getByRole('article', { name: '旧术语候选', exact: true })
					.getByRole('button', { name: '接受候选' }),
			).toBeDisabled()
			const result = await page.evaluate(
				(workId) =>
					window.novelive.call('proposal.resolve', {
						workId,
						proposalId: 'stale',
						decision: { kind: 'approve' },
					}).promise,
				workId,
			)
			expect(result.status).toBe('stale')
			const staleBible = await page.evaluate(
				(workId) =>
					window.novelive.call('proposal.resolve', {
						workId,
						proposalId: 'stale-bible',
						decision: { kind: 'approve' },
					}).promise,
				workId,
			)
			expect(staleBible.status).toBe('stale')
			expect(
				(await project.read(projectFiles.glossary(scope))).entries[0].written,
			).toBe('纸船')
			await page
				.getByRole('article', { name: '确认术语', exact: true })
				.getByRole('button', { name: '接受候选' })
				.click()
			await page.getByRole('button', { name: /^术语/ }).click()
			await expect(
				confirmed.getByRole('heading', { name: '灯船', exact: true }),
			).toBeVisible()
			await page.screenshot({
				path: '.workflow/evidence/m2-editor/04-bible-after.png',
				fullPage: true,
			})
			await page.reload()
			await expect(
				page.getByRole('heading', { name: '小夏', exact: true }),
			).toBeVisible()
			expect(
				(await getBible(project, { workId, volumeId })).glossary[0].written,
			).toBe('灯船')
			const native = await page.evaluate(
				() =>
					[...document.querySelectorAll<HTMLElement>('*')].filter(
						(el) =>
							el.scrollHeight > el.clientHeight + 1 &&
							['auto', 'scroll'].includes(getComputedStyle(el).overflowY) &&
							getComputedStyle(el).scrollbarWidth !== 'none' &&
							getComputedStyle(el, '::-webkit-scrollbar').display !== 'none',
					).length,
			)
			expect(native).toBe(0)
			expect(
				JSON.parse(
					await readFile(join(directory, 'bible/characters/xia.json'), 'utf8'),
				).entries[0].appearance.description,
			).toBe('银发')
		} finally {
			await app.close()
		}
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})
