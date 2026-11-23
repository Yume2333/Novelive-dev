import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
	type AssetRegistry,
	concatenateStyles,
	formatVersion,
	overlayEntries,
	type ProjectDocument,
	type ProjectScope,
	projectFiles,
} from '@novelive/format/model'
import type { Project } from '../index'

export async function optionalFile<T>(read: () => Promise<T>) {
	try {
		return await read()
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
			return undefined
		throw error
	}
}

export function scopeLevels(scope: ProjectScope): ProjectScope[] {
	return [
		{ level: 'series' },
		...(scope.level === 'series'
			? []
			: [{ level: 'volume' as const, volumeId: scope.volumeId }]),
		...(scope.level === 'work' ? [scope] : []),
	]
}

async function scopedBible(project: Project, scope: ProjectScope) {
	const collection = async <T>(file: ProjectDocument<{ entries: T[] }>) =>
		(await optionalFile(() => project.read(file)))?.entries ?? []
	async function directory<T>(
		file: (id: string) => ProjectDocument<{ entries: T[] }>,
	) {
		const path = dirname(file('entry').path)
		const names = await optionalFile(() => readdir(join(project.root, path)))
		return (
			await Promise.all(
				(names ?? [])
					.filter((name) => /^[a-z0-9][a-z0-9_-]*\.json$/.test(name))
					.sort()
					.map((name) => collection(file(name.slice(0, -5)))),
			)
		).flat()
	}
	return {
		character: await directory((id) => projectFiles.character(scope, id)),
		relation: await collection(projectFiles.relations(scope)),
		location: await directory((id) => projectFiles.location(scope, id)),
		timeline: await collection(projectFiles.timeline(scope)),
		foreshadowing: await collection(projectFiles.foreshadowing(scope)),
		style: await collection(projectFiles.style(scope)),
		glossary: await collection(projectFiles.glossary(scope)),
	}
}

export async function resolveBible(
	project: Project,
	scope: ProjectScope = { level: 'series' },
) {
	const levels = await Promise.all(
		scopeLevels(scope).map((level) => scopedBible(project, level)),
	)
	return {
		character: overlayEntries(...levels.map((level) => level.character)),
		relation: overlayEntries(...levels.map((level) => level.relation)),
		location: overlayEntries(...levels.map((level) => level.location)),
		timeline: overlayEntries(...levels.map((level) => level.timeline)),
		foreshadowing: overlayEntries(
			...levels.map((level) => level.foreshadowing),
		),
		style: overlayEntries(...levels.map((level) => level.style)),
		glossary: overlayEntries(...levels.map((level) => level.glossary)),
	}
}

export async function resolveRegistry(
	project: Project,
	scope: ProjectScope,
): Promise<AssetRegistry> {
	const levels = await Promise.all(
		scopeLevels(scope).map(
			async (level) =>
				(
					await optionalFile(() =>
						project.read(projectFiles.assetRegistry(level)),
					)
				)?.entries ?? [],
		),
	)
	return { formatVersion, entries: overlayEntries(...levels) }
}

export async function resolveSeries(project: Project, scope: ProjectScope) {
	const styles = await Promise.all(
		scopeLevels(scope).map(
			async (level) =>
				(
					await optionalFile(() => project.readFile(projectFiles.styles(level)))
				)?.toString('utf8') ?? '',
		),
	)
	return {
		bible: await resolveBible(project, scope),
		registry: await resolveRegistry(project, scope),
		styles: concatenateStyles(...styles),
	}
}
