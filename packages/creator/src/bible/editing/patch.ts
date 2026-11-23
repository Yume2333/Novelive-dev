import type { BiblePatch } from '@novelive/format/model'
import type { Proposal } from '../../contract'
import { type readBible, validatePatch } from '../../synthesis/patch'

type Bible = Awaited<ReturnType<typeof readBible>>
type Kind = keyof Bible
type Entry = Bible[Kind][number]
type Payload = Extract<Proposal['payload'], { kind: 'bible' | 'glossary' }>

export function prepareBiblePatch(
	bible: Bible,
	payload: Payload,
	chapters: ReadonlySet<string>,
) {
	const patch = payload.kind === 'bible' ? payload.changes : []
	const scoped = patch.find(
		(change) => change.op !== 'none' && change.observedChapter,
	)
	if (scoped)
		throw new Error(
			`此候选限定于章节 ${scoped.observedChapter}，暂不支持按章应用；仅可拒绝，不能覆盖全局设定。`,
		)
	validatePatch(
		bible,
		patch,
		payload.kind === 'glossary' ? payload.changes : [],
		chapters,
		chapters,
		false,
	)
	const after = structuredClone(bible)
	const touched = new Set<Kind>()
	const changes =
		payload.kind === 'bible'
			? payload.changes
			: payload.changes.map((entry) => ({
					kind: 'glossary' as const,
					op: 'update' as const,
					entry,
				}))
	for (const { kind, op, entry } of changes) {
		if (op === 'none') continue
		touched.add(kind)
		const entries = after[kind] as Entry[]
		const index = entries.findIndex(({ id }) => id === entry.id)
		if (op === 'delete') {
			if (index >= 0) entries.splice(index, 1)
			continue
		}
		const { conflict: _, ...fields } = entry
		const confirmed = { ...fields, status: 'confirmed' as const }
		if (index >= 0) entries[index] = confirmed
		else entries.push(confirmed)
	}
	const remaining = (Object.keys(after) as Kind[]).flatMap((kind) =>
		kind === 'glossary'
			? []
			: after[kind].map((entry) => ({ kind, op: 'update', entry })),
	) as BiblePatch
	validatePatch(after, remaining, after.glossary, chapters, chapters, false)
	return { after, touched }
}
