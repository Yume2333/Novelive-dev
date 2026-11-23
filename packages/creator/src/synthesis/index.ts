import { createHash } from 'node:crypto'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import {
	arr,
	bool,
	compile,
	int,
	nullable,
	obj,
	type Static,
	str,
} from '@earendil-works/pi-schema'
import {
	type BiblePatch,
	biblePatchSchema,
	entityId,
	formatVersion,
	glossaryPatchSchema,
	type ProjectDocument,
	projectFiles,
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
import {
	applyPatches,
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
const whole = compile(outputSchema)
const eventSchema = obj({
	...fields,
	event: str({ minLength: 1 }),
	is_last: bool(),
})
const nextEvent = compile(eventSchema)
const checkpointSchema = obj({
	...version,
	fingerprint: str(),
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
	rerun?: boolean
	signal?: AbortSignal
	fetch?: typeof globalThis.fetch
}

const minimumEventLimit = 128
const hash = (value: unknown) =>
	createHash('sha256').update(JSON.stringify(value)).digest('hex')
const bytes = (text: string) => Buffer.byteLength(text)
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
	const fingerprint = hash({
		packetFormat: 2,
		previews,
		language: options.language,
		requirements: options.requirements,
		strategy,
		incremental,
		model: model.id,
		context: model.contextWindow,
	})
	const saved = options.rerun
		? undefined
		: await existing(() => project.read(files.checkpoint))
	if (saved?.fingerprint === fingerprint && saved.applied)
		return project.read(files.result)

	const bible = await readBible(project)
	const basis = hash(bible)
	const matching = saved?.fingerprint === fingerprint ? saved : undefined
	const quarantined =
		matching?.ready && matching.basis !== basis ? matching : undefined
	const resumable = matching?.basis === basis ? matching : undefined
	const maxTokens = outputTokenBudget(model)
	const historyBudget = Math.min(1024, Math.floor(model.contextWindow / 16))
	const packetOutputReserve = Math.min(
		4096,
		Math.floor(model.contextWindow / 4),
	)
	const budget = model.contextWindow - packetOutputReserve - historyBudget
	const packetText = previews.map((preview) => JSON.stringify(preview))
	const instructions = `Synthesize the ordered chapter previews in ${options.language}. Adaptation requirements: ${options.requirements ?? ''}.
Return only JSON with overview, chapters [{chapterId,progress}], biblePatch [{kind,op,entry}], glossaryPatch [entry].
Bible kinds: character, relation, location, timeline, foreshadowing, style. Every entry has an id and status ("candidate"); use actual chapter IDs for provenance and relationships reference existing or extracted characters. Characters have name and aliases (mark main characters major:true); locations have name and description; relations have from, to and description; timeline has chapterId and event; foreshadowing has plantedChapter and description; style has description; glossary has original, written and category.
Use stable IDs; record changing identities in changes with chapterId, field and value. Keep confirmed facts intact; ${incremental ? 'do not emit delete for successive volumes.' : 'delete only a mistaken candidate from this volume.'}
Existing entries:
${JSON.stringify(bible)}`
	const wholePrompt = `${instructions}
Synthesize the entire volume. Include progress for every chapter.
Chapter previews:
${packetText.join('\n')}`
	const useEvents =
		strategy === 'events' ||
		(strategy === 'auto' && bytes(wholePrompt) + 384 > budget)
	const packetBudget = Math.floor(
		(budget - bytes(instructions) - historyBudget - 768) / 3,
	)
	const packets =
		useEvents && packetBudget > 0
			? previewPackets(packetText, chapterIds, packetBudget)
			: []
	const limit =
		options.maxEvents ?? Math.max(minimumEventLimit, packets.length * 4)
	const state: Checkpoint = quarantined ??
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
		validator: {
			validate(
				input: unknown,
			): { ok: true; value: T } | { ok: false; errors: unknown }
		},
		check: (output: T) => void,
	): Promise<T> {
		const messages = [{ role: 'user' as const, content: prompt, timestamp: 0 }]
		for (let attempt = 0; ; attempt++) {
			options.signal?.throwIfAborted()
			if (
				messages.reduce((total, message) => total + bytes(message.content), 0) >
				budget
			)
				throw new Error('Synthesis input exceeds the model context budget')
			const response = await stream(model, normalizeContext({ messages }), {
				apiKey: options.connection.apiKey,
				signal: options.signal,
				outputLimit: maxTokens,
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
				const validation = validator.validate(parseModelJson(text))
				if (!validation.ok) throw new Error(JSON.stringify(validation.errors))
				check(validation.value)
				return validation.value
			} catch (error) {
				if (attempt === 1) throw error
				messages.push({
					role: 'user',
					content: `Repair the JSON: ${String(error).slice(0, 320)}`,
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
			`${instructions}
Extract only the next event in packet ${packet + 1}/${packets.length}. A packet can contain a fragment of a chapter preview. Include one event string, only its changes, and is_last (true if this is the last event of this packet); report progress for affected chapters.
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
	const skeleton = combine(volumeId, chapterIds, parts)
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
			? chapterIds
			: [...(packets[packetIndex] ?? '').matchAll(/^Chapter ([\w-]+):$/gm)].map(
					([, id]) => id,
				)
		const affected = unique(
			part.chapters
				.map(({ chapterId }) => chapterId)
				.filter((id) => packetIds.includes(id)),
		)
		const observed =
			affected.length === 1
				? affected[0]
				: new Set(packetIds).size === 1
					? packetIds[0]
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
	const biblePatch = [...ordered].map(({ item, chapter }) =>
		chapter ? { ...item, observedChapter: chapter } : item,
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
			throw new Error('Bible changed during synthesis')
		state.ready = true
		await project.write(files.checkpoint, state)
		latest = await readBible(project)
	}
	const { conflicts, glossaryConflicts } =
		!quarantined && hash(latest) === state.basis
			? await applyPatches(
					project,
					latest,
					biblePatch,
					glossaryPatch,
					chapterSet,
					provenance,
				)
			: {
					conflicts: biblePatch
						.filter(({ op }) => op !== 'none')
						.map((item) => ({
							...item,
							entry: {
								...item.entry,
								status: 'candidate',
								conflict: 'Bible changed before synthesis publication',
							},
						})) as typeof biblePatch,
					glossaryConflicts: glossaryPatch.map((entry) => ({
						...entry,
						status: 'candidate' as const,
						conflict: 'Bible changed before synthesis publication',
					})),
				}
	const result: VolumeSynthesis = {
		...skeleton,
		biblePatch,
		glossaryPatch,
		conflicts,
		glossaryConflicts,
	}
	await project.write(projectFiles.skeleton(volumeId), skeleton)
	await project.write(files.result, result)
	await project.write(files.checkpoint, { ...state, applied: true })
	return result
}
