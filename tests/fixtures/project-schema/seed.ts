import { Project } from '../../../packages/creator/src/project'
import {
	defaultWorkSettings,
	formatVersion,
	projectFiles,
	type Series,
	type Work,
} from '../../../packages/format/src/model'

export const series: Series = {
	formatVersion,
	seriesId: 'synthetic-series',
	title: '纸上世界',
	volumeIds: ['v1'],
}
export const ref = {
	volumeId: 'v1',
	workId: '1b4833c0-f854-4ca4-aec8-eea2752f030a',
	chapterId: 'ch1',
}
export const scope = { level: 'series' } as const
export const chapterText = '她推开了门。\n\n风吹过空屋。\n'
export const original = Buffer.from(
	`第一章\r\n${chapterText.replaceAll('\n', '\r\n')}`,
)
export const work: Work = {
	formatVersion,
	workId: ref.workId,
	title: series.title,
	chapterIds: [ref.chapterId],
	version: 0,
	minReaderVersion: 1,
	appVersion: '0.1.0',
	language: 'zh-CN',
	settings: defaultWorkSettings(),
}

export async function seed(root: string) {
	using project = await Project.create(root, series)
	await project.write(projectFiles.volume(ref.volumeId), {
		formatVersion,
		volumeId: ref.volumeId,
		title: '第一卷',
		workIds: [ref.workId],
	})
	await project.write(projectFiles.work(ref.volumeId, ref.workId), work)
	await project.write(projectFiles.chapter(ref), {
		formatVersion,
		chapterId: ref.chapterId,
		title: '第一章',
		paragraphIds: ['p0001', 'p0002'],
		sceneIds: [],
		cg: [],
	})
	await project.writeFile(projectFiles.original('txt'), original)
	await project.writeFile(projectFiles.chapterText(ref.chapterId), chapterText)
	await project.writeFile(
		projectFiles.chapterNotes(ref.chapterId),
		'合成附注\n',
	)
	await project.write(projectFiles.character(scope, 'traveler'), {
		formatVersion,
		entries: [
			{ id: 'traveler', name: '旅人', aliases: [], status: 'confirmed' },
			{
				id: 'traveler',
				name: '访客',
				aliases: [],
				status: 'candidate',
				conflict: '姓名冲突',
			},
		],
	})
	await project.write(projectFiles.glossary(scope), {
		formatVersion,
		entries: [
			{
				id: 'door',
				status: 'candidate',
				original: '木门',
				written: '木门',
				category: '物品',
			},
		],
	})
	await project.write(projectFiles.assetRegistry(scope), {
		formatVersion,
		entries: [
			{
				id: 'room/day',
				type: 'location',
				path: 'assets/locations/room/day.webp',
				status: 'pending',
				aliases: [],
			},
		],
	})
	project.tasks.registerWork(work, 1)
	project.tasks.enqueue({
		taskId: 'preview-ch1',
		workId: ref.workId,
		kind: 'preview',
		refId: ref.chapterId,
		createdAt: 2,
	})
}
