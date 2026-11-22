import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { createServer } from 'vite'
import { startDevBridge } from './server'
import { viteFileUrl } from './vite-url'

const root = resolve(import.meta.dirname, '../../..')
const bridge = await startDevBridge()
try {
	const vite = await createServer({
		configFile: false,
		root: resolve(root, 'packages/ui'),
		server: {
			host: 'localhost',
			port: 5173,
			strictPort: true,
			fs: { allow: [root] },
		},
		plugins: [
			react(),
			{
				name: 'novelive-browser-bridge',
				transformIndexHtml: {
					order: 'pre',
					handler: () => [
						{
							tag: 'script',
							attrs: {
								type: 'module',
								src: viteFileUrl(new URL('./browser.ts', import.meta.url)),
							},
							injectTo: 'head-prepend',
						},
					],
				},
			},
		],
	})
	await vite.listen()
	vite.printUrls()
	for (const signal of ['SIGINT', 'SIGTERM'] as const) {
		process.once(signal, async () => {
			await Promise.all([bridge.close(), vite.close()])
		})
	}
} catch (error) {
	await bridge.close()
	throw error
}
