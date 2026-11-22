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

function splitText(text: string, limit: number) {
	const parts: string[] = []
	let part = ''
	let size = 0
	for (const char of text) {
		const bytes = Buffer.byteLength(char)
		if (size + bytes > limit && part) {
			parts.push(part)
			part = ''
			size = 0
		}
		part += char
		size += bytes
	}
	if (part) parts.push(part)
	return parts
}

const sizeOf = (value: unknown) => Buffer.byteLength(JSON.stringify(value))
const toolsSize = sizeOf(tools)

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
	const available =
		model.inputLimit -
		toolsSize -
		sizeOf(fidelityPrompt({ paragraphs: [] }, '', true)) -
		320
	if (available < 128) throw new Error('Insufficient fidelity review context')
	const window = Math.floor(available / 3)
	if (sizeOf(script) <= window && sizeOf(chapter.paragraphs) <= window)
		return reviewWindow(model, chapter, script, false)

	const scripts = splitText(script, Math.max(16, Math.floor(window / 2)))
	const windows: SourceParagraph[][] = []
	let batch: SourceParagraph[] = []
	for (const paragraph of chapter.paragraphs) {
		for (const text of splitText(
			paragraph.text,
			Math.max(16, Math.floor(window / 4)),
		)) {
			const part = { ...paragraph, text }
			if (
				batch.length &&
				(batch.some(({ id }) => id === part.id) ||
					sizeOf([...batch, part]) > window)
			) {
				windows.push(batch)
				batch = []
			}
			batch.push(part)
		}
	}
	if (batch.length || !windows.length) windows.push(batch)
	const count = Math.max(scripts.length, windows.length)
	const issues = new Map<string, FidelityIssue>()
	for (let i = 0; i < count; i++) {
		const scenePart = scripts[Math.floor((i * scripts.length) / count)] ?? ''
		const paragraphs = windows[Math.floor((i * windows.length) / count)]
		for (const issue of await reviewWindow(
			model,
			{ ...chapter, paragraphs },
			scenePart,
			true,
		))
			issues.set(JSON.stringify(issue), issue)
	}
	return [...issues.values()]
}

function messageSize(message: Message) {
	return message.role === 'assistant'
		? sizeOf(message.content.filter(({ type }) => type !== 'thinking')) + 64
		: sizeOf(message)
}

async function reviewWindow(
	model: ReturnType<typeof writingModel>,
	chapter: ReviewContext,
	script: string,
	partial: boolean,
) {
	const messages: Message[] = [
		userMessage(fidelityPrompt(chapter, script, partial)),
	]
	const remaining = () =>
		model.inputLimit -
		toolsSize -
		messages.reduce((bytes, message) => bytes + messageSize(message), 0)
	for (let turn = 0; turn < 8; turn++) {
		if (remaining() < 0)
			throw new Error(
				'Fidelity review exceeded its context budget without submitting',
			)
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
			const reply = error ?? JSON.stringify(value)
			const fits = sizeOf(reply) + 240 <= remaining()
			messages.push({
				role: 'toolResult',
				toolCallId: part.id,
				toolName: part.name,
				isError: error !== undefined || !fits,
				content: [
					{
						type: 'text',
						text: fits
							? reply
							: 'Tool result exceeds the remaining context. Request a smaller range or submit now.',
					},
				],
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
