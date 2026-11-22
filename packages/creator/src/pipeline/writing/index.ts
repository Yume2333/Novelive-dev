import { defaultWorkSettings, type WorkSettings } from '@novelive/format/model'
import {
	type CompileOptions,
	compileScript,
	type Diagnostic,
	formatScene,
	type Scene,
} from '@novelive/format/script'
import type { TextConnection } from '../../models/text'
import { ContextLimitError, fitUnits, promptFits } from './budget'
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
} from './review'
import { sceneBody, scopedScene, scopeScene } from './scope'

export { ContextLimitError } from './budget'

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
	const adaptationRule = `Adaptation: ${adaptation[settings.adaptation]}`
	const requirements = `Requirements: ${settings.requirements}`
	const rules = `Rules: ${[...settings.rules, ...(settings.chapterRules[chapter.chapterId] ?? [])].join('; ')}`
	return {
		instructions: [
			...(redLines ? [`RED LINES (mandatory):\n${redLines}`] : []),
			`Write a visual novel adaptation in ${chapter.language}.`,
			grammar,
			adaptationRule,
			`Performance density: ${density[settings.stagingDensity]}`,
			`Allowed speaker IDs: ${speakers.join(', ') || '(none; use narration)'}`,
			requirements,
			rules,
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
		revision: [adaptationRule, requirements, rules].join('\n'),
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
const userPrompt = (prompt: string) => ({ messages: [userMessage(prompt)] })
function ask(model: Writer, prompt: string, phase: string, outputEstimate = 0) {
	return model
		.request(userPrompt(prompt), phase, outputEstimate)
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
		const cited =
			startOfGap >= 0 && endOfGap >= startOfGap
				? paragraphs.slice(startOfGap, endOfGap + 1)
				: []
		const repair = await repairScene(
			model,
			chunks[index],
			instructions,
			errors,
			start,
			paragraphs,
			cited,
		)
		if (rawScenes(repair).length === 1) {
			chunks = chunks.map((chunk, i) => (i === index ? repair : chunk))
		}
	}
}

async function repairScene(
	model: Writer,
	draft: string,
	instructions: ReturnType<typeof brief>,
	errors: Diagnostic[],
	start: number,
	paragraphs: readonly SourceParagraph[],
	cited: readonly SourceParagraph[],
) {
	const format = (
		instruction: string,
		text: string,
		diagnostics: Diagnostic[],
	) =>
		[
			instructions.instructions,
			instruction,
			`Diagnostics: ${JSON.stringify(diagnostics)}`,
			`Valid paragraph IDs: ${paragraphs.map(({ id }) => id).join(', ')}`,
			...(cited.length ? [source(cited)] : []),
			text,
			instructions.end,
		].join('\n')
	const whole = format(
		'Repair only the supplied scene. Return exactly one complete scene, keeping its narrative and valid IDs.',
		draft,
		errors,
	)
	if (promptFits(model, userPrompt(whole), estimateNvs(draft)))
		return ask(model, whole, 'Scene repair', estimateNvs(draft))

	const lines = draft.split('\n')
	const header = lines.findIndex((line) => /^\s*source\s/.test(line))
	const bad = errors.filter(({ code }) => code.startsWith('E_'))
	if (
		header < 0 ||
		!cited.length ||
		!bad.length ||
		bad.some(({ line }) => line - start <= header)
	)
		throw new ContextLimitError('Scene repair')
	const body = lines
		.slice(header + 1)
		.map((text, i) => ({ text, line: start + header + 1 + i }))
	const render = (units: readonly { text: string; line: number }[]) =>
		format(
			'Repair the supplied body lines, keeping valid IDs. Return only body lines (no scene or source header).',
			units.map(({ text }) => text).join('\n'),
			errors.filter(({ line }) => units.some((unit) => unit.line === line)),
		)
	const corrected = lines.slice(0, header + 1)
	for (const unit of body) {
		if (bad.some(({ line }) => line === unit.line))
			corrected.push(
				await ask(
					model,
					render([unit]),
					'Scene repair',
					estimateNvs(unit.text),
				),
			)
		else corrected.push(unit.text)
	}
	return corrected.join('\n')
}

function estimateNvs(text: string) {
	return 24 + Math.ceil(Buffer.byteLength(text) / 3)
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
			`Previous segment ending (context only): ${staged.at(-1)?.trimEnd().split('\n').at(-1) ?? ''}`,
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
		const currentPrompt = prompt(batch)
		const estimate = outputEstimate(batch)
		const phase = 'Source paragraph adaptation'
		const split = async () => {
			if (batch.length < 2) throw new ContextLimitError(phase)
			const middle = Math.floor(batch.length / 2)
			await writeBatch(batch.slice(0, middle))
			await writeBatch(batch.slice(middle))
		}
		if (!promptFits(model, userPrompt(currentPrompt), estimate)) return split()
		let draft: string
		try {
			draft = await ask(model, currentPrompt, phase, estimate)
		} catch (error) {
			if (
				!(
					error instanceof TruncatedWritingError ||
					error instanceof ContextLimitError
				)
			)
				throw error
			return split()
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
	for (const batch of fitUnits(
		paragraphs,
		(batch) =>
			promptFits(model, userPrompt(prompt(batch)), outputEstimate(batch)),
		'Source paragraph adaptation',
	))
		await writeBatch(batch)
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
	if (!settings.fidelityReview && !settings.styleReview)
		return {
			...draft,
			fidelity: [] as FidelityIssue[],
			style: [] as string[],
			revised: false,
		}
	const reviewer = writingModel(options.reviewer, options)
	let writer: Writer | undefined
	const getWriter = () => (writer ??= writingModel(options.writer, options))
	const aligner = () => {
		const candidate = getWriter()
		return candidate.inputLimit > reviewer.inputLimit ? candidate : reviewer
	}
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
					aligner,
				)),
			)
		}
	}
	const styleByScene = new Map<Scene, string[]>()
	if (settings.styleReview) {
		for (const { scene } of draft.scenes)
			styleByScene.set(scene, await reviewStyle(reviewer, formatScene(scene)))
	}
	const style = [...styleByScene.values()].flat()
	if (!fidelity.length && !style.length)
		return { ...draft, fidelity, style, revised: false }
	const revisionWriter = getWriter()
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
		const styleIssues = styleByScene.get(scene) ?? []
		const revised =
			issues.length || styleIssues.length
				? await reviseScene(
						revisionWriter,
						aligner,
						instructions.revision,
						instructions.end,
						script,
						paragraphs,
						issues,
						styleIssues,
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
		revisionWriter,
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
	aligner: () => Writer,
	rules: string,
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
		`${redLines}\n${instruction}\n${rules}\n${issues}\nSource:\n${text}\nDraft:\n${draft}${redLines}`
	const whole = render(
		'Revise this NVS scene once. Preserve the original source coverage and IDs for retained lines. Return only complete NVS scenes.',
		findings,
		original,
		script,
	)
	if (promptFits(writer, userPrompt(whole), estimateNvs(script)))
		return ask(writer, whole, 'Scene revision', estimateNvs(script))

	const instruction =
		'Revise this fragment of an NVS scene once. Return only its body lines (no scene or source header). Preserve IDs for retained lines.'
	const { heading, lines } = sceneBody(script)
	if (
		paragraphs.length === 1 &&
		lines.some(
			(line) =>
				!promptFits(
					writer,
					userPrompt(render(instruction, '', original, line)),
					estimateNvs(line),
				),
		)
	)
		throw new ContextLimitError('Scene revision line')
	const groups = await scopeScene(aligner, script, paragraphs, [
		...fidelity.map((item) => ({
			paragraphId: item.paragraphId,
			quote: item.quote,
			text: JSON.stringify(item),
		})),
		...style.map((text) => ({ text })),
	])
	const subset = (indices: readonly number[]) => {
		const accepted = new Set(indices)
		return `Fidelity issues: ${JSON.stringify(fidelity.filter((_, i) => accepted.has(i)))}\nStyle issues: ${JSON.stringify(style.filter((_, i) => accepted.has(fidelity.length + i)))}`
	}
	const scenes: string[] = []
	for (const group of groups) {
		const current = scopedScene(heading, group.paragraphs, group.lines)
		if (!group.targets.length) {
			scenes.push(current)
			continue
		}
		const cited = source(group.paragraphs)
		const paragraphPrompt = render(
			'Revise only the portion of this NVS scene that adapts the supplied source paragraphs. Return complete NVS scenes covering exactly the supplied paragraph IDs. Preserve IDs for retained lines.',
			subset(group.targets.map(({ finding }) => finding)),
			cited,
			current,
		)
		if (
			groups.length > 1 &&
			promptFits(writer, userPrompt(paragraphPrompt), estimateNvs(current))
		) {
			scenes.push(
				await ask(
					writer,
					paragraphPrompt,
					'Scene revision paragraph',
					estimateNvs(current),
				),
			)
			continue
		}
		const units = (group.lines.length ? group.lines : ['']).map(
			(text, line) => ({
				text,
				findings: group.targets
					.filter((target) => target.line === line)
					.map(({ finding }) => finding),
			}),
		)
		const revised: string[] = []
		for (const unit of units) {
			if (!unit.findings.length) {
				revised.push(unit.text)
				continue
			}
			revised.push(
				await ask(
					writer,
					render(instruction, subset(unit.findings), cited, unit.text),
					'Scene revision line',
					estimateNvs(unit.text),
				),
			)
		}
		scenes.push(scopedScene(heading, group.paragraphs, revised))
	}
	return scenes.join('\n\n')
}
