import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
	ClientFrame,
	CommandOutput,
	EventEnvelope,
} from '@novelive/creator/contract'
import {
	type ElectronApplication,
	_electron as electron,
	expect,
	type Page,
	test,
} from '@playwright/test'
import sharp from 'sharp'

const require = createRequire(
	new URL('../../apps/desktop/package.json', import.meta.url),
)
const workId = '5c1d7d3e-2f0b-4b8e-9a51-8f3c2b6d9e10'
type Snapshot = CommandOutput<'chat.get'>
type Entry = Snapshot['entries'][number]
type Driver = { calls: Extract<ClientFrame, { type: 'call' }>[] }

const at = '2026-11-23T08:00:00.000Z'
const message = (
	id: string,
	parentId: string | null,
	role: 'user' | 'assistant',
	parts: Extract<Entry, { kind: 'message' }>['parts'],
): Entry => ({ id, parentId, at, kind: 'message', role, parts })
const session = (sessionId: string, title: string) => ({
	workId,
	sessionId,
	title,
	updatedAt: at,
})

const keeper: Snapshot = {
	session: session('keeper', '守塔人设定'),
	headId: 'a1b',
	headIds: ['a1', 'a1b'],
	status: 'idle',
	entries: [
		message('u1', null, 'user', [
			{ type: 'text', text: '守塔人的年龄写得前后不一' },
		]),
		message('a1', 'u1', 'assistant', [
			{ type: 'reasoning', text: '先查设定集里的年龄条目。' },
			{
				type: 'tool',
				id: 'tool-1',
				name: 'read_bible',
				input: '{"entry":"守塔人","field":"年龄"}',
				result: '{"年龄":"五十八岁","来源":"第一章"}',
			},
			{ type: 'subtask', id: 'sub-1', label: '核对第二章称呼', status: 'done' },
			{ type: 'text', text: '设定集写的是**五十八岁**，第二章误写成六十岁。' },
		]),
		message('u1b', null, 'user', [
			{ type: 'text', text: '守塔人的年龄统一成六十岁' },
		]),
		message('a1b', 'u1b', 'assistant', [
			{ type: 'text', text: '好的，我会把设定集和第一章都改成六十岁。' },
		]),
	],
}
const tide: Snapshot = {
	session: session('tide', '第二章节奏'),
	headId: 'a2',
	headIds: ['a2'],
	status: 'idle',
	entries: [
		message('u2', null, 'user', [{ type: 'text', text: '第二章太拖了' }]),
		message('a2', 'u2', 'assistant', [
			{ type: 'text', text: '建议重做第二章，压缩潮汐前的独白。' },
			{
				type: 'proposal',
				proposal: {
					workId,
					id: 'proposal-1',
					sessionId: 'tide',
					prompt: '重做第二章，删去重复独白',
					chapterIds: ['two'],
					payload: {
						kind: 'redoChapter',
						chapterId: 'two',
						expectedRevision: 'r3',
					},
					status: 'pending',
				},
			},
		]),
	],
}

async function installChatProjection(app: ElectronApplication) {
	await app.evaluate(
		({ BrowserWindow, MessageChannelMain }, fixture) => {
			const window = BrowserWindow.getAllWindows()[0]
			const { port1, port2 } = new MessageChannelMain()
			const generation = 200
			const calls: Driver['calls'] = []
			const store: Record<string, Snapshot> = {
				keeper: fixture.keeper,
				tide: fixture.tide,
			}
			let seq = 0
			let streamingId = ''
			const emit = (payload: unknown) =>
				port1.postMessage({
					type: 'event',
					generation,
					envelope: {
						seq: ++seq,
						scope: 'work',
						scopeId: fixture.workId,
						at: fixture.at,
						event: { type: 'chat.message', payload },
					} satisfies EventEnvelope,
				})
			;(
				globalThis as typeof globalThis & { chatProjection: Driver }
			).chatProjection = { calls }
			port1.on('message', ({ data }: { data: ClientFrame }) => {
				if (data.type !== 'call') return
				calls.push(data)
				const base = { generation, requestId: data.requestId }
				const respond = (result: unknown) =>
					port1.postMessage({ ...base, type: 'result', result })
				const input = data.payload as Record<string, never>
				const current = store[input.sessionId]
				switch (data.command) {
					case 'production.get':
						respond({ workId: fixture.workId, chapterTitles: { two: '潮汐' } })
						break
					case 'chat.list':
						respond({
							sessions: Object.values(store).map((item) => item.session),
						})
						break
					case 'chat.get':
						respond({ ...current, headId: input.headId ?? current.headId })
						break
					case 'chat.attach':
						respond({
							id: 'attachment-1',
							name: input.name,
							mimeType: input.mimeType,
							cachePath: 'm2-chat/pasted.png',
						})
						break
					case 'chat.send': {
						const send = data.payload as {
							parentId: string | null
							content: { text: string; attachmentIds: string[] }
						}
						const user = {
							id: `u${seq + 10}`,
							parentId: send.parentId,
							at: fixture.at,
							kind: 'message' as const,
							role: 'user' as const,
							parts: [
								...send.content.attachmentIds.map((id) => ({
									type: 'image' as const,
									attachment: {
										id,
										name: 'pasted.png',
										mimeType: 'image/png' as const,
										cachePath: 'm2-chat/pasted.png',
									},
								})),
								{ type: 'text' as const, text: send.content.text },
							],
						}
						const reply = {
							id: `a${seq + 10}`,
							parentId: user.id,
							at: fixture.at,
							kind: 'message' as const,
							role: 'assistant' as const,
							parts: [
								{
									type: 'reasoning' as const,
									text: '对照参考图里的外套颜色。',
								},
								{
									type: 'tool' as const,
									id: 'tool-live',
									name: 'compare_image',
									input: '{"attachment":"attachment-1"}',
								},
								{ type: 'text' as const, text: '正在比对参考图' },
							],
						}
						streamingId = reply.id
						store[input.sessionId] = {
							...current,
							entries: [...current.entries, user, reply],
							headId: reply.id,
							headIds: [...current.headIds, reply.id],
							status: 'streaming',
						}
						respond({ headId: user.id })
						emit({
							workId: fixture.workId,
							sessionId: input.sessionId,
							headId: reply.id,
							message: reply,
							status: 'streaming',
						})
						break
					}
					case 'chat.stop': {
						const reply = current.entries.find(
							(entry) => entry.id === streamingId,
						)
						store[input.sessionId] = { ...current, status: 'idle' }
						respond({ stopped: true })
						emit({
							workId: fixture.workId,
							sessionId: input.sessionId,
							headId: streamingId,
							message: reply,
							status: 'cancelled',
						})
						break
					}
					case 'proposal.resolve': {
						const resolve = data.payload as {
							decision: { kind: string; reason?: string }
						}
						const proposal = fixture.tide.entries
							.flatMap((entry) => (entry.kind === 'message' ? entry.parts : []))
							.find((part) => part.type === 'proposal')
						if (proposal?.type !== 'proposal') throw new Error('No proposal')
						respond({
							status: 'resolved',
							proposal: {
								...proposal.proposal,
								status:
									resolve.decision.kind === 'reject' ? 'rejected' : 'approved',
								feedback: resolve.decision.reason,
							},
						})
						break
					}
					default:
						port1.postMessage({
							...base,
							type: 'error',
							error: { code: 'unsupported', message: 'Test projection' },
						})
				}
			})
			port1.start()
			window.webContents.postMessage('novelive:port', generation, [port2])
			window.webContents.send('novelive:ready', { generation })
		},
		{ keeper, tide, workId, at },
	)
}

const calls = (app: ElectronApplication, command: string) =>
	app.evaluate(
		(_electron, name) =>
			(
				globalThis as typeof globalThis & { chatProjection: Driver }
			).chatProjection.calls
				.filter((call) => call.command === name)
				.map((call) => call.payload),
		command,
	)

async function capture(page: Page, name: string) {
	const evidence = process.env.NL_CHAT_UI_EVIDENCE
	if (!evidence) return
	await page.evaluate(() => document.fonts.ready)
	await page.screenshot({
		path: join(evidence, `06-${name}.jpg`),
		type: 'jpeg',
		quality: 75,
	})
}

test('M2 chat panel pastes images, shows tools, stops, switches sessions and branches', async () => {
	const profile = await mkdtemp(join(tmpdir(), 'novelive-m2-chat-'))
	try {
		const cache = join(profile, 'cache', 'm2-chat')
		await mkdir(cache, { recursive: true })
		await sharp({
			create: { width: 64, height: 48, channels: 3, background: '#7d8998' },
		})
			.png()
			.toFile(join(cache, 'pasted.png'))
		const app = await electron.launch({
			executablePath: require('electron'),
			args: ['apps/desktop', `--user-data-dir=${profile}`],
			env: { ...process.env, ELECTRON_RENDERER_URL: '', NL_REPLAY: 'strict' },
		})
		try {
			const page = await app.firstWindow()
			await expect(page.getByText('创作端已就绪')).toBeAttached()
			await installChatProjection(app)
			await page.evaluate((hash) => {
				window.location.hash = hash
			}, `#/work/${workId}/bible`)

			await page.keyboard.press('Control+J')
			const panel = page.getByRole('complementary', { name: 'Agent' })
			await expect(panel).toBeVisible()
			await expect(panel.getByText('守塔人的年龄统一成六十岁')).toBeVisible()
			const branches = panel.getByRole('navigation', { name: '分支' })
			await expect(branches.getByText('2/2')).toBeVisible()

			await branches.getByRole('button', { name: '上一个分支' }).click()
			await expect(panel.getByText('守塔人的年龄写得前后不一')).toBeVisible()
			await expect(branches.getByText('1/2')).toBeVisible()
			expect(await calls(app, 'chat.get')).toContainEqual({
				workId,
				sessionId: 'keeper',
				headId: 'a1',
			})
			await panel.getByRole('button', { name: /read_bible/ }).click()
			await expect(panel.getByText('"field": "年龄"')).toBeVisible()
			await expect(panel.getByText('"来源": "第一章"')).toBeVisible()
			await expect(panel.getByText('核对第二章称呼')).toBeVisible()
			await capture(page, 'tool-detail')

			const input = panel.getByRole('textbox', { name: '给 Agent 发消息' })
			await input.evaluate(async (element) => {
				const canvas = document.createElement('canvas')
				canvas.width = 32
				canvas.height = 24
				const blob = await new Promise<Blob>((resolve) =>
					canvas.toBlob((value) => resolve(value as Blob), 'image/png'),
				)
				const data = new DataTransfer()
				data.items.add(new File([blob], 'pasted.png', { type: 'image/png' }))
				element.dispatchEvent(
					new ClipboardEvent('paste', { clipboardData: data, bubbles: true }),
				)
			})
			const pending = panel.getByRole('list', { name: '待发送的图片' })
			await expect(
				pending.getByRole('img', { name: 'pasted.png' }),
			).toBeVisible()
			const [attach] = await calls(app, 'chat.attach')
			expect(attach).toMatchObject({
				workId,
				sessionId: 'keeper',
				name: 'pasted.png',
				mimeType: 'image/png',
			})
			expect((attach as { base64: string }).base64.length).toBeGreaterThan(0)

			await input.fill('按这张图调整外套')
			await input.press('Enter')
			await expect(panel.getByText('正在比对参考图')).toBeVisible()
			expect(await calls(app, 'chat.send')).toContainEqual({
				workId,
				sessionId: 'keeper',
				expectedHeadId: 'a1',
				parentId: 'a1',
				content: { text: '按这张图调整外套', attachmentIds: ['attachment-1'] },
			})
			await expect(
				panel
					.getByRole('article', { name: '我的消息' })
					.getByRole('img', { name: 'pasted.png' }),
			).toBeVisible()
			await expect(
				panel.getByRole('button', { name: /compare_image\s*运行中/ }),
			).toBeVisible()
			await capture(page, 'streaming')

			await panel.getByRole('button', { name: '停止', exact: true }).click()
			await expect(
				panel.getByRole('button', { name: /compare_image\s*已停止/ }),
			).toBeVisible()
			await expect(
				panel.getByRole('button', { name: '停止', exact: true }),
			).toHaveCount(0)
			expect((await calls(app, 'chat.stop')).length).toBe(1)

			await panel.getByRole('button', { name: '切换会话' }).click()
			await panel
				.getByRole('button', { name: '第二章节奏', exact: true })
				.click()
			const card = panel.getByRole('region', { name: '确认卡' })
			await expect(card.getByText('影响：潮汐')).toBeVisible()
			await card.getByRole('button', { name: '拒绝', exact: true }).click()
			await card.getByRole('textbox', { name: '拒绝理由' }).fill('先保留独白')
			await card.getByRole('button', { name: '确认拒绝' }).click()
			await expect(card.getByText('已拒绝：先保留独白')).toBeVisible()
			expect(await calls(app, 'proposal.resolve')).toEqual([
				{
					workId,
					proposalId: 'proposal-1',
					decision: { kind: 'reject', reason: '先保留独白' },
				},
			])

			await panel.getByRole('button', { name: '全屏' }).click()
			await expect(panel).toHaveAttribute('data-full', 'true')
			await capture(page, 'fullscreen')
			await page.keyboard.press('Escape')
			await expect(panel).toHaveAttribute('data-full', 'false')
			await page.keyboard.press('Control+J')
			await expect(panel).toHaveCount(0)
		} finally {
			await app.close()
		}
	} finally {
		await rm(profile, { recursive: true, force: true })
	}
})
