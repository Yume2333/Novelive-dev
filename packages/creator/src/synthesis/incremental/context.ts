export function scopedOnlyBrief(
	context: Record<string, readonly { id: string }[]>,
	publication: Record<string, readonly { id: string }[]>,
) {
	const entries = Object.entries(context).flatMap(([kind, entries]) =>
		entries
			.filter(({ id }) => !publication[kind]?.some((entry) => entry.id === id))
			.map(({ id }) => ({ kind, id })),
	)
	return entries.length
		? `\nScoped-only entries (not in the series publication bible; add to biblePatch before referencing, or glossaryPatch for glossary entries):\n${JSON.stringify(entries)}`
		: ''
}
