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
	const requireChapter = (id?: string) => {
		if (id !== undefined && !chapters.has(id))
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
		requireChapter(entry.firstSeenChapter)
		requireChapter(entry.revealedChapter)
		if (op === 'delete' || op === 'none') continue
		switch (kind) {
			case 'character':
				for (const address of item.entry.addresses ?? [])
					requireCharacter(address.speakerId)
				for (const fact of item.entry.knows ?? [])
					requireChapter(fact.chapterId)
				for (const costume of item.entry.costumes ?? [])
					requireChapter(costume.fromChapter)
				break
			case 'relation':
				requireCharacter(item.entry.from)
				requireCharacter(item.entry.to)
				break
			case 'timeline':
				requireChapter(item.entry.chapterId)
				break
			case 'foreshadowing':
				requireChapter(item.entry.plantedChapter)
				requireChapter(item.entry.resolvedChapter)
				break
		}
		if (kind === 'character' || kind === 'relation' || kind === 'location')
			for (const change of item.entry.changes ?? [])
				requireChapter(change.chapterId)
	}
	for (const term of glossary) {
		requireChapter(term.firstSeenChapter)
		requireChapter(term.revealedChapter)
	}
}

function unique<T>(values: T[]) {
	const result: T[] = []
	for (const value of values)
		if (!result.some((other) => isDeepStrictEqual(value, other)))
			result.push(value)
	return result
}

function merge<T extends Entry>(
	current: T | undefined,
	raw: T,
	kind: keyof Bible,
) {
	const { conflict: _conflict, ...fields } = raw
	const candidate = { ...fields, status: 'candidate' } as T
	if (!current) return { entry: candidate }
	const temporal =
		kind === 'character'
			? 'identity'
			: kind === 'relation'
				? 'description'
				: undefined
	const incoming = candidate as Entry & Record<string, unknown>
	const before = current as Entry & Record<string, unknown>
	const after = { ...current } as T & Record<string, unknown>
	const changes = Array.isArray(incoming.changes)
		? [...(incoming.changes as Change[])]
		: []
	const anchor = candidate.firstSeenChapter
	if (
		temporal &&
		anchor &&
		typeof incoming[temporal] === 'string' &&
		before[temporal] !== undefined &&
		incoming[temporal] !== before[temporal]
	) {
		changes.push({
			chapterId: anchor,
			field: temporal,
			value: incoming[temporal],
		})
		delete incoming[temporal]
	}
	const metadata = new Set([
		'status',
		'conflict',
		'firstSeenChapter',
		'revealedChapter',
		'changes',
		'knows',
	])
	const hasConflict =
		current.status === 'confirmed' &&
		Object.entries(incoming).some(
			([key, value]) =>
				!metadata.has(key) && !isDeepStrictEqual(before[key], value),
		)
	if (hasConflict)
		return {
			entry: current,
			conflict: {
				...candidate,
				...fields,
				status: 'candidate',
				conflict: difference,
			} as T,
		}
	if (current.status !== 'confirmed') Object.assign(after, incoming)
	for (const field of ['firstSeenChapter', 'revealedChapter'] as const)
		if (current[field] !== undefined) after[field] = current[field]
	if (changes.length)
		Object.assign(after, {
			changes: unique([
				...(Array.isArray(before.changes) ? before.changes : []),
				...changes,
			]),
		})
	if (Array.isArray(incoming.knows))
		Object.assign(after, {
			knows: unique([
				...(Array.isArray(before.knows) ? before.knows : []),
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
) {
	const conflicts: BiblePatch = []
	const glossaryConflicts: GlossaryPatch = []
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
					changed.add(current.id)
				}
				continue
			}
			const { entry, conflict } = merge<E>(current, item.entry as E, kind)
			if (conflict) conflicts.push({ ...item, entry: conflict } as Patch)
			if (!isDeepStrictEqual(current, entry)) {
				entries.set(entry.id, entry)
				changed.add(entry.id)
			}
		}
		if (changed.size) await persist([...entries.values()], changed)
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

	const terms = new Map(bible.glossary.map((term) => [term.id, term]))
	let changed = false
	for (const incoming of glossary) {
		const current = terms.get(incoming.id)
		const { entry, conflict } = merge(current, incoming, 'glossary')
		if (conflict) glossaryConflicts.push(conflict)
		if (!isDeepStrictEqual(current, entry)) {
			terms.set(entry.id, entry)
			changed = true
		}
	}
	if (changed) await write(projectFiles.glossary(scope), [...terms.values()])
	return { conflicts, glossaryConflicts }
}
