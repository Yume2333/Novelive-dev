import type { AssetRegistry } from '../model/metadata'
import { actionSpec, slots } from './grammar'
import { assignScriptIds, type IdentityOptions } from './identity'
import { parseScript } from './parse'
import type { Diagnostic, Scene, ScriptLine, StageAction } from './schema'

type Asset = AssetRegistry['entries'][number]
type Slot = (typeof slots)[number]
type Point = Pick<Diagnostic, 'line' | 'col'>
type Report = (
	code: Diagnostic['code'],
	at: Point,
	message: string,
	hint: string,
) => void
type Sprite = { character: string; costume: string }
type Stage = { cast: Map<Slot, Sprite>; location?: string }
export type CompiledAction = StageAction & {
	assets: Array<{ id: string; slot?: Slot }>
}
export type Advance =
	| { kind: 'click' | 'auto' }
	| { kind: 'delay'; seconds: number }
export interface Beat {
	actions: CompiledAction[]
	line?: Exclude<ScriptLine, StageAction>
	advance: Advance
}
export interface CompiledScene {
	scene: Scene
	beats: Beat[]
}
export interface CompileOptions extends IdentityOptions {
	paragraphIds: readonly string[]
	assets: readonly Asset[]
	speakers: Iterable<string>
	customMarks?: Iterable<string>
}

function lookup(entries: readonly Asset[]) {
	const byId = new Map(entries.map((entry) => [entry.id, entry]))
	const aliases = new Map<string, Asset | null>()
	for (const entry of entries) {
		for (const alias of entry.aliases) {
			const existing = aliases.get(alias)
			aliases.set(
				alias,
				existing === undefined || existing === entry ? entry : null,
			)
		}
	}
	return (id: string) => byId.get(id) ?? aliases.get(id)
}

function validateSource(
	scenes: readonly Scene[],
	paragraphs: readonly string[],
	report: Report,
) {
	const indices = new Map(paragraphs.map((id, index) => [id, index]))
	let expected = 0
	let valid = true
	for (const { source } of scenes) {
		const from = indices.get(source.from)
		const to = indices.get(source.to)
		if (from === undefined || to === undefined || from > to) {
			const offset =
				from !== undefined && to === undefined ? source.from.length + 1 : 0
			report(
				'E_SOURCE_RANGE',
				{ line: source.line, col: source.col + offset },
				'原文范围不存在或顺序颠倒。',
				'选择本章内有效的段落起止编号。',
			)
			valid = false
			continue
		}
		if (valid && from !== expected)
			report(
				'E_SOURCE_COVERAGE',
				source,
				'场景原文范围有重叠、断档或顺序错误。',
				`该场景应从 ${paragraphs[expected] ?? '章末'} 开始。`,
			)
		expected = to + 1
	}
	const last = scenes.at(-1)
	if (valid && last && expected !== paragraphs.length)
		report(
			'E_SOURCE_COVERAGE',
			last.source,
			'最后一个场景没有覆盖到章末。',
			'各范围按顺序覆盖本章每一段一次。',
		)
}

function compileAction(
	line: StageAction,
	stage: Stage,
	find: ReturnType<typeof lookup>,
	report: Report,
): CompiledAction {
	const { cast } = stage
	const spec = actionSpec(line.name)
	const args = {
		...Object.fromEntries(
			(spec.optional ?? []).map(({ name, default: fallback }) => [
				name,
				fallback as string | number,
			]),
		),
		...line.args,
	}
	const assets: CompiledAction['assets'] = []
	const resolve = (
		id: string,
		allowed?: readonly Asset['type'][],
		slot?: Slot,
	) => {
		const asset = find(id)
		if (!asset || (allowed && !allowed.includes(asset.type))) {
			report(
				'E_ASSET',
				line,
				`未登记、歧义或类型错误的素材：${id}`,
				'使用素材登记表中的正确 ID 或无歧义的别名。',
			)
			return
		}
		assets.push(slot ? { id: asset.id, slot } : { id: asset.id })
		return asset
	}
	const stageError = (target: string) =>
		report(
			'E_STAGE',
			line,
			`舞台上找不到 ${target}`,
			'先用 @show 将对应角色放到舞台。',
		)
	const input = String(args.asset)
	const slot = args.slot as Slot
	switch (line.name) {
		case 'bg': {
			const asset = resolve(input, ['location', 'variant'])
			if (asset) {
				const location = asset.id.split('/')[0]
				if (stage.location === location && line.args.transition === undefined)
					args.transition = 'none'
				stage.location = location
			}
			break
		}
		case 'cg':
			if (input !== 'none') resolve(input, ['cg'])
			break
		case 'fg':
			if (input !== 'none') resolve(input)
			break
		case 'show': {
			const asset = resolve(input, ['character', 'expression'], slot)
			if (asset) {
				const [character, costume] = asset.id.split('/')
				cast.set(slot, { character, costume })
			}
			break
		}
		case 'hide': {
			const target = String(args.target)
			if (slots.includes(target as Slot)) cast.delete(target as Slot)
			else
				for (const [key, sprite] of cast)
					if (sprite.character === target) cast.delete(key)
			break
		}
		case 'move':
			if (!cast.has(slot)) stageError(slot)
			break
		case 'face': {
			const [character, second, expression] = input.split('/')
			if (expression) {
				const asset = resolve(input, ['character', 'expression'])
				if (asset) {
					const [actor, costume] = asset.id.split('/')
					for (const [key, sprite] of cast)
						if (sprite.character === actor)
							cast.set(key, { ...sprite, costume })
				}
			} else {
				const matches = [...cast].filter(
					([, sprite]) => sprite.character === character,
				)
				if (!matches.length) stageError(character)
				for (const [key, sprite] of matches)
					resolve(
						`${character}/${sprite.costume}/${second}`,
						['character', 'expression'],
						key,
					)
			}
			break
		}
		case 'costume': {
			const asset = resolve(input, ['character'])
			if (asset) {
				const [character, costume] = asset.id.split('/')
				for (const [key, sprite] of cast)
					if (sprite.character === character)
						cast.set(key, { ...sprite, costume })
			}
			break
		}
	}
	return { ...line, args, assets }
}

function compileScene(
	scene: Scene,
	stage: Stage,
	find: ReturnType<typeof lookup>,
	speakers: Set<string>,
	report: Report,
): CompiledScene {
	const beats: Beat[] = []
	let actions: CompiledAction[] = []
	for (const line of scene.lines) {
		if (line.type === 'action') {
			actions.push(compileAction(line, stage, find, report))
			continue
		}
		if (line.type === 'text' && line.speaker && !speakers.has(line.speaker)) {
			report(
				'E_SPEAKER',
				line,
				`设定集没有角色：${line.speaker}`,
				'说话人使用设定集角色 ID；显示别名写在 as 后。',
			)
		}
		const advance: Advance =
			line.type === 'wait'
				? line.seconds === undefined
					? { kind: 'click' }
					: { kind: 'delay', seconds: line.seconds }
				: { kind: line.click ? 'click' : 'auto' }
		beats.push({ actions, line, advance })
		actions = []
	}
	if (actions.length) beats.push({ actions, advance: { kind: 'auto' } })
	return { scene, beats }
}

export function compileScript(input: string, options: CompileOptions) {
	const parsed = parseScript(input, options)
	const diagnostics = [...parsed.diagnostics]
	const report: Report = (code, at, message, hint) =>
		diagnostics.push({ code, line: at.line, col: at.col, message, hint })
	const errors = () => diagnostics.some(({ code }) => code.startsWith('E_'))
	if (errors()) return { ok: false as const, diagnostics }
	validateSource(parsed.scenes, options.paragraphIds, report)
	const find = lookup(options.assets)
	const stage: Stage = { cast: new Map() }
	const speakers = new Set(options.speakers)
	const semantic = parsed.scenes.map((scene) =>
		compileScene(scene, stage, find, speakers, report),
	)
	if (errors()) return { ok: false as const, diagnostics }
	const assigned = assignScriptIds(parsed.scenes, options)
	diagnostics.push(...assigned.diagnostics)
	if (errors()) return { ok: false as const, diagnostics }
	const scenes = semantic.map(({ beats }, index) => {
		const scene = assigned.scenes[index]
		const text = scene.lines.filter((line) => line.type !== 'action')
		return {
			scene,
			beats: beats.map((beat, j) =>
				beat.line ? { ...beat, line: text[j] } : beat,
			),
		}
	})
	return { ok: true as const, scenes, diagnostics }
}
