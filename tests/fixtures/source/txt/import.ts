import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { importTxt } from '../../../../packages/creator/src/import/txt'
import { Project } from '../../../../packages/creator/src/project'
import { projectFiles } from '../../../../packages/format/src/model'

const [action, directory] = process.argv.slice(2)
if (!directory || (action !== 'create' && action !== 'reopen')) {
	throw new Error('Usage: import <create|reopen> <project-directory>')
}
const bytes = await readFile(new URL('./multivolume.txt', import.meta.url))
if (action === 'create') {
	using project = await Project.create(directory, {
		formatVersion: 1,
		seriesId: 'synthetic-txt',
		title: '风',
		volumeIds: [],
	})
	const report = await importTxt(project, bytes, { title: '风' })
	assert.equal(report.encoding, 'utf-8')
	console.log(
		'Imported synthetic TXT: 3 volumes, 6 chapters; original, body, notes, chapter metadata and report saved.',
	)
} else {
	using project = await Project.open(directory)
	assert.deepEqual(await project.readFile(projectFiles.original('txt')), bytes)
	const series = await project.read(projectFiles.series)
	assert.equal(series.volumeIds.length, 3)
	let chapters = 0
	for (const volumeId of series.volumeIds) {
		const volume = await project.read(projectFiles.volume(volumeId))
		const workId = volume.workIds[0]
		const work = await project.read(projectFiles.work(volumeId, workId))
		for (const chapterId of work.chapterIds) {
			const chapter = await project.read(
				projectFiles.chapter({ volumeId, workId, chapterId }),
			)
			const text = (
				await project.readFile(projectFiles.chapterText(chapterId))
			).toString()
			assert.equal(
				chapter.paragraphIds.length,
				text.trim().split('\n\n').length,
			)
			assert.doesNotMatch(text, /版权页|www\.|脚注|请收藏/)
			await project.readFile(projectFiles.chapterNotes(chapterId))
			chapters++
		}
	}
	assert.equal(chapters, 6)
	assert.equal(
		(await project.read(projectFiles.importReport)).volumeSuggestions.length,
		3,
	)
	assert.equal(
		project.database.prepare('PRAGMA integrity_check').get()?.integrity_check,
		'ok',
	)
	console.log(
		'Reopened synthetic TXT project in a new process: 6 chapter bodies and paragraph tables verified; notes/report readable; original bytes unchanged; SQLite integrity_check: ok.',
	)
}
