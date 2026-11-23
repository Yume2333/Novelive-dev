import { isDeepStrictEqual } from 'node:util'
import { type ProjectScope, projectFiles } from '@novelive/format/model'
import type { Project } from '../../project'
import { existing, type readBible } from '../../synthesis/patch'

type Bible = Awaited<ReturnType<typeof readBible>>

export function stalePrefixes(before: Bible, after: Bible) {
	const prefixes: string[] = []
	for (const character of before.character) {
		const next = after.character.find(({ id }) => id === character.id)
		if (!next || !isDeepStrictEqual(character.appearance, next.appearance))
			prefixes.push(`${character.id}/`)
		else
			for (const costume of character.costumes ?? []) {
				if (
					costume.description !==
					next.costumes?.find(({ id }) => id === costume.id)?.description
				)
					prefixes.push(`${character.id}/${costume.id}/`)
			}
	}
	for (const location of before.location) {
		if (
			location.description !==
			after.location.find(({ id }) => id === location.id)?.description
		)
			prefixes.push(`${location.id}/`)
	}
	return prefixes
}

export async function propagateStaleness(
	project: Project,
	before: Bible,
	after: Bible,
) {
	const prefixes = stalePrefixes(before, after)
	const series = await project.read(projectFiles.series)
	const scopes: { scope: ProjectScope; workIds: string[] }[] = []
	const allWorks: string[] = []
	for (const volumeId of series.volumeIds) {
		const { workIds } = await project.read(projectFiles.volume(volumeId))
		allWorks.push(...workIds)
		scopes.push({ scope: { level: 'volume', volumeId }, workIds })
		for (const workId of workIds)
			scopes.push({
				scope: { level: 'work', volumeId, workId },
				workIds: [workId],
			})
	}
	scopes.push({ scope: { level: 'series' }, workIds: allWorks })
	for (const { scope, workIds } of scopes) {
		const registry = await existing(() =>
			project.read(projectFiles.assetRegistry(scope)),
		)
		for (const entry of registry?.entries ?? []) {
			if (
				entry.status !== 'drawn' ||
				entry.type === 'cg' ||
				!prefixes.some((prefix) => entry.id.startsWith(prefix))
			)
				continue
			for (const workId of workIds)
				project.database
					.prepare(`INSERT OR IGNORE INTO asset (work_id, asset_key, kind, status)
					SELECT ?, ?, ?, 'drawn' WHERE EXISTS (SELECT 1 FROM work WHERE work_id = ?)`)
					.run(
						workId,
						entry.id,
						entry.type === 'expression' || entry.type === 'variant'
							? 'variant'
							: 'base',
						workId,
					)
		}
	}
	const assets = project.database
		.prepare(
			"SELECT work_id, asset_key FROM asset WHERE kind != 'cg' AND status IN ('drawn','stale')",
		)
		.all()
	for (const asset of assets)
		if (prefixes.some((prefix) => String(asset.asset_key).startsWith(prefix)))
			project.database
				.prepare(
					"UPDATE asset SET status = 'stale' WHERE work_id = ? AND asset_key = ?",
				)
				.run(asset.work_id, asset.asset_key)
}
