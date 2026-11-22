import { parentPort, workerData } from 'node:worker_threads'
import { tsImport } from 'tsx/esm/api'

if (!parentPort) throw new Error('Creator must run in a worker')

const parent = parentPort
Object.defineProperty(process, 'parentPort', {
	value: {
		once: (
			_event: 'message',
			callback: (message: { ports: unknown[] }) => void,
		) => {
			parent.once('message', (port) =>
				callback({
					ports: [
						{
							on: (
								_event: 'message',
								listener: (message: { data: unknown }) => void,
							) => port.on('message', (data: unknown) => listener({ data })),
							once: (event: 'close', listener: () => void) =>
								port.once(event, listener),
							start: () => port.start(),
							postMessage: (frame: unknown) => port.postMessage(frame),
						},
					],
				}),
			)
		},
		postMessage: (message: unknown) => parent.postMessage(message),
	},
})
process.env.NL_CREATOR_GENERATION = String(workerData)
await tsImport('../../../packages/creator/src/entry.ts', import.meta.url)
