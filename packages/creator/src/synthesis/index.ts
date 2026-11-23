import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
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
import { canonicalizeAdditions } from './canonicalize'
import {
	reconcileNamedAdditions,
	type SelectionGroup,
	selectAdditions,
} from './consolidate'
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
const selection = synthesisOutput(obj({ keep: arr(int({ minimum: 1 })) }))
const selectionScope: Record<string, string> = {
	character:
		'Keep a named or identifiable participant whose choices or role affect the plot, or who needs recurring character continuity. A one-scene character qualifies only when consequential. Use later observations to recognize supporting roles established after the first appearance. Drop passing mentions, stock roles and alternate IDs for a person already kept; recognize names, aliases and titles.',
	location:
		'Keep a recurring playable setting or the setting of a consequential scene that needs a distinct backdrop. Prefer the actual playable setting over its broader region or an incidental subdivision. Drop passing mentions, route waypoints and alternate names of the same setting.',
	relation:
		'Keep durable relationships that explain consequential choices or conflicts, or establish character or family roles that the adaptation must keep consistent even if introduced once. Group both directions of the same pair, and keep one representative of the same standing relationship; descriptions in chapter-dated changes count as evidence. Drop co-presence, isolated interactions, and incidental kinship or titles.',
	timeline:
		'Keep only turning points that change the direction or outcome of a plot thread. Keep one representative of the whole event, not the separate approach, confrontation and aftermath unless each independently changes the plot. Omit scene beats, logistics and retellings under another ID.',
	foreshadowing:
		'Keep deliberate setups with a consequential later payoff or an unresolved thread that must be tracked. Drop momentary suspense, speculation, and restatements of the same thread.',
	style:
		'Keep reusable visual direction or narrator voice that should apply beyond the scene. Drop commentary on plot, a chapter summary, and the mood of an individual scene.',
	glossary:
		'Keep a distinctive named organization, object, technique, title, or cultural expression whose consistent wording or pronunciation matters, or whose meaning is needed to understand a consequential event. Prefer a representative with an exact source spelling and useful usage note over a vague gloss. Drop ordinary objects, generic offices and roles, and definitions with no continuity need. Character and place names belong in the Bible, not the glossary.',
}
const inclusionCriteria =
	'Inclusion: keep plot-relevant supporting characters and recurring or consequential terms and locations. Omit incidental mentions.'
const checkpointSchema = obj({
	...version,
	fingerprint: str(),
	inputFingerprint: opt(str()),
	basis: str(),
	packet: int({ minimum: 0 }),
	events: arr(eventSchema),
	selections: opt(arr(arr(int({ minimum: 1 })))),
	selectionVersion: opt(int({ minimum: 1 })),
	selectionPlan: opt(str()),
	selectedPatch: opt(
		obj({ biblePatch: biblePatchSchema, glossaryPatch: glossaryPatchSchema }),
	),
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
	selectionConnection?: TextConnection
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
const packetFormat = 7
const selectionVersion = 5
const legacyPacketFormats = [1, 2, 3, 4, 5, 6]
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
function recentEvents(
	events: Event[],
	historyBudget: number,
	distinct = false,
) {
	const summaries: string[] = []
	const seen = new Set<string>()
	let remaining = historyBudget - 2
	for (let i = events.length - 1; i >= 0 && remaining > 0; i--) {
		const chars = Array.from(events[i].event).slice(0, 160)
		let summary = chars.join('')
		if (distinct && seen.has(summary)) continue
		const separator = summaries.length ? 1 : 0
		let size = bytes(JSON.stringify(summary)) + separator
		if (!summaries.length)
			while (size > remaining && chars.length) {
				chars.pop()
				summary = chars.join('')
				size = bytes(JSON.stringify(summary))
			}
		if (size > remaining) break
		seen.add(summary)
		summaries.unshift(summary)
		remaining -= size
	}
	return JSON.stringify(summaries)
}
function repeatsPacketEvent(event: Event, packetEvents: Event[]) {
	const matching = packetEvents.filter(
		(previous) => previous.event === event.event,
	)
	return (
		matching.length > 0 &&
		(['chapters', 'biblePatch', 'glossaryPatch'] as const).every((field) =>
			event[field].every((item) =>
				matching.some((previous) =>
					previous[field].some((saved) => isDeepStrictEqual(item, saved)),
				),
			),
		)
	)
}
function proposedEntries(
	events: Event[],
	packetEvents: Event[],
	budget: number,
) {
	const lines = new Map<string, string>()
	const items = events.flatMap((event) => event.biblePatch)
	for (const kind of [
		'character',
		'location',
		'relation',
		'timeline',
		'foreshadowing',
		'style',
	])
		for (const item of items) {
			if (item.kind !== kind || item.op === 'delete') continue
			const label =
				item.kind === 'character'
					? [item.entry.name, ...(item.entry.aliases ?? [])].join('/')
					: item.kind === 'location'
						? item.entry.name
						: item.kind === 'relation'
							? `${item.entry.from}>${item.entry.to}`
							: item.kind === 'timeline'
								? item.entry.chapterId
								: item.kind === 'foreshadowing'
									? item.entry.plantedChapter
									: ''
			lines.set(`${kind}:${item.entry.id}`, `${kind} ${item.entry.id} ${label}`)
		}
	for (const entry of events.flatMap((event) => event.glossaryPatch))
		lines.set(`glossary:${entry.original}`, `glossary ${entry.original}`)
	const full = [...lines.values()].join('\n')
	if (bytes(full) <= budget) return { text: full, compact: false }

	const ordered = new Set<string>()
	for (const event of [...packetEvents].reverse()) {
		for (const item of event.biblePatch)
			if (item.op !== 'delete') ordered.add(`${item.kind}:${item.entry.id}`)
		for (const entry of event.glossaryPatch)
			ordered.add(`glossary:${entry.original}`)
	}
	for (const key of lines.keys()) ordered.add(key)
	const groups = new Map<string, string[]>()
	for (const key of ordered) {
		const colon = key.indexOf(':')
		const kind = key.slice(0, colon)
		const id = key.slice(colon + 1)
		if (!groups.has(kind)) groups.set(kind, [])
		groups.get(kind)?.push(kind === 'glossary' ? JSON.stringify(id) : id)
	}
	const kept = new Map<string, string>()
	let remaining = budget
	const pending = [...groups].map(([kind, ids]) => ({ kind, ids, index: 0 }))
	while (pending.length) {
		for (let i = 0; i < pending.length; ) {
			const group = pending[i]
			const id = group.ids[group.index++]
			const line = kept.get(group.kind)
			const text = line === undefined ? `${group.kind}: ${id}` : ` ${id}`
			const size = bytes(text) + Number(line === undefined && kept.size > 0)
			if (size <= remaining) {
				kept.set(group.kind, (line ?? '') + text)
				remaining -= size
			}
			if (group.index === group.ids.length) pending.splice(i, 1)
			else i++
		}
	}
	return { text: [...kept.values()].join('\n'), compact: true }
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
	const selector = options.selectionConnection
		? buildTextModel(options.selectionConnection)
		: model
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
	const registryBudget = Math.max(
		0,
		Math.min(2048, Math.floor(model.contextWindow / 8) - 512),
	)
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
	if (quarantineReason && matching?.selections && !matching.selectedPatch)
		throw new Error(
			'Cannot recover saved synthesis picks against a changed Bible',
		)
	const eventPrompt = `${instructions}
${nextEvent.instructions}`
	const outputReserve = useEvents
		? Math.min(
				packetOutputReserve,
				Math.max(
					512,
					model.contextWindow -
						bytes(eventPrompt) -
						historyBudget -
						registryBudget -
						768,
				),
			)
		: packetOutputReserve
	const budget = model.contextWindow - outputReserve
	const packetBudget = eventPacketBudget(
		model.contextWindow,
		historyBudget + registryBudget,
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
	async function request<T>(
		prompt: string,
		contract: ReturnType<typeof synthesisOutput<T>>,
		check: (output: T) => void,
		focusedPrompt?: string,
		{
			connection = options.connection,
			requestModel = model,
			inputBudget = budget,
			requestOutputLimit = outputLimit,
		} = {},
	): Promise<T> {
		const repairBudget = inputBudget - bytes(prompt) - bytes(repairPrefix)
		if (repairBudget <= 0)
			throw new Error('Synthesis input exceeds the model context budget')
		const messages = [{ role: 'user' as const, content: prompt, timestamp: 0 }]
		for (let attempt = 0; ; attempt++) {
			options.signal?.throwIfAborted()
			const response = await stream(
				requestModel,
				normalizeContext({ messages }),
				{
					apiKey: connection.apiKey,
					signal: options.signal,
					timeoutMs: options.requestTimeoutMs,
					outputLimit: requestOutputLimit,
					cacheRetention: 'none',
				},
			).result()
			if (response.stopReason !== 'stop') {
				const error = textResultError(
					response,
					`Synthesis stopped: ${response.stopReason}`,
				)
				if (focusedPrompt && error.code === 'reasoning_limit')
					return request(focusedPrompt, contract, check)
				throw error
			}
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
		const packetEvents = state.events.slice(
			state.events.findLastIndex(({ is_last }) => is_last) + 1,
		)
		const registry = proposedEntries(state.events, packetEvents, registryBudget)
		const summaries = recentEvents(
			registry.compact ? packetEvents : state.events,
			historyBudget,
			registry.compact,
		)
		const complete =
			'When no distinct event or new fact remains in this packet, use is_last:true and empty arrays instead of restating it.'
		const prompt = (instruction: string) => `${eventPrompt}
Extract only the next event in packet ${packet + 1}/${packets.length}. ${instruction}
Events already extracted: ${state.events.length}
Already proposed entries:
${registry.text}
Recent event summaries: ${summaries}
Chapter previews:
${packets[packet]}`
		const event = await request(
			prompt(
				registry.compact
					? `Compare this packet with the saved events and proposed IDs below. Skip restatements, including rewordings; return progress and qualifying facts only for the next uncovered event. Describe relations as standing relationships, naming their kind first. ${complete}`
					: 'Include progress and every qualifying entry. Never restate a proposed entry; update its ID only with a new fact. Describe a relation as the standing relationship between the pair, naming its kind first, not the scene that shows it. Set is_last when done.',
			),
			nextEvent,
			(value: Event) => {
				if (!value.is_last && repeatsPacketEvent(value, packetEvents))
					throw new Error(
						`This packet already has that event with the same progress and facts. Return the next event with new information, or set is_last if this packet is complete. Repeated event: ${JSON.stringify(value.event)}`,
					)
				check(value, state.events)
				if (value.is_last && packet === packets.length - 1)
					combine(volumeId, chapterIds, [...state.events, value])
			},
			prompt(
				`Return one short JSON answer: the next uncovered plot event, its progress and only its new qualifying facts. Do not rescan for earlier events or restate proposed entries. Describe relations as standing relationships, naming their kind first. ${complete}`,
			),
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
	async function selectPatch() {
		const reconciled = reconcileNamedAdditions(
			[...ordered].map(({ item, chapter }) =>
				chapter ? { ...item, observedChapter: chapter } : item,
			),
			bible,
		)
		const terms = unique(parts.flatMap((part) => part.glossaryPatch))
		return state.whole || (state.ready && !state.selections)
			? { biblePatch: reconciled, glossaryPatch: terms }
			: selectAdditions(
					canonicalizeAdditions(reconciled, bible, chapterIds),
					terms,
					bible,
					choose,
				)
	}
	if (
		!state.selectedPatch &&
		state.selections &&
		state.selectionVersion !== selectionVersion
	) {
		state.selections = []
		state.selectionVersion = selectionVersion
	}
	async function choose(groups: readonly SelectionGroup[]) {
		const selectionOutput = outputTokenBudget(selector)
		const selectionBudget = selector.contextWindow - selectionOutput - 1024
		const progressBudget = Math.min(
			8192,
			Math.floor(selector.contextWindow / 8),
		)
		const chapterRoom = Math.floor(progressBudget / skeleton.chapters.length)
		const progress = skeleton.chapters
			.map(({ chapterId, progress }) => {
				const label = `${chapterId}: `
				return `${label}${fitBytes(progress, Math.max(0, chapterRoom - bytes(label) - 1))}`
			})
			.join('\n')
		let position = 0
		const numbered = groups.map(({ kind, entries }) => ({
			kind,
			lines: entries.map(
				(entry) => `${++position} ${JSON.stringify({ kind, ...entry })}`,
			),
		}))
		const promptFor = (batches: typeof numbered) => `${instructions}
${selection.instructions}
Select from these canonical candidates across the whole volume. Compare evidence from early and late chapters and keep the entries the adaptation needs for consequential scenes, continuity, or recurring assets. Accuracy, a name, or repeated extraction is not enough. Observations are evidence about the same entry, not separate choices. Keep one representative for repeated people, places, relationships, or plot beats. Keep nothing if no candidate qualifies. Return keep as the numbers of the kept candidates.
${batches.map(({ kind }) => `${kind}: ${selectionScope[kind]}`).join('\n')}
Respond with only the JSON object, with no commentary before or after it.
Chapter progress:
${progress}
Candidates:
${batches.flatMap(({ lines }) => lines).join('\n')}`
		const fits = (prompt: string) =>
			bytes(prompt) + bytes(repairPrefix) < selectionBudget
		const whole = promptFor(numbered)
		const batches = fits(whole)
			? [{ prompt: whole, count: position }]
			: numbered.map((group) => ({
					prompt: promptFor([group]),
					count: group.lines.length,
				}))
		if (batches.some(({ prompt }) => !fits(prompt)))
			throw new Error(
				'A whole-volume candidate kind exceeds the selection context budget',
			)
		const plan = hash(batches.map(({ count }) => count))
		if (state.selectionPlan !== plan) state.selections = []
		state.selectionPlan = plan
		const kept = new Set<number>()
		let offset = 0
		for (const [index, { prompt, count }] of batches.entries()) {
			let keep = state.selections?.[index]
			if (!keep) {
				const answer = await request(
					prompt,
					selection,
					(value) => {
						if (
							new Set(value.keep).size !== value.keep.length ||
							value.keep.some((n) => n <= offset || n > offset + count)
						)
							throw new Error(
								`keep must list distinct candidate numbers from ${offset + 1} to ${offset + count}`,
							)
					},
					undefined,
					{
						connection: options.selectionConnection,
						requestModel: selector,
						inputBudget: selectionBudget,
						requestOutputLimit: selectionOutput,
					},
				)
				keep = answer.keep
				state.selections = [...(state.selections ?? []), keep]
				state.selectionVersion = selectionVersion
				await project.write(files.checkpoint, state)
			}
			for (const n of keep) kept.add(n)
			offset += count
		}
		return kept
	}
	const selectedPatch = state.selectedPatch ?? (await selectPatch())
	const { biblePatch, glossaryPatch } = selectedPatch
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
	const basisUnchanged = hash(latest) === state.basis
	if (!state.ready && !basisUnchanged)
		throw new Error('Bible changed during synthesis')
	if (
		!state.ready ||
		(!state.whole &&
			!state.selectedPatch &&
			!quarantineReason &&
			basisUnchanged)
	) {
		if (!state.whole) state.selectedPatch = selectedPatch
		state.ready = true
		await project.write(files.checkpoint, state)
		latest = await readBible(project)
	}
	const canPublish = !quarantineReason && hash(latest) === state.basis
	const conflictReason =
		quarantineReason ?? 'Bible changed before synthesis publication'
	let publicationBase: ReturnType<typeof bibleEntryBases> | undefined
	const { conflicts, glossaryConflicts, consolidated } = canPublish
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
				consolidated: undefined,
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
			const merged = consolidated?.get(item)
			return merged === null ? [] : [merged ?? item]
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
