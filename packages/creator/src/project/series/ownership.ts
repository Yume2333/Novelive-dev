import { isDeepStrictEqual } from 'node:util'
import { formatVersion, overlayEntries, type ProjectDocument, type ProjectScope } from '@novelive/format/model'
import type { Project } from '../index'
import { optionalFile, scopeLevels } from './resolve'

type Entries<T> = { formatVersion: 1; entries: T[] }

export async function entryOwner<T extends { id: string }>(
	project: Project, readScope: ProjectScope, fallback: ProjectScope,
	file: (scope: ProjectScope) => ProjectDocument<Entries<T>>, id: string,
) {
	for (const scope of scopeLevels(readScope).reverse()) {
		const local = await optionalFile(() => project.read(file(scope)))
		if (local?.entries.some((entry) => entry.id === id)) return scope
	}
	return fallback
}

export async function persistOwnedEntries<T extends { id: string }>(
	project: Project, readScope: ProjectScope, fallback: ProjectScope,
	file: (scope: ProjectScope) => ProjectDocument<Entries<T>>, entries: readonly T[],
) {
	const levels = await Promise.all(scopeLevels(readScope).map(async (scope) => ({
		scope, document: await optionalFile(() => project.read(file(scope))),
	})))
	const effective = overlayEntries(...levels.map(({ document }) => document?.entries ?? []))
	const updates = new Map<string, { scope: ProjectScope; entries: T[] }>()
	for (const entry of entries) {
		if (isDeepStrictEqual(entry, effective.find((current) => current.id === entry.id))) continue
		const owner = levels.findLast(({ document }) => document?.entries.some((current) => current.id === entry.id))?.scope ?? fallback
		const path = file(owner).path
		const update = updates.get(path) ?? { scope: owner, entries: [] }
		update.entries.push(entry)
		updates.set(path, update)
	}
	for (const { scope, entries: changed } of updates.values()) {
		const target = file(scope)
		const local = await optionalFile(() => project.read(target))
		await project.write(target, { ...local, formatVersion, entries: overlayEntries(local?.entries ?? [], changed) })
	}
}
