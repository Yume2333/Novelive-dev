import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function writeOwnerBookEvidence(
	fixtures: string,
	evidence: string,
	fixture: string,
	report: {
		normalized: number
		confirmedIntact: boolean
		restartRequests: number
		restartIntact: boolean
	},
) {
	if (
		!report.confirmedIntact ||
		!report.restartIntact ||
		report.restartRequests !== 0
	)
		throw new Error(
			'W4 requires confirmed entries to stay intact and reopening to reproduce the result without requests',
		)
	if (!(report.normalized >= 0.9))
		throw new Error(
			'W4 requires consensus-normalized BiblePatch F1 of at least 0.90',
		)
	await writeFile(join(fixtures, 'chunked-run.json'), fixture)
	await writeFile(join(evidence, 'chunked-run.json'), fixture)
	await writeFile(
		join(evidence, 'w4-consensus.json'),
		`${JSON.stringify(report, null, '\t')}\n`,
	)
}
