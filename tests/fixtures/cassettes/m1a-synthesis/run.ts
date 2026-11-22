import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { Project } from '../../../../packages/creator/src/project'
import { createReplayFetch } from '../../../../packages/creator/src/replay'
import { synthesizeVolume } from '../../../../packages/creator/src/synthesis'
import { projectFiles } from '../../../../packages/format/src/model'
import { chapters, confirmed, connection, scope, seed } from './fixture'

const [directory, step] = process.argv.slice(2)
assert.ok(directory)
const root = resolve(directory)
const strict = createReplayFetch({
	mode: 'strict',
	directory: import.meta.dirname,
	fetch: async () => {
		throw new Error('Network forbidden')
	},
})
let requests = 0
const fetch: typeof globalThis.fetch = (...args) => {
	requests++
	return strict(...args)
}
const options = { connection, fetch, language: 'en' }

if (step === 'whole' || step === 'checkpoint') await seed(root)
using project = await Project.open(root)
if (step === 'checkpoint') {
	await assert.rejects(
		synthesizeVolume(project, 'v1', chapters, {
			...options,
			strategy: 'events',
			maxEvents: 1,
		}),
		/event limit/,
	)
	assert.equal(requests, 1)
	console.log(
		'Checkpoint saved to disk after 1 event; no partial skeleton published.',
	)
} else {
	assert.ok(step === 'whole' || step === 'resume' || step === 'reopen')
	const result = await synthesizeVolume(project, 'v1', chapters, {
		...options,
		strategy: step === 'whole' ? 'whole' : 'events',
	})
	assert.equal(requests, step === 'reopen' ? 0 : 1)
	assert.equal(result.conflicts.length, 1)
	assert.equal(result.glossaryConflicts.length, 1)
	assert.deepEqual(
		(await project.read(projectFiles.skeleton('v1'))).chapters,
		result.chapters,
	)
	assert.equal(
		(await project.read(projectFiles.character(scope, 'ada'))).entries[0].name,
		confirmed.name,
	)
	assert.equal(
		(await project.read(projectFiles.glossary(scope))).entries.length,
		2,
	)
	console.log(
		`${step}: ${requests} replay requests; 2-chapter skeleton, candidates and conflicts persisted; confirmed name preserved.`,
	)
}
