import {
	bool,
	lit,
	obj,
	oneOf,
	opt,
	type Static,
	str,
	union,
} from '@earendil-works/pi-schema'
import { assetId, entityId } from './metadata'

export const workPhaseSchema = oneOf([
	'preview',
	'confirm-visual',
	'confirm-first',
	'producing',
	'done',
	'imported',
])

export const productionStatusSchema = oneOf([
	'idle',
	'producing',
	'stopped',
	'confirm',
])
export const chapterStepSchema = oneOf(['write', 'review', 'stage', 'draw'])

const chapterFields = {
	chapterId: entityId,
	issue: opt(str({ minLength: 1 })),
	priority: bool(),
}

export const chapterProductionSchema = union([
	obj({ ...chapterFields, status: lit('waiting') }),
	obj({ ...chapterFields, status: lit('producing'), step: chapterStepSchema }),
	obj({ ...chapterFields, status: lit('published') }),
])

export const imageQueueItemSchema = union([
	obj({ assetId, kind: oneOf(['character', 'location', 'cg']) }),
	obj({
		assetId,
		kind: oneOf(['expression', 'variant']),
		baseAssetId: assetId,
	}),
])

export const imageJobResultSchema = union([
	obj({ status: lit('drawn') }),
	obj({ status: lit('placeholder'), issue: str({ minLength: 1 }) }),
	obj({ status: lit('unsupported'), issue: str({ minLength: 1 }) }),
])

export type WorkPhase = Static<typeof workPhaseSchema>
export type ProductionStatus = Static<typeof productionStatusSchema>
export type ChapterProduction = Static<typeof chapterProductionSchema>
export type ImageQueueItem = Static<typeof imageQueueItemSchema>
export type ImageJobResult = Static<typeof imageJobResultSchema>
