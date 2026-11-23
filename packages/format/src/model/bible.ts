import {
	arr,
	bool,
	obj,
	oneOf,
	opt,
	type Static,
	str,
} from '@earendil-works/pi-schema'
import { entityId, open, version } from './metadata'

const entry = {
	id: entityId,
	status: oneOf(['candidate', 'confirmed']),
	firstSeenChapter: opt(entityId),
	revealedChapter: opt(entityId),
	conflict: opt(str()),
}
const change = obj({ chapterId: entityId, field: str(), value: str() }, open)
const shape = obj({ id: entityId, description: str() }, open)
const reference = obj({ path: str(), description: str() }, open)
const named = { name: str(), originalName: opt(str()) }

const characterFields = {
	...entry,
	...named,
	aliases: arr(str()),
	major: opt(bool()),
	addresses: opt(arr(obj({ speakerId: entityId, name: str() }, open))),
	identity: opt(str()),
	personality: opt(str()),
	speech: opt(str()),
	appearance: opt(
		obj(
			{
				description: str(),
				anchorFeatures: opt(arr(str(), { minItems: 2, maxItems: 3 })),
				keyColors: opt(
					obj({ hair: str(), eyes: str(), clothing: str() }, open),
				),
			},
			open,
		),
	),
	costumes: opt(
		arr(
			obj(
				{ id: entityId, description: str(), fromChapter: opt(entityId) },
				open,
			),
		),
	),
	expressions: opt(arr(shape)),
	references: opt(arr(reference)),
	reuse: opt(oneOf(['reusable', 'one-off'])),
	knows: opt(arr(obj({ chapterId: entityId, fact: str() }, open))),
	changes: opt(arr(change)),
}
export const characterSchema = obj(characterFields, open)
export const characterUpdateSchema = obj(
	{ ...characterFields, aliases: opt(characterFields.aliases) },
	open,
)
export const relationSchema = obj(
	{
		...entry,
		from: entityId,
		to: entityId,
		description: str(),
		changes: opt(arr(change)),
	},
	open,
)
export const locationSchema = obj(
	{
		...entry,
		...named,
		description: str(),
		variants: opt(arr(shape)),
		references: opt(arr(reference)),
		changes: opt(arr(change)),
	},
	open,
)
export const timelineEntrySchema = obj(
	{
		...entry,
		chapterId: entityId,
		event: str(),
		storyTime: opt(str()),
	},
	open,
)
export const foreshadowingEntrySchema = obj(
	{
		...entry,
		description: str(),
		plantedChapter: entityId,
		resolvedChapter: opt(entityId),
	},
	open,
)
export const styleSchema = obj(
	{
		...entry,
		description: str(),
		narration: opt(str()),
		references: opt(arr(reference, { maxItems: 3 })),
	},
	open,
)
export const glossaryEntrySchema = obj(
	{
		...entry,
		original: str(),
		written: str(),
		pronunciation: opt(str()),
		category: str(),
		note: opt(str()),
	},
	open,
)

export const characterFileSchema = obj(
	{ ...version, entries: arr(characterSchema) },
	open,
)
export const locationFileSchema = obj(
	{ ...version, entries: arr(locationSchema) },
	open,
)
export const relationsFileSchema = obj(
	{ ...version, entries: arr(relationSchema) },
	open,
)
export const timelineFileSchema = obj(
	{ ...version, entries: arr(timelineEntrySchema) },
	open,
)
export const foreshadowingFileSchema = obj(
	{ ...version, entries: arr(foreshadowingEntrySchema) },
	open,
)
export const styleFileSchema = obj(
	{
		...version,
		entries: arr(styleSchema),
		visualApprovals: opt(
			arr(obj({ styleId: entityId, volumeId: opt(entityId) })),
		),
	},
	open,
)
export const glossarySchema = obj(
	{ ...version, entries: arr(glossaryEntrySchema) },
	open,
)

export type Character = Static<typeof characterSchema>
export type Relation = Static<typeof relationSchema>
export type Location = Static<typeof locationSchema>
export type TimelineEntry = Static<typeof timelineEntrySchema>
export type ForeshadowingEntry = Static<typeof foreshadowingEntrySchema>
export type Style = Static<typeof styleSchema>
export type Glossary = Static<typeof glossarySchema>
