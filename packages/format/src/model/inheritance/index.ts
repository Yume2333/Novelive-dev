export function overlayEntries<T extends { id: string }>(
	...levels: readonly (readonly T[])[]
): T[] {
	const entries = new Map<string, T>()
	for (const level of levels)
		for (const entry of level) entries.set(entry.id, entry)
	return [...entries.values()]
}

export function concatenateStyles(...levels: readonly string[]): string {
	return levels.filter(Boolean).join('\n')
}
