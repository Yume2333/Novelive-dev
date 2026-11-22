import { projectFiles } from '@novelive/format/model'
import type { TextConnection } from '../models/text'
import { type PreviewChapter, previewBook } from '../preview'
import type { Project } from '../project'
import { type SynthesisOptions, synthesizeVolume } from '../synthesis'

export { importTxt, type TxtImportOptions } from '../import/txt'
export { importTxtProject, reviseTxtProject } from '../import/wizard'

export interface PrepareVolumeOptions
	extends Omit<SynthesisOptions, 'connection'> {
	previewConnection: TextConnection
	synthesisConnection: TextConnection
}

export async function prepareVolume(
	project: Project,
	volumeId: string,
	{ previewConnection, synthesisConnection, ...options }: PrepareVolumeOptions,
) {
	const series = await project.read(projectFiles.series)
	const volumeIndex = series.volumeIds.indexOf(volumeId)
	if (volumeIndex === -1) throw new Error(`Unknown project volume: ${volumeId}`)
	const volume = await project.read(projectFiles.volume(volumeId))
	const works = await Promise.all(
		volume.workIds.map((workId) =>
			project.read(projectFiles.work(volumeId, workId)),
		),
	)
	const chapterIds = works.flatMap((work) => work.chapterIds)
	const chapters: PreviewChapter[] = []
	for (const chapterId of chapterIds) {
		options.signal?.throwIfAborted()
		const body = (
			await project.readFile(projectFiles.chapterText(chapterId))
		).toString('utf8')
		chapters.push({
			chapterId,
			volumeId,
			paragraphs: body ? body.replace(/\n$/, '').split('\n\n') : [],
		})
	}
	const preview = await previewBook(project, chapters, {
		connection: previewConnection,
		language: options.language,
		fetch: options.fetch,
		signal: options.signal,
	})
	const synthesis = await synthesizeVolume(project, volumeId, chapterIds, {
		...options,
		connection: synthesisConnection,
		incremental: options.incremental ?? volumeIndex > 0,
	})
	return { ...preview, synthesis }
}
