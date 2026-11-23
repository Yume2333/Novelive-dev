import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { writeOwnerBookEvidence } from '../acceptance/owner-book-evidence'

test.each([
	[{ confirmedIntact: false, restartIntact: true, normalized: 0.95 }, false],
	[{ confirmedIntact: true, restartIntact: false, normalized: 0.95 }, false],
	[{ confirmedIntact: true, restartIntact: true, normalized: 0.89 }, false],
	[{ confirmedIntact: true, restartIntact: true, normalized: 0.9 }, true],
] as const)(
	'publishes W4 artifacts only for a passing report %j',
	async (report, passes) => {
		const root = await mkdtemp(join(tmpdir(), 'novelive-w4-evidence-'))
		try {
			const publication = writeOwnerBookEvidence(root, root, '{}\n', report)
			if (passes) {
				await publication
				expect(await readFile(join(root, 'chunked-run.json'), 'utf8')).toBe(
					'{}\n',
				)
				expect(
					JSON.parse(await readFile(join(root, 'w4-consensus.json'), 'utf8')),
				).toEqual(report)
			} else {
				await expect(publication).rejects.toThrow('W4 requires')
				expect(await readdir(root)).toEqual([])
			}
		} finally {
			await rm(root, { recursive: true, force: true })
		}
	},
)
