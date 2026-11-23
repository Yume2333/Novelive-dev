import { readFileSync } from 'node:fs'
import type { EpubExtraction } from '../../../../packages/creator/src/import/epub'
import type { TextConnection } from '../../../../packages/creator/src/models/text'

export const visualConnection: TextConnection = {
	baseUrl: 'https://relay.invalid/v1',
	apiKey: 'offline',
	model: 'gemini-3.8-flash',
	format: 'openai-completions',
	compat: 'auto',
	contextWindow: 16_384,
}
export const syntheticDirectory = 'tests/fixtures/source/epub/synthetic'
export const classificationCases = [
	{
		label: 'character',
		bible:
			'The protagonist Ada has bright red hair and wears a blue uniform. The illustration style is simple flat vector art.',
		nearby:
			'Ada stood alone in her blue uniform, her bright red hair framing her face.',
		svg: '<rect width="512" height="512" fill="white"/><path d="M170 210 Q140 40 256 45 Q375 40 342 210" fill="red"/><circle cx="256" cy="150" r="80" fill="#ffd6b0"/><circle cx="230" cy="145" r="7"/><circle cx="280" cy="145" r="7"/><path d="M230 180 Q256 200 280 180" fill="none" stroke="black" stroke-width="5"/><path d="M175 255 L337 255 L380 480 L130 480Z" fill="blue"/><path d="M220 255 L256 300 L290 255" fill="white"/>',
	},
	{
		label: 'scene',
		bible:
			'The story takes place at a mountain lake: green pine trees, distant gray mountains, a blue lake and a small brown cabin. No characters are present in this scene. The style is simple flat vector art.',
		nearby:
			'The blue lake reflected the gray mountains. Green pines surrounded the small brown cabin.',
		svg: '<rect width="512" height="512" fill="#bce8ff"/><path d="M0 250 L150 40 L310 250 L420 80 L512 250Z" fill="gray"/><rect y="250" width="512" height="262" fill="#3388ee"/><path d="M0 290 Q170 200 512 310 L512 512 L0 512Z" fill="#5aaf53"/><path d="M25 290 L70 160 L115 290Z M95 325 L145 160 L195 325Z" fill="darkgreen"/><rect x="290" y="290" width="140" height="110" fill="#995522"/><path d="M270 290 L360 220 L450 290Z" fill="#663311"/><rect x="345" y="335" width="35" height="65" fill="#442211"/>',
	},
	{
		label: 'irrelevant',
		bible:
			'Ada is a red-haired student in a blue uniform living by a mountain lake. Publisher logos and printing marks have no relation to the characters or settings.',
		nearby: 'Publisher imprint and printing marks. Not a story illustration.',
		svg: '<rect width="512" height="512" fill="white"/><rect x="56" y="56" width="400" height="400" fill="none" stroke="black" stroke-width="10"/><text x="256" y="225" text-anchor="middle" font-size="44" font-family="sans-serif">SYNTHETIC</text><text x="256" y="290" text-anchor="middle" font-size="48" font-family="sans-serif">PRESS</text><text x="256" y="355" text-anchor="middle" font-size="24" font-family="sans-serif">PUBLISHER LOGO</text>',
	},
] as const

export function classificationExtraction(
	sample: (typeof classificationCases)[number],
): EpubExtraction {
	const archivePath = `OPS/images/${sample.label}.svg`
	return {
		status: 'ready',
		book: {
			format: 'epub',
			navigation: 'spine',
			metadata: { title: 'Synthetic illustration cases' },
			volumes: [
				{
					title: '正文',
					chapters: [
						{ title: 'Chapter One', paragraphs: [sample.nearby], notes: [] },
					],
				},
			],
			illustrations: [{ archivePath, volume: 0, chapter: 0, paragraph: 0 }],
		},
		images: new Map([
			[archivePath, readFileSync(`${syntheticDirectory}/${sample.label}.png`)],
		]),
	}
}
