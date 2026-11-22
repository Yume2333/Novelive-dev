import {
	arr,
	bool,
	int,
	lit,
	map,
	obj,
	oneOf,
	opt,
	type Static,
	str,
} from '@earendil-works/pi-schema'

export const formatVersion = 1
export const version = { formatVersion: lit(formatVersion) }
export const open = { open: true } as const
export const idPattern = '^[a-z0-9][a-z0-9_-]*$'
export const entityId = str({ pattern: idPattern })
export const paragraphId = str({ pattern: '^p(?!0000)[0-9]{4}$' })
export const sceneId = str({ pattern: '^[0-9a-f]{8}$' })
export const lineId = str({ pattern: '^[0-9a-f]{4}$' })
export const workId = str({
	pattern: '^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$',
})
const heading = { title: str({ minLength: 1 }) }

export const seriesSchema = obj(
	{
		...version,
		seriesId: entityId,
		...heading,
		volumeIds: arr(entityId, { uniqueItems: true }),
	},
	open,
)
export const volumeSchema = obj(
	{
		...version,
		volumeId: entityId,
		...heading,
		workIds: arr(workId, { uniqueItems: true }),
	},
	open,
)
export const workSettingsSchema = obj(
	{
		adaptation: oneOf(['faithful', 'balanced', 'condensed']),
		stagingDensity: oneOf(['loose', 'standard', 'aggressive']),
		requirements: str(),
		rules: arr(str()),
		chapterRules: map(arr(str())),
		writerPresetId: opt(entityId),
		fidelityReview: bool(),
		styleReview: bool(),
		confirmWithReferences: bool(),
		customMarks: map(obj({ css: str(), perChar: bool() }, open)),
		outputResolution: oneOf(['2K', '4K']),
		accent: opt(str()),
	},
	open,
)
export const workSchema = obj(
	{
		...version,
		workId,
		...heading,
		chapterIds: arr(entityId, { uniqueItems: true }),
		version: int({ minimum: 0 }),
		derivedFrom: opt(obj({ workId, version: int({ minimum: 0 }) }, open)),
		minReaderVersion: int({ minimum: 1 }),
		appVersion: str({ minLength: 1 }),
		language: str({ minLength: 1 }),
		settings: workSettingsSchema,
	},
	open,
)
export const chapterSchema = obj(
	{
		...version,
		chapterId: entityId,
		...heading,
		sceneIds: arr(sceneId, { uniqueItems: true }),
		paragraphIds: arr(paragraphId, { uniqueItems: true }),
		cg: arr(obj({ id: entityId, description: str() }, open)),
	},
	open,
)
export const assetRegistrySchema = obj(
	{
		...version,
		entries: arr(
			obj(
				{
					id: str({
						pattern:
							'^(?:cg-[a-z0-9][a-z0-9_-]*|[a-z0-9][a-z0-9_-]*(?:/[a-z0-9][a-z0-9_-]*){1,2})$',
					}),
					type: oneOf(['character', 'location', 'cg', 'expression', 'variant']),
					path: str({ minLength: 1 }),
					status: oneOf(['drawn', 'pending', 'placeholder']),
					aliases: arr(str()),
				},
				open,
			),
		),
	},
	open,
)

export type Series = Static<typeof seriesSchema>
export type Volume = Static<typeof volumeSchema>
export type Work = Static<typeof workSchema>
export type WorkSettings = Static<typeof workSettingsSchema>
export type Chapter = Static<typeof chapterSchema>
export type AssetRegistry = Static<typeof assetRegistrySchema>

export function defaultWorkSettings(): WorkSettings {
	return {
		adaptation: 'balanced',
		stagingDensity: 'standard',
		requirements: '',
		rules: [],
		chapterRules: {},
		fidelityReview: true,
		styleReview: false,
		confirmWithReferences: true,
		customMarks: {},
		outputResolution: '2K',
	}
}
