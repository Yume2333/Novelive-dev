import { createHash } from 'node:crypto'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import {
	arr,
	bool,
	int,
	lit,
	nullable,
	obj,
	opt,
	type Static,
	str,
} from '@earendil-works/pi-schema'
import {
	type BiblePatch,
	biblePatchSchema,
	completeBiblePatchSchema,
	entityId,
	formatVersion,
	glossaryPatchSchema,
	type ProjectDocument,
	type ProjectScope,
	projectFiles,
	type VolumeDigest,
	type VolumeSkeleton,
	version,
} from '@novelive/format/model'
import {
	buildTextModel,
	createTextStream,
	outputTokenBudget,
	parseModelJson,
	type TextConnection,
	textResultError,
} from '../models/text'
import { splitChapter } from '../preview'
import type { Project } from '../project'
import { reconcileNamedAdditions } from './consolidate'
import { scopedOnlyBrief } from './incremental/context'
import { synthesisInstructions, synthesisOutput } from './output'
import {
	applyPatches,
	bibleEntryBases,
	existing,
	proposalKeys,
	readBible,
	validatePatch,
} from './patch'

export class BibleChangedDuringSynthesisError extends Error {
	constructor() {
		super('Bible changed during synthesis')
	}
}

const fields = {
	overview: str(),
	chapters: arr(obj({ chapterId: entityId, progress: str({ minLength: 1 }) })),
	biblePatch: biblePatchSchema,
	glossaryPatch: glossaryPatchSchema,
}
const outputSchema = obj(fields)
const whole = synthesisOutput(outputSchema)
const eventFields = {
	...fields,
	event: str({ minLength: 1 }),
	is_last: bool(),
}
const eventSchema = obj(eventFields)
const nextEvent = synthesisOutput(eventSchema)
const inclusionCriteria =
	'Inclusion: keep plot-relevant supporting characters and recurring or consequential terms and locations. Omit incidental mentions.'
const checkpointSchema = obj({
	...version,
	fingerprint: str(),
	inputFingerprint: opt(str()),
	basis: str(),
	packet: int({ minimum: 0 }),
	events: arr(eventSchema),
	whole: nullable(outputSchema),
	ready: bool(),
	applied: bool(),
})
const resultSchema = obj({
	...version,
	volumeId: entityId,
	...fields,
	conflicts: biblePatchSchema,
	glossaryConflicts: glossaryPatchSchema,
	bibleRevision: opt(str()),
	bibleBase: opt(arr(obj({ kind: str(), id: str(), revision: str() }))),
	quarantined: opt(bool()),
	baseVersion: opt(lit(1)),
})
export type VolumeSynthesis = Static<typeof resultSchema>

export function synthesisFiles(volumeId: string) {
	const dir = projectFiles
		.skeleton(volumeId)
		.path.slice(0, -'skeleton.json'.length)
	return {
		checkpoint: {
			path: `source/synthesis/${volumeId}.json`,
			schema: checkpointSchema,
		} satisfies ProjectDocument<Checkpoint>,
		result: {
			path: `${dir}synthesis.json`,
			schema: resultSchema,
		} satisfies ProjectDocument<VolumeSynthesis>,
	}
}

type Checkpoint = Static<typeof checkpointSchema>
type Output = Static<typeof outputSchema>
type Event = Static<typeof eventSchema>

export interface SynthesisOptions {
	connection: TextConnection
	language: string
	requirements?: string
	strategy?: 'auto' | 'whole' | 'events'
	maxEvents?: number
	incremental?: boolean
	scope?: ProjectScope
	previousDigests?: readonly VolumeDigest[]
	rerun?: boolean
	requestTimeoutMs?: number
	signal?: AbortSignal
	fetch?: typeof globalThis.fetch
}

const minimumEventLimit = 128
const packetFormat = 6
const legacyPacketFormats = [1, 2, 3, 4, 5]
const hash = (value: unknown) =>
	createHash('sha256').update(JSON.stringify(value)).digest('hex')
const bytes = (text: string) => Buffer.byteLength(text)
const repairPrefix = 'Repair the JSON: '
function fitBytes(text: string, limit: number) {
	if (bytes(text) <= limit) return text
	return new TextDecoder().decode(Buffer.from(text).subarray(0, limit), {
		stream: true,
	})
}
function recentEvents(events: Event[], historyBudget: number) {
	const summaries: string[] = []
	let remaining = historyBudget - 2
	for (let i = events.length - 1; i >= 0 && remaining > 0; i--) {
		const chars = Array.from(events[i].event).slice(0, 160)
		let summary = chars.join('')
		const separator = summaries.length ? 1 : 0
		let size = bytes(JSON.stringify(summary)) + separator
		if (!summaries.length)
			while (size > remaining && chars.length) {
				chars.pop()
				summary = chars.join('')
				size = bytes(JSON.stringify(summary))
			}
		if (size > remaining) break
		summaries.unshift(summary)
		remaining -= size
	}
	return JSON.stringify(summaries)
}
function previewPackets(
	previews: readonly string[],
	chapterIds: readonly string[],
	budget: number,
) {
	const packets: string[] = []
	for (const [i, preview] of previews.entries()) {
		const label = `Chapter ${chapterIds[i]}:\n`
		if (budget - label.length < 2) return []
		for (const fragment of splitChapter([preview], budget - label.length)) {
			const part = label + fragment
			const last = packets.at(-1)
			if (last && last.length + part.length + 1 <= budget)
				packets[packets.length - 1] = `${last}\n${part}`
			else packets.push(part)
		}
	}
	return packets
}

const packetChapters = (packet = '') =>
	new Set(Array.from(packet.matchAll(/^Chapter ([\w-]+):$/gm), ([, id]) => id))

function matchesRecordedPackets(checkpoint: Checkpoint, packets: string[]) {
	if (!packets.length || packets.length !== checkpoint.packet) return false
	const recorded = new Set<string>()
	let index = 0
	for (const event of checkpoint.events) {
		if (index === packets.length) return false
		for (const { chapterId } of event.chapters) recorded.add(chapterId)
		if (!event.is_last) continue
		const rebuilt = packetChapters(packets[index++])
		if (
			!recorded.size ||
			recorded.size !== rebuilt.size ||
			[...recorded].some((chapter) => !rebuilt.has(chapter))
		)
			return false
		recorded.clear()
	}
	return index === packets.length
}

function eventPacketBudget(
	context: number,
	history: number,
	reserve: number,
	prompt: number,
) {
	const output = Math.min(
		reserve,
		Math.max(512, context - prompt - history - 768),
	)
	return Math.floor((context - output - prompt - history - 384) / 3)
}

function legacyEventPacketBudget(
	format: number,
	context: number,
	history: number,
	reserve: number,
	incremental: boolean,
	prefix: string,
	instructions: string,
	bible: Awaited<ReturnType<typeof readBible>>,
) {
	if (format >= 4) {
		const contract = synthesisInstructions(
			obj({ ...eventFields, biblePatch: completeBiblePatchSchema }),
		)
		return eventPacketBudget(
			context,
			history,
			reserve,
			bytes(`${instructions}\n${contract}`),
		)
	}
	const existing = `Existing entries:\n${JSON.stringify(bible)}`
	if (format === 3) {
		const contract = synthesisInstructions(
			obj({ ...eventFields, biblePatch: completeBiblePatchSchema }),
		)
		const prompt = `${prefix}
Return one JSON object. Use stable IDs, actual chapter IDs for provenance, and existing or extracted character IDs for relations. Mark main characters as major and new entries as candidate. Preserve confirmed facts; ${incremental ? 'do not delete in successive volumes.' : 'delete only mistaken candidates from this volume.'}
${existing}
${contract}`
		return eventPacketBudget(context, history, reserve, bytes(prompt))
	}
	const prompt = `${prefix}
Return only JSON with overview, chapters [{chapterId,progress}], biblePatch [{kind,op,entry}], glossaryPatch [entry].
Bible kinds: character, relation, location, timeline, foreshadowing, style. Every entry has an id and status ("candidate"); use actual chapter IDs for provenance and relationships reference existing or extracted characters. Characters have name and aliases (mark main characters major:true); locations have name and description; relations have from, to and description; timeline has chapterId and event; foreshadowing has plantedChapter and description; style has description; glossary has original, written and category.
Use stable IDs; record changing identities in changes with chapterId, field and value. Keep confirmed facts intact; ${incremental ? 'do not emit delete for successive volumes.' : 'delete only a mistaken candidate from this volume.'}
${existing}`
	return format === 1
		? Math.floor((context - reserve - bytes(prompt) - 3072) / 8)
		: Math.floor((context - reserve - bytes(prompt) - 2 * history - 768) / 3)
}

async function seriesChapterIds(
	project: Project,
	volumeId: string,
	chapterIds: readonly string[],
) {
	const series = await project.read(projectFiles.series)
	const volumes = await Promise.all(
		series.volumeIds.map((id) =>
			existing(() => project.read(projectFiles.volume(id))),
		),
	)
	const indexed = await Promise.all(
		volumes.flatMap((volume) =>
			volume
				? [
						Promise.all(
							volume.workIds.map((id) =>
								project.read(projectFiles.work(volume.volumeId, id)),
							),
						).then((works) => ({
							volumeId: volume.volumeId,
							chapters: works.flatMap((work) => work.chapterIds),
						})),
					]
				: [],
		),
	)
	const current = indexed.find((volume) => volume.volumeId === volumeId)
	const currentIds = new Set(current?.chapters)
	if (current && chapterIds.some((id) => !currentIds.has(id)))
		throw new Error('Synthesis chapter IDs must belong to this volume')
	return new Set([
		...indexed.flatMap((volume) => volume.chapters),
		...chapterIds,
	])
}
const unique = <T>(items: T[]) => [
	...new Map(items.map((item) => [JSON.stringify(item), item])).values(),
]

function combine(
	volumeId: string,
	chapterIds: readonly string[],
	parts: Output[],
): VolumeSkeleton {
	const chapters = chapterIds.map((chapterId) => {
		const notes = unique(
			parts.flatMap((part) =>
				part.chapters
					.filter((chapter) => chapter.chapterId === chapterId)
					.map((chapter) => chapter.progress),
			),
		)
		if (!notes.length)
			throw new Error(`Synthesis missing chapter progress: ${chapterId}`)
		return { chapterId, progress: notes.join('；') }
	})
	return {
		formatVersion,
		volumeId,
		overview: unique(parts.map((part) => part.overview).filter(Boolean)).join(
			'\n\n',
		),
		chapters,
	}
}

export async function synthesizeVolume(
	project: Project,
	volumeId: string,
	chapterIds: readonly string[],
	options: SynthesisOptions,
): Promise<VolumeSynthesis> {
	if (!chapterIds.length || new Set(chapterIds).size !== chapterIds.length)
		throw new Error('Synthesis requires distinct ordered chapter IDs')
	const model = buildTextModel(options.connection)
	const stream = createTextStream({ fetch: options.fetch })
	if (
		options.maxEvents !== undefined &&
		(!Number.isSafeInteger(options.maxEvents) || options.maxEvents < 1)
	)
		throw new Error('Synthesis event limit must be a positive integer')
	const strategy = options.strategy ?? 'auto'
	const incremental = options.incremental ?? false
	const files = synthesisFiles(volumeId)
	const provenance = await seriesChapterIds(project, volumeId, chapterIds)
	const previews = await Promise.all(
		chapterIds.map((id) => project.read(projectFiles.preview(id))),
	)
	if (previews.some((preview, i) => preview.chapterId !== chapterIds[i]))
		throw new Error('Stored preview chapter ID does not match its file')
	const inputsFor = (mode: typeof strategy) => ({
		previews,
		language: options.language,
		requirements: options.requirements,
		strategy: mode,
		incremental,
		...(options.scope ? { scope: options.scope } : {}),
		...(options.previousDigests
			? { previousDigests: options.previousDigests }
			: {}),
		model: model.id,
		context: model.contextWindow,
	})
	const saved = options.rerun
		? undefined
		: await existing(() => project.read(files.checkpoint))
	const savedMode = saved && (saved.whole ? 'whole' : 'events')
	const completedInputs =
		savedMode && (strategy === savedMode || strategy === 'auto')
			? [inputsFor(savedMode), inputsFor('auto')]
			: []
	const matchesPacket = (checkpoint: Checkpoint, formats: readonly number[]) =>
		completedInputs.some((inputs) =>
			formats.some(
				(format) =>
					checkpoint.fingerprint === hash({ packetFormat: format, ...inputs }),
			),
		)
	if (
		saved?.applied &&
		(saved.inputFingerprint
			? completedInputs.some(
					(inputs) => saved.inputFingerprint === hash(inputs),
				)
			: matchesPacket(saved, legacyPacketFormats))
	)
		return project.read(files.result)
	const legacyFormat =
		saved?.ready && !saved.applied
			? legacyPacketFormats.find((format) => matchesPacket(saved, [format]))
			: undefined
	const bible = await readBible(project)
	const contextBible = options.scope
		? await readBible(project, options.scope)
		: bible
	const outputLimit = outputTokenBudget(model)
	const historyBudget = Math.min(1024, Math.floor(model.contextWindow / 16))
	const packetOutputReserve = Math.min(
		4096,
		Math.floor(model.contextWindow / 4),
	)
	const packetText = previews.map((preview) => JSON.stringify(preview))
	const prefix = `Synthesize the ordered chapter previews in ${options.language}. Adaptation requirements: ${options.requirements ?? ''}.`
	const instructions = `${prefix}
Return JSON. Use stable IDs, real chapter IDs, and character IDs for relations. Mark main characters major and new entries candidate. Preserve confirmed facts; ${incremental ? 'never delete.' : 'delete only this volume’s mistaken candidates.'}
${inclusionCriteria}
Existing entries:
${JSON.stringify(contextBible)}${scopedOnlyBrief(contextBible, bible)}${options.previousDigests?.length ? `\nEarlier volume digests (context only):\n${JSON.stringify(options.previousDigests)}` : ''}`
	const wholePrompt = `${instructions}
${whole.instructions}
For each chapter, include progress and exhaustively extract every distinct Bible and glossary entry that meets the inclusion rules. Return their union across all chapters. Summarize only the overview; do not abridge the patch to a volume-level shortlist.
Chapter previews:
${packetText.join('\n')}`
	const legacyPackets =
		legacyFormat !== undefined && savedMode === 'events'
			? previewPackets(
					packetText,
					chapterIds,
					legacyEventPacketBudget(
						legacyFormat,
						model.contextWindow,
						historyBudget,
						packetOutputReserve,
						incremental,
						prefix,
						instructions,
						bible,
					),
				)
			: undefined
	const legacyReady =
		legacyFormat !== undefined &&
		saved &&
		(saved.whole ||
			(legacyPackets && matchesRecordedPackets(saved, legacyPackets)))
			? saved
			: undefined
	const useEvents = legacyReady
		? savedMode === 'events'
		: strategy === 'events' ||
			(strategy === 'auto' &&
				bytes(wholePrompt) + 384 > model.contextWindow - packetOutputReserve)
	const inputs = inputsFor(useEvents ? 'events' : 'whole')
	const inputFingerprint = hash(inputs)
	const fingerprint = hash({ packetFormat, ...inputs })
	const basis = hash(bible)
	const matching = saved?.fingerprint === fingerprint ? saved : legacyReady
	let quarantineReason =
		matching?.ready && matching.basis !== basis
			? 'Bible changed before synthesis publication'
			: undefined
	const resumable = matching?.basis === basis ? matching : undefined
	const eventPrompt = `${instructions}
${nextEvent.instructions}`
	const outputReserve = useEvents
		? Math.min(
				packetOutputReserve,
				Math.max(
					512,
					model.contextWindow - bytes(eventPrompt) - historyBudget - 768,
				),
			)
		: packetOutputReserve
	const budget = model.contextWindow - outputReserve
	const packetBudget = eventPacketBudget(
		model.contextWindow,
		historyBudget,
		packetOutputReserve,
		bytes(eventPrompt),
	)
	const packets =
		legacyReady && legacyPackets
			? legacyPackets
			: useEvents && packetBudget > 0
				? previewPackets(packetText, chapterIds, packetBudget)
				: []
	const limit =
		options.maxEvents ?? Math.max(minimumEventLimit, packets.length * 4)
	const state: Checkpoint = (quarantineReason ? matching : undefined) ??
		resumable ?? {
			formatVersion,
			fingerprint,
			basis,
			packet: 0,
			events: [],
			whole: null,
			ready: false,
			applied: false,
		}
	if (useEvents && !packets.length && !state.ready)
		throw new Error('Existing Bible is too large for synthesis context')

	const chapterSet = new Set(chapterIds)
	async function request<T extends Output>(
		prompt: string,
		contract: ReturnType<typeof synthesisOutput<T>>,
		check: (output: T) => void,
	): Promise<T> {
		const repairBudget = budget - bytes(prompt) - bytes(repairPrefix)
		if (repairBudget <= 0)
			throw new Error('Synthesis input exceeds the model context budget')
		const messages = [{ role: 'user' as const, content: prompt, timestamp: 0 }]
		for (let attempt = 0; ; attempt++) {
			options.signal?.throwIfAborted()
			const response = await stream(model, normalizeContext({ messages }), {
				apiKey: options.connection.apiKey,
				signal: options.signal,
				timeoutMs: options.requestTimeoutMs,
				outputLimit,
				cacheRetention: 'none',
			}).result()
			if (response.stopReason !== 'stop')
				throw textResultError(
					response,
					`Synthesis stopped: ${response.stopReason}`,
				)
			try {
				const text = response.content
					.flatMap((part) => (part.type === 'text' ? [part.text] : []))
					.join('')
				const output = parseModelJson(text)
				const validation = contract.parse(output)
				if (!validation.ok)
					throw new Error(contract.repair(output, validation.errors))
				check(validation.value)
				return validation.value
			} catch (error) {
				if (attempt === 1) throw error
				messages.push({
					role: 'user',
					content:
						repairPrefix +
						fitBytes(
							error instanceof Error ? error.message : String(error),
							repairBudget,
						),
					timestamp: 0,
				})
			}
		}
	}

	const check = (output: Output, prior: Output[]) => {
		const progressIds = new Set(
			output.chapters.map(({ chapterId }) => chapterId),
		)
		if (
			progressIds.size !== output.chapters.length ||
			[...progressIds].some((id) => !chapterSet.has(id))
		)
			throw new Error('Chapter progress must use distinct IDs from this volume')
		validatePatch(
			bible,
			[...prior.flatMap((part) => part.biblePatch), ...output.biblePatch],
			output.glossaryPatch,
			chapterSet,
			provenance,
			incremental,
		)
	}
	if (!state.ready && !useEvents && !state.whole) {
		state.whole = await request(wholePrompt, whole, (value) => {
			check(value, [])
			combine(volumeId, chapterIds, [value])
		})
		await project.write(files.checkpoint, state)
	}
	while (!state.ready && useEvents && state.packet < packets.length) {
		if (state.events.length >= limit)
			throw new Error(`Synthesis reached its event limit (${limit})`)
		const packet = state.packet
		const event = await request(
			`${eventPrompt}
Extract only the next event in packet ${packet + 1}/${packets.length}. Include progress and qualifying new facts, not repeated background. Set is_last when done.
Events already extracted: ${state.events.length}
Recent event summaries: ${recentEvents(state.events, historyBudget)}
Chapter previews:
${packets[packet]}`,
			nextEvent,
			(value: Event) => {
				if (state.events.some((previous) => previous.event === value.event))
					throw new Error('Event was already extracted; return a new event')
				check(value, state.events)
				if (value.is_last && packet === packets.length - 1)
					combine(volumeId, chapterIds, [...state.events, value])
			},
		)
		state.events.push(event)
		if (event.is_last) state.packet++
		await project.write(files.checkpoint, state)
	}

	const parts = state.whole ? [state.whole] : state.events
	let skeleton: VolumeSkeleton
	try {
		skeleton = combine(volumeId, chapterIds, parts)
	} catch (error) {
		if (!legacyReady) throw error
		quarantineReason ??= 'Saved synthesis failed current validation'
		const observed = new Set(
			parts.flatMap((part) => part.chapters.map(({ chapterId }) => chapterId)),
		)
		skeleton = combine(
			volumeId,
			chapterIds.filter((id) => observed.has(id)),
			parts,
		)
	}
	if (legacyReady && !quarantineReason) {
		try {
			for (const [i, part] of parts.entries()) check(part, parts.slice(0, i))
		} catch {
			quarantineReason = 'Saved synthesis failed current validation'
		}
	}
	type Proposal = {
		item: BiblePatch[number]
		content: string
		chapter?: string
	}
	const proposals = new Map<string, Proposal>()
	const located = new Map<string, Proposal>()
	let packetIndex = 0
	for (const part of parts) {
		const packetIds = state.whole
			? new Set(chapterIds)
			: packetChapters(packets[packetIndex])
		const affected = unique(
			part.chapters
				.map(({ chapterId }) => chapterId)
				.filter((id) => packetIds.has(id)),
		)
		const observed =
			affected.length === 1
				? affected[0]
				: packetIds.size === 1
					? packetIds.values().next().value
					: undefined
		for (const { observedChapter: _claimed, ...item } of part.biblePatch) {
			const { content, observation } = proposalKeys(item, observed)
			const key = JSON.stringify([content, observation])
			if (proposals.has(key)) continue
			const proposal = {
				item,
				content,
				chapter: observation ? observed : undefined,
			}
			proposals.set(key, proposal)
			if (proposal.chapter && !located.has(content))
				located.set(content, proposal)
		}
		if ('is_last' in part && part.is_last) packetIndex++
	}
	const ordered = new Set<Proposal>()
	for (const proposal of proposals.values()) {
		ordered.add(
			proposal.chapter ? proposal : (located.get(proposal.content) ?? proposal),
		)
	}
	const biblePatch = reconcileNamedAdditions(
		[...ordered].map(({ item, chapter }) =>
			chapter ? { ...item, observedChapter: chapter } : item,
		),
		bible,
	)
	const glossaryPatch = unique(parts.flatMap((part) => part.glossaryPatch))
	options.signal?.throwIfAborted()
	if (
		hash(
			await Promise.all(
				chapterIds.map((id) => project.read(projectFiles.preview(id))),
			),
		) !== hash(previews)
	)
		throw new Error('Chapter previews changed during synthesis')
	let latest = await readBible(project)
	if (!state.ready) {
		if (hash(latest) !== state.basis)
			throw new BibleChangedDuringSynthesisError()
		state.ready = true
		await project.write(files.checkpoint, state)
		latest = await readBible(project)
	}
	const canPublish = !quarantineReason && hash(latest) === state.basis
	const conflictReason =
		quarantineReason ?? 'Bible changed before synthesis publication'
	let publicationBase: ReturnType<typeof bibleEntryBases> | undefined
	const { conflicts, glossaryConflicts, consolidatedAdds } = canPublish
		? await applyPatches(
				project,
				latest,
				biblePatch,
				glossaryPatch,
				chapterSet,
				provenance,
				(merged) => {
					publicationBase = bibleEntryBases(merged)
				},
			)
		: {
				consolidatedAdds: undefined,
				conflicts: biblePatch
					.filter(({ op }) => op !== 'none')
					.map((item) => ({
						...item,
						entry: {
							...item.entry,
							status: 'candidate',
							conflict: conflictReason,
						},
					})) as typeof biblePatch,
				glossaryConflicts: glossaryPatch.map((entry) => ({
					...entry,
					status: 'candidate' as const,
					conflict: conflictReason,
				})),
			}
	const publishedBible = await readBible(project)
	const result: VolumeSynthesis = {
		...skeleton,
		biblePatch: biblePatch.flatMap((item) => {
			const consolidated = consolidatedAdds?.get(item)
			return consolidated === null ? [] : [consolidated ?? item]
		}),
		glossaryPatch,
		conflicts,
		glossaryConflicts,
		bibleRevision: canPublish ? hash(publishedBible) : state.basis,
		bibleBase: publicationBase,
		quarantined: !canPublish,
		baseVersion: canPublish ? 1 : undefined,
	}
	await project.write(projectFiles.skeleton(volumeId), skeleton)
	await project.write(files.result, result)
	await project.write(files.checkpoint, {
		...state,
		inputFingerprint,
		applied: true,
	})
	return result
}
