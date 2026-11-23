import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

const renderer = resolve(import.meta.dirname, '../../packages/ui')

export default defineConfig({
	main: {
		build: {
			externalizeDeps: { exclude: ['@novelive/creator'] },
			rollupOptions: {
				input: {
					index: 'src/main/index.ts',
					creator: '../../packages/creator/src/entry.ts',
				},
				external: ['onnxruntime-node', 'sharp'],
			},
		},
	},
	preload: {
		build: {
			externalizeDeps: { exclude: ['@novelive/creator'] },
			rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } },
		},
	},
	renderer: {
		root: renderer,
		base: './',
		plugins: [react()],
		build: {
			outDir: resolve(import.meta.dirname, 'out/renderer'),
			rollupOptions: { input: resolve(renderer, 'index.html') },
		},
	},
})
