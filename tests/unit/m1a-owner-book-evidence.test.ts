import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { writeOwnerBookEvidence } from '../acceptance/owner-book-evidence'

test.each([
	[{ confirmedIntact: false, restartIntact: true, normalized: 0.95 }, false],
	[{ confirmedIntact: true, restartIntact: false, normalized: 0.95 }, false],
	[
		{
			confirmedIntact: true,
			restartIntact: true,
			restartRequests: 1,
			normalized: 0.95,
		},
		false,
	],
	[{ confirmedIntact: true, restartIntact: true, normalized: 0.89 }, false],
	[{ confirmedIntact: true, restartIntact: true, normalized: 0.9 }, true],
] as const)(
	'publishes W4 artifacts only for a passing report %j',
	async (report, passes) => {
		const root = await mkdtemp(join(tmpdir(), 'novelive-w4-evidence-'))
		const fixtures = join(root, 'fixtures')
		const evidence = join(root, 'evidence')
		try {
			await Promise.all([mkdir(fixtures), mkdir(evidence)])
			const result = { restartRequests: 0, ...report }
			const publication = writeOwnerBookEvidence(
				fixtures,
				evidence,
				'{}\n',
				result,
			)
			if (passes) {
				await publication
				for (const directory of [fixtures, evidence])
					expect(
						await readFile(join(directory, 'chunked-run.json'), 'utf8'),
					).toBe('{}\n')
				expect(
					JSON.parse(
						await readFile(join(evidence, 'w4-consensus.json'), 'utf8'),
					),
				).toEqual(result)
			} else {
				await expect(publication).rejects.toThrow('W4 requires')
				expect(await readdir(fixtures)).toEqual([])
				expect(await readdir(evidence)).toEqual([])
			}
		} finally {
			await rm(root, { recursive: true, force: true })
		}
	},
)
