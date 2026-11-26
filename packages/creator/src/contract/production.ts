import {
	arr,
	bool,
	compile,
	int,
	lit,
	map,
	nullable,
	obj,
	oneOf,
	opt,
	type Static,
	str,
	union,
} from '@earendil-works/pi-schema'
import {
	assetId,
	assetRegistrySchema,
	chapterSchema,
	chapterStepSchema,
	customMarksSchema,
	entityId,
	productionStatusSchema,
	workId,
	workPhaseSchema,
} from '@novelive/format/model'
import { issueKinds } from './errors'
import { productionQueueSchema } from './queue'

/**
 * The production chapter failure. `kind` is machine-readable; the optional
 * `detail` is raw developer-facing text for the details disclosure only.
 * Placeholder issues carry the affected image `count`.
 */
export const issueSchema = obj({
	kind: oneOf(issueKinds),
	detail: opt(str()),
	count: opt(int({ minimum: 1 })),
})

// The wire shape widens @novelive/format's chapterProductionSchema, whose
// `issue` stays a free-form string for work-package internals.
const chapterFields = {
	chapterId: entityId,
	issue: opt(issueSchema),
	priority: bool(),
}
export const productionChapterSchema = union([
	obj({ ...chapterFields, status: lit('waiting') }),
	obj({ ...chapterFields, status: lit('producing'), step: chapterStepSchema }),
	obj({ ...chapterFields, status: lit('published') }),
])
export type ProductionChapter = Static<typeof productionChapterSchema>

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
	exportTarget: opt(
		obj({ projectRoot: str({ minLength: 1 }), volumeId: entityId }),
	),
	title: opt(str()),
	summary: opt(str()),
	chapterTitles: opt(map(str())),
	phase: workPhaseSchema,
	status: productionStatusSchema,
	chapters: arr(productionChapterSchema),
	blockedChapterId: opt(entityId),
	visual: nullable(
		obj({
			mainVisuals: arr(candidateSchema, { minItems: 3, maxItems: 3 }),
			mattingUnavailable: opt(lit(true)),
			characters: arr(
				obj({
					characterId: entityId,
					costumeId: entityId,
					characterName: opt(str()),
					costumeName: opt(str()),
					candidates: arr(candidateSchema, { minItems: 1 }),
				}),
			),
			supplemental: arr(candidateSchema),
			importedIllustrations: opt(
				obj({
					fallback: bool(),
					recommended: arr(entityId),
					selected: arr(entityId),
					candidates: arr(candidateSchema),
				}),
			),
		}),
	),
})

const playerChaptersSchema = arr(
	obj({
		chapterId: entityId,
		title: str(),
		published: bool(),
		progress: str(),
	}),
)

export const productionCommands = {
	'production.getQueue': { input: obj({}), output: productionQueueSchema },
	'production.moveQueueWork': {
		input: obj({ workId, direction: union([lit(-1), lit(1)]) }),
		output: productionQueueSchema,
	},
	'production.playerStatus': {
		input: obj({ ...work, directory: opt(str({ minLength: 1 })) }),
		output: obj({ chapters: playerChaptersSchema }),
	},
	'production.playerChapter': {
		input: obj({
			...work,
			directory: opt(str({ minLength: 1 })),
			chapterId: opt(entityId),
		}),
		output: obj({
			linked: bool(),
			chapters: playerChaptersSchema,
			script: str(),
			chapter: chapterSchema,
			registry: assetRegistrySchema,
			speakers: arr(entityId, { uniqueItems: true }),
			speakerNames: map(str()),
			customMarks: customMarksSchema,
		}),
	},
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

export const productionSnapshotEvent = compile(productionSnapshotEventSchema)
export const productionQueueEvent = compile(
	obj({ type: lit('production.queue'), payload: productionQueueSchema }),
)
export const productionChapterRecordEvent = compile(
	obj({
		type: lit('production.chapterRecord'),
		payload: obj({
			...chapter,
			step: chapterStepSchema,
			status: oneOf(['running', 'done', 'failed', 'cancelled']),
			errorKind: opt(oneOf(issueKinds)),
			detail: opt(str()),
		}),
	}),
)

export type ProductionSnapshot = Static<typeof productionSnapshotSchema>
export type ProductionSnapshotEvent = Static<
	typeof productionSnapshotEventSchema
>
