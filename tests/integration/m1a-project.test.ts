import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import {
	importFixture,
	runGate,
	strictFetch,
} from '../fixtures/cassettes/m1a-offline/gate'

test.each([
	{ scenario: 'with chapters in each volume', emptyVolume: false },
	{ scenario: 'with an empty middle volume', emptyVolume: true },
])(
	'imports, prepares and reopens a multivolume TXT project $scenario',
	async ({ emptyVolume }) => {
		const directory = await mkdtemp(join(tmpdir(), 'novelive-m1a-offline-'))
		try {
			const root = join(directory, 'project')
			await importFixture(root, emptyVolume)
			expect(await runGate(root, strictFetch(), emptyVolume)).toBe(7)
			expect(await runGate(root, strictFetch(), emptyVolume)).toBe(0)
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	},
)
