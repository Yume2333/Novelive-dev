import { isDeepStrictEqual } from 'node:util'
import { type ProjectScope, projectFiles } from '@novelive/format/model'
import type { Project } from '../../project'
import { existing, type readBible } from '../../synthesis/patch'

type Bible = Awaited<ReturnType<typeof readBible>>
type Family = 'character' | 'location' | 'cg'

export function stalePrefixes(before: Bible, after: Bible) {
	const prefixes: { prefix: string; family: Family }[] = []
	for (const character of before.character) {
		const next = after.character.find(({ id }) => id === character.id)
		if (!next || !isDeepStrictEqual(character.appearance, next.appearance))
			prefixes.push({ prefix: `${character.id}/`, family: 'character' })
		else
			for (const costume of character.costumes ?? []) {
				if (
					costume.description !==
					next.costumes?.find(({ id }) => id === costume.id)?.description
				)
					prefixes.push({
						prefix: `${character.id}/${costume.id}/`,
						family: 'character',
					})
			}
	}
	for (const location of before.location) {
		if (
			location.description !==
			after.location.find(({ id }) => id === location.id)?.description
		)
			prefixes.push({ prefix: `${location.id}/`, family: 'location' })
	}
	return prefixes
}

export async function propagateStaleness(
	project: Project,
	before: Bible,
	after: Bible,
) {
	const prefixes = stalePrefixes(before, after)
	const matches = (id: string, family: Family) =>
		prefixes.some(
			(target) => target.family === family && id.startsWith(target.prefix),
		)
	const families = new Map<string, Family>()
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
			const family =
				entry.type === 'character' || entry.type === 'expression'
					? 'character'
					: entry.type === 'cg'
						? 'cg'
						: 'location'
			for (const workId of workIds)
				families.set(`${workId}/${entry.id}`, family)
			if (
				entry.status !== 'drawn' ||
				entry.type === 'cg' ||
				!matches(entry.id, family)
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
	for (const asset of assets) {
		const id = String(asset.asset_key)
		const family =
			families.get(`${asset.work_id}/${id}`) ??
			(id.split('/').length === 3 ? 'character' : 'location')
		if (matches(id, family))
			project.database
				.prepare(
					"UPDATE asset SET status = 'stale' WHERE work_id = ? AND asset_key = ?",
				)
				.run(asset.work_id, asset.asset_key)
	}
}
