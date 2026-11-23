import {
	arr,
	bool,
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
	characterSchema,
	entityId,
	foreshadowingEntrySchema,
	glossaryEntrySchema,
	lineId,
	locationSchema,
	paragraphId,
	relationSchema,
	sceneId,
	styleSchema,
	timelineEntrySchema,
	workId,
	workSettingsSchema,
} from '@novelive/format/model'

const text = str({ minLength: 1 })
const nvsLine = str({ minLength: 1, pattern: '^[^\\r\\n]+$' })
export const revisionSchema = text
export const workTarget = { workId }
export const chapterTarget = { ...workTarget, chapterId: entityId }
export const sceneTarget = { ...chapterTarget, sceneId }
const openEditor = { ...chapterTarget, editorId: text }
const versioned = { expectedRevision: revisionSchema }
const lineEdit = union([
	obj({ kind: lit('text'), lineId, previous: nvsLine, next: nvsLine }),
	obj({ kind: lit('expression'), lineId, previous: assetId, next: assetId }),
])
const paragraph = obj({ id: paragraphId, text: str() })
const scene = obj({
	sceneId,
	sourceIds: arr(paragraphId, { uniqueItems: true }),
	nvs: text,
})
const markSuggestion = obj({
	id: text,
	name: text,
	css: str(),
	perChar: bool(),
})
const chapterSnapshot = obj({
	...chapterTarget,
	revision: revisionSchema,
	title: text,
	paragraphs: arr(paragraph),
	scenes: arr(scene),
	markSuggestions: arr(markSuggestion),
})
const historyEntry = obj({
	id: text,
	at: text,
	origin: oneOf(['creator', 'agent', 'undo']),
	kind: text,
	chapterId: opt(entityId),
	sceneId: opt(sceneId),
	lineId: opt(lineId),
	assetId: opt(assetId),
	previous: nullable(str()),
	next: nullable(str()),
})
const ruleTarget = union([
	obj({ scope: lit('work') }),
	obj({ scope: lit('chapter'), chapterId: entityId }),
])
const candidate = obj({ id: text, cachePath: text })
const imageRevision = { ...workTarget, assetId, ...versioned }

export const rewriteRequestSchema = obj({
	...sceneTarget,
	...versioned,
	instruction: text,
	sourceIds: opt(arr(paragraphId, { minItems: 1, uniqueItems: true })),
})
export const rewriteProposalSchema = obj({
	...sceneTarget,
	proposalId: text,
	...versioned,
	hunks: arr(
		obj({
			id: text,
			afterLineId: nullable(lineId),
			before: arr(nvsLine),
			after: arr(nvsLine),
		}),
		{ minItems: 1 },
	),
})
export type RewriteRequest = Static<typeof rewriteRequestSchema>
export type RewriteProposal = Static<typeof rewriteProposalSchema>

export const editorCommands = {
	'editor.open': {
		input: obj(chapterTarget),
		output: obj({
			editorId: text,
			chapter: chapterSnapshot,
			registry: assetRegistrySchema,
			speakerNames: map(str()),
			settings: workSettingsSchema,
			settingsRevision: revisionSchema,
		}),
	},
	'editor.close': { input: obj(openEditor), output: obj({ closed: bool() }) },
	'editor.editLine': {
		input: obj({ ...openEditor, sceneId, ...versioned, edit: lineEdit }),
		output: chapterSnapshot,
	},
	'editor.undo': {
		input: obj({ ...openEditor, ...versioned }),
		output: chapterSnapshot,
	},
	'editor.history': {
		input: obj({ ...workTarget, chapterId: opt(entityId) }),
		output: obj({ entries: arr(historyEntry) }),
	},
	'editor.saveRules': {
		input: obj({
			...workTarget,
			...versioned,
			target: ruleTarget,
			previous: arr(text),
			next: arr(text),
		}),
		output: obj({ revision: revisionSchema, rules: arr(text) }),
	},
	'editor.resolveMark': {
		input: obj({
			...openEditor,
			...versioned,
			suggestionId: text,
			decision: oneOf(['accept', 'reject']),
		}),
		output: chapterSnapshot,
	},
	'editor.rewriteScene': {
		input: rewriteRequestSchema,
		output: rewriteProposalSchema,
	},
	'editor.applyRewrite': {
		input: obj({
			...sceneTarget,
			proposalId: text,
			...versioned,
			hunkIds: arr(text, { minItems: 1, uniqueItems: true }),
		}),
		output: chapterSnapshot,
	},
	'editor.imageRevision': {
		input: obj({ ...workTarget, assetId }),
		output: obj({ revision: revisionSchema }),
	},
	'editor.regenerateImage': {
		input: obj({
			...imageRevision,
			instruction: opt(text),
			count: int({ minimum: 1 }),
		}),
		output: union([
			obj({ status: lit('applied'), revision: revisionSchema }),
			obj({
				status: lit('candidates'),
				candidates: arr(candidate, { minItems: 2 }),
			}),
		]),
	},
	'editor.selectImage': {
		input: obj({ ...imageRevision, candidateId: text }),
		output: obj({ revision: revisionSchema }),
	},
	'bible.get': {
		input: obj({ ...workTarget, volumeId: entityId }),
		output: obj({
			revision: revisionSchema,
			characters: arr(characterSchema),
			locations: arr(locationSchema),
			relations: arr(relationSchema),
			timeline: arr(timelineEntrySchema),
			foreshadowing: arr(foreshadowingEntrySchema),
			styles: arr(styleSchema),
			glossary: arr(glossaryEntrySchema),
			proposalIds: arr(text, { uniqueItems: true }),
			proposalActions: map(
				obj({
					canApprove: bool(),
					reason: opt(text),
					status: opt(oneOf(['stale', 'restricted'])),
				}),
			),
		}),
	},
} as const
