import assert from 'node:assert/strict'
import { Project } from '../../../packages/creator/src/project'
import { projectFiles } from '../../../packages/format/src/model'
import { original, ref, seed, series, work } from './seed'

const [action, directory] = process.argv.slice(2)
if (!directory || (action !== 'create' && action !== 'reopen')) {
	throw new Error('Usage: reopen <create|reopen> <project-directory>')
}
if (action === 'create') {
	await seed(directory)
	console.log(
		'Created project, saved source and hierarchy, queued preview, closed SQLite.',
	)
} else {
	using project = await Project.open(directory)
	assert.deepEqual(await project.read(projectFiles.series), series)
	assert.deepEqual(
		await project.read(projectFiles.work(ref.volumeId, ref.workId)),
		work,
	)
	assert.deepEqual(
		await project.readFile(projectFiles.original('txt')),
		original,
	)
	assert.deepEqual(
		(await project.read(projectFiles.chapter(ref))).paragraphIds,
		['p0001', 'p0002'],
	)
	assert.equal(project.tasks.list(ref.workId)[0]?.status, 'queued')
	assert.equal(
		project.database.prepare('PRAGMA integrity_check').get()?.integrity_check,
		'ok',
	)
	console.log(
		'Reopened project: series/work identity and original bytes preserved.',
	)
	console.log(
		'Chapter p0001/p0002 and queued preview preserved; SQLite integrity_check: ok.',
	)
}
