import { type CreatorFrame, clientFrame, commandError } from './contract'
import { createRegistry } from './registry'

const parent = process.parentPort
const generation = Number(process.env.NL_CREATOR_GENERATION)
const registry = createRegistry()

registry.register('events.list', ({ scope }) => ({
	events: [],
	gap: false,
	snapshot: scope === 'app' ? { ready: true, generation } : null,
}))

if (process.env.NL_E2E === '1') {
	registry.register('debug.sqliteSmoke', async () => {
		const { DatabaseSync } = await import('node:sqlite')
		using db = new DatabaseSync(':memory:')
		return { ok: db.prepare('SELECT 1 AS value').get()?.value === 1 }
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
				error: commandError.check(error)
					? error
					: { code: 'internal', message: '创作端命令失败' },
			}
		}
		if (!controller.signal.aborted) {
			pending.delete(requestId)
			port.postMessage(response)
		}
	})
	port.once('close', () => {
		for (const controller of pending.values()) controller.abort()
		pending.clear()
	})
	port.start()
	parent.postMessage({ type: 'ready', generation })
})
