import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import { connectDevBridge } from '../../tools/dev-bridge/src/client'
import { startDevBridge } from '../../tools/dev-bridge/src/server'
import { viteFileUrl } from '../../tools/dev-bridge/src/vite-url'

test('Vite bootstrap URLs preserve Windows drive paths and encode spaces', () => {
	const path = win32.join('C:\\', 'Novelive dev', 'browser.ts')
	expect(viteFileUrl(pathToFileURL(path, { windows: true }))).toBe(
		'/@fs/C:/Novelive%20dev/browser.ts',
	)
	expect(viteFileUrl(new URL('file:///home/novelive/browser.ts'))).toBe(
		'/@fs/home/novelive/browser.ts',
	)
})

test('browser clients see a creator startup failure before any ready event', async () => {
	const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
	await new Promise<void>((resolve, reject) => {
		server.once('listening', resolve).once('error', reject)
	})
	const address = server.address()
	if (typeof address === 'string' || !address)
		throw new Error('Expected TCP address')
	const client = connectDevBridge({ wsUrl: `ws://127.0.0.1:${address.port}` })
	try {
		const connection = await new Promise<WebSocket>((resolve) =>
			server.once('connection', resolve),
		)
		const state = (creator: 'starting' | 'failed') =>
			connection.send(
				JSON.stringify({
					type: 'state',
					state: {
						creator,
						generation: 1,
						breakerOpen: false,
						logDir: '/logs',
					},
				}),
			)
		state('starting')
		await expect(client.api.host.appState()).resolves.toMatchObject({
			creator: 'starting',
		})
		const down = new Promise((resolve) =>
			client.api.on('creator.down', resolve),
		)
		state('failed')
		await expect(down).resolves.toEqual({ generation: 1 })
		await expect(client.api.host.appState()).resolves.toMatchObject({
			creator: 'failed',
		})
	} finally {
		client.close()
		await new Promise<void>((resolve) => server.close(() => resolve()))
	}
})

test('local browser bridge forwards creator commands and host operations and confines cache resources', async () => {
	const dataDir = await mkdtemp(join(tmpdir(), 'novelive-bridge-'))
	const logged: string[] = []
	try {
		const server = await startDevBridge({
			dataDir,
			wsPort: 0,
			httpPort: 0,
			log: (message) => logged.push(message),
		})
		const url = `ws://127.0.0.1:${server.wsPort}`
		const client = connectDevBridge({
			wsUrl: url,
			httpUrl: `http://127.0.0.1:${server.httpPort}`,
			prompt: () => dataDir,
		})
		try {
			const { api } = client
			const transitions: string[] = []
			const unsub = api.on('creator.down', ({ generation }) =>
				transitions.push(`down:${generation}`),
			)
			await expect
				.poll(async () => (await api.host.appState()).creator, {
					timeout: 10_000,
				})
				.toBe('ready')
			const snapshot = () =>
				api.call('events.list', { scope: 'app', scopeId: 'app', afterSeq: 0 })
					.promise
			expect(await snapshot()).toEqual({
				events: [],
				gap: false,
				snapshot: { ready: true, generation: 1 },
			})
			const request = api.call('events.list', {
				scope: 'app',
				scopeId: 'app',
				afterSeq: 0,
			})
			request.cancel()
			await expect(request.promise).rejects.toMatchObject({ code: 'cancelled' })
			expect(await api.pickFolder()).toBe(dataDir)
			await api.host.openLogDir()
			expect(logged).toEqual([join(dataDir, 'logs')])
			await api.host.restartCreator()
			await expect
				.poll(api.host.appState, { timeout: 10_000 })
				.toMatchObject({ creator: 'ready', generation: 2 })
			expect(transitions).toEqual(['down:1'])
			unsub()
			expect(await snapshot()).toMatchObject({
				snapshot: { ready: true, generation: 2 },
			})

			const image =
				'<svg xmlns="http://www.w3.org/2000/svg" width="5" height="6"/>'
			await writeFile(join(server.cacheDir, '样图.svg'), image)
			await writeFile(join(dataDir, 'outside.svg'), image)
			await symlink(
				join(dataDir, 'outside.svg'),
				join(server.cacheDir, 'linked.svg'),
			)
			const resource = await fetch(api.resourceUrl('样图.svg'))
			expect(resource.headers.get('content-type')).toBe('image/svg+xml')
			expect(await resource.text()).toBe(image)
			expect((await fetch(api.resourceUrl('linked.svg'))).status).toBe(404)
			expect(
				(
					await fetch(
						`http://127.0.0.1:${server.httpPort}/cache/%2e%2e%2foutside.svg`,
					)
				).status,
			).toBe(404)

			const foreign = new WebSocket(url, {
				origin: 'https://unrelated.example',
			})
			const refusal = await new Promise((resolve, reject) => {
				foreign.on('error', reject)
				foreign.on('open', () =>
					reject(new Error('Unexpected WebSocket connection')),
				)
				foreign.on('unexpected-response', (_request, response) => {
					response.resume()
					resolve(response.statusCode)
				})
			})
			expect(refusal).toBe(403)
		} finally {
			client.close()
			await server.close()
		}
	} finally {
		await rm(dataDir, { recursive: true, force: true })
	}
})
