import type { Inline } from '@novelive/format/script'

export function textTiming(
	content: readonly Inline[],
	millisecondsPerCharacter: number,
) {
	const speeds = [1]
	const delays: number[] = []
	let pause = 0
	for (const part of content) {
		if (part.type === 'pause') pause += part.seconds * 1000
		else if (part.type === 'open')
			speeds.push(
				speeds[speeds.length - 1] *
					(part.name === 'speed' ? Number(part.argument) : 1),
			)
		else if (part.type === 'close') speeds.pop()
		else
			for (const _ of new Intl.Segmenter(undefined, {
				granularity: 'grapheme',
			}).segment(part.text)) {
				delays.push(
					pause + millisecondsPerCharacter / speeds[speeds.length - 1],
				)
				pause = 0
			}
	}
	return { delays, trailingPause: pause }
}
