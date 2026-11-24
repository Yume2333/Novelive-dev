import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
	bibleRevision,
	getBible,
} from '../../packages/creator/src/bible/editing'
import type { Proposal } from '../../packages/creator/src/contract'
import { Project } from '../../packages/creator/src/project'
import { createReplayFetch } from '../../packages/creator/src/replay'
import {
	synthesisFiles,
	synthesizeVolume,
} from '../../packages/creator/src/synthesis'
import { readBible } from '../../packages/creator/src/synthesis/patch'
import {
	defaultWorkSettings,
	formatVersion,
	projectFiles,
} from '../../packages/format/src/model'
import {
	chapters,
	connection,
	seed as seedSynthesis,
} from '../fixtures/cassettes/m1a-synthesis/fixture'

const require = createRequire(
	new URL('../../apps/desktop/package.json', import.meta.url),
)
const workId = 'f947f6e9-b854-4b16-b322-6aad47eb5df8'
const volumeId = 'v0001'
const scope = { level: 'series' } as const

async function openCandidates(page: Page) {
	const chip = page.getByRole('button', { name: /^候选与冲突/ })
	if ((await chip.getAttribute('aria-expanded')) !== 'true') await chip.click()
}

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
			personality: '谨慎',
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
		const nextXia = {
			...xia,
			personality: undefined,
			appearance: { description: '银发' },
		}
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
				.run(
					id,
					workId,
					value.kind,
					prompt,
					JSON.stringify({ chapterIds: [], payload: value }),
				)
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
				window.location.hash = `/work/${id}/edit`
			}, workId)
			await page
				.getByRole('navigation', { name: '作品导航' })
				.getByRole('link', { name: '设定集', exact: true })
				.click()
			await expect(
				page.getByRole('heading', { name: '设定集', exact: true }),
			).toBeVisible()
			await openCandidates(page)
			const volumeInput = page.getByRole('textbox', { name: '卷 ID' })
			await volumeInput.focus()
			await volumeInput.press('End')
			await volumeInput.press('Backspace')
			await volumeInput.press('2')
			await expect(volumeInput).toBeFocused()
			await expect(volumeInput).toHaveValue('v0002')
			expect(page.url()).not.toContain('volume=v0002')
			await volumeInput.press('Enter')
			await expect(page.getByRole('alert')).toHaveText(
				'工程中找不到这部作品或卷',
			)
			await expect(volumeInput).toHaveValue('v0002')
			await volumeInput.fill(volumeId)
			await page.getByRole('button', { name: '切换卷' }).click()
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
			const chat = await page.evaluate(async (workId) => {
				const { session } = await window.novelive.call('chat.create', {
					workId,
					title: 'Bible integration',
				}).promise
				const { sessions } = await window.novelive.call('chat.list', { workId })
					.promise
				const snapshot = await window.novelive.call('chat.get', {
					workId,
					sessionId: session.sessionId,
				}).promise
				await window.novelive.call('chat.rename', {
					workId,
					sessionId: session.sessionId,
					title: 'Renamed integration',
				}).promise
				const renamed = await window.novelive.call('chat.get', {
					workId,
					sessionId: session.sessionId,
				}).promise
				await window.novelive.call('chat.delete', {
					workId,
					sessionId: session.sessionId,
				}).promise
				return {
					listed: sessions.some(
						({ sessionId }) => sessionId === session.sessionId,
					),
					entries: snapshot.entries,
					title: renamed.session.title,
				}
			}, workId)
			expect(chat).toEqual({
				listed: true,
				entries: [],
				title: 'Renamed integration',
			})
			const confirmed = page.getByRole('region', { name: '已登记内容' })
			await expect(
				confirmed.getByText('小夏', { exact: true }).first(),
			).toBeVisible()
			await confirmed.getByText('跨章节定位（2）').first().click()
			await expect(confirmed.getByText('ch02 · p0002').first()).toBeVisible()
			await openCandidates(page)
			const accept = page.getByRole('article', {
				name: '更新角色与地点',
				exact: true,
			})
			await expect(accept.getByText('与已确认内容冲突').first()).toBeVisible()
			await expect(
				accept.getByText('性格：谨慎 → 移除', { exact: true }),
			).toBeVisible()
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
			await expect(
				page.getByRole('status').filter({ hasText: '已接受候选' }),
			).toHaveText('已接受候选。')
			await page.getByRole('button', { name: /^术语/ }).click()
			await expect(
				confirmed.getByRole('rowheader', { name: '灯船', exact: true }),
			).toBeVisible()
			await page.screenshot({
				path: '.workflow/evidence/m2-editor/04-bible-after.png',
				fullPage: true,
			})
			await page.reload()
			await openCandidates(page)
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

test('M2 bible and glossary bridges a synthesized conflict into persistent approval and rejection controls', async () => {
	const root = await mkdtemp(join(tmpdir(), 'novelive-m2-synthesized-bible-'))
	const directory = join(root, 'project')
	const profile = join(root, 'profile')
	try {
		await seedSynthesis(directory)
		using project = await Project.open(directory)
		const synthesis = await synthesizeVolume(project, 'v1', chapters, {
			connection,
			language: 'en',
			strategy: 'whole',
			fetch: createReplayFetch({
				mode: 'strict',
				directory: 'tests/fixtures/cassettes/m1a-synthesis',
				async fetch() {
					throw new Error('Network forbidden')
				},
			}),
		})
		expect(synthesis.conflicts).toHaveLength(1)
		expect(synthesis.glossaryConflicts).toHaveLength(1)
		synthesis.conflicts.push(
			{
				...synthesis.conflicts[0],
				observedChapter: 'c2',
				entry: { ...synthesis.conflicts[0].entry, name: 'Later Ava' },
			} as (typeof synthesis.conflicts)[number],
			{
				kind: 'relation',
				op: 'add',
				entry: {
					id: 'unpublished-relation',
					from: 'ada',
					to: 'unpublished',
					description: 'Unpublished friend',
					status: 'candidate',
				},
			},
		)
		await project.write(synthesisFiles('v1').result, synthesis)
		await project.write(projectFiles.volume('v1'), {
			formatVersion,
			volumeId: 'v1',
			title: 'Synthesized volume',
			workIds: [workId],
		})
		await project.write(projectFiles.work('v1', workId), {
			formatVersion,
			workId,
			title: 'Synthesized work',
			chapterIds: chapters,
			version: 0,
			minReaderVersion: 1,
			appVersion: '0.1.0',
			language: 'en',
			settings: defaultWorkSettings(),
		})
		for (const chapterId of chapters) {
			await project.write(
				projectFiles.chapter({ volumeId: 'v1', workId, chapterId }),
				{
					formatVersion,
					chapterId,
					title: chapterId,
					sceneIds: [],
					paragraphIds: ['p0001'],
					cg: [],
				},
			)
			await project.writeFile(
				projectFiles.chapterText(chapterId),
				'Ada visits Paper Tower.\n',
			)
		}
		expect(
			project.database.prepare('SELECT COUNT(*) AS n FROM proposal').get(),
		).toEqual({ n: 0 })
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
			await page.evaluate((id) => {
				window.location.hash = `/work/${id}/bible?volume=v1`
			}, workId)
			await openCandidates(page)
			const character = page
				.getByRole('article', {
					name: /^综合候选：character\/ada\//,
				})
				.filter({ hasText: 'Ada → Ava' })
				.filter({ hasText: '待确认' })
			await expect(character).toBeVisible()
			await project.write(synthesisFiles('v1').result, {
				...synthesis,
				overview: 'Replacement synthesis, unchanged Bible',
			})
			await page.reload()
			await openCandidates(page)
			const superseded = page
				.getByRole('article', { name: /^综合候选：character\/ada\// })
				.filter({ hasText: 'Ada → Ava' })
				.filter({ hasText: '候选来源已' })
			await expect(
				superseded.getByRole('button', { name: '接受候选' }),
			).toBeDisabled()
			await expect(
				superseded.getByRole('button', { name: '拒绝候选' }),
			).toBeEnabled()
			const scoped = page
				.getByRole('article')
				.filter({ hasText: '暂不支持按章应用' })
			await expect(
				scoped.getByRole('button', { name: '接受候选' }),
			).toBeDisabled()
			await expect(
				scoped.getByRole('button', { name: '拒绝候选' }),
			).toBeEnabled()
			const relation = page
				.getByRole('article')
				.filter({ hasText: 'Unknown character reference: unpublished' })
			await expect(
				relation.getByRole('button', { name: '接受候选' }),
			).toBeDisabled()
			await expect(relation).toContainText('unpublished')
			await expect(
				character.getByRole('button', { name: '接受候选' }),
			).toBeEnabled()
			await expect(
				character.getByRole('button', { name: '拒绝候选' }),
			).toBeEnabled()
			await expect(character).toContainText('Ada → Ava')
			await page.getByRole('button', { name: /^术语/ }).click()
			const glossary = page
				.getByRole('article', {
					name: /^综合候选：glossary\/tower\//,
				})
				.filter({ hasText: '待确认' })
			await page.getByRole('button', { name: /^角色/ }).click()
			await character.getByRole('button', { name: '接受候选' }).click()
			await expect(character).toHaveCount(0)
			await expect(
				page
					.getByRole('region', { name: '已登记内容' })
					.getByRole('heading', { name: 'Ava', exact: true }),
			).toBeVisible()
			await page.getByRole('button', { name: /^术语/ }).click()
			await expect(
				glossary.getByRole('button', { name: '接受候选' }),
			).toBeEnabled()
			await glossary
				.getByRole('textbox', { name: '拒绝理由' })
				.fill('Keep Paper Tower')
			await glossary.getByRole('button', { name: '拒绝候选' }).click()
			await expect(glossary).toHaveCount(0)
			await page.reload()
			await openCandidates(page)
			await expect(
				page
					.getByRole('region', { name: '已登记内容' })
					.getByRole('heading', { name: 'Ava', exact: true }),
			).toBeVisible()
			await expect(character).toHaveCount(0)
			await page.getByRole('button', { name: /^术语/ }).click()
			await expect(glossary).toHaveCount(0)
			expect(
				(await project.read(projectFiles.character(scope, 'ada'))).entries[0],
			).toMatchObject({ name: 'Ava', status: 'confirmed' })
			expect(
				project.database
					.prepare(
						"SELECT status, feedback FROM proposal WHERE kind = 'glossary' AND status = 'rejected'",
					)
					.get(),
			).toMatchObject({ status: 'rejected', feedback: 'Keep Paper Tower' })
		} finally {
			await app.close()
		}
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})
