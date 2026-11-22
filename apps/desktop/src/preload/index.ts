import {
	type ClientFrame,
	type CommandError,
	creatorFrame,
	type HostState,
	type Novelive,
	type NoveliveEvents,
} from '@novelive/creator/contract'
import { contextBridge, ipcRenderer } from 'electron'

let generation = 0
let nextRequest = 0
let port: MessagePort | undefined
const pending = new Map<
	number,
	{
		resolve(value: unknown): void
		reject(error: CommandError): void
	}
>()
const bus = new EventTarget()

function emit<K extends keyof NoveliveEvents>(
	type: K,
	detail: NoveliveEvents[K],
) {
	bus.dispatchEvent(new CustomEvent(type, { detail }))
}

function disconnect() {
	port?.close()
	port = undefined
	for (const call of pending.values()) {
		call.reject({ code: 'creator_down', message: '创作端未连接' })
	}
	pending.clear()
}

ipcRenderer.on('novelive:port', (event, current: number) => {
	if (current <= generation) {
		event.ports[0].close()
		return
	}
	disconnect()
	generation = current
	const [connection] = event.ports
	port = connection
	connection.addEventListener('close', () => {
		if (connection === port) disconnect()
	})
	connection.onmessage = ({ data }) => {
		if (connection !== port) return
		if (!creatorFrame.check(data)) {
			console.error('Invalid creator response frame')
			return
		}
		if (data.generation !== generation) return
		if (data.type === 'event') {
			emit('event', data.envelope)
			return
		}
		const call = pending.get(data.requestId)
		if (!call) return
		pending.delete(data.requestId)
		if (data.type === 'result') call.resolve(data.result)
		else call.reject(data.error)
	}
})
ipcRenderer.on(
	'novelive:ready',
	(_event, frame: NoveliveEvents['creator.ready']) => {
		if (frame.generation === generation) emit('creator.ready', frame)
	},
)
ipcRenderer.on(
	'novelive:down',
	(_event, frame: NoveliveEvents['creator.down']) => {
		if (frame.generation !== generation) return
		disconnect()
		emit('creator.down', frame)
	},
)

const api: Novelive = {
	call(command, payload) {
		const requestId = ++nextRequest
		const current = generation
		const promise = new Promise<never>((resolve, reject) => {
			if (!port) {
				reject({ code: 'creator_down', message: '创作端未连接' })
				return
			}
			pending.set(requestId, {
				resolve: (value) => resolve(value as never),
				reject,
			})
			port.postMessage({
				type: 'call',
				generation,
				requestId,
				command,
				payload,
			} satisfies ClientFrame)
		})
		return {
			promise,
			cancel() {
				const call = pending.get(requestId)
				if (!call || current !== generation) return
				pending.delete(requestId)
				port?.postMessage({
					type: 'cancel',
					generation,
					requestId,
				} satisfies ClientFrame)
				call.reject({ code: 'cancelled', message: '已取消' })
			},
		}
	},
	on(type, handler) {
		const listener: EventListener = (event) =>
			handler((event as CustomEvent).detail)
		bus.addEventListener(type, listener)
		return () => bus.removeEventListener(type, listener)
	},
	resourceUrl: (path) =>
		`novelive://cache/${path.split('/').map(encodeURIComponent).join('/')}`,
	pickFolder: () => ipcRenderer.invoke('novelive:pick-folder'),
	pickFiles: (kind) => ipcRenderer.invoke('novelive:pick-files', kind),
	host: {
		appState: (): Promise<HostState> => ipcRenderer.invoke('novelive:state'),
		openLogDir: () => ipcRenderer.invoke('novelive:open-log-dir'),
		restartCreator: () => ipcRenderer.invoke('novelive:restart'),
	},
}

contextBridge.exposeInMainWorld('novelive', api)
