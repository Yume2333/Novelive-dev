import { type CompileOptions, compileScript } from '../compile'
import { portraitsAt } from './portraits'

export interface SceneScript {
	sceneId: string
	nvs: string
}

export type LineEdit =
	| { kind: 'text'; lineId: string; previous: string; next: string }
	| { kind: 'expression'; lineId: string; previous: string; next: string }

export interface ScriptLinePatch {
	offset: number
	before: string
	after: string
}

export class ScriptEditError extends Error {
	constructor(
		readonly code: 'not_found' | 'stale_revision' | 'invalid_config',
		message: string,
	) {
		super(message)
	}
}

const newline = /\r\n?|\n/
const idSuffix = /\s+#([0-9a-f]{4})$/
const lines = (nvs: string) => nvs.split(/(\r\n?|\n)/)

export function applyScriptLinePatch(nvs: string, patch: ScriptLinePatch) {
	const end = patch.offset + patch.before.length
	if (nvs.slice(patch.offset, end) !== patch.before)
		throw new ScriptEditError('stale_revision', '剧本行已改变，请刷新后重试。')
	return nvs.slice(0, patch.offset) + patch.after + nvs.slice(end)
}

export function compileEditorScript(
	scenes: readonly SceneScript[],
	options: Omit<CompileOptions, 'sceneIds' | 'previous' | 'makeId'>,
) {
	const result = compileScript(
		scenes.map(({ nvs }) => nvs.replace(/\r\n?/g, '\n')).join('\n'),
		{
			...options,
			sceneIds: scenes.map(({ sceneId }) => sceneId),
		},
	)
	if (!result.ok)
		throw new ScriptEditError(
			'invalid_config',
			result.diagnostics
				.filter(({ code }) => code.startsWith('E_'))
				.map(({ message }) => message)
				.join(' '),
		)
	if (result.scenes.length !== scenes.length)
		throw new ScriptEditError(
			'invalid_config',
			'每个剧本文件必须包含一个场景。',
		)
	return result.scenes
}

export function editScriptLine(
	scenes: readonly SceneScript[],
	sceneId: string,
	edit: LineEdit,
	options: Parameters<typeof compileEditorScript>[1],
) {
	const sceneIndex = scenes.findIndex((scene) => scene.sceneId === sceneId)
	if (sceneIndex < 0) throw new ScriptEditError('not_found', '找不到场景。')
	const scene = scenes[sceneIndex]
	// Offsets match the parser's one-based line numbers in the joined chapter.
	const offset = scenes
		.slice(0, sceneIndex)
		.reduce((sum, { nvs }) => sum + nvs.split(newline).length, 1)
	const rawLines = lines(scene.nvs)
	const compiled = compileEditorScript(scenes, options)
	const beat = compiled[sceneIndex].beats.find(
		({ line }) => line?.id === edit.lineId,
	)
	if (!beat?.line) throw new ScriptEditError('not_found', '找不到剧本行。')

	function patchAt(line: number, replacement: (raw: string) => string) {
		const index = (line - offset) * 2
		const before = rawLines[index]
		return {
			offset: rawLines.slice(0, index).join('').length,
			before,
			after: replacement(before),
		}
	}

	let patch: ScriptLinePatch
	let previous: string
	let next: string
	if (edit.kind === 'text') {
		if (beat.line.type !== 'text')
			throw new ScriptEditError('invalid_config', '只能修改文字行。')
		const before = rawLines[(beat.line.line - offset) * 2]
		previous = before.trim()
		const supplied = edit.previous.trim()
		if (supplied !== previous && supplied !== previous.replace(idSuffix, ''))
			throw new ScriptEditError('stale_revision', '文字已改变，请刷新后重试。')
		const replacement = edit.next.trim()
		const id = idSuffix.exec(replacement)?.[1]
		if (!replacement || newline.test(edit.next) || (id && id !== edit.lineId))
			throw new ScriptEditError(
				'invalid_config',
				'只可替换单行且不可更改句子 ID。',
			)
		next = id ? replacement : `${replacement} #${edit.lineId}`
		patch = patchAt(beat.line.line, (raw) =>
			raw.replace(raw.trim(), () => next),
		)
	} else {
		const portraits = portraitsAt(compiled, beat)
		const speaker = beat.line.type === 'text' ? beat.line.speaker : undefined
		const matches = [...portraits].filter(
			([, { id }]) =>
				id === edit.previous &&
				(speaker === undefined || id.split('/')[0] === speaker),
		)
		if (matches.length !== 1)
			throw new ScriptEditError('stale_revision', '此句没有唯一匹配的原表情。')
		const asset = options.assets.find(({ id }) => id === edit.next)
		if (
			!asset ||
			(asset.type !== 'expression' && asset.type !== 'character') ||
			edit.previous.split('/').length !== 3 ||
			edit.next.split('/').slice(0, -1).join('/') !==
				edit.previous.split('/').slice(0, -1).join('/')
		)
			throw new ScriptEditError(
				'invalid_config',
				'请选择同一角色和造型的表情。',
			)
		const [slot, { action }] = matches[0]
		previous = edit.previous
		next = edit.next
		if (action.name === 'show' && beat.actions.includes(action)) {
			patch = patchAt(action.line, (raw) =>
				raw.replace(/\S+/g, (token) =>
					token === action.args.asset ? next : token,
				),
			)
		} else {
			const index = (beat.line.line - offset) * 2
			const eol = rawLines[index + 1] ?? rawLines[index - 1]
			patch = patchAt(
				beat.line.line,
				(raw) => `@show ${next} ${slot}${eol}${raw}`,
			)
		}
	}

	const nvs =
		previous === next ? scene.nvs : applyScriptLinePatch(scene.nvs, patch)
	const updated = compileEditorScript(
		scenes.map((item) => (item === scene ? { ...scene, nvs } : item)),
		options,
	)
	if (
		edit.kind === 'text' &&
		!updated[sceneIndex].scene.lines.some(
			(line) => line.type === 'text' && line.id === edit.lineId,
		)
	)
		throw new ScriptEditError('invalid_config', '只能替换成文字行。')
	return { patch, nvs, previous, next }
}
