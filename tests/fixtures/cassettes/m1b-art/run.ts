import assert from 'node:assert/strict'
import { join } from 'node:path'
import { Project } from '../../../../packages/creator/src/project'
import { directory, projectSeed, runArt, runFailures, service } from './fixture'

const root = process.argv[2]
if (!root || process.env.NL_REPLAY !== 'strict')
	throw new Error(
		'Supply a new project parent directory and set NL_REPLAY=strict',
	)
const replay = { directory, mode: 'strict' } as const
{
	using project = await Project.create(join(root, 'chapter'), {
		...projectSeed,
		volumeIds: ['v1'],
	})
	const result = await runArt(project, replay)
	assert.deepEqual(
		result.results.map(({ status }) => status),
		Array(6).fill('drawn'),
	)
	console.log(
		'Stage, confirm and draw: 3 main visuals, 3 costume candidates, 6 drawn assets',
	)
}
{
	using project = await Project.open(join(root, 'chapter'))
	const registry = await service(project, replay).registry()
	assert.equal(registry.entries.length, 6)
	assert.ok(registry.entries.every(({ status }) => status === 'drawn'))
	console.log('Reopen SQLite project: 6 persisted drawn assets')
}
{
	using project = await Project.create(join(root, 'failures'), {
		...projectSeed,
		volumeIds: ['v1'],
	})
	const { results } = await runFailures(project, replay)
	assert.deepEqual(
		results.map(({ status }) => status),
		['placeholder', 'placeholder', 'placeholder', 'unsupported', 'placeholder'],
	)
	console.log(
		'Failure mapping: 4 placeholders, 1 unsupported (not substituted)',
	)
}
