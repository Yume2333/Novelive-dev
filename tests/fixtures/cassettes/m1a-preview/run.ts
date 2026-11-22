import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { previewBook } from '../../../../packages/creator/src/preview'
import { Project } from '../../../../packages/creator/src/project'
import { createReplayFetch } from '../../../../packages/creator/src/replay'
import { chapters, connection } from './fixture'

const root = resolve(process.argv[2])
const fetch = createReplayFetch({
	mode: 'strict',
	directory: join(import.meta.dirname, '.'),
	fetch: async () => {
		throw new Error('Network forbidden')
	},
})
if (process.argv[3] === 'create') {
	using project = await Project.create(root, {
		formatVersion: 1,
		seriesId: 'synthetic',
		title: 'Paper sea',
		volumeIds: ['v1', 'v2'],
	})
	const result = await previewBook(project, chapters, {
		connection,
		language: 'en',
		fetch,
	})
	assert.equal(result.previews.length, 3)
	assert.equal(result.digests.length, 2)
	console.log(
		'Created disk project: 3 chapter previews, 2 volume digests (strict replay).',
	)
} else {
	using project = await Project.open(root)
	let calls = 0
	await previewBook(project, chapters, {
		connection,
		language: 'en',
		fetch: async (...args) => {
			calls++
			return fetch(...args)
		},
	})
	assert.equal(calls, 0)
	console.log(
		'Reopened disk project in a new process: 0 model calls; all previews and digests reused.',
	)
}
