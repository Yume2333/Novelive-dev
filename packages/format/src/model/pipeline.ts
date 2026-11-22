import {
	arr,
	lit,
	obj,
	oneOf,
	opt,
	type Static,
	str,
	union,
} from '@earendil-works/pi-schema'
import {
	characterSchema,
	foreshadowingEntrySchema,
	glossaryEntrySchema,
	locationSchema,
	relationSchema,
	styleSchema,
	timelineEntrySchema,
} from './bible'
import { entityId, open, paragraphId, version } from './metadata'

const names = obj(
	{
		name: str(),
		description: opt(str()),
		paragraphIds: opt(arr(paragraphId)),
	},
	open,
)
export const chapterPreviewFields = {
	summary: str(),
	characters: arr(names),
	locations: arr(names),
	timelineNotes: arr(str()),
	foreshadowingHints: arr(str()),
}
export const chapterPreviewSchema = obj(
	{
		...version,
		chapterId: entityId,
		...chapterPreviewFields,
	},
	open,
)
export const volumeDigestSchema = obj(
	{
		...version,
		volumeId: entityId,
		summary: str(),
	},
	open,
)
export const volumeSkeletonSchema = obj(
	{
		...version,
		volumeId: entityId,
		overview: str(),
		chapters: arr(obj({ chapterId: entityId, progress: str() }, open)),
	},
	open,
)
export const volumeSuggestionSchema = obj(
	{
		title: str(),
		firstChapterId: entityId,
		lastChapterId: entityId,
	},
	open,
)
export const importCheckResultSchema = obj(
	{
		title: str(),
		language: str(),
		chapterFindings: arr(obj({ chapterId: entityId, note: str() }, open)),
	},
	open,
)
export const importReportSchema = obj(
	{
		...version,
		check: opt(importCheckResultSchema),
		volumeSuggestions: arr(volumeSuggestionSchema),
	},
	open,
)
const operation = oneOf(['add', 'update', 'delete', 'none'])
export const biblePatchSchema = arr(
	union([
		obj(
			{ kind: lit('character'), op: operation, entry: characterSchema },
			open,
		),
		obj({ kind: lit('relation'), op: operation, entry: relationSchema }, open),
		obj({ kind: lit('location'), op: operation, entry: locationSchema }, open),
		obj(
			{ kind: lit('timeline'), op: operation, entry: timelineEntrySchema },
			open,
		),
		obj(
			{
				kind: lit('foreshadowing'),
				op: operation,
				entry: foreshadowingEntrySchema,
			},
			open,
		),
		obj({ kind: lit('style'), op: operation, entry: styleSchema }, open),
	]),
)
export const glossaryPatchSchema = arr(glossaryEntrySchema)

export type ChapterPreview = Static<typeof chapterPreviewSchema>
export type VolumeDigest = Static<typeof volumeDigestSchema>
export type VolumeSkeleton = Static<typeof volumeSkeletonSchema>
export type VolumeSuggestion = Static<typeof volumeSuggestionSchema>
export type ImportCheckResult = Static<typeof importCheckResultSchema>
export type ImportReport = Static<typeof importReportSchema>
export type BiblePatch = Static<typeof biblePatchSchema>
export type GlossaryPatch = Static<typeof glossaryPatchSchema>
