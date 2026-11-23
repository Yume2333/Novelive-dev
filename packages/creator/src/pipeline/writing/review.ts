import type { Message, Tool } from '@earendil-works/pi-ai'
import { arr, compile, obj, oneOf, str } from '@earendil-works/pi-schema'
import { paragraphIdPattern } from '@novelive/format/model'
import { ContextLimitError, fitUnits, promptFits } from './budget'
import { requestWritingJson, userMessage, type writingModel } from './request'
import {
	type SourceParagraph,
	sceneBody,
	scopedScene,
	scopeScene,
} from './scope'

export type { SourceParagraph } from './scope'

const categories = [
	'omission',
	'invention',
	'dialogue',
	'speaker',
	'inner',
	'sequence',
	'bible',
] as const
const reviewIssue = obj({
	category: oneOf(categories),
	paragraphId: str(),
	quote: str(),
	issue: str({ minLength: 1 }),
})
const review = compile(obj({ issues: arr(reviewIssue) }))
const style = compile(obj({ issues: arr(str({ minLength: 1 })) }))
const overflow =
	'Tool result exceeds the remaining context. Request a smaller range or submit now.'
type Issue = (typeof categories)[number]
export type FidelityIssue = {
	category: Issue
	paragraphId: string
	quote: string
	issue: string
}
export type ReviewContext = {
	paragraphs: readonly SourceParagraph[]
	terms?: Readonly<Record<string, string>>
	preview?: string
	bible?: string
}

const strings = (...names: string[]) => ({
	type: 'object',
	properties: Object.fromEntries(
		names.map((name) => [name, { type: 'string' }]),
	),
	required: names,
})
const tools: Tool[] = [
	{
		name: 'read_source_range',
		description: 'Read the inclusive range of chapter paragraph IDs.',
		parameters: strings('from', 'to'),
	},
	{
		name: 'find_term',
		description: 'Look up an original term.',
		parameters: strings('term'),
	},
	{
		name: 'read_chapter_preview',
		description: 'Read the current chapter preview summary.',
		parameters: strings(),
	},
	{
		name: 'read_bible',
		description: 'Read the relevant Bible context.',
		parameters: strings(),
	},
]

function citationTool(paragraphIds: string[], usePattern: boolean): Tool {
	return {
		name: 'submit_review',
		description: 'Submit all source-grounded issues, or an empty issue list.',
		parameters: {
			type: 'object',
			properties: {
				issues: {
					type: 'array',
					items: {
						...strings('category', 'paragraphId', 'quote', 'issue'),
						properties: {
							...strings('paragraphId', 'quote', 'issue').properties,
							paragraphId: {
								type: 'string',
								...(usePattern
									? { pattern: paragraphIdPattern }
									: paragraphIds.length
										? { enum: paragraphIds }
										: {}),
							},
							category: { type: 'string', enum: categories },
						},
					},
				},
			},
			required: ['issues'],
		},
	}
}

function reviewTools(chapter: ReviewContext, usePattern = false) {
	const scoped = tools.map((tool) => {
		if (
			tool.name === 'read_bible' &&
			(chapter.bible || Object.keys(chapter.terms ?? {}).length)
		)
			return {
				...tool,
				description:
					'Read Bible context. Select a Markdown section, an entry ID, or an inclusive glossary range (section=glossary, from/to are term keys).',
				parameters: {
					...strings('section', 'entry', 'from', 'to'),
					required: [],
				},
			}
		return tool
	})
	return [
		...scoped,
		citationTool(
			chapter.paragraphs.map(({ id }) => id),
			usePattern,
		),
	]
}

function bibleSection(bible: string, selector: string) {
	const lines = bible.split('\n')
	const headings = lines.map((line) => line.match(/^(#{1,6})\s+(.+?)\s*#*$/))
	const start = headings.findIndex(
		(heading) =>
			heading?.[2].toLowerCase() === selector.toLowerCase() ||
			heading?.[2].split(/\s+/).includes(selector),
	)
	const startHeading = headings[start]
	if (!startHeading) return undefined
	const end = headings.findIndex(
		(heading, index) =>
			index > start &&
			heading !== null &&
			heading[1].length <= startHeading[1].length,
	)
	return lines.slice(start, end < 0 ? undefined : end).join('\n')
}

function selectBible(chapter: ReviewContext, args: Record<string, unknown>) {
	const section = typeof args.section === 'string' ? args.section : undefined
	const entry = typeof args.entry === 'string' ? args.entry : undefined
	if (section?.toLowerCase() === 'glossary') {
		const entries = Object.entries(chapter.terms ?? {})
		const from =
			args.from === undefined
				? 0
				: entries.findIndex(([key]) => key === args.from)
		const to =
			args.to === undefined
				? entries.length - 1
				: entries.findIndex(([key]) => key === args.to)
		if (entry !== undefined)
			return Object.fromEntries(entries.filter(([key]) => key === entry))
		if (from < 0 || (args.to !== undefined && to < from)) return undefined
		return Object.fromEntries(entries.slice(from, to + 1))
	}
	if (args.from !== undefined || args.to !== undefined) return undefined
	const bible = chapter.bible ?? ''
	const selected = section ? bibleSection(bible, section) : bible
	return entry && selected !== undefined
		? (bibleSection(selected, entry) ??
				selected
					.split('\n')
					.find((line) => line.split(/[\s|:]+/).includes(entry)))
		: selected
}

function fidelityPrompt(
	chapter: ReviewContext,
	script: string,
	partial: boolean,
) {
	return [
		'Review fidelity, not style: omissions, inventions, dialogue, speakers, inner speech, sequence, Bible contradictions.',
		'Use submit_review even with no issues.',
		'Source text (via read_source_range): cite a source paragraph ID and a verbatim quote.',
		`Source paragraph IDs: ${chapter.paragraphs.map(({ id }) => id).join(', ')}`,
		...(partial
			? [
					'Scene excerpt: report only supported findings; do not infer omissions at excerpt boundaries.',
				]
			: []),
		'Draft script (comparison only): never cite draft line IDs or text.',
		script,
	].join('\n')
}

export async function reviewFidelity(
	model: ReturnType<typeof writingModel>,
	chapter: ReviewContext,
	script: string,
	aligner: () => ReturnType<typeof writingModel>,
) {
	const { heading } = sceneBody(script)
	const fits = (
		paragraphs: readonly SourceParagraph[],
		draft: string,
		partial: boolean,
		usePattern = false,
	) => {
		const id = 'call_'.padEnd(64, 'x')
		const name = 'read_source_range'
		const argumentsSize =
			Buffer.byteLength(
				JSON.stringify({
					role: 'assistant',
					content: [
						{
							type: 'toolCall',
							id,
							name,
							arguments: { from: paragraphs[0]?.id, to: paragraphs.at(-1)?.id },
						},
					],
				}),
			) + 1
		const limits = { ...model, inputLimit: model.inputLimit - argumentsSize }
		return [JSON.stringify(paragraphs), overflow].every((reply) =>
			promptFits(limits, {
				tools: reviewTools({ ...chapter, paragraphs }, usePattern),
				messages: [
					userMessage(
						fidelityPrompt({ ...chapter, paragraphs }, draft, partial),
					),
					toolResult(id, name, reply),
				],
			}),
		)
	}
	if (fits(chapter.paragraphs, script, false))
		return reviewWindow(model, chapter, script, false)

	const issues = new Map<string, FidelityIssue>()
	for (const { paragraphs, lines } of await scopeScene(
		aligner,
		script,
		chapter.paragraphs,
	)) {
		const excerpt = (body: readonly string[]) =>
			scopedScene(heading, paragraphs, body)
		const whole = excerpt(lines)
		const wholeFits = fits(paragraphs, whole, false)
		if (
			wholeFits ||
			(lines.length <= 1 && fits(paragraphs, whole, false, true))
		) {
			for (const issue of await reviewWindow(
				model,
				{ ...chapter, paragraphs },
				whole,
				false,
				!wholeFits,
			))
				issues.set(JSON.stringify(issue), issue)
			continue
		}
		for (const body of fitUnits(
			lines.length ? lines : [''],
			(batch) =>
				fits(paragraphs, excerpt(batch), true) ||
				(batch.length === 1 && fits(paragraphs, excerpt(batch), true, true)),
			'Fidelity scene line',
		)) {
			const draft = excerpt(body)
			for (const issue of await reviewWindow(
				model,
				{ ...chapter, paragraphs },
				draft,
				true,
				!fits(paragraphs, draft, true),
			))
				issues.set(JSON.stringify(issue), issue)
		}
	}
	return [...issues.values()]
}

function toolResult(
	id: string,
	name: string,
	text: string,
	isError = false,
): Message {
	return {
		role: 'toolResult',
		toolCallId: id,
		toolName: name,
		isError,
		content: [{ type: 'text', text }],
		timestamp: 0,
	}
}

async function reviewWindow(
	model: ReturnType<typeof writingModel>,
	chapter: ReviewContext,
	script: string,
	partial: boolean,
	usePattern = false,
) {
	const activeTools = reviewTools(chapter, usePattern)
	const messages: Message[] = [
		userMessage(fidelityPrompt(chapter, script, partial)),
	]
	for (let turn = 0; turn < 8; turn++) {
		const result = await model.request(
			{ messages, tools: activeTools },
			'Fidelity review',
		)
		messages.push(result)
		let submitted: FidelityIssue[] | undefined
		let rejected = false
		for (const part of result.content) {
			if (part.type !== 'toolCall') continue
			const args = part.arguments
			let value: unknown
			let error: string | undefined
			switch (part.name) {
				case 'read_source_range': {
					const from = chapter.paragraphs.findIndex(
						({ id }) => id === args.from,
					)
					const to = chapter.paragraphs.findIndex(({ id }) => id === args.to)
					if (from < 0 || to < from) {
						const nearby = chapter.paragraphs.slice(
							Math.max(from - 1, 0),
							Math.max(from + 2, 3),
						)
						error = `Invalid source range; nearby IDs: ${nearby.map(({ id }) => id).join(', ')}`
					} else value = chapter.paragraphs.slice(from, to + 1)
					break
				}
				case 'find_term':
					value =
						typeof args.term === 'string' &&
						chapter.terms &&
						Object.hasOwn(chapter.terms, args.term)
							? chapter.terms[args.term]
							: null
					break
				case 'read_chapter_preview':
					value = chapter.preview ?? ''
					break
				case 'read_bible':
					value = selectBible(chapter, args)
					if (value === undefined)
						error =
							'Bible selector not found; use a section, entry, or glossary range.'
					break
				case 'submit_review': {
					const checked = review.validate(args)
					if (!checked.ok)
						error = 'Submit issues with category, paragraphId, quote and issue.'
					else {
						const invalid = checked.value.issues.find(
							({ paragraphId, quote }) =>
								!quote.trim() ||
								!chapter.paragraphs.some(
									({ id, text }) => id === paragraphId && text.includes(quote),
								),
						)
						if (invalid) {
							const index = chapter.paragraphs.findIndex(
								({ id }) => id === invalid.paragraphId,
							)
							const nearby = chapter.paragraphs.slice(
								Math.max(index - 1, 0),
								Math.max(index + 2, 3),
							)
							const sourceIds = nearby.map(({ id }) => id).join(', ')
							error =
								index < 0 && /^#?[0-9a-f]{4}$/i.test(invalid.paragraphId)
									? `You cited draft line #${invalid.paragraphId.replace(/^#/, '')}; cite source paragraph IDs (${sourceIds}) with text quoted verbatim from the source. Use read_source_range to read those paragraphs.`
									: `Quote not found in ${invalid.paragraphId}; use read_source_range for nearby IDs ${sourceIds}.`
						} else {
							submitted = checked.value.issues
							value = 'Accepted'
						}
					}
					rejected ||= error !== undefined
					break
				}
				default:
					error = 'Unknown review tool.'
			}
			const reply = toolResult(
				part.id,
				part.name,
				error ?? JSON.stringify(value),
				error !== undefined,
			)
			messages.push(
				promptFits(model, {
					messages: [...messages, reply],
					tools: activeTools,
				})
					? reply
					: toolResult(
							part.id,
							part.name,
							part.name === 'read_bible'
								? 'Bible result exceeds the remaining context. Use read_bible with a section, entry, or glossary range.'
								: overflow,
							true,
						),
			)
		}
		if (submitted && !rejected) return submitted
		if (result.stopReason !== 'toolUse')
			messages.push(
				userMessage(
					'Use the submit_review tool to finish; plain text is not a submission.',
				),
			)
		if (turn === 5)
			messages.push(
				userMessage(
					'Review budget is nearly exhausted. Submit the verified issues now.',
				),
			)
	}
	throw new Error(
		'Fidelity review did not submit valid source citations within its request budget',
	)
}

export async function reviewStyle(
	model: ReturnType<typeof writingModel>,
	script: string,
) {
	const prompt = (draft: string) =>
		`Review prose style only (voice, rhythm and wording). Do not evaluate fidelity or plot. Return JSON {"issues":["..."]}; use an empty array when no issues.\n${draft}`
	const fits = (draft: string) =>
		promptFits(model, { messages: [userMessage(prompt(draft))] })
	const request = (draft: string, phase: string) =>
		requestWritingJson(
			model,
			prompt(draft),
			phase,
			(value) => {
				const checked = style.validate(value)
				return checked.ok ? checked.value.issues : undefined
			},
			'Style review returned invalid issues',
		)
	if (fits(script)) return request(script, 'Style review')
	const [heading, range, , ...lines] = script.trimEnd().split('\n')
	const excerpt = (body: readonly string[]) =>
		[heading, range, '', ...body].join('\n')
	const issues = new Set<string>()
	if (!lines.length) throw new ContextLimitError('Style review')
	for (const body of fitUnits(
		lines,
		(batch) => fits(excerpt(batch)),
		'Style review line',
	))
		for (const issue of await request(excerpt(body), 'Style review line'))
			issues.add(issue)
	return [...issues]
}
