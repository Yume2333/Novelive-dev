import {
	arr,
	bool,
	int,
	lit,
	map,
	num,
	obj,
	oneOf,
	opt,
	type Static,
	str,
	union,
} from '@earendil-works/pi-schema'
import { lineId, paragraphId, sceneId } from '../model/metadata'
import { actionNames } from './grammar'

export const diagnosticCodes = [
	'E_FENCE',
	'E_SCENE',
	'E_SOURCE',
	'E_SOURCE_RANGE',
	'E_SOURCE_COVERAGE',
	'E_LINE',
	'E_ID',
	'E_DUPLICATE_ID',
	'E_ID_EXHAUSTED',
	'E_COMMAND',
	'E_ARGUMENT',
	'E_TAG',
	'E_SPEAKER',
	'E_ASSET',
	'E_STAGE',
	'W_LINE_LONG',
] as const
export const diagnosticSchema = obj({
	code: oneOf(diagnosticCodes),
	line: int({ minimum: 1 }),
	col: int({ minimum: 1 }),
	message: str(),
	hint: str(),
})
export type Diagnostic = Static<typeof diagnosticSchema>

const at = { line: int({ minimum: 1 }), col: int({ minimum: 1 }) }
const inlineSchema = union([
	obj({ type: lit('text'), text: str() }),
	obj({ type: lit('open'), name: str(), argument: opt(str()) }),
	obj({ type: lit('close'), name: str() }),
	obj({ type: lit('pause'), seconds: num({ minimum: 0 }) }),
])
export const stageActionSchema = obj({
	type: lit('action'),
	...at,
	name: oneOf(actionNames),
	args: map(union([num(), str()])),
})
const textSchema = obj({
	type: lit('text'),
	...at,
	kind: oneOf(['dialogue', 'inner', 'narration', 'caption']),
	speaker: opt(str()),
	alias: opt(str()),
	id: opt(lineId),
	content: arr(inlineSchema),
	click: bool(),
})
const waitSchema = obj({
	type: lit('wait'),
	...at,
	id: opt(lineId),
	seconds: opt(num({ minimum: 0 })),
})
export const scriptLineSchema = union([
	stageActionSchema,
	textSchema,
	waitSchema,
])
export const sceneSchema = obj({
	...at,
	id: opt(sceneId),
	title: str({ minLength: 1 }),
	source: obj({ ...at, from: paragraphId, to: paragraphId }),
	lines: arr(scriptLineSchema),
})
export const chapterScriptSchema = arr(sceneSchema)
export type Scene = Static<typeof sceneSchema>
export type ScriptLine = Static<typeof scriptLineSchema>
export type StageAction = Static<typeof stageActionSchema>
export type TextLine = Static<typeof textSchema>
export type Inline = Static<typeof inlineSchema>
