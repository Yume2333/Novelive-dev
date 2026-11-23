import {
	arr,
	bool,
	compile,
	lit,
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
	biblePatchSchema,
	entityId,
	glossaryPatchSchema,
	paragraphId,
} from '@novelive/format/model'
import {
	chapterTarget,
	revisionSchema,
	rewriteProposalSchema,
	rewriteRequestSchema,
	sceneTarget,
	workTarget,
} from './editor'

const id = str({ minLength: 1 })
const sessionTarget = { ...workTarget, sessionId: id }
const headId = nullable(id)
const mimeType = oneOf(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const attachment = obj({
	id,
	name: str(),
	mimeType,
	cachePath: id,
})
const position = union([
	obj({
		kind: lit('editor'),
		chapterId: entityId,
		sceneId: sceneTarget.sceneId,
		sourceIds: opt(arr(paragraphId, { uniqueItems: true })),
	}),
	obj({ kind: lit('bible'), entryId: opt(entityId) }),
])

export const proposalPayloadSchema = union([
	obj({
		kind: lit('bible'),
		volumeId: entityId,
		expectedRevision: revisionSchema,
		changes: biblePatchSchema,
	}),
	obj({
		kind: lit('glossary'),
		volumeId: entityId,
		expectedRevision: revisionSchema,
		changes: glossaryPatchSchema,
	}),
	obj({
		kind: lit('requirements'),
		expectedRevision: revisionSchema,
		previous: str(),
		next: str(),
	}),
	obj({ kind: lit('rewriteScene'), request: rewriteRequestSchema }),
	obj({
		kind: lit('redrawImage'),
		assetId,
		expectedRevision: revisionSchema,
		instruction: opt(id),
	}),
	obj({
		kind: lit('redoChapter'),
		chapterId: chapterTarget.chapterId,
		expectedRevision: revisionSchema,
	}),
	obj({
		kind: lit('resynthesizeVolume'),
		volumeId: entityId,
		expectedRevision: revisionSchema,
	}),
])
export const proposalSchema = obj({
	...workTarget,
	id,
	sessionId: nullable(id),
	prompt: id,
	chapterIds: arr(entityId, { uniqueItems: true }),
	payload: proposalPayloadSchema,
	status: oneOf(['pending', 'approved', 'rejected']),
	feedback: opt(str()),
})
export type Proposal = Static<typeof proposalSchema>

const messagePart = union([
	obj({ type: lit('text'), text: str() }),
	obj({ type: lit('reasoning'), text: str() }),
	obj({ type: lit('image'), attachment }),
	obj({ type: lit('tool'), id, name: id, input: str(), result: opt(str()) }),
	obj({
		type: lit('subtask'),
		id,
		label: id,
		status: oneOf(['running', 'done', 'failed', 'cancelled']),
	}),
	obj({ type: lit('proposal'), proposal: proposalSchema }),
])
const entry = {
	id,
	parentId: headId,
	at: str(),
}
const message = obj({
	...entry,
	kind: lit('message'),
	role: oneOf(['user', 'assistant']),
	parts: arr(messagePart),
})
const sessionEntry = union([
	message,
	obj({
		...entry,
		kind: oneOf(['compaction', 'branch_summary']),
		summary: str(),
	}),
])
const session = obj({ ...sessionTarget, title: id, updatedAt: str() })
const sessionSnapshot = obj({
	session,
	headId,
	headIds: arr(id, { uniqueItems: true }),
	entries: arr(sessionEntry),
	status: oneOf(['idle', 'streaming']),
})
export const chatMessageEvent = compile(
	obj({
		type: lit('chat.message'),
		payload: obj({
			...sessionTarget,
			headId: id,
			message,
			status: oneOf(['streaming', 'done', 'cancelled', 'failed']),
		}),
	}),
)

export const chatCommands = {
	'chat.list': {
		input: obj(workTarget),
		output: obj({ sessions: arr(session) }),
	},
	'chat.create': {
		input: obj({ ...workTarget, title: opt(id) }),
		output: sessionSnapshot,
	},
	'chat.get': {
		input: obj({ ...sessionTarget, headId: opt(id) }),
		output: sessionSnapshot,
	},
	'chat.rename': {
		input: obj({ ...sessionTarget, title: id }),
		output: session,
	},
	'chat.delete': {
		input: obj(sessionTarget),
		output: obj({ deleted: bool() }),
	},
	'chat.attach': {
		input: obj({ ...sessionTarget, name: id, mimeType, base64: id }),
		output: attachment,
	},
	'chat.send': {
		input: obj({
			...sessionTarget,
			expectedHeadId: headId,
			parentId: headId,
			content: union([
				obj({ text: id, attachmentIds: arr(id, { uniqueItems: true }) }),
				obj({
					text: lit(''),
					attachmentIds: arr(id, { minItems: 1, uniqueItems: true }),
				}),
			]),
			position: opt(position),
		}),
		output: obj({ headId: id }),
	},
	'chat.stop': {
		input: obj({ ...sessionTarget, headId: id }),
		output: obj({ stopped: bool() }),
	},
	'proposal.get': {
		input: obj({ ...workTarget, proposalId: id }),
		output: proposalSchema,
	},
	'proposal.resolve': {
		input: obj({
			...workTarget,
			proposalId: id,
			decision: union([
				obj({ kind: lit('approve') }),
				obj({ kind: lit('reject'), reason: opt(str()) }),
			]),
		}),
		output: union([
			obj({
				status: lit('resolved'),
				proposal: proposalSchema,
				rewrite: opt(rewriteProposalSchema),
			}),
			obj({ status: lit('stale'), proposal: proposalSchema }),
		]),
	},
} as const
