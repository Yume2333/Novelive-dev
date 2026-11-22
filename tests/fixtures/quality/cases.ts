import type { Failure, QualityCase } from '../../../tools/quality/scorer'

const common = {
	producer: 'hand-authored',
	source: [
		{
			id: 'p0001',
			text: 'Mira slid a sealed envelope under the lamp. “Wait until dusk,” Mira told Oren. A blue thread caught in its seal.',
		},
		{
			id: 'p0002',
			text: 'Oren slid the same envelope back under the lamp. “I can wait,” Oren said. Neither opened it.',
		},
	],
	speakers: ['mira', 'oren'],
	bible:
		'Mira is also called Miri and wears a grey coat. Oren does not know what is inside the envelope. The blue thread hints at a hidden map, but the payoff is in a later chapter.',
	maxLineChars: 110,
}

export const cases = [
	{
		...common,
		id: 'adjacent-paragraphs-aligned',
		script: `scene Under the lamp
source p0001-p0001

: Mira slid a sealed envelope under the lamp.
mira: Wait until dusk.
: A blue thread caught in its seal.

scene The envelope returns
source p0002-p0002

: Oren slid the same envelope back under the lamp.
oren: I can wait.
: Neither opened it.
`,
	},
	{
		...common,
		id: 'adjacent-paragraphs-misaligned',
		script: `scene Under the lamp
source p0001-p0001

: Oren slid the same envelope back under the lamp.
oren: I can wait. The hidden map inside will be useful.

scene The envelope returns
source p0002-p0002

: Mira slid a sealed envelope under the lamp.
mira: Wait until dusk.
: Mira wears a red coat and simultaneously stands at two opposite ends of the room, performing both visible actions in one shot without moving or cutting away.
`,
	},
] satisfies QualityCase[]

export const expected: Record<string, Failure[]> = {
	'adjacent-paragraphs-aligned': [],
	'adjacent-paragraphs-misaligned': [
		'fidelity',
		'consistency',
		'foreshadowing',
		'staging',
		'metrics',
	],
}
