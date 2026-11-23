import { createHash } from 'node:crypto'
import type { BiblePatch } from '@novelive/format/model'
import { projectFiles } from '@novelive/format/model'
import { ChatStore, type ProposalSource } from '../../chat/store'
import type { CommandInput, Proposal } from '../../contract'
import type { Project } from '../../project'
import { existing, type readBible } from '../../synthesis/patch'

type Bible = Awaited<ReturnType<typeof readBible>>
type Kind = keyof Bible
type Payload = Extract<Proposal['payload'], { kind: 'bible' | 'glossary' }>
const scope = { level: 'series' } as const

export function sourceRevision(value: unknown) {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex')
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
	function record(source: ProposalSource, key: string, payload: Payload) {
		const id = `bible-source:${sourceRevision([input.workId, input.volumeId, source, key])}`
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
			source,
		)
	}
	const conflicts = new Set<string>()
	if (result) {
		const checkpoint = result.bibleRevision
			? undefined
			: await existing(() => project.read(files.checkpoint))
		const expectedRevision =
			result.bibleRevision ??
			(checkpoint?.applied && checkpoint.ready
				? checkpoint.basis
				: 'unversioned-synthesis')
		const source = { path: files.result.path, revision: sourceRevision(result) }
		for (const change of result.conflicts) {
			if (change.op === 'none') continue
			const key = `${change.kind}/${change.entry.id}`
			conflicts.add(key)
			record(source, `${key}/${sourceRevision(change)}`, {
				kind: 'bible',
				volumeId: input.volumeId,
				expectedRevision,
				changes: [change],
			})
		}
		for (const entry of result.glossaryConflicts) {
			const key = `glossary/${entry.id}`
			conflicts.add(key)
			record(source, `${key}/${sourceRevision(entry)}`, {
				kind: 'glossary',
				volumeId: input.volumeId,
				expectedRevision,
				changes: [entry],
			})
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
			const expectedRevision = bible[kind].some(
				(other) => other.id === entry.id && other.status === 'confirmed',
			)
				? 'unversioned-conflict'
				: sourceRevision(bible)
			record(source, `${kind}/${entry.id}`, {
				volumeId: input.volumeId,
				expectedRevision,
				...(kind === 'glossary'
					? { kind: 'glossary', changes: [entry as Bible['glossary'][number]] }
					: {
							kind: 'bible',
							changes: [{ kind, op: 'update', entry } as BiblePatch[number]],
						}),
			})
		}
	}
}
