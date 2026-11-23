import { expect, test } from 'vitest'
import { markDeclarations } from '../../packages/player/src/text/custom-marks'

test('custom mark declarations preserve text styles and CSS priority', () => {
	expect(
		markDeclarations(
			'glow',
			'COLOR: #ffa !important; color: red; text-shadow: 0 0 4px #99f; transform: translateY(-0.1em); background: gold;',
		),
	).toEqual([
		['color', '#ffa', 'important'],
		['color', 'red', ''],
		['text-shadow', '0 0 4px #99f', ''],
		['transform', 'translateY(-0.1em)', ''],
		['background-color', 'gold', ''],
	])
})

test.each([
	'color: red; } body { color: black;',
	'@import "https://invalid.test/style.css"; color: red;',
	'background: u\\72 l(https://invalid.test/) ; color: red;',
	'background: u/**/rl(https://invalid.test/) ; color: red;',
])('custom marks reject rule or escape syntax: %s', (css) => {
	expect(markDeclarations('unsafe', css)).toEqual([])
})

test('custom marks cannot set layout, reveal, resources, or variable references', () => {
	expect(
		markDeclarations(
			'unsafe',
			'position: fixed; visibility: visible !important; --url: red; color: var(--url); background: URL(https://invalid.test/); font-family: attr(data-mark); background-image: image-set("https://invalid.test/" 1x); opacity: 0.7;',
		),
	).toEqual([['opacity', '0.7', '']])
})

test.each(['b', 'em', 'ruby', 'speed', 'wait'])(
	'custom marks cannot override %s',
	(name) => {
		expect(markDeclarations(name, 'color: red')).toEqual([])
	},
)
