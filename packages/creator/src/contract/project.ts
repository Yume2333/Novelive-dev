import {
	arr,
	int,
	obj,
	oneOf,
	type Static,
	str,
} from '@earendil-works/pi-schema'
import { entityId, workId } from '@novelive/format/model'

export const taskKinds = [
	'preview',
	'synthesize',
	'chapter',
	'image',
	'redo_chapter',
	'resynthesize',
] as const
export const taskStatuses = [
	'queued',
	'running',
	'done',
	'needs_attention',
	'cancelled',
	'interrupted',
	'blocked',
] as const
export const taskPhases = [
	'queued',
	'write',
	'review',
	'stage',
	'await_draw',
	'done',
] as const
export const projectTaskSchema = obj({
	taskId: entityId,
	workId,
	kind: oneOf(taskKinds),
	refId: str({ minLength: 1 }),
	status: oneOf(taskStatuses),
	phase: oneOf(taskPhases),
	priority: int(),
	seq: int({ minimum: 1 }),
	createdAt: int({ minimum: 0 }),
})
export type ProjectTask = Static<typeof projectTaskSchema>
export type NewProjectTask = Pick<
	ProjectTask,
	'taskId' | 'workId' | 'kind' | 'refId'
> &
	Partial<Pick<ProjectTask, 'priority' | 'createdAt'>>
export type ProjectWork = { workId: string; title: string }
export const projectErrorCodes = [
	'invalid_document',
	'unsupported_format',
	'unsupported_reader',
	'unsupported_database',
] as const
export type ProjectErrorCode = (typeof projectErrorCodes)[number]

export const projectIdentitySchema = obj({
	seriesId: entityId,
	title: str(),
	volumeIds: arr(entityId),
})
export type ProjectIdentity = Static<typeof projectIdentitySchema>
