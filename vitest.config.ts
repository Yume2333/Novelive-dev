import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		testTimeout: 30_000,
		include: [
			'tests/unit/**/*.test.ts',
			'tests/integration/**/*.test.ts',
			'packages/player/src/stage/*.test.ts',
			...(process.env.NL_REPLAY === 'record' ||
			process.env.NL_STYLE_REPLAY === '1' ||
			process.env.NL_OWNER_BOOK_SELECTION_STUB
				? ['tests/acceptance/**/*.test.ts']
				: []),
		],
	},
})
