import { createHash } from 'node:crypto'
import type { BiblePatch } from '@novelive/format/model'
import { projectFiles } from '@novelive/format/model'
import { ChatStore, type ProposalSource } from '../../chat/store'
import type { CommandInput, Proposal } from '../../contract'
import type { Project } from '../../project'
import {
	bibleEntryBases,
	existing,
	type readBible,
} from '../../synthesis/patch'
import { prepareBiblePatch } from './patch'

type Bible = Awaited<ReturnType<typeof readBible>>
type Kind = keyof Bible
type Payload = Extract<Proposal['payload'], { kind: 'bible' | 'glossary' }>
const scope = { level: 'series' } as const

export function sourceRevision(value: unknown) {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function proposalRestriction(
	payload: Payload,
	bible: Bible,
	chapters: ReadonlySet<string>,
): string | undefined {
	try {
		prepareBiblePatch(bible, payload, chapters)
	} catch (error) {
		return error instanceof Error ? error.message : String(error)
	}
}

export function fileFor(kind: Kind, id: string) {
	switch (kind) {
		case 'character':
			return projectFiles.character(scope, id).path
		case 'location':
			return projectFiles.location(scope, id).path
		case 'relation':
			return projectFiles.relations(scope).path
		case 'timeline':
			return projectFiles.timeline(scope).path
		case 'foreshadowing':
			return projectFiles.foreshadowing(scope).path
		case 'style':
			return projectFiles.style(scope).path
		case 'glossary':
			return projectFiles.glossary(scope).path
	}
}

export async function sourceIsCurrent(
	project: Project,
	source: ProposalSource,
) {
	const body = await existing(() => project.readFile(source.path))
	if (!body) return false
	const value = JSON.parse(body.toString('utf8'))
	return source.entry
		? value.entries.some(
				(entry: { id: string }) =>
					entry.id === source.entry?.id &&
					sourceRevision(entry) === source.revision,
			)
		: sourceRevision(value) === source.revision
}

export function basesAreCurrent(
	bible: Bible,
	bases: NonNullable<ProposalSource['bases']>,
) {
	return bases.every(
		({ kind, id, revision }) =>
			kind in bible &&
			sourceRevision(bible[kind as Kind].filter((entry) => entry.id === id)) ===
				revision,
	)
}

export async function proposalActionability(
	project: Project,
	proposal: Proposal,
	bible: Bible,
	chapters: ReadonlySet<string>,
	source?: ProposalSource,
): Promise<
	| { canApprove: true }
	| { canApprove: false; status: 'stale' | 'restricted'; reason: string }
> {
	const payload = proposal.payload
	if (payload.kind !== 'bible' && payload.kind !== 'glossary')
		return {
			canApprove: false,
			status: 'restricted',
			reason: '不是设定或术语候选。',
		}
	if (source && !(await sourceIsCurrent(project, source)))
		return {
			canApprove: false,
			status: 'stale',
			reason: '候选来源已被替换或移除，请查看新的综合候选；仍可拒绝此候选。',
		}
	if (
		source &&
		(!source.bases || source.baseRevision !== payload.expectedRevision)
	)
		return {
			canApprove: false,
			status: 'stale',
			reason: '候选已过期：缺少可信的原始条目快照，请重新提出。',
		}
	if (
		source?.bases
			? !basesAreCurrent(bible, source.bases)
			: sourceRevision(bible) !== payload.expectedRevision
	)
		return {
			canApprove: false,
			status: 'stale',
			reason: '候选已过期：目标条目已变更，请重新提出；已确认内容保持不变。',
		}
	const reason = proposalRestriction(payload, bible, chapters)
	return reason
		? { canApprove: false, status: 'restricted', reason }
		: { canApprove: true }
}

export async function bridgeBibleSources(
	project: Project,
	input: CommandInput<'bible.get'>,
	bible: Bible,
	chapterIds: string[],
) {
	const { synthesisFiles } = await import('../../synthesis')
	const files = synthesisFiles(input.volumeId)
	const result = await existing(() => project.read(files.result))
	const store = new ChatStore(project.database, input.workId)
	const currentBases = bibleEntryBases(bible)
	function record(
		source: ProposalSource,
		key: string,
		payload: Payload,
		baseline: ProposalSource['bases'],
	) {
		const id = `bible-source:${sourceRevision([input.workId, input.volumeId, source, key])}`
		const targets =
			payload.kind === 'bible'
				? payload.changes.map(({ kind, entry }) => ({ kind, id: entry.id }))
				: payload.changes.map(({ id }) => ({ kind: 'glossary', id }))
		const bases = baseline
			? targets.map(
					({ kind, id }) =>
						baseline.find((base) => base.kind === kind && base.id === id) ?? {
							kind,
							id,
							revision: sourceRevision([]),
						},
				)
			: undefined
		store.recordStandaloneProposal(
			{
				id,
				workId: input.workId,
				sessionId: null,
				prompt: `综合候选：${key}`,
				status: 'pending',
				chapterIds,
				payload,
			},
			{
				...source,
				bases,
				...(bases ? { baseRevision: payload.expectedRevision } : {}),
			},
			sourceRevision(bible),
		)
	}
	const conflicts = new Set<string>()
	if (result) {
		const expectedRevision = result.bibleRevision ?? 'unversioned-synthesis'
		const baseline = result.quarantined
			? undefined
			: result.baseVersion === 1
				? result.bibleBase
				: result.bibleRevision === sourceRevision(bible)
					? currentBases
					: undefined
		const source = { path: files.result.path, revision: sourceRevision(result) }
		for (const change of result.conflicts) {
			if (change.op === 'none') continue
			const key = `${change.kind}/${change.entry.id}`
			conflicts.add(key)
			record(
				source,
				`${key}/${sourceRevision(change)}`,
				{
					kind: 'bible',
					volumeId: input.volumeId,
					expectedRevision,
					changes: [change],
				},
				baseline,
			)
		}
		for (const entry of result.glossaryConflicts) {
			const key = `glossary/${entry.id}`
			conflicts.add(key)
			record(
				source,
				`${key}/${sourceRevision(entry)}`,
				{
					kind: 'glossary',
					volumeId: input.volumeId,
					expectedRevision,
					changes: [entry],
				},
				baseline,
			)
		}
	}
	for (const kind of Object.keys(bible) as Kind[]) {
		for (const entry of bible[kind]) {
			if (entry.status !== 'candidate' || conflicts.has(`${kind}/${entry.id}`))
				continue
			const source = {
				path: fileFor(kind, entry.id),
				revision: sourceRevision(entry),
				entry: { kind, id: entry.id },
			}
			const expectedRevision = sourceRevision(bible)
			record(
				source,
				`${kind}/${entry.id}`,
				{
					volumeId: input.volumeId,
					expectedRevision,
					...(kind === 'glossary'
						? {
								kind: 'glossary',
								changes: [entry as Bible['glossary'][number]],
							}
						: {
								kind: 'bible',
								changes: [{ kind, op: 'update', entry } as BiblePatch[number]],
							}),
				},
				currentBases,
			)
		}
	}
}
