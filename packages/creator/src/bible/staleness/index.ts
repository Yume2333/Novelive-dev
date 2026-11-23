import { isDeepStrictEqual } from 'node:util'
import type { Project } from '../../project'
import type { readBible } from '../../synthesis/patch'

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

export function propagateStaleness(
	project: Project,
	before: Bible,
	after: Bible,
) {
	const prefixes = stalePrefixes(before, after)
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
