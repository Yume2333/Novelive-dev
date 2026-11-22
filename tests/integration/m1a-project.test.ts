import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import {
	importFixture,
	runGate,
	strictFetch,
} from '../fixtures/cassettes/m1a-offline/gate'

test('imports, prepares and reopens a multivolume TXT project on disk', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'novelive-m1a-offline-'))
	try {
		const root = join(directory, 'project')
		await importFixture(root)
		expect(await runGate(root, strictFetch())).toBe(7)
		expect(await runGate(root, strictFetch())).toBe(0)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})
