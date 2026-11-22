import { compile, type Schema } from '@earendil-works/pi-schema'
import {
	characterFileSchema,
	foreshadowingFileSchema,
	glossarySchema,
	locationFileSchema,
	relationsFileSchema,
	styleFileSchema,
	timelineFileSchema,
} from './bible'
import {
	assetRegistrySchema,
	chapterSchema,
	entityId,
	sceneId,
	seriesSchema,
	volumeSchema,
	workId,
	workSchema,
} from './metadata'
import {
	chapterPreviewSchema,
	importReportSchema,
	volumeDigestSchema,
	volumeSkeletonSchema,
} from './pipeline'

export type ProjectScope =
	| { level: 'series' }
	| { level: 'volume'; volumeId: string }
	| { level: 'work'; volumeId: string; workId: string }
export type ChapterRef = { volumeId: string; workId: string; chapterId: string }
export interface ProjectDocument<T> {
	readonly path: string
	readonly schema: Schema<T>
}

function document<T>(path: string, schema: Schema<T>): ProjectDocument<T> {
	return { path, schema }
}

const validId = compile(entityId).check
const validWorkId = compile(workId).check
const validSceneId = compile(sceneId).check

function id(value: string, check = validId) {
	if (!check(value)) throw new Error(`Invalid project identifier: ${value}`)
	return value
}

const volumeDir = (volumeId: string) => `volumes/${id(volumeId)}`
const workDir = (volumeId: string, workId: string) =>
	`${volumeDir(volumeId)}/works/${id(workId, validWorkId)}`
const chapterDir = (ref: ChapterRef) =>
	`${workDir(ref.volumeId, ref.workId)}/chapters/${id(ref.chapterId)}`
function scoped(scope: ProjectScope, path: string) {
	if (scope.level === 'series') return path
	const dir =
		scope.level === 'volume'
			? volumeDir(scope.volumeId)
			: workDir(scope.volumeId, scope.workId)
	return `${dir}/${path}`
}

export const projectFiles = {
	database: 'project.db',
	series: document('series.json', seriesSchema),
	volume: (volumeId: string) =>
		document(`${volumeDir(volumeId)}/volume.json`, volumeSchema),
	work: (volumeId: string, workId: string) =>
		document(`${workDir(volumeId, workId)}/work.json`, workSchema),
	chapter: (ref: ChapterRef) =>
		document(`${chapterDir(ref)}/chapter.json`, chapterSchema),
	scene: (ref: ChapterRef, scene: string) =>
		`${chapterDir(ref)}/${id(scene, validSceneId)}.nvs`,
	original: (extension: 'txt' | 'epub' | 'md' | 'docx' | 'pdf') =>
		`source/original.${id(extension)}`,
	chapterText: (chapterId: string) => `source/chapters/${id(chapterId)}.txt`,
	chapterNotes: (chapterId: string) =>
		`source/chapters/${id(chapterId)}.notes.txt`,
	importReport: document('source/import-report.json', importReportSchema),
	preview: (chapterId: string) =>
		document(`source/preview/${id(chapterId)}.json`, chapterPreviewSchema),
	digest: (volumeId: string) =>
		document(`${volumeDir(volumeId)}/bible/digest.json`, volumeDigestSchema),
	skeleton: (volumeId: string) =>
		document(
			`${volumeDir(volumeId)}/bible/skeleton.json`,
			volumeSkeletonSchema,
		),
	character: (scope: ProjectScope, characterId: string) =>
		document(
			scoped(scope, `bible/characters/${id(characterId)}.json`),
			characterFileSchema,
		),
	location: (scope: ProjectScope, locationId: string) =>
		document(
			scoped(scope, `bible/locations/${id(locationId)}.json`),
			locationFileSchema,
		),
	relations: (scope: ProjectScope) =>
		document(scoped(scope, 'bible/relations.json'), relationsFileSchema),
	timeline: (scope: ProjectScope) =>
		document(scoped(scope, 'bible/timeline.json'), timelineFileSchema),
	foreshadowing: (scope: ProjectScope) =>
		document(
			scoped(scope, 'bible/foreshadowing.json'),
			foreshadowingFileSchema,
		),
	style: (scope: ProjectScope) =>
		document(scoped(scope, 'bible/style.json'), styleFileSchema),
	glossary: (scope: ProjectScope) =>
		document(scoped(scope, 'glossary.json'), glossarySchema),
	assetRegistry: (scope: ProjectScope) =>
		document(scoped(scope, 'assets/asset-registry.json'), assetRegistrySchema),
	styles: (scope: ProjectScope) => scoped(scope, 'styles.css'),
} as const
