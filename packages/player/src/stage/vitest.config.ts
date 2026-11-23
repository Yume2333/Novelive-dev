import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: { include: ['packages/player/src/stage/*.test.ts'] },
})
