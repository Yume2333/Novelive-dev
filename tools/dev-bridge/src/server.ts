import { mkdir } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { MessageChannel, Worker } from 'node:worker_threads'
import {
	type CreatorFrame,
	creatorFrame,
	type HostState,
} from '@novelive/creator/contract'
import { WebSocket, WebSocketServer } from 'ws'
import {
	decodeClientFrame,
	encodeCreatorFrame,
	type HostFrame,
	type HostMessage,
} from './frames'
import { serveResource } from './resources'

interface Options {
	wsPort?: number
	httpPort?: number
	origin?: string
	dataDir?: string
	log?: (message: string) => void
}

const listen = (server: Server, port: number) =>
	new Promise<number>((resolve, reject) => {
		server.once('error', reject)
		server.listen(port, '127.0.0.1', () => {
			server.removeListener('error', reject)
			const address = server.address()
			if (address && typeof address === 'object') resolve(address.port)
		})
	})

const close = (server: Server) =>
	new Promise<void>((resolve) => server.close(() => resolve()))

function hostFrame(value: unknown): value is HostFrame {
	return (
		typeof value === 'object' &&
		value !== null &&
		'type' in value &&
		value.type === 'host' &&
		'op' in value &&
		(value.op === 'openLogDir' || value.op === 'restartCreator') &&
		'requestId' in value &&
		Number.isSafeInteger(value.requestId)
	)
}

function localHost(host: string | undefined, port: number) {
	return host === `localhost:${port}` || host === `127.0.0.1:${port}`
}

export async function startDevBridge(options: Options = {}) {
	const data = options.dataDir ?? join(homedir(), '.novelive-dev')
	const logDir = join(data, 'logs')
	const cacheDir = join(data, 'cache')
	const log = options.log ?? console.log
	await Promise.all([
		mkdir(logDir, { recursive: true }),
		mkdir(cacheDir, { recursive: true }),
	])
	const origin = options.origin ?? 'http://localhost:5173'
	const ws = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 })
	const wsHttp = createServer((_request, response) =>
		response.writeHead(404).end(),
	)
	const resourceHttp = createServer((request, response) => {
		if (!localHost(request.headers.host, httpPort)) {
			response.writeHead(403).end()
			return
		}
		void serveResource(cacheDir, request, response)
	})
	let wsPort: number
	let httpPort: number
	try {
		wsPort = await listen(wsHttp, options.wsPort ?? 8765)
		httpPort = await listen(resourceHttp, options.httpPort ?? 8766)
	} catch (error) {
		await Promise.all([close(wsHttp), close(resourceHttp)])
		throw error
	}
	wsHttp.on('upgrade', (request, socket, head) => {
		if (
			!localHost(request.headers.host, wsPort) ||
			(request.headers.origin !== undefined &&
				request.headers.origin !== origin)
		) {
			socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
			return
		}
		ws.handleUpgrade(request, socket, head, (connection) =>
			ws.emit('connection', connection),
		)
	})

	let worker: Worker | undefined
	let generation = 0
	let status: HostState['creator'] = 'down'
	const routes = new Map<
		number,
		{
			connection: WebSocket
			id: number
			pending: Map<number, number>
		}
	>()
	let port: MessageChannel['port1'] | undefined
	let nextId = 0
	const state = (): HostMessage => ({
		type: 'state',
		state: { creator: status, generation, breakerOpen: false, logDir },
	})
	function send(connection: WebSocket, message: string) {
		if (connection.readyState === WebSocket.OPEN) connection.send(message)
	}
	function publish(message: string) {
		for (const connection of ws.clients) send(connection, message)
	}
	function stop() {
		const old = worker
		worker = undefined
		port?.close()
		port = undefined
		for (const route of routes.values()) route.pending.delete(route.id)
		routes.clear()
		return old?.terminate()
	}
	function start() {
		void stop()
		const current = ++generation
		status = 'starting'
		publish(JSON.stringify(state()))
		const next = new Worker(new URL('./worker.ts', import.meta.url), {
			workerData: current,
			env: { ...process.env, NL_CREATOR_DATA_DIR: data },
		})
		worker = next
		const channel = new MessageChannel()
		port = channel.port1
		channel.port1.on('message', (frame: unknown) => {
			if (
				worker !== next ||
				!creatorFrame.check(frame) ||
				frame.generation !== current
			)
				return
			if (frame.type === 'event') {
				publish(encodeCreatorFrame(frame))
				return
			}
			const route = routes.get(frame.requestId)
			if (!route) return
			routes.delete(frame.requestId)
			route.pending.delete(route.id)
			send(
				route.connection,
				encodeCreatorFrame({ ...frame, requestId: route.id }),
			)
		})
		next.on('message', (frame) => {
			if (
				worker !== next ||
				frame?.type !== 'ready' ||
				frame.generation !== current
			)
				return
			status = 'ready'
			publish(JSON.stringify(state()))
		})
		next.on('error', (error) => log(`Creator worker failed: ${error.message}`))
		next.once('exit', () => {
			if (worker !== next) return
			void stop()
			status = status === 'starting' ? 'failed' : 'down'
			publish(JSON.stringify(state()))
		})
		next.postMessage(channel.port2, [channel.port2])
	}

	ws.on('connection', (connection) => {
		connection.on('error', () => connection.terminate())
		send(connection, JSON.stringify(state()))
		const pending = new Map<number, number>()
		function cancel(id: number) {
			const internal = pending.get(id)
			pending.delete(id)
			if (internal === undefined || !routes.delete(internal)) return
			port?.postMessage({ type: 'cancel', generation, requestId: internal })
		}
		connection.on('close', () => {
			for (const id of pending.keys()) cancel(id)
		})
		connection.on('message', (raw, binary) => {
			if (binary) return
			const json = raw.toString()
			const frame = decodeClientFrame(json)
			if (frame) {
				if (frame.generation !== generation) return
				if (frame.type === 'cancel') {
					cancel(frame.requestId)
					return
				}
				if (!port || status !== 'ready') {
					const error: CreatorFrame = {
						type: 'error',
						generation,
						requestId: frame.requestId,
						error: { code: 'creator_down', message: '创作端未连接' },
					}
					send(connection, encodeCreatorFrame(error))
					return
				}
				const prior = pending.get(frame.requestId)
				if (prior !== undefined && routes.has(prior)) return
				const requestId = ++nextId
				pending.set(frame.requestId, requestId)
				routes.set(requestId, { connection, id: frame.requestId, pending })
				port.postMessage({ ...frame, requestId })
				return
			}
			let input: unknown
			try {
				input = JSON.parse(json)
			} catch {
				return
			}
			if (!hostFrame(input)) return
			if (input.op === 'openLogDir') log(logDir)
			else start()
			send(
				connection,
				JSON.stringify({
					type: 'hostResult',
					requestId: input.requestId,
				} satisfies HostMessage),
			)
		})
	})
	start()

	return {
		wsPort,
		httpPort,
		cacheDir,
		async close() {
			for (const connection of ws.clients) connection.terminate()
			ws.close()
			await Promise.all([close(wsHttp), close(resourceHttp), stop()])
		},
	}
}
