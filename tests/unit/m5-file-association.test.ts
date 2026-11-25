import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
	openFileHandlers: [] as Array<
		(event: { preventDefault: () => void }, path: string) => void
	>,
}))

vi.mock('electron', () => ({
	app: {
		on: (
			event: string,
			handler: (event: { preventDefault: () => void }, path: string) => void,
		) => {
			if (event === 'open-file') state.openFileHandlers.push(handler)
		},
	},
}))

import { collectPackageOpens } from '../../apps/desktop/src/main/file-association'

const originalArgv = process.argv

beforeEach(() => {
	state.openFileHandlers = []
	process.argv = ['novelive']
})

afterEach(() => {
	process.argv = originalArgv
})

describe('collectPackageOpens', () => {
	it('collects relative paths, absolute paths, and decoded file:// URIs while ignoring flags and other extensions', () => {
		const notify = vi.fn()
		process.argv = ['novelive', '--no-sandbox', 'initial.novelive']
		const opens = collectPackageOpens(notify)

		expect(opens.hasFiles()).toBe(true)
		expect(opens.take()).toBe(`${process.cwd()}/initial.novelive`)
		expect(opens.take()).toBeNull()
		expect(notify).toHaveBeenCalledTimes(1)

		opens.collect(
			[
				'--remote-debugging-port=19231',
				'/tmp/ignored.txt',
				'file:///tmp/my%20work/%E6%B5%8B%E8%AF%95.novelive',
				'file://not-a-valid-host/bad.novelive',
			],
			'/tmp',
		)

		expect(opens.take()).toBe('/tmp/my work/测试.novelive')
		expect(opens.take()).toBeNull()
		expect(notify).toHaveBeenCalledTimes(2)
	})

	it('handles macOS open-file events and prevents default', () => {
		const notify = vi.fn()
		const opens = collectPackageOpens(notify)
		const preventDefault = vi.fn()
		state.openFileHandlers[0]?.({ preventDefault }, '/tmp/event.novelive')

		expect(preventDefault).toHaveBeenCalledTimes(1)
		expect(opens.take()).toBe('/tmp/event.novelive')
		expect(notify).toHaveBeenCalledTimes(1)
	})
})
