import type { Message, Tool } from '@earendil-works/pi-ai'
import { arr, compile, obj, oneOf, str } from '@earendil-works/pi-schema'
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

export async function reviewFidelity(
	model: ReturnType<typeof writingModel>,
	chapter: ReviewContext,
	script: string,
) {
	const messages: Message[] = [
		userMessage(
			[
				'Check source fidelity only: omissions, inventions, changed dialogue, speaker attribution, downgraded inner speech, sequence, and Bible contradictions. Do not review prose style.',
				'Use read_source_range to check the source. Each issue must cite a non-blank verbatim quote inside the named paragraph. Call submit_review when done, even if there are zero issues.',
				`Source paragraph IDs: ${chapter.paragraphs.map(({ id }) => id).join(', ')}`,
				script,
			].join('\n'),
		),
	]
	for (let turn = 0; turn < 8; turn++) {
		const result = await model.request({ messages, tools })
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
					value = chapter.bible ?? ''
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
			messages.push({
				role: 'toolResult',
				toolCallId: part.id,
				toolName: part.name,
				isError: error !== undefined,
				content: [{ type: 'text', text: error ?? JSON.stringify(value) }],
				timestamp: 0,
			})
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
	const response = textOf(
		await model.request({
			messages: [
				userMessage(
					`Review prose style only (voice, rhythm and wording). Do not evaluate fidelity or plot. Return JSON {"issues":["..."]}; use an empty array when no issues.\n${script}`,
				),
			],
		}),
	)
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
