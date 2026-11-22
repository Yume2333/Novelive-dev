import { arr, compile, int, obj } from '@earendil-works/pi-schema'
import { ContextLimitError } from './budget'
import { textOf, userMessage, type writingModel } from './request'

export type SourceParagraph = { id: string; text: string }
export type ScopedFinding = { paragraphId?: string; text: string }

const count = int({ minimum: 0 })
const plan = compile(
	arr(
		obj({
			paragraphCount: int({ minimum: 1 }),
			lineCount: count,
			targets: arr(obj({ finding: count, line: count })),
		}),
	),
)

export function sceneBody(script: string) {
	const [heading, , , ...lines] = script.trimEnd().split('\n')
	return { heading, lines }
}

export function scopedScene(
	heading: string,
	paragraphs: readonly SourceParagraph[],
	lines: readonly string[],
) {
	return [
		heading,
		`source ${paragraphs[0].id}-${paragraphs.at(-1)?.id}`,
		'',
		...lines,
	].join('\n')
}

export async function scopeScene(
	model: () => ReturnType<typeof writingModel>,
	script: string,
	paragraphs: readonly SourceParagraph[],
	findings: readonly ScopedFinding[] = [],
) {
	const { lines } = sceneBody(script)
	if (paragraphs.length === 1 && !findings.length)
		return [
			{ paragraphs, lines, targets: [] as { finding: number; line: number }[] },
		]
	const prompt = [
		'Map this NVS scene to its cited source. Return only a JSON array of {"paragraphCount":1,"lineCount":1,"targets":[{"finding":0,"line":0}]}.',
		'Each entry takes the next contiguous source paragraphs and draft lines, in order. Cover both lists exactly once. Group consecutive paragraphs if a line adapts them together. Use zero lines for an omitted passage.',
		'Assign each finding exactly once to the group and its zero-based local line that should be edited (use line 0 in a group with no draft lines). A finding with a paragraph ID must be assigned to a group containing that paragraph.',
		`Source: ${JSON.stringify(paragraphs.length === 1 ? paragraphs.map(({ id }) => ({ id })) : paragraphs)}`,
		`Draft lines: ${JSON.stringify(lines)}`,
		`Findings: ${JSON.stringify(findings)}`,
	].join('\n')
	const phase = 'Scene source alignment'
	const result = await model().request(
		{ messages: [userMessage(prompt)] },
		phase,
	)
	let value: unknown
	try {
		value = JSON.parse(
			textOf(result)
				.trim()
				.replace(/^```(?:json)?\s*|\s*```$/gi, ''),
		)
	} catch {
		throw new Error('Scene source alignment returned invalid JSON')
	}
	const checked = plan.validate(value)
	if (!checked.ok)
		throw new Error('Scene source alignment returned invalid ranges')
	let paragraphIndex = 0
	let lineIndex = 0
	const used = new Set<number>()
	const groups = checked.value.map(({ paragraphCount, lineCount, targets }) => {
		const cited = paragraphs.slice(
			paragraphIndex,
			paragraphIndex + paragraphCount,
		)
		const body = lines.slice(lineIndex, lineIndex + lineCount)
		paragraphIndex += paragraphCount
		lineIndex += lineCount
		for (const { finding, line } of targets) {
			const item = findings[finding]
			if (
				!item ||
				used.has(finding) ||
				line >= Math.max(1, body.length) ||
				(item.paragraphId && !cited.some(({ id }) => id === item.paragraphId))
			)
				throw new Error(
					'Scene source alignment returned an invalid finding target',
				)
			used.add(finding)
		}
		return { paragraphs: cited, lines: body, targets }
	})
	if (
		paragraphIndex !== paragraphs.length ||
		lineIndex !== lines.length ||
		used.size !== findings.length
	)
		throw new Error(
			'Scene source alignment did not cover the draft, source, and findings',
		)
	if (!groups.length) throw new ContextLimitError(phase)
	return groups
}
