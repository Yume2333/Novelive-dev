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

function timelineAction(text: string, participants: Names[]) {
	const labels = [...new Set(participants.flatMap((names) => [...names]))]
		.filter((label) => label.length > 1)
		.sort((a, b) => b.length - a.length)
	return labels.reduce(
		(action, label) => action.replaceAll(label, ''),
		normalize(text),
	)
}

function sameTimelineAction(a: string, b: string) {
	if (a === b) return a.length > 0
	const left = grams(a)
	const right = grams(b)
	const shared = [...left].filter((part) => right.has(part)).length
	return shared > 0 && shared / (left.size + right.size - shared) >= 0.65
}

type Entry = { op: string; kind: string } & (
	| { names: Names }
	| { action: string; chapter?: string; participants: Names[] }
)

function content(patch: Patch, existing: readonly CharacterNames[]): Entry[] {
	const characters = new Map(
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
						(id) => characters.get(id) ?? new Set(),
					),
				}
			case 'timeline': {
				const participants = mentioned(item.entry.event)
				return {
					kind,
					op,
					action: timelineAction(item.entry.event, participants),
					chapter: item.entry.chapterId,
					participants,
				}
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
	if (a.kind === 'timeline')
		return (
			a.participants.length > 0 &&
			a.participants.length === b.participants.length &&
			matchCount(a.participants, b.participants, overlap) ===
				a.participants.length &&
			sameTimelineAction(a.action, b.action)
		)
	const participantsMatch =
		a.participants.length >= 2 &&
		a.participants.length === b.participants.length &&
		matchCount(a.participants, b.participants, overlap) ===
			a.participants.length
	if (a.kind === 'relation')
		return participantsMatch && sameAction(a.action, b.action)
	return sameAction(a.action, b.action)
}

function scoreEntries(left: Entry[], right: Entry[]) {
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

export function scoreBiblePatches(
	whole: Patch,
	chunked: Patch,
	existing: readonly CharacterNames[] = [],
) {
	return scoreEntries(content(whole, existing), content(chunked, existing))
}

// Entries that at least `quorum` runs produce, each counted once.
function consensus(runs: Entry[][], quorum: number) {
	const claimed = runs.map(() => new Set<number>())
	const agreed: Entry[] = []
	for (const [r, run] of runs.entries())
		for (const [i, entry] of run.entries()) {
			if (claimed[r].has(i)) continue
			const matches = runs.flatMap((other, o) => {
				if (o <= r) return []
				const j = other.findIndex(
					(candidate, k) => !claimed[o].has(k) && sameEntry(entry, candidate),
				)
				return j < 0 ? [] : [[o, j] as const]
			})
			if (matches.length + 1 < quorum) continue
			claimed[r].add(i)
			for (const [o, j] of matches) claimed[o].add(j)
			agreed.push(entry)
		}
	return agreed
}

/**
 * Scores a chunked patch against the majority consensus of repeated
 * whole-volume runs, normalized by how well each whole run agrees with the
 * consensus of the others.
 */
export function scoreAgainstConsensus(
	wholeRuns: readonly Patch[],
	chunked: Patch,
	existing: readonly CharacterNames[] = [],
) {
	if (wholeRuns.length < 3)
		throw new Error('Consensus scoring needs at least three whole runs')
	const runs = wholeRuns.map((run) => content(run, existing))
	const quorum = Math.floor(runs.length / 2) + 1
	const reference = consensus(runs, quorum)
	const leaveOneOut = runs.map(
		(run, i) =>
			scoreEntries(
				consensus(
					runs.filter((_, j) => j !== i),
					Math.min(quorum, runs.length - 1),
				),
				run,
			).f1,
	)
	const baseline =
		leaveOneOut.reduce((sum, f1) => sum + f1, 0) / leaveOneOut.length
	const score = scoreEntries(reference, content(chunked, existing))
	return {
		...score,
		reference: reference.length,
		leaveOneOut,
		baseline,
		normalized: baseline ? score.f1 / baseline : 0,
	}
}
