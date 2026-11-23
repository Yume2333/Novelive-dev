import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		include: [
			'tests/unit/**/*.test.ts',
			'tests/integration/**/*.test.ts',
			...(process.env.NL_REPLAY === 'record' ||
			process.env.NL_STYLE_REPLAY === '1'
				? ['tests/acceptance/**/*.test.ts']
				: []),
		],
	},
})
