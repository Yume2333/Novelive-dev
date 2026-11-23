import { arr, bool, compile, int, obj } from '@earendil-works/pi-schema'
import { parseModelJson } from '../../models/text'
import { ContextLimitError, promptFits } from './budget'
import { textOf, userMessage, type writingModel } from './request'

export type SourceParagraph = { id: string; text: string }
export type ScopedFinding = {
	paragraphId?: string
	quote?: string
	text: string
}

type Target = { finding: number; line: number }
type SceneScope = {
	paragraphs: readonly SourceParagraph[]
	lines: readonly string[]
	targets: Target[]
}
type Model = ReturnType<typeof writingModel>

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
const boundary = compile(obj({ lineCount: count, complete: bool() }))
const phase = 'Scene source alignment'
const messages = (prompt: string) => ({ messages: [userMessage(prompt)] })

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
	const aligner = model()
	const prompt = alignmentPrompt(paragraphs, lines, findings, false)
	if (promptFits(aligner, messages(prompt)))
		return align(aligner, prompt, paragraphs, lines, findings, false)
	if (paragraphs.length < 2) throw new ContextLimitError(phase)

	const groups: SceneScope[] = []
	let from = 0
	for (const [index, paragraph] of paragraphs.entries()) {
		const remaining = lines.slice(from)
		const length =
			index === paragraphs.length - 1
				? remaining.length
				: await paragraphBoundary(aligner, paragraph, remaining)
		const body = remaining.slice(0, length)
		from += length
		const relevant = findings.flatMap((finding, index) =>
			!finding.paragraphId || finding.paragraphId === paragraph.id
				? [{ finding, index }]
				: [],
		)
		const local = relevant.map(({ finding }) => finding)
		const localPrompt = alignmentPrompt([paragraph], body, local, true)
		// Check the actual paragraph and body, not the candidate prefix used to find its boundary.
		if (!promptFits(aligner, messages(localPrompt)))
			throw new ContextLimitError(phase)
		const scoped = local.some(({ paragraphId }) => !paragraphId)
			? await align(aligner, localPrompt, [paragraph], body, local, true)
			: [
					{
						paragraphs: [paragraph],
						lines: body,
						targets: addCitedTargets([paragraph], body, local, []),
					},
				]
		for (const group of scoped)
			groups.push({
				...group,
				targets: group.targets.map(({ finding, line }) => ({
					finding: relevant[finding].index,
					line,
				})),
			})
	}
	const used = new Set(
		groups.flatMap(({ targets }) => targets.map(({ finding }) => finding)),
	)
	if (used.size !== findings.length)
		throw new Error('Scene source alignment did not cover all findings')
	return groups
}

function alignmentPrompt(
	paragraphs: readonly SourceParagraph[],
	lines: readonly string[],
	findings: readonly ScopedFinding[],
	partial: boolean,
) {
	return [
		'Map this NVS scene to its cited source. Return only a JSON array of {"paragraphCount":1,"lineCount":1,"targets":[{"finding":0,"line":0}]}.',
		'Each entry takes the next contiguous source paragraphs and draft lines, in order. Cover both lists exactly once. Group consecutive paragraphs if a line adapts them together. Use zero lines for an omitted passage.',
		'Assign each finding to every overlapping zero-based local draft line, repeating its finding index for multiple lines. Use line 0 in a group with no draft lines. A finding with a paragraph ID must be assigned to a group containing that paragraph.',
		...(partial
			? [
					'This is a source excerpt. Do not assign a style finding that only applies to another excerpt.',
				]
			: []),
		`Source: ${JSON.stringify(partial || paragraphs.length > 1 ? paragraphs : paragraphs.map(({ id }) => ({ id })))}`,
		`Draft lines: ${JSON.stringify(lines)}`,
		`Findings: ${JSON.stringify(findings)}`,
	].join('\n')
}

async function paragraphBoundary(
	model: Model,
	paragraph: SourceParagraph,
	lines: readonly string[],
) {
	if (!lines.length) return 0
	const render = (prefix: readonly string[]) =>
		[
			'Find the source boundary. Return only {"lineCount":0,"complete":true}.',
			'Count consecutive leading draft lines that adapt this source paragraph. Later lines are lookahead, not part of this paragraph. Return zero if this paragraph is omitted. Use complete=false only if more lines for this paragraph follow beyond this window.',
			`Paragraph: ${JSON.stringify(paragraph)}`,
			`Draft prefix: ${JSON.stringify(prefix)}`,
		].join('\n')
	let to = 1
	while (
		to < lines.length &&
		promptFits(model, messages(render(lines.slice(0, to + 1))))
	)
		to++
	const result = await model.request(
		messages(render(lines.slice(0, to))),
		phase,
	)
	const checked = boundary.validate(parsePlan(textOf(result)))
	if (!checked.ok || checked.value.lineCount > to)
		throw new Error(
			'Scene source alignment returned an invalid paragraph boundary',
		)
	if (!checked.value.complete) throw new ContextLimitError(phase)
	return checked.value.lineCount
}

function parsePlan(text: string): unknown {
	try {
		return parseModelJson(text)
	} catch {
		throw new Error('Scene source alignment returned invalid JSON')
	}
}

function addCitedTargets(
	paragraphs: readonly SourceParagraph[],
	lines: readonly string[],
	findings: readonly ScopedFinding[],
	targets: Target[],
) {
	const merged = new Map(
		targets.map((target) => [`${target.finding}:${target.line}`, target]),
	)
	for (const [finding, { paragraphId, quote }] of findings.entries()) {
		if (!paragraphId || !paragraphs.some(({ id }) => id === paragraphId))
			continue
		const overlapping =
			paragraphs.length === 1
				? (lines.length ? lines : ['']).map((_, line) => line)
				: quote
					? quotedLines(lines, quote)
					: []
		for (const line of overlapping)
			merged.set(`${finding}:${line}`, { finding, line })
	}
	return [...merged.values()]
}

function quotedLines(lines: readonly string[], quote: string) {
	const spans: { from: number; to: number; line: number }[] = []
	let draft = ''
	for (const [line, raw] of lines.entries()) {
		const text = raw
			.replace(/^([^@]*?:\s*|@caption\s+)/, '')
			.replace(/\s+#[0-9a-f]{4}$/, '')
			.replace(/\s+cont$/, '')
			.trim()
			.replace(/\s+/g, ' ')
		if (!text || text.startsWith('@')) continue
		if (draft) draft += ' '
		const from = draft.length
		draft += text
		spans.push({ from, to: draft.length, line })
	}
	const needle = quote.trim().replace(/\s+/g, ' ')
	const matched = new Set<number>()
	if (!needle) return []
	for (
		let from = draft.indexOf(needle);
		from !== -1;
		from = draft.indexOf(needle, from + 1)
	)
		for (const span of spans)
			if (span.from < from + needle.length && span.to > from)
				matched.add(span.line)
	return [...matched]
}

async function align(
	model: Model,
	prompt: string,
	paragraphs: readonly SourceParagraph[],
	lines: readonly string[],
	findings: readonly ScopedFinding[],
	partial: boolean,
) {
	const result = await model.request(messages(prompt), phase)
	const checked = plan.validate(parsePlan(textOf(result)))
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
				line >= Math.max(1, body.length) ||
				(item.paragraphId && !cited.some(({ id }) => id === item.paragraphId))
			)
				throw new Error(
					'Scene source alignment returned an invalid finding target',
				)
		}
		const overlaps = addCitedTargets(cited, body, findings, targets)
		for (const target of overlaps) used.add(target.finding)
		return { paragraphs: cited, lines: body, targets: overlaps }
	})
	if (
		paragraphIndex !== paragraphs.length ||
		lineIndex !== lines.length ||
		(!partial && used.size !== findings.length)
	)
		throw new Error(
			'Scene source alignment did not cover the draft, source, and findings',
		)
	return groups
}
