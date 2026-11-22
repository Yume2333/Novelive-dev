import type { Message, Tool } from '@earendil-works/pi-ai'
import { arr, compile, obj, oneOf, str } from '@earendil-works/pi-schema'
import { ContextLimitError, fitUnits, promptFits } from './budget'
import { textOf, userMessage, type writingModel } from './request'

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
type Issue = (typeof categories)[number]
export type FidelityIssue = {
	category: Issue
	paragraphId: string
	quote: string
	issue: string
}
export type SourceParagraph = { id: string; text: string }
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
	{
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
							category: { type: 'string', enum: categories },
						},
					},
				},
			},
			required: ['issues'],
		},
	},
]

function reviewTools(chapter: ReviewContext) {
	if (!chapter.bible && !Object.keys(chapter.terms ?? {}).length) return tools
	return tools.map((tool) =>
		tool.name === 'read_bible'
			? {
					...tool,
					description:
						'Read Bible context. Select a Markdown section, an entry ID, or an inclusive glossary range (section=glossary, from/to are term keys).',
					parameters: {
						...strings('section', 'entry', 'from', 'to'),
						required: [],
					},
				}
			: tool,
	)
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
		'Check source fidelity only: omissions, inventions, changed dialogue, speaker attribution, downgraded inner speech, sequence, and Bible contradictions. Do not review prose style.',
		'Use read_source_range to check the source. Each issue must cite a non-blank verbatim quote inside the named paragraph. Call submit_review when done, even if there are zero issues.',
		`Source paragraph IDs: ${chapter.paragraphs.map(({ id }) => id).join(', ')}`,
		...(partial
			? [
					'This is an excerpt of a scene. Only report findings supported by the available script and source; do not infer omissions from the excerpt boundaries.',
				]
			: []),
		script,
	].join('\n')
}

export async function reviewFidelity(
	model: ReturnType<typeof writingModel>,
	chapter: ReviewContext,
	script: string,
) {
	const activeTools = reviewTools(chapter)
	const [heading, source, , ...lines] = script.trimEnd().split('\n')
	const excerpt = (body: readonly string[]) =>
		[heading, source, '', ...body].join('\n')
	const fits = (
		paragraphs: readonly SourceParagraph[],
		draft: string,
		partial: boolean,
	) =>
		promptFits(model, {
			tools: activeTools,
			messages: [
				userMessage(fidelityPrompt({ ...chapter, paragraphs }, draft, partial)),
				toolResult('source', 'read_source_range', JSON.stringify(paragraphs)),
			],
		})
	if (fits(chapter.paragraphs, script, false))
		return reviewWindow(model, chapter, script, false, activeTools)

	const widestLine = lines.reduce(
		(longest, line) =>
			Buffer.byteLength(JSON.stringify(line)) >
			Buffer.byteLength(JSON.stringify(longest))
				? line
				: longest,
		'',
	)
	const issues = new Map<string, FidelityIssue>()
	for (const paragraphs of fitUnits(
		chapter.paragraphs,
		(batch) => fits(batch, excerpt([widestLine]), true),
		'Fidelity source paragraph',
	)) {
		// NVS cites paragraphs at scene level, not line level. Every excerpt
		// retains that citation; do not guess a narrower alignment by position.
		for (const body of fitUnits(
			lines.length ? lines : [''],
			(batch) => fits(paragraphs, excerpt(batch), true),
			'Fidelity scene line',
		)) {
			for (const issue of await reviewWindow(
				model,
				{ ...chapter, paragraphs },
				excerpt(body),
				true,
				activeTools,
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
	activeTools: Tool[],
) {
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
							error = `Quote not found in ${invalid.paragraphId}; use read_source_range for nearby IDs ${nearby.map(({ id }) => id).join(', ')}.`
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
								: 'Tool result exceeds the remaining context. Request a smaller range or submit now.',
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
	const prompt = (draft: string) => ({
		messages: [
			userMessage(
				`Review prose style only (voice, rhythm and wording). Do not evaluate fidelity or plot. Return JSON {"issues":["..."]}; use an empty array when no issues.\n${draft}`,
			),
		],
	})
	if (promptFits(model, prompt(script)))
		return styleIssues(
			textOf(await model.request(prompt(script), 'Style review')),
		)
	const [heading, range, , ...lines] = script.trimEnd().split('\n')
	const excerpt = (body: readonly string[]) =>
		[heading, range, '', ...body].join('\n')
	const issues = new Set<string>()
	if (!lines.length) throw new ContextLimitError('Style review')
	for (const body of fitUnits(
		lines,
		(batch) => promptFits(model, prompt(excerpt(batch))),
		'Style review line',
	))
		for (const issue of styleIssues(
			textOf(await model.request(prompt(excerpt(body)), 'Style review line')),
		))
			issues.add(issue)
	return [...issues]
}

function styleIssues(response: string) {
	let value: unknown
	try {
		value = JSON.parse(
			response.trim().replace(/^```(?:json)?\s*|\s*```$/gi, ''),
		)
	} catch {
		throw new Error('Style review returned invalid JSON')
	}
	const checked = style.validate(value)
	if (!checked.ok) throw new Error('Style review returned invalid issues')
	return checked.value.issues
}
