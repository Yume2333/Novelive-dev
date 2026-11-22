import { idToken, paragraphIdPattern } from '../model/metadata'
import {
	type ActionName,
	actionNames,
	actionSpec,
	builtInMarks,
	decimalPattern,
	namePattern,
	numeric,
	type Value,
} from './grammar'
import type { Diagnostic, Inline, Scene, ScriptLine, TextLine } from './schema'

type Point = Pick<Diagnostic, 'line' | 'col'>
type Report = (
	code: Diagnostic['code'],
	at: Point,
	message: string,
	hint: string,
) => void
type Token = Point & { text: string }
type Body = { scene: Scene | undefined; ids: Set<string> }
const paragraph = new RegExp(paragraphIdPattern)
const textPrefix = new RegExp(
	`^(?:(${idToken})(?:\\s+(\\(inner\\)))?(?:\\s+as\\s+([^:]+?))?)?:\\s*`,
)
const lineId = /^[0-9a-f]{4}$/
const actionSet = new Set<string>(actionNames)
const seconds = numeric(0)
const speed = numeric(Number.MIN_VALUE)

function shift(at: Point, offset: number): Point {
	return { line: at.line, col: at.col + offset }
}

function words(text: string, at: Point): Token[] {
	return Array.from(text.matchAll(/\S+/g), (match) => ({
		...shift(at, match.index),
		text: match[0],
	}))
}

function payload(text: string, at: Point, body: Body, report: Report) {
	const suffix = /(?:^|\s)#(\S*)$/.exec(text)
	if (!suffix) return { text }
	const id = suffix[1]
	const position = shift(at, suffix.index + suffix[0].indexOf('#'))
	if (!lineId.test(id))
		report(
			'E_ID',
			position,
			`无效句子 ID：#${id}`,
			'使用四位小写十六进制，或省略以便保存时分配。',
		)
	else if (body.ids.has(id))
		report(
			'E_DUPLICATE_ID',
			position,
			`重复句子 ID：#${id}`,
			'同一场景内句子 ID 必须唯一。',
		)
	else body.ids.add(id)
	return {
		text: text.slice(0, suffix.index).trimEnd(),
		id: lineId.test(id) ? id : undefined,
	}
}

function inline(
	text: string,
	at: Point,
	marks: Set<string>,
	report: Report,
): Inline[] {
	const result: Inline[] = []
	const stack: Array<{ name: string; at: Point }> = []
	let plain = ''
	const flush = () => {
		if (plain) result.push({ type: 'text', text: plain })
		plain = ''
	}
	for (let i = 0; i < text.length; ) {
		if (text[i] !== '{') {
			plain += text[i++]
			continue
		}
		if (text[i + 1] === '{') {
			plain += '{'
			i += 2
			continue
		}
		const position = shift(at, i)
		const end = text.indexOf('}', i + 1)
		if (end < 0) {
			report(
				'E_TAG',
				position,
				'行内标签未闭合。',
				'闭合标签，或用 {{ 表示字面的 {。',
			)
			plain += text.slice(i)
			break
		}
		const tag = text.slice(i + 1, end)
		i = end + 1
		const match = /^(\/?)([a-z][a-z0-9_-]*)(?:\s+(.+))?$/.exec(tag)
		const invalid = () =>
			report(
				'E_TAG',
				position,
				`无效行内标签：{${tag}}`,
				'检查标签名称、参数以及嵌套顺序。',
			)
		if (!match) {
			invalid()
			continue
		}
		const [, closing, name, argument] = match
		flush()
		if (closing) {
			if (argument !== undefined || stack.at(-1)?.name !== name) invalid()
			else {
				stack.pop()
				result.push({ type: 'close', name })
			}
		} else if (name === 'wait') {
			const delay = argument === undefined ? undefined : seconds(argument)
			if (typeof delay !== 'number') invalid()
			else result.push({ type: 'pause', seconds: delay })
		} else if (
			name === 'ruby'
				? Boolean(argument?.trim()) && !argument?.includes('{')
				: name === 'speed'
					? argument !== undefined && speed(argument) !== undefined
					: marks.has(name) && argument === undefined
		) {
			stack.push({ name, at: position })
			result.push(
				argument === undefined
					? { type: 'open', name }
					: { type: 'open', name, argument },
			)
		} else invalid()
	}
	flush()
	for (const tag of stack)
		report(
			'E_TAG',
			tag.at,
			`标签 {${tag.name}} 未关闭。`,
			`补上 {/${tag.name}}。`,
		)
	let width = 0
	for (const part of result) {
		if (part.type !== 'text') continue
		for (const char of part.text)
			width +=
				/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff01-\uff60]/u.test(
					char,
				)
					? 1
					: 0.5
	}
	if (width > 90)
		report(
			'W_LINE_LONG',
			at,
			'文字可能无法放入单页对话框。',
			'可拆成短句；播放器仍会自动分页。',
		)
	return result
}

function parseAction(
	name: ActionName,
	input: Token[],
	at: Point,
	report: Report,
): ScriptLine {
	const spec = actionSpec(name)
	const parameters = spec.optional ?? []
	const args: Record<string, Value> = {}
	const positional: Token[] = []
	for (let i = 0; i < input.length; i++) {
		const token = input[i]
		const parameter = parameters.find(
			(candidate) => candidate.name === token.text,
		)
		const next = input[i + 1]
		const value = next && parameter?.read(next.text)
		const required = spec.required[positional.length]
		if (
			!parameter ||
			(required?.read(token.text) !== undefined &&
				(value === undefined ||
					input.length - i - 2 < spec.required.length - positional.length))
		) {
			positional.push(token)
			continue
		}
		i++
		if (value === undefined || Object.hasOwn(args, parameter.name))
			report(
				'E_ARGUMENT',
				next ?? token,
				`无效或重复参数：${parameter.name}`,
				'使用文档中的参数名与值域。',
			)
		else args[parameter.name] = value
	}
	const ordered = [...spec.required, ...parameters].filter(
		(parameter) => !Object.hasOwn(args, parameter.name),
	)
	for (const token of positional) {
		const index = spec.flexible
			? ordered.findIndex((p) =>
					p.name === 'scale' || p.name === 'duration'
						? decimalPattern.test(token.text)
						: p.read(token.text) !== undefined,
				)
			: 0
		const parameter = index < 0 ? undefined : ordered.splice(index, 1)[0]
		const value = parameter?.read(token.text)
		if (!parameter || value === undefined)
			report(
				'E_ARGUMENT',
				token,
				`无效参数：${token.text}`,
				'检查参数顺序、类型和值域。',
			)
		else args[parameter.name] = value
	}
	for (const p of spec.required)
		if (!Object.hasOwn(args, p.name))
			report(
				'E_ARGUMENT',
				at,
				`缺少参数：${p.name}`,
				'按指令语法补齐必需参数。',
			)
	return { type: 'action', ...at, name, args }
}

function parseLine(
	line: string,
	at: Point,
	body: Body,
	marks: Set<string>,
	report: Report,
): ScriptLine | undefined {
	const action = /^@([^\s]+)(?:\s+|$)/.exec(line)
	let textAt: Point
	let fields: Pick<TextLine, 'kind' | 'speaker' | 'alias'>
	let raw: string
	if (action) {
		const name = action[1]
		textAt = shift(at, action[0].length)
		raw = line.slice(action[0].length)
		if (name === 'wait') {
			const part = payload(raw, textAt, body, report)
			const delay = part.text ? seconds(part.text) : undefined
			if (part.text && typeof delay !== 'number')
				report(
					'E_ARGUMENT',
					textAt,
					'无效等待时间。',
					'省略时间等待点击，或写非负秒数。',
				)
			return {
				type: 'wait',
				...at,
				...(part.id ? { id: part.id } : {}),
				...(typeof delay === 'number' ? { seconds: delay } : {}),
			}
		}
		if (actionSet.has(name))
			return parseAction(name as ActionName, words(raw, textAt), at, report)
		if (name !== 'caption') {
			report('E_COMMAND', at, `未知指令：@${name}`, '使用文档中的指令。')
			return
		}
		fields = { kind: 'caption' }
	} else {
		const prefix = textPrefix.exec(line)
		if (!prefix) {
			report(
				'E_LINE',
				at,
				'无法识别剧本行。',
				'写指令、角色对白、独白或以 : 开头的旁白。',
			)
			return
		}
		const [, speaker, inner, alias] = prefix
		fields = {
			kind: inner ? 'inner' : speaker ? 'dialogue' : 'narration',
			...(speaker ? { speaker } : {}),
			...(alias ? { alias: alias.trim() } : {}),
		}
		textAt = shift(at, prefix[0].length)
		raw = line.slice(prefix[0].length)
	}
	const part = payload(raw, textAt, body, report)
	const caption = fields.kind === 'caption'
	const marker = caption ? /(?:^|\s)wait$/ : /(?:^|\s)cont$/
	const tail = marker.test(part.text)
	const text = tail ? part.text.replace(marker, '').trimEnd() : part.text
	if (!text)
		report(
			'E_LINE',
			textAt,
			'文字为空。',
			'填入文字，或用 @wait 插入无文字停顿。',
		)
	return {
		type: 'text',
		...at,
		...fields,
		...(part.id ? { id: part.id } : {}),
		content: inline(text, textAt, marks, report),
		click: caption ? tail : !tail,
	}
}

export function parseScript(
	input: string,
	options: { customMarks?: Iterable<string> } = {},
) {
	const scenes: Scene[] = []
	const diagnostics: Diagnostic[] = []
	const report: Report = (code, at, message, hint) =>
		diagnostics.push({ code, ...at, message, hint })
	const marks = new Set<string>(builtInMarks)
	for (const mark of options.customMarks ?? [])
		if (namePattern.test(mark)) marks.add(mark)
	const lines = input.replace(/^\uFEFF/, '').split(/\r\n?|\n/)
	const start = lines.findIndex((line) => line.trim())
	const end = lines.findLastIndex((line) => line.trim())
	let fenced = false
	const body: Body = { scene: undefined, ids: new Set() }
	let pending: { title: string; at: Point } | undefined
	for (const [index, raw] of lines.entries()) {
		const line = raw.trim()
		if (!line) continue
		const at = { line: index + 1, col: raw.length - raw.trimStart().length + 1 }
		if (line.startsWith('```')) {
			if (
				index === start &&
				/^\u0060{3}(?:nvs|text|txt)?$/i.test(line) &&
				index !== end &&
				lines[end].trim() === '```'
			)
				fenced = true
			else if (!(fenced && index === end && line === '```'))
				report(
					'E_FENCE',
					at,
					'无法识别代码围栏。',
					'只用一对外围 Markdown 围栏，或直接写剧本文本。',
				)
			continue
		}
		if (/^scene(?:\s|$)/.test(line)) {
			if (pending)
				report(
					'E_SOURCE',
					pending.at,
					'缺少 source 行。',
					'在场景标题后写 source 段落范围。',
				)
			body.scene = undefined
			body.ids.clear()
			const title = line.slice(5).trim()
			if (!title)
				report('E_SCENE', at, '场景缺少标题。', '在 scene 后写场景标题。')
			pending = { title, at }
			continue
		}
		if (pending && /^source(?:\s|$)/.test(line)) {
			const text = line.slice(6).trimStart()
			const sourceAt = shift(at, text ? line.length - text.length : 6)
			const [from, to = from, extra] = text.split('-')
			if (!paragraph.test(from) || !paragraph.test(to) || extra !== undefined)
				report(
					'E_SOURCE',
					sourceAt,
					'无效的 source 范围。',
					'写如 source p0001-p0003 的闭区间。',
				)
			else if (pending.title) {
				body.scene = {
					...pending.at,
					title: pending.title,
					source: { ...sourceAt, from, to },
					lines: [],
				}
				scenes.push(body.scene)
			}
			pending = undefined
			continue
		}
		if (!body.scene) {
			report(
				pending ? 'E_SOURCE' : 'E_SCENE',
				at,
				pending ? '标题后的第一行应为 source。' : '内容不在有效场景中。',
				'先写 scene 标题与 source 范围。',
			)
			continue
		}
		const parsed = parseLine(line, at, body, marks, report)
		if (parsed) body.scene.lines.push(parsed)
	}
	if (pending)
		report(
			'E_SOURCE',
			pending.at,
			'缺少 source 行。',
			'在场景标题后写 source 段落范围。',
		)
	if (!scenes.length && !diagnostics.length)
		report(
			'E_SCENE',
			{ line: 1, col: 1 },
			'剧本没有场景。',
			'写至少一个 scene 块。',
		)
	return { scenes, diagnostics }
}
