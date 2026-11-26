import type {
	ClientFrame,
	CommandInput,
	EventEnvelope,
	ProductionSnapshot,
} from '@novelive/creator/contract'
import type { ElectronApplication } from '@playwright/test'

export const workId = '1827a019-0693-4cf5-8cd3-5dd70b9f8127'
export const candidateColors = ['#849589', '#aaaa89', '#7d8998']
const candidates = (prefix: string) =>
	candidateColors.map((_color, index) => ({
		id: `${prefix}-${index + 1}`,
		cachePath: `creation-ui/${prefix}-${index + 1}.png`,
	}))

const chapters = [
	{ chapterId: 'one', status: 'waiting', priority: true },
	{ chapterId: 'two', status: 'waiting', priority: false },
] as const

const beforeVisual: ProductionSnapshot = {
	workId,
	title: '白塔来信',
	summary: '一封深夜送到灯塔的信。',
	chapterTitles: { one: '灯塔', two: '潮汐' },
	phase: 'confirm-visual',
	status: 'confirm',
	chapters: [...chapters],
	visual: {
		mattingUnavailable: true,
		mainVisuals: candidates('visual'),
		characters: [
			{
				characterId: 'keeper',
				costumeId: 'coat',
				characterName: '守塔人',
				costumeName: '旧外套',
				candidates: candidates('portrait'),
			},
		],
		supplemental: candidates('reference'),
	},
}
const producing: ProductionSnapshot = {
	...beforeVisual,
	phase: 'producing',
	status: 'producing',
	chapters: [
		{ ...chapters[0], status: 'producing', step: 'write' },
		chapters[1],
	],
	visual: null,
}
const first: ProductionSnapshot = {
	...producing,
	phase: 'confirm-first',
	status: 'confirm',
	chapters: [
		{
			...chapters[0],
			status: 'published',
			issue: { kind: 'placeholder', count: 1 },
		},
		chapters[1],
	],
}
const blocked: ProductionSnapshot = {
	...first,
	phase: 'producing',
	blockedChapterId: 'two',
	chapters: [
		first.chapters[0],
		{
			...chapters[1],
			issue: {
				kind: 'network',
				detail: '[network] Model connection interrupted',
			},
		},
	],
}
const second: ProductionSnapshot = {
	...first,
	phase: 'producing',
	status: 'producing',
	chapters: [
		first.chapters[0],
		{ ...chapters[1], status: 'producing', step: 'draw' },
	],
}
const finished: ProductionSnapshot = {
	...second,
	phase: 'done',
	status: 'idle',
	chapters: [first.chapters[0], { ...chapters[1], status: 'published' }],
}

const record = (
	seq: number,
	chapterId: string,
	status: string,
	message: string,
	detail?: string,
): EventEnvelope => ({
	seq,
	scope: 'work',
	scopeId: workId,
	at: '2026-01-01T08:00:00.000Z',
	event: {
		type: 'production.chapterRecord',
		payload: { workId, chapterId, step: 'write', status, message, detail },
	},
})

type Stage = 'beforeVisual' | 'first' | 'finished'
type ProjectionDriver = {
	calls: Extract<ClientFrame, { type: 'call' }>[]
	publish(stage: Stage): void
}
type TestGlobal = typeof globalThis & { creationProjection: ProjectionDriver }

export async function installProjection(app: ElectronApplication) {
	await app.evaluate(
		({ BrowserWindow, MessageChannelMain }, fixture) => {
			const window = BrowserWindow.getAllWindows()[0]
			const { port1, port2 } = new MessageChannelMain()
			const generation = 100
			let snapshot = fixture.beforeVisual
			let seq = 3
			const persistentEvents = [...fixture.records]
			const calls: ProjectionDriver['calls'] = []
			const sendEvent = (envelope: EventEnvelope) =>
				port1.postMessage({ type: 'event', generation, envelope })
			const publish = (stage: Stage) => {
				snapshot = fixture[stage]
				sendEvent({
					seq: ++seq,
					scope: 'work',
					scopeId: snapshot.workId,
					at: new Date().toISOString(),
					event: { type: 'production.snapshot', payload: snapshot },
				})
			}
			;(globalThis as TestGlobal).creationProjection = { calls, publish }
			port1.on('message', ({ data }: { data: ClientFrame }) => {
				if (data.type !== 'call') return
				calls.push(data)
				const base = { generation, requestId: data.requestId }
				function respond(result: unknown) {
					port1.postMessage({ ...base, type: 'result', result })
				}
				switch (data.command) {
					case 'library.list':
						respond({
							works: [
								{
									workId: snapshot.workId,
									title: snapshot.title ?? '白塔来信',
									published: 0,
									chapters: snapshot.chapters.length,
									project: {
										directory: '/projects/fog-sea',
										seriesId: 'ser-1',
										seriesTitle: '雾海纪行',
										volumeId: 'v1',
										volumeTitle: '灯塔卷',
										volumeIndex: 1,
									},
								},
							],
							unreadableCount: 0,
						})
						break
					case 'production.getQueue':
						respond({ active: null, queued: [], inactive: [] })
						break
					case 'production.get':
						respond(snapshot)
						break
					case 'production.confirmVisual':
						snapshot = fixture.producing
						respond(snapshot)
						break
					case 'production.continue':
						snapshot =
							snapshot.phase === 'confirm-first'
								? fixture.blocked
								: fixture.second
						respond(snapshot)
						break
					case 'production.retryChapter': {
						snapshot = fixture.second
						respond(snapshot)
						const liveEvent = { ...fixture.live, seq: ++seq }
						persistentEvents.push(liveEvent)
						sendEvent(liveEvent)
						break
					}
					case 'production.stop':
						snapshot = {
							...fixture.second,
							status: 'stopped',
							chapters: [fixture.second.chapters[0], fixture.waiting],
						}
						respond({
							workId: snapshot.workId,
							mode: 'immediate',
							cancelledQueued: 0,
							abortedRunning: 1,
						})
						break
					case 'events.list':
						respond({ events: persistentEvents, gap: false, snapshot: null })
						break
					case 'production.playerChapter': {
						const chapterId =
							(data.payload as CommandInput<'production.playerChapter'>)
								.chapterId ?? 'one'
						const title = chapterId === 'two' ? '潮汐' : '灯塔'
						respond({
							linked: false,
							chapters: snapshot.chapters.map((chapter) => ({
								chapterId: chapter.chapterId,
								title: chapter.chapterId === 'two' ? '潮汐' : '灯塔',
								published: chapter.status === 'published',
								progress: chapter.status,
							})),
							script: `scene ${title}\nsource p0001\n@bg room/night\n: ${title}的第一句。 #0001\n: ${title}的下一句。 #0002\n\nscene ${title} · 夜谈\nsource p0002\n@bg room/day\n@show keeper/coat/neutral center\n: 灯塔下的潮声。 #0003\n`,
							chapter: {
								formatVersion: 1,
								chapterId,
								title,
								paragraphIds: ['p0001', 'p0002'],
								sceneIds: ['aaaabbbb', 'ccccdddd'],
								cg: [],
							},
							registry: {
								formatVersion: 1,
								entries: [
									{
										id: 'room/night',
										type: 'location',
										path: 'creation-ui/visual-1.png',
										status: 'drawn',
										aliases: [],
									},
									{
										id: 'room/day',
										type: 'location',
										path: 'creation-ui/visual-2.png',
										status: 'drawn',
										aliases: [],
									},
									{
										id: 'keeper/coat/neutral',
										type: 'character',
										path: 'creation-ui/portrait-1.png',
										status: 'drawn',
										aliases: [],
									},
								],
							},
							speakers: [],
							speakerNames: {},
							customMarks: {},
						})
						break
					}
					case 'config.get':
						port1.postMessage({
							...base,
							type: 'error',
							error: { code: 'unsupported', message: 'Test projection' },
						})
						break
					case 'usage.list':
						respond({ records: [], staleAssets: [], unreadableProjects: [] })
						break
					default:
						throw new Error(`Unexpected command: ${data.command}`)
				}
			})
			port1.start()
			window.webContents.postMessage('novelive:port', generation, [port2])
			window.webContents.send('novelive:ready', { generation })
		},
		{
			beforeVisual,
			producing,
			first,
			blocked,
			second,
			finished,
			waiting: chapters[1],
			records: [
				record(1, 'one', 'done', '第一章剧本生成完成'),
				record(
					2,
					'two',
					'failed',
					'第二章写手请求超时',
					'重试将重新运行写剧本',
				),
				{
					...record(3, 'two', 'done', '其他作品的记录'),
					scopeId: 'other-work',
				},
			],
			live: record(0, 'two', 'running', '重试已启动'),
		},
	)
	return {
		publish: (stage: Stage) =>
			app.evaluate(
				(_electron, value) =>
					(globalThis as TestGlobal).creationProjection.publish(value),
				stage,
			),
		calls: (command: string) =>
			app.evaluate(
				(_electron, value) =>
					(globalThis as TestGlobal).creationProjection.calls
						.filter((call) => call.command === value)
						.map((call) => call.payload),
				command,
			),
	}
}
