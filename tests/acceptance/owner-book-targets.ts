import type { BiblePatch, GlossaryPatch } from '../../packages/format/src/model'

const kinds = [
	'character',
	'location',
	'relation',
	'timeline',
	'foreshadowing',
	'style',
	'glossary',
] as const

export type WholeBookRun = {
	biblePatch: BiblePatch
	glossaryPatch: GlossaryPatch
}

export function wholeBookSelectionTargets(runs: readonly WholeBookRun[]) {
	if (!runs.length)
		throw new Error('Selection targets require whole-run outputs')
	return Object.fromEntries(
		kinds.map((kind) => {
			const counts = runs
				.map(({ biblePatch, glossaryPatch }) =>
					kind === 'glossary'
						? glossaryPatch.length
						: biblePatch.filter((item) => item.kind === kind).length,
				)
				.sort((a, b) => a - b)
			const middle = Math.floor(counts.length / 2)
			return [
				kind,
				Math.round(
					(counts[middle] + counts[Math.floor((counts.length - 1) / 2)]) / 2,
				),
			]
		}),
	)
}
