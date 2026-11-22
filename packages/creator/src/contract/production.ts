import {
	arr,
	int,
	lit,
	nullable,
	obj,
	opt,
	type Static,
	str,
} from '@earendil-works/pi-schema'
import {
	assetId,
	chapterProductionSchema,
	entityId,
	productionStatusSchema,
	workId,
	workPhaseSchema,
} from '@novelive/format/model'

const work = { workId }
const chapter = { ...work, chapterId: entityId }
const candidateSchema = obj({
	id: entityId,
	cachePath: str({ minLength: 1 }),
})
const visualChoices = {
	mainVisualId: entityId,
	characters: arr(
		obj({
			characterId: entityId,
			costumeId: entityId,
			candidateId: entityId,
		}),
	),
	supplementalIds: arr(entityId, { maxItems: 2, uniqueItems: true }),
}

export const productionSnapshotSchema = obj({
	...work,
	phase: workPhaseSchema,
	status: productionStatusSchema,
	chapters: arr(chapterProductionSchema),
	blockedChapterId: opt(entityId),
	visual: nullable(
		obj({
			mainVisuals: arr(candidateSchema, { minItems: 3, maxItems: 3 }),
			characters: arr(
				obj({
					characterId: entityId,
					costumeId: entityId,
					candidates: arr(candidateSchema, { minItems: 1 }),
				}),
			),
			supplemental: arr(candidateSchema),
		}),
	),
})

export const productionCommands = {
	'production.get': { input: obj(work), output: productionSnapshotSchema },
	'production.resolveAsset': {
		input: obj({ ...work, assetId }),
		output: nullable(obj({ cachePath: str({ minLength: 1 }) })),
	},
	'production.confirmVisual': {
		input: obj({ ...work, ...visualChoices }),
		output: productionSnapshotSchema,
	},
	'production.continue': { input: obj(work), output: productionSnapshotSchema },
	'production.stop': {
		input: obj(work),
		output: obj({
			...work,
			mode: lit('immediate'),
			cancelledQueued: int({ minimum: 0 }),
			abortedRunning: int({ minimum: 0 }),
		}),
	},
	'production.prioritizeChapter': {
		input: obj(chapter),
		output: productionSnapshotSchema,
	},
	'production.retryChapter': {
		input: obj(chapter),
		output: productionSnapshotSchema,
	},
}

export const productionSnapshotEventSchema = obj({
	type: lit('production.snapshot'),
	payload: productionSnapshotSchema,
})

export type ProductionSnapshot = Static<typeof productionSnapshotSchema>
export type ProductionSnapshotEvent = Static<
	typeof productionSnapshotEventSchema
>
