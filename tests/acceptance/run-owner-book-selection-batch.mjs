import { spawnSync } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const source = process.env.NL_OWNER_BOOK_SELECTION_SOURCE
const run = process.env.NL_OWNER_BOOK_RUN_DIR
const stub = process.env.NL_OWNER_BOOK_SELECTION_STUB
if (!source || !run)
	throw new Error(
		'Set the saved extraction source and a new private run directory',
	)

process.umask(0o077)
const directory = resolve(run)
mkdirSync(directory, { mode: 0o700 })
process.exitCode = 1
for (let i = 1; i <= 3; i++) {
	const attempt = join(directory, `attempt-${i}`)
	const log = openSync(`${attempt}.log`, 'wx', 0o600)
	const child = spawnSync(
		'corepack',
		[
			'pnpm',
			'exec',
			'vitest',
			'run',
			'tests/acceptance/m1a-owner-book.test.ts',
		],
		{
			cwd: new URL('../../', import.meta.url),
			env: {
				...process.env,
				NL_REPLAY: 'record',
				NL_OWNER_BOOK_SELECTION_SOURCE: resolve(source),
				NL_OWNER_BOOK_RUN_DIR: attempt,
				NL_OWNER_BOOK_SELECTION_BATCH: '1',
			},
			stdio: ['ignore', log, log],
		},
	)
	closeSync(log)
	if (child.error) throw child.error
	const report = JSON.parse(
		readFileSync(join(attempt, 'selection-result.json'), 'utf8'),
	)
	const {
		status,
		normalized,
		confirmedIntact,
		restartIntact,
		restartRequests,
		stats,
	} = report
	console.log(JSON.stringify({ attempt: i, status, normalized, stats }))
	if (status === 'paused at token cap' && child.status === 0) {
		if (stub) process.exitCode = 0
		break
	}
	if (!confirmedIntact || !restartIntact || restartRequests !== 0)
		throw new Error(
			'Selection batch stopped: preservation or restart check failed',
		)
	if (status === 'passed' && child.status === 0) {
		process.exitCode = 0
		break
	}
	if (status !== 'below W4 threshold' || child.status !== (stub ? 0 : 1))
		throw new Error('Selection batch stopped: unexpected attempt result')
	if (stub && i === 3) process.exitCode = 0
}
