import {
	type ClientFrame,
	type CommandError,
	creatorFrame,
	type HostState,
	type Novelive,
	type NoveliveEvents,
} from '@novelive/creator/contract'
import type { HostFrame, HostMessage } from './frames'

const disconnected = {
	code: 'creator_down',
	message: '创作端未连接',
} satisfies CommandError

export function connectDevBridge({
	wsUrl = 'ws://localhost:8765',
	httpUrl = 'http://localhost:8766',
	prompt = () => window.prompt('请输入文件夹的绝对路径'),
} = {}) {
	const socket = new WebSocket(wsUrl)
	const bus = new EventTarget()
	let id = 0
	let state: HostState = {
		creator: 'starting',
		generation: 0,
		breakerOpen: false,
		logDir: '',
	}
	const initial = Promise.withResolvers<void>()
	const pending = new Map<
		number,
		{ resolve(value: unknown): void; reject(error: CommandError): void }
	>()
	const hostPending = new Map<
		number,
		{ resolve(): void; reject(error: Error): void }
	>()
	function emit<K extends keyof NoveliveEvents>(
		type: K,
		detail: NoveliveEvents[K],
	) {
		bus.dispatchEvent(new CustomEvent(type, { detail }))
	}
	function setState(next: HostState) {
		const previous = state
		state = next
		initial.resolve()
		if (
			previous.creator === 'ready' &&
			(next.creator !== 'ready' || next.generation !== previous.generation)
		) {
			for (const call of pending.values()) call.reject(disconnected)
			pending.clear()
			emit('creator.down', { generation: previous.generation })
		}
		if (
			next.creator === 'ready' &&
			(previous.creator !== 'ready' || previous.generation !== next.generation)
		)
			emit('creator.ready', { generation: next.generation })
	}
	socket.addEventListener('close', () => {
		setState({ ...state, creator: 'down' })
		for (const call of hostPending.values())
			call.reject(new Error(disconnected.message))
		hostPending.clear()
	})
	socket.addEventListener('message', ({ data }) => {
		let frame: unknown
		try {
			frame = JSON.parse(data)
		} catch {
			return
		}
		if (creatorFrame.check(frame)) {
			if (frame.generation !== state.generation || state.creator !== 'ready')
				return
			if (frame.type === 'event') {
				emit('event', frame.envelope)
				return
			}
			const call = pending.get(frame.requestId)
			if (!call) return
			pending.delete(frame.requestId)
			if (frame.type === 'result') call.resolve(frame.result)
			else call.reject(frame.error)
			return
		}
		const host = frame as HostMessage | null
		if (host?.type === 'state') setState(host.state)
		if (host?.type === 'hostResult' || host?.type === 'hostError') {
			const call = hostPending.get(host.requestId)
			hostPending.delete(host.requestId)
			if (!call) return
			if (host.type === 'hostResult') call.resolve()
			else call.reject(new Error(host.message))
		}
	})

	async function hostCall(op: HostFrame['op']) {
		await initial.promise
		if (socket.readyState !== WebSocket.OPEN)
			throw new Error(disconnected.message)
		const requestId = ++id
		const { promise, resolve, reject } = Promise.withResolvers<void>()
		hostPending.set(requestId, { resolve, reject })
		socket.send(
			JSON.stringify({ type: 'host', op, requestId } satisfies HostFrame),
		)
		return promise
	}
	const api: Novelive = {
		call(command, payload) {
			const generation = state.generation
			const requestId = ++id
			const { promise, resolve, reject } = Promise.withResolvers<never>()
			if (state.creator !== 'ready') reject(disconnected)
			else {
				pending.set(requestId, {
					resolve: (value) => resolve(value as never),
					reject,
				})
				socket.send(
					JSON.stringify({
						type: 'call',
						generation,
						requestId,
						command,
						payload,
					} satisfies ClientFrame),
				)
			}
			return {
				promise,
				cancel() {
					if (generation !== state.generation || !pending.delete(requestId))
						return
					socket.send(
						JSON.stringify({
							type: 'cancel',
							generation,
							requestId,
						} satisfies ClientFrame),
					)
					reject({ code: 'cancelled', message: '已取消' })
				},
			}
		},
		on(event, handler) {
			const listener: EventListener = (message) =>
				handler((message as CustomEvent).detail)
			bus.addEventListener(event, listener)
			return () => bus.removeEventListener(event, listener)
		},
		resourceUrl: (path) =>
			`${httpUrl}/cache/${path.split('/').map(encodeURIComponent).join('/')}`,
		async pickFolder() {
			const path = prompt()?.trim()
			return path && /^(?:\/|[a-z]:[\\/]|\\\\)/i.test(path) ? path : null
		},
		host: {
			async appState() {
				await initial.promise
				return state
			},
			openLogDir: () => hostCall('openLogDir'),
			restartCreator: () => hostCall('restartCreator'),
		},
	}
	return { api, close: () => socket.close() }
}
