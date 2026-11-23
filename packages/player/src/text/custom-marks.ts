import { builtInMarks } from '../../../format/src/script/grammar'

const reserved = new Set<string>([...builtInMarks, 'ruby', 'speed', 'wait'])
const textProperties = new Set([
	'background-color',
	'color',
	'font-family',
	'font-size',
	'font-style',
	'font-variant',
	'font-weight',
	'letter-spacing',
	'opacity',
	'text-decoration',
	'text-decoration-color',
	'text-decoration-line',
	'text-decoration-style',
	'text-decoration-thickness',
	'text-emphasis',
	'text-emphasis-color',
	'text-emphasis-style',
	'text-shadow',
	'transform',
	'transform-origin',
	'word-spacing',
])
const ruleSyntax = /[{}@\\<>]|\/\*/
const indirectValue =
	/\b(?:url|src|(?:-webkit-)?image-set|image|expression|paint|var|attr)\s*\(/i

export const glyphProperties = new Set([
	'background-color',
	'opacity',
	'text-decoration',
	'text-decoration-color',
	'text-decoration-line',
	'text-decoration-style',
	'text-decoration-thickness',
	'transform',
	'transform-origin',
])

type Declaration = [property: string, value: string, priority: string]

export function markDeclarations(name: string, css: string): Declaration[] {
	if (reserved.has(name) || ruleSyntax.test(css)) return []
	const declarations: Declaration[] = []
	for (const entry of css.split(';')) {
		const colon = entry.indexOf(':')
		if (colon === -1) continue
		const key = entry.slice(0, colon).trim().toLowerCase()
		const property = key === 'background' ? 'background-color' : key
		if (!textProperties.has(property)) continue
		const raw = entry.slice(colon + 1).trim()
		if (!raw || indirectValue.test(raw)) continue
		const important = /!\s*important$/i.exec(raw)
		const value = important ? raw.slice(0, important.index).trimEnd() : raw
		if (value)
			declarations.push([property, value, important ? 'important' : ''])
	}
	return declarations
}
