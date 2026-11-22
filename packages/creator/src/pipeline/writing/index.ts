import { defaultWorkSettings, type WorkSettings } from '@novelive/format/model'
import {
	type CompileOptions,
	compileScript,
	type Diagnostic,
	formatScene,
	type Scene,
} from '@novelive/format/script'
import type { TextConnection } from '../../models/text'
import {
	TruncatedWritingError,
	textOf,
	userMessage,
	type WritingTransport,
	writingModel,
} from './request'
import {
	type FidelityIssue,
	type ReviewContext,
	reviewFidelity,
	reviewStyle,
	type SourceParagraph,
	splitText,
} from './review'

export type Continuity =
	| { kind: 'none' }
	| { kind: 'previous'; ending: string }
	| { kind: 'preview-summary'; summary: string }

export type WritingChapter = ReviewContext & {
	chapterId: string
	language: string
	continuity: Continuity
	settings?: WorkSettings
	redLines?: readonly string[]
	preset?: string
}

export type WriterOptions = WritingTransport & {
	writer: TextConnection
	reviewer: TextConnection
	script: Omit<CompileOptions, 'paragraphIds'>
}

const adaptation = {
	faithful: 'Preserve sentence order; split sentences without removing facts.',
	balanced:
		'Use 1–3 lines per source paragraph and aim for 30–70 characters per line.',
	condensed:
		'Use 0–2 short narration lines per source paragraph, around 15–45 characters each; still account for every source paragraph.',
}
const density = {
	loose: 'Leave most staging to the art director; note only essential cues.',
	standard:
		'Suggest visual beats when the location, mood or action materially changes.',
	aggressive:
		'Suggest frequent text-compatible performance beats at actionable moments.',
}
const grammar = [
	'Return only Novelive NVS text, without IDs. Every complete scene starts with scene <title> on one line, then source pNNNN-pNNNN (or source pNNNN for one paragraph).',
	'Write narration as ": text", dialogue as "speaker-id: text", and first-person internal speech as "speaker-id (inner): text". Do not invent story events or asset names. Leave background and sprite commands to the art director.',
	'End at a complete scene boundary. Cover the provided paragraph range exactly once in order; do not use context-only text as source.',
].join('\n')

function brief(chapter: WritingChapter, speakers: string[]) {
	const settings = chapter.settings ?? defaultWorkSettings()
	const link = chapter.continuity
	const redLines = (chapter.redLines ?? []).join('\n')
	return {
		instructions: [
			...(redLines ? [`RED LINES (mandatory):\n${redLines}`] : []),
			`Write a visual novel adaptation in ${chapter.language}.`,
			grammar,
			`Adaptation: ${adaptation[settings.adaptation]}`,
			`Performance density: ${density[settings.stagingDensity]}`,
			`Allowed speaker IDs: ${speakers.join(', ') || '(none; use narration)'}`,
			`Requirements: ${settings.requirements}`,
			`Rules: ${[...settings.rules, ...(settings.chapterRules[chapter.chapterId] ?? [])].join('; ')}`,
			`Writer style preset: ${chapter.preset ?? ''}`,
			`Bible: ${chapter.bible ?? ''}`,
			`Glossary: ${JSON.stringify(chapter.terms ?? {})}`,
			...(link.kind === 'previous'
				? [`Previous chapter's published ending (context only): ${link.ending}`]
				: link.kind === 'preview-summary'
					? [
							`Previous chapter's preview summary (context only): ${link.summary}`,
						]
					: []),
		].join('\n'),
		end: redLines ? `\nRED LINES (mandatory):\n${redLines}` : '',
	}
}

function source(paragraphs: readonly SourceParagraph[]) {
	return paragraphs.map(({ id, text }) => `${id}: ${text}`).join('\n')
}

export class ScriptDiagnosticsError extends Error {
	constructor(readonly diagnostics: Diagnostic[]) {
		super(
			'Chapter script failed validation: ' +
				diagnostics.map(({ code }) => code).join(', '),
		)
	}
}

function clean(text: string) {
	return text
		.replace(/^\uFEFF/, '')
		.replace(/\r\n?/g, '\n')
		.trim()
		.replace(/^```(?:nvs|text|txt)?[^\S\n]*\n([\s\S]*?)\n```$/i, '$1')
}

type Writer = ReturnType<typeof writingModel>
const rawScenes = (script: string) =>
	script.split(/\n(?=[^\S\n]*scene(?:\s|$))/)
function sourceBounds(chunk: string, paragraphs: readonly SourceParagraph[]) {
	const range = chunk.match(/^\s*source\s+(p\d+)(?:-(p\d+))?\s*$/m)
	return [
		paragraphs.findIndex(({ id }) => id === range?.[1]),
		paragraphs.findIndex(({ id }) => id === (range?.[2] ?? range?.[1])),
	]
}
function ask(model: Writer, prompt: string) {
	if (Buffer.byteLength(prompt) > model.inputLimit)
		throw new Error('Writer input exceeds its configured context window')
	return model
		.request({ messages: [userMessage(prompt)] })
		.then((result) => clean(textOf(result)))
}

async function validate(
	model: Writer,
	text: string,
	options: CompileOptions,
	paragraphs: readonly SourceParagraph[],
	instructions: ReturnType<typeof brief>,
) {
	let chunks = rawScenes(text)
	const attempts = new Map<number, number>()
	for (;;) {
		const compiled = compileScript(chunks.join('\n'), options)
		if (compiled.ok) return compiled
		const first = compiled.diagnostics.find(({ code }) => code.startsWith('E_'))
		if (!first) throw new ScriptDiagnosticsError(compiled.diagnostics)
		let offset = 0
		const target = chunks.findIndex((chunk) => {
			offset += chunk.split('\n').length
			return first.line <= offset
		})
		const index = target === -1 ? chunks.length - 1 : target
		const count = attempts.get(index) ?? 0
		if (count === 3) throw new ScriptDiagnosticsError(compiled.diagnostics)
		attempts.set(index, count + 1)
		const start = offset - chunks[index].split('\n').length + 1
		const errors = compiled.diagnostics.filter(
			({ line }) => line >= start && line <= offset,
		)
		const [from, to] = sourceBounds(chunks[index], paragraphs)
		const coverage = errors.some(({ code }) => code === 'E_SOURCE_COVERAGE')
		const previousEnd =
			index > 0 ? sourceBounds(chunks[index - 1], paragraphs)[1] : -1
		const startOfGap = coverage ? Math.min(previousEnd + 1, from) : from
		const endOfGap =
			coverage && index === chunks.length - 1 ? paragraphs.length - 1 : to
		const repair = await ask(
			model,
			[
				instructions.instructions,
				'Repair only the supplied scene. Return exactly one complete scene, keeping its narrative and valid IDs.',
				`Diagnostics: ${JSON.stringify(errors)}`,
				`Valid paragraph IDs: ${paragraphs.map(({ id }) => id).join(', ')}`,
				...(startOfGap >= 0 && endOfGap >= startOfGap
					? [source(paragraphs.slice(startOfGap, endOfGap + 1))]
					: []),
				chunks[index],
				instructions.end,
			].join('\n'),
		)
		if (rawScenes(repair).length === 1) {
			chunks = chunks.map((chunk, i) => (i === index ? repair : chunk))
		}
	}
}

export async function writeChapter(
	chapter: WritingChapter,
	options: WriterOptions,
) {
	const model = writingModel(options.writer, options)
	const speakers = [...options.script.speakers]
	const instructions = brief(chapter, speakers)
	const compileOptions = {
		...options.script,
		speakers,
		paragraphIds: chapter.paragraphs.map(({ id }) => id),
	}
	const staged: string[] = []
	const paragraphs = chapter.paragraphs
	if (!paragraphs.length)
		throw new Error('Writing requires at least one source paragraph')
	const prompt = (batch: readonly SourceParagraph[]) =>
		[
			instructions.instructions,
			`Previous segment ending (context only): ${staged.at(-1)?.slice(-400) ?? ''}`,
			'Source paragraphs:',
			source(batch),
			instructions.end,
		].join('\n')
	const outputEstimate = (batch: readonly SourceParagraph[]) =>
		batch.reduce(
			(total, { text }) =>
				total +
				24 +
				Math.ceil(
					Buffer.byteLength(text) /
						(chapter.settings?.adaptation === 'faithful' ? 2 : 3),
				),
			0,
		)
	async function writeBatch(batch: readonly SourceParagraph[]) {
		let draft: string
		try {
			draft = await ask(model, prompt(batch))
		} catch (error) {
			if (!(error instanceof TruncatedWritingError) || batch.length < 2)
				throw error
			const middle = Math.floor(batch.length / 2)
			await writeBatch(batch.slice(0, middle))
			await writeBatch(batch.slice(middle))
			return
		}
		const compiled = await validate(
			model,
			draft,
			{
				...compileOptions,
				paragraphIds: batch.map(({ id }) => id),
				sceneIds: undefined,
			},
			batch,
			instructions,
		)
		staged.push(...compiled.scenes.map(({ scene }) => formatScene(scene)))
	}
	for (let from = 0; from < paragraphs.length; ) {
		let to = from + 1
		while (to < paragraphs.length) {
			const batch = paragraphs.slice(from, to + 1)
			if (
				Buffer.byteLength(prompt(batch)) > model.inputLimit ||
				outputEstimate(batch) > model.outputTokens
			)
				break
			to++
		}
		await writeBatch(paragraphs.slice(from, to))
		from = to
	}
	return validate(
		model,
		staged.join('\n\n'),
		compileOptions,
		paragraphs,
		instructions,
	)
}

export async function reviewChapter(
	chapter: WritingChapter,
	draft: Awaited<ReturnType<typeof writeChapter>>,
	options: WriterOptions,
) {
	const settings = chapter.settings ?? defaultWorkSettings()
	const script = draft.scenes
		.map(({ scene }) => formatScene(scene))
		.join('\n\n')
	if (!settings.fidelityReview && !settings.styleReview)
		return {
			...draft,
			fidelity: [] as FidelityIssue[],
			style: [] as string[],
			revised: false,
		}
	const reviewer = writingModel(options.reviewer, options)
	const fidelity: FidelityIssue[] = []
	if (settings.fidelityReview) {
		for (const { scene } of draft.scenes) {
			const from = chapter.paragraphs.findIndex(
				({ id }) => id === scene.source.from,
			)
			const to = chapter.paragraphs.findIndex(
				({ id }) => id === scene.source.to,
			)
			fidelity.push(
				...(await reviewFidelity(
					reviewer,
					{
						...chapter,
						paragraphs: chapter.paragraphs.slice(from, to + 1),
					},
					formatScene(scene),
				)),
			)
		}
	}
	const style = settings.styleReview ? await reviewStyle(reviewer, script) : []
	if (!fidelity.length && !style.length)
		return { ...draft, fidelity, style, revised: false }
	const writer = writingModel(options.writer, options)
	const speakers = [...options.script.speakers]
	const instructions = brief(chapter, speakers)
	const parts: string[] = []
	const previous: Scene[] = []
	const sceneIds: string[] = []
	for (const { scene } of draft.scenes) {
		const from = chapter.paragraphs.findIndex(
			({ id }) => id === scene.source.from,
		)
		const to = chapter.paragraphs.findIndex(({ id }) => id === scene.source.to)
		const paragraphs = chapter.paragraphs.slice(from, to + 1)
		const issues = fidelity.filter(({ paragraphId }) =>
			paragraphs.some(({ id }) => id === paragraphId),
		)
		const script = formatScene(scene)
		const revised =
			issues.length || style.length
				? await reviseScene(
						writer,
						instructions.end,
						script,
						paragraphs,
						issues,
						style,
					)
				: script
		if (scene.id) sceneIds[previous.length] = scene.id
		for (const [index, part] of rawScenes(revised).entries()) {
			parts.push(part)
			previous.push(
				index === 0 ? scene : { ...scene, id: undefined, title: '', lines: [] },
			)
		}
	}
	const output = await validate(
		writer,
		parts.join('\n\n'),
		{
			...options.script,
			speakers,
			paragraphIds: chapter.paragraphs.map(({ id }) => id),
			previous,
			sceneIds,
		},
		chapter.paragraphs,
		instructions,
	)
	return { ...output, fidelity, style, revised: true }
}

async function reviseScene(
	writer: Writer,
	redLines: string,
	script: string,
	paragraphs: SourceParagraph[],
	fidelity: FidelityIssue[],
	style: string[],
) {
	const findings = `Fidelity issues: ${JSON.stringify(fidelity)}\nStyle issues: ${JSON.stringify(style)}`
	const original = source(paragraphs)
	const render = (
		instruction: string,
		issues: string,
		text: string,
		draft: string,
	) =>
		`${redLines}\n${instruction}\n${issues}\nSource:\n${text}\nDraft:\n${draft}${redLines}`
	const whole = render(
		'Revise this NVS scene once. Preserve the original source coverage and IDs for retained lines. Return only complete NVS scenes.',
		findings,
		original,
		script,
	)
	if (Buffer.byteLength(whole) <= writer.inputLimit) return ask(writer, whole)

	const instruction =
		'Revise this fragment of an NVS scene once. Return only its body lines (no scene or source header). Preserve IDs for retained lines.'
	const budget = Math.floor(
		(writer.inputLimit - Buffer.byteLength(render(instruction, '', '', ''))) /
			3,
	)
	if (budget < 16) throw new Error('Insufficient context for a scene revision')
	const [heading, range, , ...lines] = script.trimEnd().split('\n')
	const splitLines: string[] = []
	for (const line of lines) {
		const last = splitLines.at(-1) ?? ''
		if (last && Buffer.byteLength(`${last}\n${line}`) <= budget)
			splitLines[splitLines.length - 1] = `${last}\n${line}`
		else splitLines.push(...splitText(line, budget))
	}
	const splitSource = splitText(original, budget)
	const splitFindings = splitText(findings, budget)
	const count = Math.max(
		splitLines.length,
		splitSource.length,
		splitFindings.length,
	)
	const at = (chunks: string[], i: number) =>
		chunks[Math.floor((i * chunks.length) / count)] ?? ''
	const revised: string[] = []
	for (let i = 0; i < count; i++) {
		const repeated =
			i > 0 &&
			Math.floor((i * splitLines.length) / count) ===
				Math.floor(((i - 1) * splitLines.length) / count)
		revised.push(
			await ask(
				writer,
				render(
					instruction,
					at(splitFindings, i),
					at(splitSource, i),
					repeated ? '' : at(splitLines, i),
				),
			),
		)
	}
	return [heading, range, '', ...revised].join('\n')
}
