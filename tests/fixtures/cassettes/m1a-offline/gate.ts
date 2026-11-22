import assert from 'node:assert/strict'
import { Project } from '../../../../packages/creator/src/project'
import {
	importTxt,
	prepareVolume,
} from '../../../../packages/creator/src/project-pipeline'
import { createReplayFetch } from '../../../../packages/creator/src/replay'
import { synthesisFiles } from '../../../../packages/creator/src/synthesis'
import { projectFiles } from '../../../../packages/format/src/model'

export const paragraphs = [
	['Ada found a key.', 'The tower was locked.'],
	['Ada opened the tower.', 'Bo was waiting.'],
	['Bo sailed to Ink Island.', 'A bell rang below the sea.'],
]
const original = Buffer.from(
	[
		'第一卷 风起',
		'第一章 钥匙',
		...paragraphs[0],
		'附注：不进入预览',
		'第二章 高塔',
		...paragraphs[1],
		'第二卷 风止',
		'第三章 海岛',
		...paragraphs[2],
		'',
	].join('\r\n'),
)
const series = {
	formatVersion: 1,
	seriesId: 'paper-sea',
	title: 'Paper Sea',
	volumeIds: [],
} as const
const scope = { level: 'series' } as const
const ada = {
	id: 'ada',
	name: 'Ada',
	aliases: [],
	status: 'confirmed' as const,
	firstSeenChapter: 'ch0001',
}
const connection = {
	format: 'openai-completions',
	baseUrl: 'https://relay.invalid/v1',
	apiKey: 'offline-placeholder',
	compat: 'auto',
	contextWindow: 16384,
} as const

export async function importFixture(root: string) {
	using project = await Project.create(root, { ...series, volumeIds: [] })
	await importTxt(project, original, {
		title: series.title,
		language: 'en',
		encoding: 'utf-8',
	})
	await project.write(projectFiles.character(scope, ada.id), {
		formatVersion: 1,
		entries: [ada],
	})
}

export async function runGate(root: string, replay: typeof globalThis.fetch) {
	using project = await Project.open(root)
	let requests = 0
	const fetch: typeof globalThis.fetch = (...args) => {
		requests++
		return replay(...args)
	}
	const { volumeIds, ...identity } = await project.read(projectFiles.series)
	const { volumeIds: _, ...expected } = series
	assert.deepEqual(identity, expected)
	assert.deepEqual(volumeIds, ['v0001', 'v0002'])
	assert.deepEqual(
		await project.readFile(projectFiles.original('txt')),
		original,
	)
	const report = await project.read(projectFiles.importReport)
	assert.ok(report.check)
	assert.equal(report.check.title, series.title)
	assert.equal(report.check.language, 'en')
	assert.deepEqual(
		report.volumeSuggestions.map(({ firstChapterId, lastChapterId }) => [
			firstChapterId,
			lastChapterId,
		]),
		[
			['ch0001', 'ch0002'],
			['ch0003', 'ch0003'],
		],
	)
	const notes = await project.readFile(projectFiles.chapterNotes('ch0001'))
	assert.equal(notes.toString(), '附注：不进入预览\n')
	const chapterIds = [['ch0001', 'ch0002'], ['ch0003']]
	let chapterIndex = 0
	for (const [i, volumeId] of volumeIds.entries()) {
		const volume = await project.read(projectFiles.volume(volumeId))
		assert.equal(volume.workIds.length, 1)
		const [workId] = volume.workIds
		const work = await project.read(projectFiles.work(volumeId, workId))
		assert.deepEqual(work.chapterIds, chapterIds[i])
		for (const chapterId of work.chapterIds) {
			const chapter = await project.read(
				projectFiles.chapter({ volumeId, workId, chapterId }),
			)
			assert.deepEqual(chapter.paragraphIds, ['p0001', 'p0002'])
			const body = await project.readFile(projectFiles.chapterText(chapterId))
			assert.equal(
				body.toString(),
				`${paragraphs[chapterIndex++].join('\n\n')}\n`,
			)
		}
		const result = await prepareVolume(project, volumeId, {
			language: work.language,
			previewConnection: { ...connection, model: 'offline-preview' },
			synthesisConnection: { ...connection, model: 'offline-synthesis' },
			fetch,
		})
		assert.deepEqual(
			result.previews.map((preview) => preview.chapterId),
			chapterIds[i],
		)
		for (const preview of result.previews) {
			assert.deepEqual(
				await project.read(projectFiles.preview(preview.chapterId)),
				preview,
			)
		}
		assert.deepEqual(
			await project.read(projectFiles.digest(volumeId)),
			result.digests[0],
		)
		assert.equal(
			result.digests[0].summary,
			`Digest for ${chapterIds[i].join(', ')}`,
		)
		const skeleton = await project.read(projectFiles.skeleton(volumeId))
		assert.deepEqual(
			skeleton.chapters.map((chapter) => chapter.chapterId),
			chapterIds[i],
		)
		assert.equal(skeleton.overview, result.synthesis.overview)
		assert.deepEqual(
			result.synthesis.conflicts.map((item) => item.entry.id),
			i === 0 ? ['ada'] : [],
		)
		assert.deepEqual(
			await project.read(synthesisFiles(volumeId).result),
			result.synthesis,
		)
	}
	const confirmed = await project.read(projectFiles.character(scope, 'ada'))
	assert.deepEqual(confirmed.entries, [ada])
	const bo = await project.read(projectFiles.character(scope, 'bo'))
	assert.equal(bo.entries[0].status, 'candidate')
	const glossary = await project.read(projectFiles.glossary(scope))
	assert.deepEqual(
		glossary.entries.map(({ id, status }) => [id, status]),
		[
			['key', 'candidate'],
			['bell', 'candidate'],
		],
	)
	return requests
}

export const strictFetch = () =>
	createReplayFetch({
		mode: 'strict',
		directory: import.meta.dirname,
		fetch: async () => {
			throw new Error('Network forbidden')
		},
	})
