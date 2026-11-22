import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import {
	type BiblePatch,
	type Character,
	type ForeshadowingEntry,
	formatVersion,
	type GlossaryPatch,
	type Location,
	type ProjectDocument,
	projectFiles,
	type Relation,
	type Style,
	type TimelineEntry,
} from '@novelive/format/model'
import type { Project } from '../project'

type Bible = {
	character: Character[]
	relation: Relation[]
	location: Location[]
	timeline: TimelineEntry[]
	foreshadowing: ForeshadowingEntry[]
	style: Style[]
	glossary: GlossaryPatch
}
type Patch = BiblePatch[number]
type Entry = Bible[keyof Bible][number]
type Collection<T> = { formatVersion: typeof formatVersion; entries: T[] }
type Change = NonNullable<Character['changes']>[number]
const scope = { level: 'series' } as const
const deletion = 'Proposed deletion of a confirmed entry'
const difference = 'Proposed fields differ from the confirmed entry'

export async function existing<T>(
	read: () => Promise<T>,
): Promise<T | undefined> {
	try {
		return await read()
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
			return undefined
		throw error
	}
}

export async function readBible(project: Project): Promise<Bible> {
	const collection = async <T>(file: ProjectDocument<Collection<T>>) =>
		(await existing(() => project.read(file)))?.entries ?? []
	async function directory<T>(
		name: string,
		file: (id: string) => ProjectDocument<Collection<T>>,
	) {
		const names = await existing(() =>
			readdir(join(project.root, 'bible', name), { withFileTypes: true }),
		)
		const ids = (names ?? [])
			.flatMap((entry) =>
				entry.isFile() && /^[a-z0-9][a-z0-9_-]*\.json$/.test(entry.name)
					? [entry.name.slice(0, -5)]
					: [],
			)
			.sort()
		return (await Promise.all(ids.map((id) => collection(file(id))))).flat()
	}
	const [
		character,
		relation,
		location,
		timeline,
		foreshadowing,
		style,
		glossary,
	] = await Promise.all([
		directory('characters', (id) => projectFiles.character(scope, id)),
		collection(projectFiles.relations(scope)),
		directory('locations', (id) => projectFiles.location(scope, id)),
		collection(projectFiles.timeline(scope)),
		collection(projectFiles.foreshadowing(scope)),
		collection(projectFiles.style(scope)),
		collection(projectFiles.glossary(scope)),
	])
	return {
		character,
		relation,
		location,
		timeline,
		foreshadowing,
		style,
		glossary,
	}
}

export function validatePatch(
	bible: Bible,
	patch: BiblePatch,
	glossary: GlossaryPatch,
	chapters: ReadonlySet<string>,
	seriesChapters: ReadonlySet<string>,
	incremental: boolean,
) {
	const ids = Object.fromEntries(
		Object.entries(bible).map(([kind, entries]) => [
			kind,
			new Set((entries as Entry[]).map(({ id }) => id)),
		]),
	) as Record<keyof Bible, Set<string>>
	for (const item of patch)
		if (item.op === 'add') ids[item.kind].add(item.entry.id)
	const requireChapter = (id?: string, keep = false) => {
		if (id !== undefined && !(keep ? seriesChapters : chapters).has(id))
			throw new Error(`Unknown chapter reference: ${id}`)
	}
	const requireCharacter = (id: string) => {
		if (!ids.character.has(id))
			throw new Error(`Unknown character reference: ${id}`)
	}
	for (const item of patch) {
		const { kind, op, entry } = item
		if (!ids[kind].has(entry.id))
			throw new Error(`Unknown ${kind} reference: ${entry.id}`)
		if (op === 'delete' && incremental)
			throw new Error('Incremental synthesis cannot delete entries')
		const current =
			op === 'add' ? undefined : bible[kind].find(({ id }) => id === entry.id)
		requireChapter(
			entry.firstSeenChapter,
			entry.firstSeenChapter === current?.firstSeenChapter,
		)
		requireChapter(
			entry.revealedChapter,
			entry.revealedChapter === current?.revealedChapter,
		)
		if (op === 'delete' || op === 'none') continue
		switch (kind) {
			case 'character':
				{
					const character =
						op === 'add'
							? undefined
							: bible.character.find(({ id }) => id === entry.id)
					for (const address of item.entry.addresses ?? [])
						requireCharacter(address.speakerId)
					for (const fact of item.entry.knows ?? [])
						requireChapter(
							fact.chapterId,
							character?.knows?.some((prior) => isDeepStrictEqual(prior, fact)),
						)
					for (const costume of item.entry.costumes ?? [])
						requireChapter(
							costume.fromChapter,
							character?.costumes?.some(
								(prior) =>
									prior.id === costume.id &&
									prior.fromChapter === costume.fromChapter,
							),
						)
				}
				break
			case 'relation':
				requireCharacter(item.entry.from)
				requireCharacter(item.entry.to)
				break
			case 'timeline':
				requireChapter(
					item.entry.chapterId,
					op !== 'add' &&
						bible.timeline.some(
							(prior) =>
								prior.id === entry.id &&
								prior.chapterId === item.entry.chapterId &&
								prior.event === item.entry.event &&
								prior.storyTime === item.entry.storyTime,
						),
				)
				break
			case 'foreshadowing':
				{
					const hint =
						op === 'add'
							? undefined
							: bible.foreshadowing.find(({ id }) => id === entry.id)
					requireChapter(
						item.entry.plantedChapter,
						item.entry.plantedChapter === hint?.plantedChapter,
					)
					requireChapter(
						item.entry.resolvedChapter,
						item.entry.resolvedChapter === hint?.resolvedChapter,
					)
				}
				break
		}
		if (kind === 'character' || kind === 'relation' || kind === 'location')
			for (const change of item.entry.changes ?? [])
				requireChapter(
					change.chapterId,
					'changes' in (current ?? {}) &&
						(current as Character | Relation | Location).changes?.some(
							(prior) => isDeepStrictEqual(prior, change),
						),
				)
	}
	for (const term of glossary) {
		const current = bible.glossary.find(({ id }) => id === term.id)
		requireChapter(
			term.firstSeenChapter,
			term.firstSeenChapter === current?.firstSeenChapter,
		)
		requireChapter(
			term.revealedChapter,
			term.revealedChapter === current?.revealedChapter,
		)
	}
}

function unique<T>(values: T[]) {
	const result: T[] = []
	for (const value of values)
		if (!result.some((other) => isDeepStrictEqual(value, other)))
			result.push(value)
	return result
}

type Point = Omit<Change, 'chapterId'> & { chapterId?: string }
type History = Map<string, Point>

function temporalField(kind: keyof Bible) {
	if (kind === 'character') return 'identity'
	if (kind === 'relation' || kind === 'location') return 'description'
}

function changesOf(entry: Entry | undefined): Change[] {
	const changes = (entry as { changes?: unknown } | undefined)?.changes
	return Array.isArray(changes) ? changes : []
}

function temporalPoint(
	kind: keyof Bible,
	entry: Entry,
	chapterId?: string,
): Point | undefined {
	const field = temporalField(kind)
	const value = field && (entry as Entry & Record<string, unknown>)[field]
	if (field && typeof value === 'string') return { field, value, chapterId }
}

const pointKey = ({ field, value, chapterId }: Point) =>
	JSON.stringify([field, value, chapterId])

export function proposalKeys(item: Patch, observedChapter?: string) {
	const point =
		item.op === 'add' || item.op === 'update'
			? temporalPoint(item.kind, item.entry, observedChapter)
			: undefined
	return {
		content: JSON.stringify(item),
		observation: point?.chapterId ? pointKey(point) : undefined,
	}
}

function existingHistory(
	current: Entry | undefined,
	kind: keyof Bible,
): History {
	const points: Point[] = changesOf(current).filter(
		({ field }) => field === temporalField(kind),
	)
	const base = current && temporalPoint(kind, current, current.firstSeenChapter)
	if (base) points.unshift(base)
	return new Map(points.map((point) => [pointKey(point), point]))
}

function addPoints(history: History, points: Point[]) {
	const additions = new Map<string, Point>()
	for (const point of points) {
		const key = pointKey(point)
		if (history.has(key) || additions.has(key)) continue
		if (
			[...history.values(), ...additions.values()].some(
				(prior) =>
					prior.field === point.field &&
					prior.chapterId === point.chapterId &&
					prior.value !== point.value,
			)
		)
			return false
		additions.set(key, point)
	}
	for (const [key, point] of additions) history.set(key, point)
	return true
}

function normalizeHistory<T extends Entry>(
	entry: T,
	history: History,
	order: ReadonlyMap<string, number>,
): T {
	const rank = (chapter?: string) =>
		chapter === undefined ? -1 : (order.get(chapter) ?? -1)
	const points = [...history.values()].sort(
		(a, b) => rank(a.chapterId) - rank(b.chapterId),
	)
	const base = points[0]
	if (!base) return entry
	const transitions = points
		.slice(1)
		.filter(
			(point, index) =>
				point.chapterId !== undefined && point.value !== points[index].value,
		)
	const changes = [
		...changesOf(entry).filter(({ field }) => field !== base.field),
		...transitions,
	]
	const firstSeenChapter =
		base.chapterId && rank(base.chapterId) < rank(entry.firstSeenChapter)
			? base.chapterId
			: entry.firstSeenChapter
	return {
		...entry,
		[base.field]: base.value,
		...(firstSeenChapter ? { firstSeenChapter } : {}),
		...(changes.length || 'changes' in entry ? { changes } : {}),
	}
}

function merge<T extends Entry>(
	current: T | undefined,
	raw: T,
	kind: keyof Bible,
	observedChapter?: string,
	history?: History,
) {
	const { conflict: _conflict, ...fields } = raw
	const candidate = { ...fields, status: 'candidate' } as T
	const temporal = temporalField(kind)
	const incoming = { ...candidate } as Entry & Record<string, unknown>
	const before = current as (Entry & Record<string, unknown>) | undefined
	const after = { ...(current ?? candidate) } as T & Record<string, unknown>
	const proposedChanges = changesOf(candidate)
	if (temporal) delete incoming[temporal]
	const metadata = new Set([
		'status',
		'conflict',
		'firstSeenChapter',
		'revealedChapter',
		'changes',
		'knows',
	])
	const fixedConflict =
		current?.status === 'confirmed' &&
		(proposedChanges.some(({ field }) => field !== temporal) ||
			Object.entries(incoming).some(
				([key, value]) =>
					!metadata.has(key) && !isDeepStrictEqual(before?.[key], value),
			))
	const points: Point[] = proposedChanges.filter(
		({ field }) => field === temporal,
	)
	const observation = temporalPoint(
		kind,
		candidate,
		observedChapter ?? (!current ? candidate.firstSeenChapter : undefined),
	)
	if (observation && (observation.chapterId || !current))
		points.push(observation)
	const temporalConflict =
		!fixedConflict && history && !addPoints(history, points)
	if (current && (fixedConflict || temporalConflict))
		return {
			entry: current,
			conflict: {
				...candidate,
				conflict: fixedConflict
					? difference
					: 'Different temporal values claimed for the same chapter',
			} as T,
		}
	if (temporalConflict)
		return {
			entry: undefined,
			conflict: {
				...candidate,
				conflict: 'Different temporal values claimed for the same chapter',
			} as T,
		}
	if (current?.status !== 'confirmed') Object.assign(after, incoming)
	for (const field of ['firstSeenChapter', 'revealedChapter'] as const)
		if (current?.[field] !== undefined) after[field] = current[field]
	const changes = unique([
		...changesOf(current),
		...proposedChanges.filter(({ field }) => field !== temporal),
	])
	if (changes.length || 'changes' in incoming)
		Object.assign(after, {
			changes,
		})
	if (Array.isArray(incoming.knows))
		Object.assign(after, {
			knows: unique([
				...(Array.isArray(before?.knows) ? before.knows : []),
				...incoming.knows,
			]),
		})
	return { entry: after }
}

export async function applyPatches(
	project: Project,
	bible: Bible,
	patch: BiblePatch,
	glossary: GlossaryPatch,
	chapters: ReadonlySet<string>,
	observations: ReadonlyMap<Patch, string> = new Map(),
	seriesChapters = chapters,
): Promise<{ conflicts: BiblePatch; glossaryConflicts: GlossaryPatch }> {
	const chapterOrder = new Map(
		Array.from(seriesChapters, (id, index) => [id, index]),
	)
	const conflicts: BiblePatch = []
	const glossaryConflicts: GlossaryPatch = []
	const pending: (() => Promise<void>)[] = []
	const characterDeletions: (() => Promise<void>)[] = []
	const removedCharacters = new Set<string>()
	let survivingCharacters = bible.character
	let survivingRelations = bible.relation
	const write = async <T>(
		file: ProjectDocument<Collection<T>>,
		entries: T[],
	) => {
		const original = await existing(() => project.read(file))
		await project.write(file, { ...original, formatVersion, entries })
	}
	async function apply<E extends Entry>(
		kind: Patch['kind'],
		original: E[],
		persist: (entries: NoInfer<E>[], ids: Set<string>) => Promise<void>,
	) {
		const entries = new Map(original.map((entry) => [entry.id, entry]))
		const histories = new Map<string, History>()
		const changed = new Set<string>()
		for (const item of patch) {
			if (item.kind !== kind || item.op === 'none') continue
			const current = entries.get(item.entry.id)
			if (item.op === 'delete') {
				if (current?.status === 'confirmed')
					conflicts.push({
						...item,
						entry: { ...item.entry, status: 'candidate', conflict: deletion },
					} as Patch)
				else if (
					current?.firstSeenChapter &&
					chapters.has(current.firstSeenChapter)
				) {
					entries.delete(current.id)
					histories.delete(current.id)
					changed.add(current.id)
					if (kind === 'character') removedCharacters.add(current.id)
				}
				continue
			}
			const history =
				histories.get(item.entry.id) ?? existingHistory(current, kind)
			const { entry, conflict } = merge<E>(
				current,
				item.entry as E,
				kind,
				observations.get(item),
				history,
			)
			if (conflict) conflicts.push({ ...item, entry: conflict } as Patch)
			else if (entry && history.size) histories.set(entry.id, history)
			if (entry && !isDeepStrictEqual(current, entry)) {
				entries.set(entry.id, entry)
				changed.add(entry.id)
			}
		}
		for (const [id, history] of histories) {
			const entry = entries.get(id)
			if (!entry) continue
			const normalized = normalizeHistory(entry, history, chapterOrder)
			if (!isDeepStrictEqual(entry, normalized)) {
				entries.set(id, normalized)
				changed.add(id)
			}
		}
		const survivors = [...entries.values()]
		if (kind === 'character') {
			survivingCharacters = survivors as Character[]
			for (const id of removedCharacters) {
				if (entries.has(id)) removedCharacters.delete(id)
				else {
					changed.delete(id)
					characterDeletions.push(() => persist(survivors, new Set([id])))
				}
			}
		}
		if (kind === 'relation') survivingRelations = survivors as Relation[]
		if (changed.size) pending.push(() => persist(survivors, changed))
	}
	const perId =
		<T extends Entry>(file: (id: string) => ProjectDocument<Collection<T>>) =>
		async (entries: T[], ids: Set<string>) => {
			for (const id of ids)
				await write(
					file(id),
					entries.filter((entry) => entry.id === id),
				)
		}
	await apply(
		'character',
		bible.character,
		perId((id) => projectFiles.character(scope, id)),
	)
	await apply(
		'location',
		bible.location,
		perId((id) => projectFiles.location(scope, id)),
	)
	await apply('relation', bible.relation, (entries) =>
		write(projectFiles.relations(scope), entries),
	)
	await apply('timeline', bible.timeline, (entries) =>
		write(projectFiles.timeline(scope), entries),
	)
	await apply('foreshadowing', bible.foreshadowing, (entries) =>
		write(projectFiles.foreshadowing(scope), entries),
	)
	await apply('style', bible.style, (entries) =>
		write(projectFiles.style(scope), entries),
	)

	const blocked = new Set(
		[
			...survivingRelations.flatMap(({ from, to }) => [from, to]),
			...survivingCharacters.flatMap(
				({ addresses }) => addresses?.map(({ speakerId }) => speakerId) ?? [],
			),
		].filter((id) => removedCharacters.has(id)),
	)
	if (blocked.size) {
		const allowed: BiblePatch = []
		const rejected: BiblePatch = []
		for (const item of patch)
			if (
				item.kind === 'character' &&
				item.op === 'delete' &&
				blocked.has(item.entry.id)
			)
				rejected.push({
					...item,
					entry: {
						...item.entry,
						status: 'candidate',
						conflict: `Cannot delete character ${item.entry.id}: still referenced in the Bible`,
					},
				})
			else allowed.push(item)
		const result = await applyPatches(
			project,
			bible,
			allowed,
			glossary,
			chapters,
			observations,
			seriesChapters,
		)
		return { ...result, conflicts: [...rejected, ...result.conflicts] }
	}

	const terms = new Map(bible.glossary.map((term) => [term.id, term]))
	let changed = false
	for (const incoming of glossary) {
		const current = terms.get(incoming.id)
		const { entry, conflict } = merge(current, incoming, 'glossary')
		if (conflict) glossaryConflicts.push(conflict)
		if (entry && !isDeepStrictEqual(current, entry)) {
			terms.set(entry.id, entry)
			changed = true
		}
	}
	for (const persist of pending) await persist()
	for (const persist of characterDeletions) await persist()
	if (changed) await write(projectFiles.glossary(scope), [...terms.values()])
	return { conflicts, glossaryConflicts }
}
