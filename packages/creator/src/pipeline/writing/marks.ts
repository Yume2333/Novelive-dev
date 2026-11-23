import {
	builtInMarks,
	namePattern,
} from '../../../../format/src/script/grammar'

export type ProposedMark = { name: string; css: string; perChar: boolean }

const reserved = new Set<string>([...builtInMarks, 'ruby', 'wait', 'speed'])
const marker = /^@propose-mark(?:\s|$)/
const unsafeCss =
	/[{}@\\<>]|\/\*|\b(?:url|src|(?:-webkit-)?image-set|image|expression|paint)\s*\(/i

export const markInstructions = (registered: readonly string[]) =>
	[
		registered.length
			? `Registered custom marks you may use in NVS: ${registered.join(', ')}.`
			: 'There are no registered custom marks.',
		'The only exception to NVS-only output is an optional new mark proposal. If a new effect would help, append a separate line after the NVS for each proposal: @propose-mark {"name":"shiver","css":"text-shadow: 0 0 4px #99f;","perChar":true}',
		'Names are lowercase English tags (letters, digits, hyphens or underscores). CSS is a declaration list only, without selectors, at-rules or external resources. perChar is true for per-glyph effects.',
		'Never use a proposed tag in the NVS; it only becomes available after the creator accepts it. Do not propose a mark if an existing mark is sufficient.',
	].join('\n')

function parseMark(line: string): ProposedMark | undefined {
	let value: unknown
	try {
		value = JSON.parse(line)
	} catch {
		return undefined
	}
	if (!value || typeof value !== 'object') return undefined
	const { name, css, perChar } = value as Partial<ProposedMark>
	if (
		typeof name !== 'string' ||
		name.length > 64 ||
		!namePattern.test(name) ||
		reserved.has(name) ||
		typeof css !== 'string' ||
		!css.trim() ||
		css.length > 1024 ||
		unsafeCss.test(css) ||
		!css
			.trim()
			.split(';')
			.every(
				(declaration) =>
					!declaration.trim() ||
					/^[-a-z][\w-]*\s*:\s*\S/i.test(declaration.trim()),
			) ||
		typeof perChar !== 'boolean'
	)
		return undefined
	return { name, css: css.trim(), perChar }
}

export function splitMarkSuggestions(text: string) {
	const script: string[] = []
	const suggestions: ProposedMark[] = []
	for (const line of text.split('\n')) {
		const trimmed = line.trim()
		if (!marker.test(trimmed)) {
			script.push(line)
			continue
		}
		const mark = parseMark(trimmed.replace(marker, ''))
		if (mark) suggestions.push(mark)
	}
	return { script: script.join('\n'), suggestions }
}
