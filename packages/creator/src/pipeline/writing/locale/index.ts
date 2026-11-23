import type { Character, Location } from '@novelive/format/model'

export function canonicalNamesBrief(
	language: string,
	characters: readonly Character[],
	locations: readonly Location[],
	terms: Readonly<Record<string, string>> = {},
) {
	const names = [...characters, ...locations].map(
		(entry) =>
			`${entry.originalName ?? entry.name} → ${entry.name} (ID: ${entry.id})`,
	)
	return [
		`Write directly in target language ${language}; do not translate in a separate pass. Keep machine IDs unchanged.`,
		'Canonical names (use these spellings consistently):',
		...names,
		...Object.entries(terms).map(
			([original, written]) => `${original} → ${written}`,
		),
	].join('\n')
}
