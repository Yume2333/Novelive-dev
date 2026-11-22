import type { TextConnection } from '../../../../packages/creator/src/models/text'
import { Project } from '../../../../packages/creator/src/project'
import {
	type ChapterPreview,
	defaultWorkSettings,
	formatVersion,
	projectFiles,
} from '../../../../packages/format/src/model'

export const connection: TextConnection = {
	format: 'openai-completions',
	model: 'fixture-synthesis',
	contextWindow: 16384,
	baseUrl: 'https://relay.invalid/v1',
	compat: 'auto',
	apiKey: 'offline-placeholder',
}
export const scope = { level: 'series' } as const
export const candidateTower = {
	id: 'tower',
	name: 'Paper Tower',
	description: 'A tower on the shore.',
	status: 'candidate',
} as const
export const chapters = ['c1', 'c2']
export const confirmed = {
	id: 'ada',
	name: 'Ada',
	aliases: [],
	status: 'confirmed',
	identity: 'Cartographer',
	firstSeenChapter: 'c1',
} as const
export const term = {
	id: 'tower',
	original: 'Paper Tower',
	written: 'Paper Tower',
	category: 'place',
	status: 'confirmed',
	firstSeenChapter: 'c1',
} as const
export const previews: ChapterPreview[] = chapters.map((chapterId, index) => ({
	formatVersion,
	chapterId,
	summary:
		index === 0
			? 'Ada found a key near Paper Tower.'
			: 'Ada took command and opened the tower.',
	characters: [{ name: 'Ada' }],
	locations: [{ name: 'Paper Tower' }],
	timelineNotes: [],
	foreshadowingHints: [],
}))

export const planted = {
	id: 'old-key',
	description: 'The key foreshadows opening the tower.',
	status: 'candidate',
	plantedChapter: 'earlier',
} as const

export async function seed(
	root: string,
	extended = false,
	crossVolume = false,
) {
	using project = await Project.create(root, {
		formatVersion,
		seriesId: 'paper',
		title: 'Paper Sea',
		volumeIds: crossVolume ? ['v0', 'v1'] : ['v1'],
	})
	if (crossVolume) {
		const workId = '00000000-0000-0000-0000-000000000001'
		await project.write(projectFiles.volume('v0'), {
			formatVersion,
			volumeId: 'v0',
			title: 'First volume',
			workIds: [workId],
		})
		await project.write(projectFiles.work('v0', workId), {
			formatVersion,
			workId,
			title: 'First volume',
			chapterIds: ['earlier'],
			version: 0,
			minReaderVersion: 1,
			appVersion: '0.1.0',
			language: 'en',
			settings: defaultWorkSettings(),
		})
		await project.write(projectFiles.foreshadowing(scope), {
			formatVersion,
			entries: [planted],
		})
	}
	await project.write(projectFiles.character(scope, 'ada'), {
		formatVersion,
		entries: [{ ...confirmed, aliases: [] }],
	})
	await project.write(projectFiles.glossary(scope), {
		formatVersion,
		entries: [term],
	})
	for (const preview of previews)
		await project.write(
			projectFiles.preview(preview.chapterId),
			extended ? { ...preview, summary: preview.summary.repeat(230) } : preview,
		)
}

export const progress = [
	{ chapterId: 'c1', progress: 'Ada finds a key.' },
	{ chapterId: 'c2', progress: 'Ada opens the tower.' },
]

export const changes = [
	{ kind: 'character', op: 'update', entry: { ...confirmed, name: 'Ava' } },
	{
		kind: 'location',
		op: 'add',
		entry: {
			id: 'tower',
			name: 'Paper Tower',
			description: 'A tower built over the sea.',
			status: 'confirmed',
			firstSeenChapter: 'c1',
		},
	},
	{
		kind: 'character',
		op: 'update',
		entry: { ...confirmed, identity: 'Captain' },
	},
]

export const glossaryChanges = [
	{ ...term, written: 'Ink Tower' },
	{
		id: 'key',
		original: 'blue key',
		written: 'Blue Key',
		status: 'candidate',
		category: 'object',
		firstSeenChapter: 'c1',
	},
]
