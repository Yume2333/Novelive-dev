import { actionSpec } from './grammar'
import type { Inline, Scene, ScriptLine } from './schema'

function formatInline(part: Inline): string {
	switch (part.type) {
		case 'text':
			return part.text.replaceAll('{', '{{')
		case 'open':
			return `{${part.name}${part.argument === undefined ? '' : ` ${part.argument}`}}`
		case 'close':
			return `{/${part.name}}`
		case 'pause':
			return `{wait ${decimal(part.seconds)}}`
	}
}

function decimal(number: number): string {
	return number.toLocaleString('en-US', {
		useGrouping: false,
		maximumSignificantDigits: 21,
	})
}

function formatLine(line: ScriptLine) {
	if (line.type === 'action') {
		const spec = actionSpec(line.name)
		const required = spec.required.map(({ name }) => line.args[name])
		const optional = (spec.optional ?? []).flatMap(({ name }) =>
			Object.hasOwn(line.args, name) ? [name, line.args[name]] : [],
		)
		return [`@${line.name}`, ...required, ...optional]
			.map((value) => (typeof value === 'number' ? decimal(value) : value))
			.join(' ')
	}
	const id = line.id ? ` #${line.id}` : ''
	if (line.type === 'wait')
		return `@wait${line.seconds === undefined ? '' : ` ${decimal(line.seconds)}`}${id}`
	const text = line.content.map(formatInline).join('')
	if (line.kind === 'caption')
		return `@caption ${text}${line.click ? ' wait' : ''}${id}`
	const prefix = line.speaker
		? `${line.speaker}${line.kind === 'inner' ? ' (inner)' : ''}${line.alias ? ` as ${line.alias}` : ''}`
		: ''
	return `${prefix}: ${text}${line.click ? '' : ' cont'}${id}`
}

export function formatScene(scene: Scene): string {
	const { from, to } = scene.source
	const lines = [
		`scene ${scene.title}`,
		`source ${from}-${to}`,
		'',
		...scene.lines.map(formatLine),
	]
	return `${lines.join('\n').trimEnd()}\n`
}

export function formatScript(scenes: readonly Scene[]): string {
	return scenes.map(formatScene).join('\n')
}
