import {
	arr,
	int,
	lit,
	nullable,
	num,
	obj,
	oneOf,
	type Static,
	str,
	union,
} from '@earendil-works/pi-schema'
import { chapterStepSchema } from '@novelive/format/model'
import { workVolumeLinkSchema } from './import'

const text = str({ minLength: 1 })
const count = int({ minimum: 0 })
const queueWork = {
	link: workVolumeLinkSchema,
	projectDir: text,
	title: text,
}

// Only queued works are ordered and can be moved. Confirming re-enters at the
// head of queued, without replacing active; restoring after a crash pauses it.
export const productionQueueSchema = obj({
	active: nullable(obj({ ...queueWork, status: lit('active') })),
	queued: arr(obj({ ...queueWork, status: lit('queued') })),
	inactive: arr(
		union([
			obj({
				...queueWork,
				status: lit('awaiting_confirm'),
				reason: oneOf(['confirm_visual', 'confirm_first']),
			}),
			obj({
				...queueWork,
				status: lit('paused'),
				reason: oneOf([
					'chapter_failed',
					'image_unsupported',
					'budget_paused',
					'stopped',
					'crashed',
				]),
			}),
			obj({ ...queueWork, status: lit('done') }),
		]),
	),
})
export type ProductionQueue = Static<typeof productionQueueSchema>

const usageFields = {
	link: workVolumeLinkSchema,
	// Epoch milliseconds of an actual call, not a forecast.
	at: count,
	phase: union([
		oneOf(['import', 'preview', 'synthesize', 'chat']),
		chapterStepSchema,
	]),
	model: text,
	// null is unpriced; zero is a known price.
	costUsd: nullable(num({ minimum: 0 })),
}

export const productionUsageSchema = union([
	obj({
		...usageFields,
		kind: lit('text'),
		inputTokens: count,
		outputTokens: count,
		cacheReadTokens: count,
		cacheWriteTokens: count,
	}),
	obj({ ...usageFields, kind: lit('image'), imageCount: count }),
])
export type ProductionUsage = Static<typeof productionUsageSchema>
