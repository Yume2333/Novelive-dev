import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compile } from '@earendil-works/pi-schema'
import { _electron as electron, expect, test } from '@playwright/test'
import { bibleRevision } from '../../packages/creator/src/bible/editing'
import { commands } from '../../packages/creator/src/contract'
import { Project } from '../../packages/creator/src/project'
import { createReplayFetch } from '../../packages/creator/src/replay'
import { readBible } from '../../packages/creator/src/synthesis/patch'
import { listUsage, withUsage } from '../../packages/creator/src/usage'
import {
	defaultWorkSettings,
	formatVersion,
	projectFiles,
} from '../../packages/format/src/model'
import {
	directory as artDirectory,
	runArt,
} from '../fixtures/cassettes/m1b-art/fixture'
import {
	fixtureOptions,
	runRecording,
} from '../fixtures/cassettes/m1b-writer/fixture'

const require = createRequire(
	new URL('../../apps/desktop/package.json', import.meta.url),
)
const workId = '00000000-0000-0000-0000-000000000001'
const volumeId = 'v1'
const offline = async () => {
	throw new Error('Network forbidden')
}

test('M4 usage and stale assets', async () => {
	const root = await mkdtemp(join(tmpdir(), 'novelive-m4-usage-'))
	const directory = join(root, 'project')
	const profile = join(root, 'profile')
	try {
		expect(await listUsage(profile)).toEqual({
			records: [],
			staleAssets: [],
			unreadableProjects: [],
		})
		using project = await Project.create(directory, {
			formatVersion,
			seriesId: 'usage',
			title: '用量验收',
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
			title: '用量验收',
			chapterIds: ['c1'],
			version: 1,
			minReaderVersion: 1,
			appVersion: '0.1.0',
			language: 'zh-CN',
			settings: defaultWorkSettings(),
		})
		project.tasks.registerWork({ workId, title: '用量验收' })
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
			await page.getByRole('link', { name: '用量', exact: true }).click()
			await expect(page.getByText('暂无用量记录')).toBeVisible()
			await withUsage(project, workId, 'write', () =>
				runRecording(
					fixtureOptions(
						createReplayFetch({
							mode: 'strict',
							directory: 'tests/fixtures/cassettes/m1b-writer',
							fetch: offline,
						}),
						undefined,
						4096,
					),
				),
			)
			await withUsage(project, workId, 'draw', () =>
				runArt(project, {
					mode: 'strict',
					directory: artDirectory,
					fetch: offline,
				}),
			)
			const usage = await listUsage(profile)
			expect(
				compile(commands['usage.list'].output).validate(usage),
			).toMatchObject({ ok: true })
			expect(
				usage.records.some(
					({ usage: row }) => row.kind === 'text' && row.inputTokens > 0,
				),
			).toBe(true)
			expect(
				usage.records.some(
					({ usage: row }) => row.kind === 'image' && row.imageCount > 0,
				),
			).toBe(true)
			await page.reload()
			expect(
				await page.evaluate(async () => {
					try {
						return await window.novelive.call('usage.list', {}).promise
					} catch (error) {
						return { error }
					}
				}),
			).toEqual(usage)
			// 逐次调用列表已改为按日/按模型汇总（ui-polish 决定）：
			// 模型 id 只出现在汇总表的行标签里，不再主导每一行
			const byModelTable = page.getByRole('region', { name: '按模型汇总' })
			await expect(byModelTable).toContainText('fixture-art-image')
			await expect(byModelTable).toContainText('devin-swe-2')
			const byDayTable = page.getByRole('region', { name: '按日汇总' })
			await expect(byDayTable).toContainText('缓存命中')
			// 内部 id（卷 id joined-<uuid>）绝不出现在界面上
			await expect(page.getByText(/joined-/)).toHaveCount(0)
			await page.getByRole('button', { name: '用量说明' }).click()
			await expect(
				page
					.getByRole('tooltip')
					.getByText(
						'文本按 tokens，图片按张数；参考金额只计入有单价的调用，仅供参考，不设预算或自动停机。',
					),
			).toBeVisible()
			await page.keyboard.press('Escape')
			await expect(page.getByRole('tooltip')).toHaveCount(0)
			const scope = { level: 'series' } as const
			const character = {
				id: 'xia',
				name: '小夏',
				aliases: [],
				status: 'confirmed' as const,
				appearance: { description: '黑发' },
				costumes: [
					{ id: 'uniform', description: '制服' },
					{ id: 'casual', description: '便服' },
				],
			}
			const second = { ...character, id: 'lin', name: '小林' }
			const location = {
				id: 'bridge',
				name: '桥边',
				description: '木桥',
				status: 'confirmed' as const,
			}
			await project.write(projectFiles.character(scope, character.id), {
				formatVersion,
				entries: [character],
			})
			await project.write(projectFiles.character(scope, second.id), {
				formatVersion,
				entries: [second],
			})
			await project.write(projectFiles.location(scope, location.id), {
				formatVersion,
				entries: [location],
			})
			await project.write(projectFiles.style(scope), {
				formatVersion,
				entries: [{ id: 'main', description: '水彩', status: 'confirmed' }],
			})
			const keys = [
				'xia/uniform/base',
				'xia/uniform/happy',
				'xia/casual/base',
				'lin/uniform/base',
				'lin/uniform/happy',
				'lin/casual/base',
				'bridge/day',
				'bridge/night',
				'other/day',
				'cg-test',
			]
			for (const key of keys)
				project.database
					.prepare(
						"INSERT INTO asset(work_id, asset_key, kind, status) VALUES (?, ?, ?, 'drawn')",
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
			async function propose(id: string, changes: unknown[]) {
				project.database
					.prepare(
						'INSERT INTO proposal(proposal_id, work_id, kind, prompt, payload, created_at) VALUES (?, ?, ?, ?, ?, 0)',
					)
					.run(
						id,
						workId,
						'bible',
						id,
						JSON.stringify({
							chapterIds: [],
							payload: {
								kind: 'bible',
								volumeId,
								expectedRevision: bibleRevision(await readBible(project)),
								changes,
							},
						}),
					)
				await page.evaluate(
					({ workId, volumeId }) => {
						window.location.hash = `/work/${workId}/bible?volume=${volumeId}`
					},
					{ workId, volumeId },
				)
				await page.reload()
				{
					const chip = page.getByRole('button', { name: /^候选与冲突/ })
					if ((await chip.getAttribute('aria-expanded')) !== 'true')
						await chip.click()
				}
				await page
					.getByRole('article', { name: id, exact: true })
					.getByRole('button', { name: '接受候选' })
					.click()
			}
			await propose('修改风格', [
				{
					kind: 'style',
					op: 'update',
					entry: { id: 'main', description: '赛璐璐', status: 'confirmed' },
				},
			])
			await expect(
				page.getByRole('status').filter({ hasText: '已接受候选' }),
			).toContainText('风格变更仅提示')
			expect((await listUsage(profile)).staleAssets).toEqual([])
			await propose('修改外貌造型地点', [
				{
					kind: 'character',
					op: 'update',
					entry: { ...character, appearance: { description: '银发' } },
				},
				{
					kind: 'character',
					op: 'update',
					entry: {
						...second,
						costumes: [
							{ id: 'uniform', description: '新制服' },
							second.costumes[1],
						],
					},
				},
				{
					kind: 'location',
					op: 'update',
					entry: { ...location, description: '石桥' },
				},
			])
			await expect(
				page.getByRole('status').filter({ hasText: '已接受候选' }),
			).toContainText('已标记过期')
			const expected = [
				'bridge/day',
				'bridge/night',
				'lin/uniform/base',
				'lin/uniform/happy',
				'xia/casual/base',
				'xia/uniform/base',
				'xia/uniform/happy',
			]
			expect(
				(await listUsage(profile)).staleAssets.map((row) => row.assetKey),
			).toEqual(expected)
			// 候选与冲突现在是有意保持打开的模态 Drawer（原型组件升级：
			// 内嵌面板 → Drawer），接受最后一个候选后渲染空态；
			// 离开前必须显式关闭，否则 scrim 会拦截后续导航点击。
			const drawer = page.getByRole('dialog', { name: '候选与冲突' })
			await expect(drawer.getByText('暂无待确认候选')).toBeVisible()
			await drawer.getByRole('button', { name: '关闭' }).click()
			await expect(drawer).toBeHidden()
			await page.getByRole('link', { name: '用量', exact: true }).click()
			// 「过期素材」栏已从用量页删除（ui-polish 决定：制作页拥有过期素材）；
			// 后端数据仍由 listUsage 提供，上面已逐键断言
			await expect(page.getByRole('region', { name: '过期素材' })).toHaveCount(
				0,
			)
			await expect(page.getByText('cg-test', { exact: true })).toHaveCount(0)
			await page.screenshot({
				path: '.workflow/evidence/m4-longform/09-usage-staleness.png',
				fullPage: true,
			})
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
			await page.reload()
			await expect(
				page.getByRole('region', { name: '按模型汇总' }),
			).toContainText('fixture-art-image')
			expect((await listUsage(profile)).records).toEqual(usage.records)
			await writeFile(
				join(profile, 'projects', 'broken'),
				join(root, 'missing'),
			)
			await writeFile(
				join(profile, 'projects', 'broken-too'),
				join(root, 'missing-too'),
			)
			const partial = await listUsage(profile)
			expect(partial.records).toEqual(usage.records)
			expect(
				[...partial.unreadableProjects].sort((a, b) =>
					a.projectId.localeCompare(b.projectId),
				),
			).toEqual([
				{ projectId: 'broken', reason: '项目已移动或不存在' },
				{ projectId: 'broken-too', reason: '项目已移动或不存在' },
			])
			await page.reload()
			// 警示横幅：人话条目（一部作品无法读取 + 本地化原因），
			// 原始 projectId 只进折叠的「详细信息」，绝不在主文案露 UUID
			const warning = page.getByRole('alert').filter({
				hasText: '部分作品无法读取，未计入统计',
			})
			// 同因多部合成一行「N 部作品无法读取 · 原因」，不再逐条重复
			await expect(warning).toContainText('2 部作品无法读取')
			await expect(warning).toContainText('项目已移动或删除')
			expect(
				await warning
					.getByText('2 部作品无法读取 · 项目已移动或删除', { exact: true })
					.count(),
			).toBe(1)
			// 原始 id 只在折叠的「详细信息」里：默认收起，展开后才可见
			const detailsToggle = warning.getByRole('button', { name: '详细信息' })
			await expect(detailsToggle).toHaveAttribute('aria-expanded', 'false')
			await detailsToggle.click()
			await expect(detailsToggle).toHaveAttribute('aria-expanded', 'true')
			// 两个 broken 绑定的原始行都留在「详细信息」里
			await expect(
				warning.getByText(/^broken · 项目已移动或不存在$/),
			).toBeVisible()
			await expect(
				warning.getByText(/^broken-too · 项目已移动或不存在$/),
			).toBeVisible()
			await expect(
				page.getByRole('region', { name: '按模型汇总' }),
			).toContainText('fixture-art-image')
		} finally {
			await app.close()
		}
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})
