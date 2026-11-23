import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, extname, join } from 'node:path'
import { projectFiles } from '@novelive/format/model'
import { getBible, openBibleProject } from './bible/editing'
import { EventReplay } from './chat/events'
import { registerChat } from './chat/register'
import { createConfigStore } from './config'
import {
	type CommandInput,
	type CreatorFrame,
	clientFrame,
	creatorCommandError,
	type EventEnvelope,
} from './contract'
import { createRegistry } from './registry'
import { createReplayFetch, type ReplayOptions } from './replay'
import { listUsage } from './usage'

const parent = process.parentPort
const generation = Number(process.env.NL_CREATOR_GENERATION)
const registry = createRegistry()
const configuredDataDir = process.env.NL_CREATOR_DATA_DIR
assert(configuredDataDir, 'Creator data directory is required')
const dataDir = configuredDataDir
const config = createConfigStore(dataDir)
const cacheDir = join(dataDir, 'cache')
let sendEvent: ((frame: CreatorFrame) => void) | undefined
let production: ReturnType<typeof loadProduction> | undefined
const editorWorks = new Map<string, ReturnType<typeof openEditorWork>>()

async function openEditorWork(workId: string) {
	const [{ Project }, { ProjectEditor }] = await Promise.all([
		import('./project'),
		import('./editor/history'),
	])
	let directory: string
	try {
		directory = await readFile(join(dataDir, 'projects', workId), 'utf8')
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
		throw { code: 'not_found', message: '工程中找不到这部作品' }
	}
	const project = await Project.open(directory)
	try {
		const series = await project.read(projectFiles.series)
		for (const volumeId of series.volumeIds) {
			const volume = await project.read(projectFiles.volume(volumeId))
			if (!volume.workIds.includes(workId)) continue
			const work = await project.read(projectFiles.work(volumeId, workId))
			if (
				!project.database
					.prepare('SELECT 1 FROM work WHERE work_id = ?')
					.get(workId)
			)
				project.tasks.registerWork({ workId, title: work.title })
			return {
				project,
				volumeId,
				editor: new ProjectEditor(project, volumeId, workId),
			}
		}
		throw { code: 'not_found', message: '工程中找不到这部作品' }
	} catch (error) {
		project.close()
		throw error
	}
}

async function revisionsFor(workId: string) {
	const session = await editorWork(workId)
	const { CreativeRevisions } = await import('./editor/revisions')
	return new CreativeRevisions(session.project, workId, session.editor, {
		rewriteScene: async (...args) =>
			(await productionSession(workId)).rewriteScene(...args),
		redraw: async (...args) =>
			(await productionSession(workId)).redraw(...args),
		adoptImage: async (...args) =>
			(await productionSession(workId)).adoptImage(...args),
		redo: async (...args) => (await productionSession(workId)).redo(...args),
	})
}

registry.register('editor.resolveMark', async (input) => {
	const { editor } = await editorWork(input.workId)
	return editor.resolveMark(input)
})
registry.register('editor.rewriteScene', async (input, signal) =>
	(await revisionsFor(input.workId)).rewriteScene(input, signal),
)
registry.register('editor.applyRewrite', async (input) =>
	(await revisionsFor(input.workId)).applyRewrite(input),
)
registry.register('editor.selectImage', async (input) =>
	(await revisionsFor(input.workId)).selectImage(input),
)
registry.register('editor.imageRevision', async (input) => ({
	revision: await (await revisionsFor(input.workId)).imageRevision(
		input.assetId,
	),
}))
registry.register('editor.regenerateImage', async (input, signal) => {
	const result = await (await revisionsFor(input.workId)).regenerateImage(
		input,
		signal,
	)
	if (result.status !== 'candidates') return result
	const { project } = await editorWork(input.workId)
	return {
		...result,
		candidates: await Promise.all(
			result.candidates.map(async (candidate) => {
				const bytes = await project.readFile(candidate.cachePath)
				const cachePath = `editor/${createHash('sha256').update(bytes).digest('hex')}${extname(candidate.cachePath)}`
				const destination = join(cacheDir, cachePath)
				await mkdir(dirname(destination), { recursive: true })
				await writeFile(destination, bytes)
				return { ...candidate, cachePath }
			}),
		),
	}
})

function editorWork(workId: string) {
	let session = editorWorks.get(workId)
	if (!session) {
		session = openEditorWork(workId).catch((error) => {
			editorWorks.delete(workId)
			throw error
		})
		editorWorks.set(workId, session)
	}
	return session
}

registry.register('editor.open', async (input) => {
	const { project, editor } = await editorWork(input.workId)
	const result = await editor.open(input)
	try {
		const entries = await Promise.all(
			result.registry.entries.map(async (entry) => {
				const unavailable = () => ({
					...entry,
					path: `editor/unavailable/${createHash('sha256').update(`${project.root}/${entry.id}`).digest('hex')}${extname(entry.path)}`,
				})
				if (entry.status === 'pending') return unavailable()
				let bytes: Buffer
				try {
					bytes = await project.readFile(entry.path)
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === 'ENOENT')
						return unavailable()
					throw error
				}
				const path = `editor/${createHash('sha256').update(bytes).digest('hex')}${extname(entry.path)}`
				const destination = join(cacheDir, path)
				await mkdir(dirname(destination), { recursive: true })
				await writeFile(destination, bytes)
				return { ...entry, path }
			}),
		)
		return { ...result, registry: { ...result.registry, entries } }
	} catch (error) {
		await editor.close({ ...input, editorId: result.editorId })
		throw error
	}
})
registry.register('editor.close', async (input) =>
	(await editorWork(input.workId)).editor.close(input),
)
registry.register('editor.editLine', async (input) =>
	(await editorWork(input.workId)).editor.editLine(input),
)
registry.register('editor.undo', async (input) =>
	(await editorWork(input.workId)).editor.undo(input),
)
registry.register('editor.history', async (input) => {
	const { project } = await editorWork(input.workId)
	const { listHistory, withProjectEdits } = await import('./editor/history')
	return withProjectEdits(project, async () => listHistory(project, input))
})
registry.register('editor.saveRules', async (input) => {
	const { project, volumeId } = await editorWork(input.workId)
	const { saveRules } = await import('./editor/rules')
	return saveRules(project, volumeId, input)
})
const chats = new Map<string, ReturnType<typeof openChat>>()
const events = new EventReplay()
// Sequences belong to this creator generation. Reopened sessions republish their
// persisted chapter records with new seqs; clients must reset afterSeq when the
// creator generation changes.
let eventSeq = 0
let closing = false

function publish(envelope: EventEnvelope) {
	envelope.seq = ++eventSeq
	events.append(envelope)
	sendEvent?.({ type: 'event', generation, envelope })
}

async function openChat(workId: string) {
	const project = await openBibleProject(dataDir, workId)
	try {
		const { projectChat } = await import('./chat/project')
		const chat = await projectChat(
			project,
			workId,
			config,
			cacheDir,
			process.env.NL_CHAT_CASSETTE_DIR
				? {
						directory: process.env.NL_CHAT_CASSETTE_DIR,
						normalizeIds: true,
						reuseRecorded: true,
					}
				: strictReplayOptions(),
			(event) => {
				const envelope: EventEnvelope = {
					scope: 'work',
					scopeId: workId,
					seq: 0,
					at: new Date().toISOString(),
					event,
				}
				publish(envelope)
			},
			await revisionsFor(workId),
		)
		return { chat, project }
	} catch (error) {
		project.close()
		throw error
	}
}

async function getChat(workId: string) {
	if (closing) throw { code: 'cancelled', message: '创作端正在关闭' }
	let opening = chats.get(workId)
	if (!opening) {
		opening = openChat(workId)
		chats.set(workId, opening)
		opening.catch(() => chats.delete(workId))
	}
	return (await opening).chat
}

function strictReplayOptions(): ReplayOptions | undefined {
	if (process.env.NL_REPLAY !== 'strict') return undefined
	const delay = Number(process.env.NL_REPLAY_DELAY_MS)
	const fault = process.env.NL_REPLAY_FAULT
	return {
		delayMs: Number.isSafeInteger(delay) && delay > 0 ? delay : undefined,
		fault: fault === 'disconnect' || fault === 'bad-image' ? fault : undefined,
	}
}

function loadProduction() {
	const directory = process.env.NL_PRODUCTION_CASSETTE_DIR
	return import('./project/production').then(({ createProduction }) =>
		createProduction(
			dataDir,
			config,
			{
				...strictReplayOptions(),
				...(directory
					? { directory, normalizeIds: true, reuseRecorded: true }
					: {}),
				fallbackDirectory: process.env.NL_PRODUCTION_FALLBACK_DIR,
			},
			publish,
			(active) =>
				parent.postMessage({ type: 'production.active', generation, active }),
		),
	)
}

function getProduction() {
	if (closing) throw { code: 'cancelled', message: '创作端正在关闭' }
	production ??= loadProduction()
	return production
}

async function productionSession(workId: string) {
	return (await getProduction()).get(workId)
}

registry.register('config.get', () => config.get())
registry.register('library.list', async () =>
	(await import('./project/library')).listLibrary(dataDir),
)
registry.register('usage.list', () => listUsage(dataDir))
registry.register('bible.get', async (input) => {
	using project = await openBibleProject(dataDir, input.workId)
	return await getBible(project, input)
})
registerChat(registry, getChat)
registry.register('config.update', async (patch) => {
	const value = await config.update(patch)
	await (await production)?.refreshSettings()
	return value
})
registry.register('config.reset', async () => {
	const value = await config.reset()
	await (await production)?.refreshSettings()
	return value
})
registry.register(
	'production.playerChapter',
	async ({ directory, workId, chapterId }) =>
		(await getProduction()).player(workId, directory, chapterId),
)
registry.register('production.playerStatus', async ({ directory, workId }) =>
	(await getProduction()).playerStatus(workId, directory),
)
registry.register('production.get', async ({ workId }) =>
	(await productionSession(workId)).snapshot(),
)
registry.register('production.resolveAsset', async ({ workId, assetId }) =>
	(await productionSession(workId)).asset(assetId),
)
registry.register('production.confirmVisual', async (input) =>
	(await productionSession(input.workId)).confirm(input),
)
registry.register('production.continue', async ({ workId }) =>
	(await productionSession(workId)).continue(),
)
registry.register('production.getQueue', async () =>
	(await getProduction()).getQueue(),
)
registry.register('production.moveQueueWork', async ({ workId, direction }) =>
	(await getProduction()).moveQueueWork(workId, direction),
)
registry.register('production.stop', async ({ workId }) =>
	(await productionSession(workId)).queue.stop(workId),
)
registry.register(
	'production.prioritizeChapter',
	async ({ workId, chapterId }) => {
		const session = await productionSession(workId)
		session.queue.prioritizeChapter(workId, chapterId)
		return session.snapshot()
	},
)
registry.register('production.retryChapter', async ({ workId, chapterId }) =>
	(await productionSession(workId)).retry(chapterId),
)
registry.register('model.suggestContextWindow', async (model) => {
	const { suggestContextWindow } = await import('./models/text')
	return suggestContextWindow(model)
})
registry.register('model.testText', async ({ slot }, signal) => {
	const { testTextConnection, textConnectionImage, TextModelError } =
		await import('./models/text')
	const model = await config.resolveTextModel(slot)
	const replay = strictReplayOptions()
	try {
		await testTextConnection(model, {
			signal,
			image: slot === 'visual' ? textConnectionImage : undefined,
			fetch: createReplayFetch(replay),
		})
		return { ok: true } as const
	} catch (error) {
		if (error instanceof TextModelError)
			throw { code: error.code, message: error.message }
		throw error
	}
})
registry.register('model.testImage', async (_payload, signal) => {
	const { testImage } = await import('./models/image')
	return testImage(await config.resolveImageModel(), {
		cacheDir,
		signal,
		replay: strictReplayOptions(),
	})
})

async function importSource(
	payload: CommandInput<'import.file'>,
	txtOnly: boolean,
) {
	const { importFileProject, importTxtProject } = await import(
		'./import/wizard'
	)
	const staged: string[] = []
	async function register(workIds: string[], projectDir: string) {
		const service = await getProduction()
		for (const workId of workIds) {
			staged.push(workId)
			await service.remember(workId, projectDir)
		}
	}
	try {
		return await (txtOnly ? importTxtProject : importFileProject)(
			payload,
			register,
		)
	} catch (error) {
		await Promise.allSettled(
			staged.map((id) => rm(join(dataDir, 'projects', id), { force: true })),
		)
		throw error
	}
}
registry.register('import.file', (payload) => importSource(payload, false))
registry.register('import.txt', (payload) => importSource(payload, true))
registry.register('import.target', async ({ projectDir }) => {
	const { readImportTarget } = await import('./import/wizard/join')
	return readImportTarget(projectDir)
})
registry.register(
	'import.revise',
	async ({ projectDir, layout, selectedIllustrations }) => {
		const { reviseTxtProject } = await import('./project-pipeline')
		const result = await reviseTxtProject(
			projectDir,
			layout,
			selectedIllustrations,
		)
		const service = await getProduction()
		for (const workId of result.workIds)
			await service.remember(workId, result.projectDir)
		return result
	},
)

registry.register('events.list', async ({ scope, scopeId, afterSeq }) => {
	const service = scope === 'work' && production ? await production : undefined
	return {
		...events.list(
			scopeId,
			afterSeq,
			scope,
			service?.records(scopeId) ?? [],
			service?.hasRecords(scopeId) ?? false,
		),
		snapshot: scope === 'app' ? { ready: true, generation } : null,
	}
})

if (process.env.NL_E2E === '1') {
	registry.register('debug.sqliteSmoke', async () => {
		const { DatabaseSync } = await import('node:sqlite')
		const directory = await mkdtemp(join(tmpdir(), 'novelive-sqlite-'))
		try {
			using db = new DatabaseSync(join(directory, 'smoke.sqlite'))
			const journalMode = db
				.prepare('PRAGMA journal_mode = WAL')
				.get()?.journal_mode
			assert.equal(journalMode, 'wal')
			db.exec('CREATE TABLE smoke (value INTEGER NOT NULL)')
			db.prepare('INSERT INTO smoke (value) VALUES (?)').run(1)
			const value = db.prepare('SELECT value FROM smoke').get()?.value
			assert.equal(value, 1)
			return { ok: true, journalMode, value } as const
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	})
	registry.register('debug.sharpSmoke', async () => {
		const { default: sharp } = await import('sharp')
		const png = await sharp({
			create: { width: 2, height: 2, channels: 3, background: '#ffffff' },
		})
			.png()
			.toBuffer()
		const decoded = await sharp(png).raw().toBuffer()
		return {
			ok: decoded.length === 12 && decoded.every((byte) => byte === 255),
		}
	})
}

parent.once('message', ({ ports }) => {
	const [port] = ports
	sendEvent = (frame) => port.postMessage(frame)
	const pending = new Map<number, AbortController>()
	const requests = new Set<Promise<void>>()
	let draining: Promise<void> | undefined

	async function handle(data: unknown) {
		if (!clientFrame.check(data)) {
			console.error('Invalid creator command frame')
			return
		}
		if (data.generation !== generation) return
		const { requestId } = data
		if (data.type === 'cancel') {
			pending.get(requestId)?.abort()
			pending.delete(requestId)
			return
		}
		if (pending.has(requestId)) return
		const controller = new AbortController()
		pending.set(requestId, controller)
		let response: CreatorFrame
		try {
			const result = await registry.run(
				data.command,
				data.payload,
				controller.signal,
			)
			response = { type: 'result', generation, requestId, result }
		} catch (error) {
			const failure = creatorCommandError(error)
			if (
				data.command === 'production.get' &&
				failure.code === 'internal' &&
				error instanceof Error
			)
				console.error('production.get failed', {
					name: error.name,
					code: 'code' in error ? error.code : undefined,
					stack: error.stack
						?.split('\n')
						.filter((line) => line.startsWith('    at ')),
				})
			response = {
				type: 'error',
				generation,
				requestId,
				error: failure,
			}
		}
		if (!controller.signal.aborted) {
			pending.delete(requestId)
			port.postMessage(response)
		}
	}

	port.on('message', ({ data }) => {
		if (draining) return
		const request = handle(data).finally(() => requests.delete(request))
		requests.add(request)
	})
	function drain() {
		draining ??= shutdown()
		return draining
	}
	async function shutdown() {
		sendEvent = undefined
		closing = true
		for (const controller of pending.values()) controller.abort()
		pending.clear()
		await Promise.allSettled([
			...requests,
			production?.then((session) => session.close()),
			...[...chats.values()].map(async (opening) => {
				const { chat, project } = await opening
				await chat.close()
				project.close()
			}),
		])
		await Promise.allSettled(
			[...editorWorks.values()].map(async (session) => {
				const { project } = await session
				const { withProjectEdits } = await import('./editor/history')
				await withProjectEdits(project, async () => project.close())
			}),
		)
		editorWorks.clear()
	}
	port.once('close', () => void drain())
	parent.once('message', ({ data }) => {
		if (data?.type !== 'shutdown' || data.generation !== generation) return
		void drain().then(() => process.exit(0))
	})
	port.start()
	parent.postMessage({ type: 'ready', generation })
})
