import { createHash } from 'node:crypto'
import {
	type HeadingRule,
	parseTxt,
} from '../../packages/creator/src/import/txt'
import type { BiblePatch, Character } from '../../packages/format/src/model'
import { scoreAgainstConsensus, scoreBiblePatches } from './bible-patch-score'
import type { WholeBookRun } from './owner-book-targets'

export type TimelineProvenancePointer = {
	chapterIndex: number
	chapterId: string
	paragraphIndex: number
	paragraphId: string
	paragraphOffset: number
	charOffset: number
	charLength: number
	byteOffset: number
	byteLength: number
	sha256: string
	anchor: string
}

export type TimelineReferenceItem = Extract<
	BiblePatch[number],
	{ kind: 'timeline' }
> & {
	provenance: TimelineProvenancePointer[]
}

export type TimelineReference = {
	formatVersion: number
	volumeId: string
	volumeTitle: string
	source: {
		title: string
		indexOldid: number
		sourceUrl: string
		bookSha256: string
		chapters: number
	}
	entries: TimelineReferenceItem[]
}

type CharacterNames = Pick<
	Character,
	'id' | 'name' | 'originalName' | 'aliases'
>

export function extractConsensusReference(
	runs: readonly WholeBookRun[],
	existing: readonly CharacterNames[] = [],
): WholeBookRun {
	const claimed = runs.map(() => ({
		bible: new Set<number>(),
		glossary: new Set<number>(),
	}))
	const biblePatch: BiblePatch = []
	const glossaryPatch: WholeBookRun['glossaryPatch'] = []
	const chars = (run: WholeBookRun) =>
		run.biblePatch.filter((item) => item.kind === 'character')
	for (let r = 0; r < runs.length; r++) {
		const leftChars = chars(runs[r])
		for (let i = 0; i < runs[r].biblePatch.length; i++) {
			if (claimed[r].bible.has(i)) continue
			const item = runs[r].biblePatch[i]
			const matches: [number, number][] = []
			for (let o = r + 1; o < runs.length; o++) {
				const rightChars = chars(runs[o])
				const base =
					item.kind === 'character'
						? 0
						: scoreBiblePatches(
								{ biblePatch: leftChars, glossaryPatch: [] },
								{ biblePatch: rightChars, glossaryPatch: [] },
								existing,
							).shared
				const leftProbe =
					item.kind === 'character'
						? { biblePatch: [item], glossaryPatch: [] }
						: { biblePatch: [...leftChars, item], glossaryPatch: [] }
				const j = runs[o].biblePatch.findIndex((candidate, k) => {
					if (
						claimed[o].bible.has(k) ||
						candidate.kind !== item.kind ||
						candidate.op !== item.op
					)
						return false
					const rightProbe =
						item.kind === 'character'
							? { biblePatch: [candidate], glossaryPatch: [] }
							: { biblePatch: [...rightChars, candidate], glossaryPatch: [] }
					return (
						scoreBiblePatches(leftProbe, rightProbe, existing).shared > base
					)
				})
				if (j >= 0) matches.push([o, j])
			}
			if (matches.length + 1 < 2) continue
			claimed[r].bible.add(i)
			for (const [o, j] of matches) claimed[o].bible.add(j)
			biblePatch.push(item)
		}
		for (let i = 0; i < runs[r].glossaryPatch.length; i++) {
			if (claimed[r].glossary.has(i)) continue
			const term = runs[r].glossaryPatch[i]
			const matches: [number, number][] = []
			for (let o = r + 1; o < runs.length; o++) {
				const j = runs[o].glossaryPatch.findIndex(
					(candidate, k) =>
						!claimed[o].glossary.has(k) &&
						scoreBiblePatches(
							{ biblePatch: [], glossaryPatch: [term] },
							{ biblePatch: [], glossaryPatch: [candidate] },
							existing,
						).shared === 1,
				)
				if (j >= 0) matches.push([o, j])
			}
			if (matches.length + 1 < 2) continue
			claimed[r].glossary.add(i)
			for (const [o, j] of matches) claimed[o].glossary.add(j)
			glossaryPatch.push(term)
		}
	}
	return { biblePatch, glossaryPatch }
}

export function buildOwnerBookReference(
	runs: readonly WholeBookRun[],
	reference: TimelineReference,
	existing: readonly CharacterNames[] = [],
): WholeBookRun {
	const agreed = extractConsensusReference(runs, existing)
	const timelineItems: BiblePatch = reference.entries.map(
		({ kind, op, entry }) => ({ kind, op, entry }),
	)
	return {
		biblePatch: [
			...agreed.biblePatch.filter((item) => item.kind !== 'timeline'),
			...timelineItems,
		],
		glossaryPatch: agreed.glossaryPatch,
	}
}

export function scoreOwnerBookAgainstReference(
	wholeRuns: readonly WholeBookRun[],
	reference: TimelineReference,
	chunked: WholeBookRun,
	existing: readonly CharacterNames[] = [],
) {
	const consensus = scoreAgainstConsensus(wholeRuns, chunked, existing)
	const referencePatch = buildOwnerBookReference(wholeRuns, reference, existing)
	const score = scoreBiblePatches(referencePatch, chunked, existing)
	return {
		...score,
		reference: score.whole,
		leaveOneOut: consensus.leaveOneOut,
		baseline: consensus.baseline,
		normalized: consensus.baseline ? score.f1 / consensus.baseline : 0,
	}
}

export function verifyTimelineReferenceProvenance(
	reference: TimelineReference,
	bookBytes: Uint8Array,
	rules: HeadingRule[],
) {
	const text = Buffer.from(bookBytes).toString('utf8')
	const parsed = parseTxt(text, { rules })
	const volume = parsed.volumes[0]
	if (!volume || volume.volumeId !== reference.volumeId)
		throw new Error(`Missing volume ${reference.volumeId} in book text`)
	if (volume.chapters.length !== reference.source.chapters)
		throw new Error(
			`Expected ${reference.source.chapters} chapters in ${reference.volumeId}, got ${volume.chapters.length}`,
		)
	const matchesSourceBytes =
		createHash('sha256').update(bookBytes).digest('hex') ===
		reference.source.bookSha256
	let verified = 0
	for (const item of reference.entries) {
		if (!item.provenance.length)
			throw new Error(`Timeline entry ${item.entry.id} has no provenance`)
		for (const pointer of item.provenance) {
			if (pointer.chapterId !== item.entry.chapterId)
				throw new Error(
					`Provenance chapter mismatch on ${item.entry.id}: ${pointer.chapterId}`,
				)
			const chapter = volume.chapters[pointer.chapterIndex - 1]
			const paragraph = chapter?.paragraphs[pointer.paragraphIndex]
			if (!chapter || !paragraph || paragraph.id !== pointer.paragraphId)
				throw new Error(
					`Missing paragraph ${pointer.chapterId}/${pointer.paragraphId}`,
				)
			const slice = paragraph.text.slice(
				pointer.paragraphOffset,
				pointer.paragraphOffset + pointer.charLength,
			)
			if (
				createHash('sha256')
					.update(Buffer.from(slice, 'utf8'))
					.digest('hex') !== pointer.sha256
			)
				throw new Error(
					`Provenance hash mismatch at ${pointer.chapterId}/${pointer.paragraphId}`,
				)
			const [head, tail] = pointer.anchor.split('…')
			if (!slice.startsWith(head) || (tail && !slice.endsWith(tail)))
				throw new Error(
					`Provenance anchor mismatch at ${pointer.chapterId}/${pointer.paragraphId}`,
				)
			if (matchesSourceBytes) {
				const rawSlice = Buffer.from(bookBytes)
					.subarray(pointer.byteOffset, pointer.byteOffset + pointer.byteLength)
					.toString('utf8')
				if (rawSlice !== slice)
					throw new Error(
						`Provenance byte offset mismatch at ${pointer.chapterId}/${pointer.paragraphId}`,
					)
			}
			verified++
		}
	}
	return verified
}
