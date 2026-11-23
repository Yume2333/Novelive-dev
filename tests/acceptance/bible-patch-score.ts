import type {
	BiblePatch,
	Character,
	GlossaryPatch,
} from '../../packages/format/src/model'

type Patch = { biblePatch: BiblePatch; glossaryPatch: GlossaryPatch }
type Names = Set<string>
type CharacterNames = Pick<
	Character,
	'id' | 'name' | 'originalName' | 'aliases'
>

function normalize(text: string) {
	return text
		.normalize('NFKC')
		.toLowerCase()
		.replace(/[\p{P}\s]/gu, '')
}

function names(entry: object, ...labels: (string | undefined)[]) {
	const aliases =
		'aliases' in entry && Array.isArray(entry.aliases)
			? entry.aliases.filter(
					(alias): alias is string => typeof alias === 'string',
				)
			: []
	return new Set(
		[...labels, ...aliases].flatMap((label) => {
			const name = label ? normalize(label) : ''
			return name ? [name] : []
		}),
	)
}

function overlap(a: Names, b: Names) {
	return [...a].some((name) => b.has(name))
}

function grams(text: string) {
	const chars = [...normalize(text)]
	return new Set(chars.slice(1).map((char, i) => chars[i] + char))
}

function sameAction(a: string, b: string) {
	const left = grams(a)
	const right = grams(b)
	const shared = [...left].filter((part) => right.has(part)).length
	return (
		normalize(a) === normalize(b) ||
		(shared >= 3 && shared / Math.min(left.size, right.size) >= 0.5)
	)
}

type Entry = { op: string; kind: string } & (
	| { names: Names }
	| { action: string; chapter?: string; participants: Names[] }
)

function content(patch: Patch, existing: readonly CharacterNames[]): Entry[] {
	const characters = new Map<string, Names>()
	const existingNames = new Map(
		existing.map((entry) => [
			entry.id,
			names(entry, entry.name, entry.originalName),
		]),
	)
	for (const item of patch.biblePatch) {
		if (item.kind !== 'character') continue
		const { entry } = item
		const labels = names(entry, entry.name, entry.originalName)
		const known = characters.get(entry.id)
		if (known) for (const label of labels) known.add(label)
		else characters.set(entry.id, labels)
	}
	const mentioned = (text: string) => {
		const action = normalize(text)
		return [...characters.values()].filter((labels) =>
			[...labels].some((label) => label.length > 1 && action.includes(label)),
		)
	}
	const bible = patch.biblePatch.map((item): Entry => {
		const { kind, op, observedChapter } = item
		switch (kind) {
			case 'character':
			case 'location':
				return {
					kind,
					op,
					names: names(item.entry, item.entry.name, item.entry.originalName),
				}
			case 'relation':
				return {
					kind,
					op,
					action: item.entry.description,
					chapter: item.entry.firstSeenChapter ?? observedChapter,
					participants: [item.entry.from, item.entry.to].map(
						(id) =>
							new Set([
								...(characters.get(id) ?? []),
								...(existingNames.get(id) ?? []),
							]),
					),
				}
			case 'timeline':
				return {
					kind,
					op,
					action: item.entry.event,
					chapter: item.entry.chapterId,
					participants: mentioned(item.entry.event),
				}
			case 'foreshadowing':
				return {
					kind,
					op,
					action: item.entry.description,
					chapter: item.entry.plantedChapter,
					participants: mentioned(item.entry.description),
				}
			case 'style':
				return { kind, op, action: item.entry.description, participants: [] }
		}
		throw new Error(`Unsupported BiblePatch kind: ${kind satisfies never}`)
	})
	return [
		...bible,
		...patch.glossaryPatch.map((entry) => ({
			kind: 'glossary',
			op: 'add',
			names: names(entry, entry.original, entry.written),
		})),
	]
}

function matchCount<T>(left: T[], right: T[], match: (a: T, b: T) => boolean) {
	const edges = left.map((a) =>
		right.flatMap((b, i) => (match(a, b) ? [i] : [])),
	)
	const owners = new Map<number, number>()
	function assign(a: number, visited: Set<number>): boolean {
		for (const b of edges[a]) {
			if (visited.has(b)) continue
			visited.add(b)
			const owner = owners.get(b)
			if (owner !== undefined && !assign(owner, visited)) continue
			owners.set(b, a)
			return true
		}
		return false
	}
	for (const i of edges.keys()) assign(i, new Set())
	return owners.size
}

function sameEntry(a: Entry, b: Entry) {
	if (a.kind !== b.kind || a.op !== b.op) return false
	if ('names' in a && 'names' in b) return overlap(a.names, b.names)
	if (!('action' in a && 'action' in b) || a.chapter !== b.chapter) return false
	const participantsMatch =
		a.participants.length >= 2 &&
		a.participants.length === b.participants.length &&
		matchCount(a.participants, b.participants, overlap) ===
			a.participants.length
	if (a.kind === 'relation')
		return participantsMatch && sameAction(a.action, b.action)
	return (
		sameAction(a.action, b.action) ||
		(a.kind === 'timeline' && participantsMatch)
	)
}

export function scoreBiblePatches(
	whole: Patch,
	chunked: Patch,
	existing: readonly CharacterNames[] = [],
) {
	const left = content(whole, existing)
	const right = content(chunked, existing)
	const shared = matchCount(left, right, sameEntry)
	return {
		whole: left.length,
		chunked: right.length,
		shared,
		wholeOnly: left.length - shared,
		chunkedOnly: right.length - shared,
		f1:
			left.length + right.length
				? (2 * shared) / (left.length + right.length)
				: 0,
	}
}
