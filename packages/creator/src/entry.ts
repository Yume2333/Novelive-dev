import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConfigStore } from './config'
import { type CreatorFrame, clientFrame, creatorCommandError } from './contract'
import { createRegistry } from './registry'
import { createReplayFetch, type ReplayOptions } from './replay'

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
	return import('./project/production').then(({ createProduction }) =>
		createProduction(
			dataDir,
			config,
			strictReplayOptions(),
			(envelope) => sendEvent?.({ type: 'event', generation, envelope }),
			(active) =>
				parent.postMessage({ type: 'production.active', generation, active }),
		),
	)
}

function getProduction() {
	production ??= loadProduction()
	return production
}

async function productionSession(workId: string) {
	return (await getProduction()).get(workId)
}

registry.register('config.get', () => config.get())
registry.register('config.update', (patch) => config.update(patch))
registry.register('config.reset', () => config.reset())
registry.register('production.playerChapter', async ({ directory, workId }) =>
	(await getProduction()).player(workId, directory),
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
registry.register('production.continue', async ({ workId }) => {
	const session = await productionSession(workId)
	session.queue.continue(workId)
	return session.snapshot()
})
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
registry.register('production.retryChapter', async ({ workId, chapterId }) => {
	const session = await productionSession(workId)
	session.queue.retryChapter(workId, chapterId)
	return session.snapshot()
})
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

registry.register('import.txt', async (payload) => {
	const { importTxtProject } = await import('./project-pipeline')
	const result = await importTxtProject(payload)
	if (result.status === 'ready')
		await (await getProduction()).remember(result.workId, result.projectDir)
	return result
})
registry.register('import.revise', async ({ projectDir, layout }) => {
	const { reviseTxtProject } = await import('./project-pipeline')
	const result = await reviseTxtProject(projectDir, layout)
	await (await getProduction()).remember(result.workId, result.projectDir)
	return result
})

registry.register('events.list', async ({ scope, scopeId, afterSeq }) => ({
	events:
		scope === 'work'
			? (await productionSession(scopeId)).records.filter(
					({ seq }) => seq > afterSeq,
				)
			: [],
	gap: false,
	snapshot: scope === 'app' ? { ready: true, generation } : null,
}))

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

	port.on('message', async ({ data }) => {
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
			response = {
				type: 'error',
				generation,
				requestId,
				error: creatorCommandError(error),
			}
		}
		if (!controller.signal.aborted) {
			pending.delete(requestId)
			port.postMessage(response)
		}
	})
	port.once('close', () => {
		sendEvent = undefined
		for (const controller of pending.values()) controller.abort()
		pending.clear()
		void production?.then((session) => session.close())
	})
	port.start()
	parent.postMessage({ type: 'ready', generation })
})
