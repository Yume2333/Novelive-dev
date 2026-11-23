import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { defaultWorkSettings, projectFiles } from '@novelive/format/model'

export const workA = '00000000-0000-4000-8000-000000000001'
export const workB = '00000000-0000-4000-8000-000000000002'
export const workC = '00000000-0000-4000-8000-000000000003'
export const scope = {
	level: 'work',
	volumeId: 'vol-a',
	workId: workA,
} as const
const chapter = { ...scope, chapterId: 'ch-1' }
export const workPath = projectFiles.work(scope.volumeId, workA).path
export const chapterPath = projectFiles.chapter(chapter).path
export const scenePath = projectFiles.scene(chapter, '12345678')
export const artPath = 'assets/style/插图.webp'

const version = { formatVersion: 1 }
export const series = {
	...version,
	seriesId: 'series',
	title: 'Rain on Glass',
	volumeIds: ['vol-a', 'vol-b'],
}
export const volume = {
	...version,
	volumeId: 'vol-a',
	title: 'Rain',
	workIds: [workA, workB],
}
export const work = {
	...version,
	workId: workA,
	title: 'Window',
	chapterIds: ['ch-1'],
	version: 0,
	minReaderVersion: 1,
	appVersion: '0.1.0',
	language: 'en',
	settings: defaultWorkSettings(),
	futureField: { preserved: true },
}

export function projectEntries() {
	return new Map<string, string>([
		['series.json', JSON.stringify(series)],
		['volumes/vol-a/volume.json', JSON.stringify(volume)],
		[
			'volumes/vol-b/volume.json',
			JSON.stringify({ ...volume, volumeId: 'vol-b', workIds: [workC] }),
		],
		[workPath, JSON.stringify(work)],
		[
			projectFiles.work('vol-a', workB).path,
			JSON.stringify({ ...work, workId: workB, chapterIds: [], version: 4 }),
		],
		[
			projectFiles.work('vol-b', workC).path,
			JSON.stringify({ ...work, workId: workC, chapterIds: [] }),
		],
		[
			chapterPath,
			JSON.stringify({
				...version,
				chapterId: 'ch-1',
				title: 'First chapter',
				sceneIds: ['12345678'],
				paragraphIds: ['p0001'],
				cg: [],
			}),
		],
		[scenePath, '#12345678\n\nRain taps on the glass. #cafe\n'],
		[artPath, 'WebP bytes'],
		['styles.css', '/* series styles */'],
		['volumes/vol-a/styles.css', '/* volume styles */'],
		[projectFiles.styles(scope), '/* work styles */'],
		[
			'glossary.json',
			JSON.stringify({ ...version, entries: [], future: 'keep' }),
		],
		['source/original.txt', 'Original text, opt-in only'],
		['source/production/private.json', '{}'],
		['project.db', 'Private database'],
		['candidates/rejected.webp', 'Private art'],
	])
}

export async function writeProject(root: string) {
	for (const [path, bytes] of projectEntries()) {
		const file = join(root, path)
		await mkdir(dirname(file), { recursive: true })
		await writeFile(file, bytes)
	}
}
