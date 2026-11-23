import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { compile } from '@earendil-works/pi-schema'
import { formatVersion, projectFiles } from '@novelive/format/model'
import {
	type CommandInput,
	type CommandOutput,
	type Proposal,
	proposalSchema,
} from '../../contract'
import { Project } from '../../project'
import { existing, readBible, validatePatch } from '../../synthesis/patch'

type Bible = Awaited<ReturnType<typeof readBible>>
type Kind = keyof Bible
type Entry = Bible[Kind][number]
type Payload = Extract<Proposal['payload'], { kind: 'bible' | 'glossary' }>
const scope = { level: 'series' } as const
const locks = new Map<string, Promise<unknown>>()

async function exclusive<T>(
	project: Project,
	action: () => Promise<T>,
): Promise<T> {
	const prior = locks.get(project.root) ?? Promise.resolve()
	const next = prior.catch(() => {}).then(action)
	locks.set(project.root, next)
	try {
		return await next
	} finally {
		if (locks.get(project.root) === next) locks.delete(project.root)
	}
}

export function bibleRevision(bible: Bible): string {
	return createHash('sha256').update(JSON.stringify(bible)).digest('hex')
}

export async function openBibleProject(dataDir: string, workId: string) {
	const directory = await readFile(join(dataDir, 'projects', workId), 'utf8')
	return Project.open(directory)
}

async function workContext(
	project: Project,
	workId: string,
	volumeId?: string,
) {
	const series = await project.read(projectFiles.series)
	for (const id of series.volumeIds) {
		if (volumeId && id !== volumeId) continue
		const volume = await project.read(projectFiles.volume(id))
		if (volume.workIds.includes(workId))
			return project.read(projectFiles.work(id, workId))
	}
	throw { code: 'not_found', message: '工程中找不到这部作品或卷' }
}

export function getBibleProposal(
	project: Project,
	workId: string,
	proposalId: string,
): Proposal {
	const row = project.database
		.prepare('SELECT * FROM proposal WHERE work_id = ? AND proposal_id = ?')
		.get(workId, proposalId)
	if (!row) throw { code: 'not_found', message: '找不到候选' }
	const payload = JSON.parse(String(row.payload))
	const proposal = {
		workId,
		id: proposalId,
		sessionId: row.session_id,
		prompt: row.prompt,
		chapterIds: [],
		payload,
		status: row.status,
		...(row.feedback === null ? {} : { feedback: row.feedback }),
	}
	const result = compile(proposalSchema).validate(proposal)
	if (!result.ok) throw { code: 'invalid_config', message: '候选数据无效' }
	return result.value
}

export async function getBible(
	project: Project,
	input: CommandInput<'bible.get'>,
): Promise<CommandOutput<'bible.get'>> {
	const work = await workContext(project, input.workId, input.volumeId)
	const bible = await readBible(project)
	const paragraphs = await Promise.all(
		work.chapterIds.map(async (chapterId) => {
			const body = await existing(() =>
				project.readFile(projectFiles.chapterText(chapterId)),
			)
			const chapter = await project.read(
				projectFiles.chapter({
					volumeId: input.volumeId,
					workId: input.workId,
					chapterId,
				}),
			)
			return {
				chapterId,
				ids: chapter.paragraphIds,
				text: body?.toString('utf8').replace(/\n$/, '').split('\n\n') ?? [],
			}
		}),
	)
	function locate<T extends Entry>(entry: T): T {
		const record = entry as Entry & Record<string, unknown>
		const names = ['name', 'originalName', 'original', 'written'].flatMap(
			(field) =>
				typeof record[field] === 'string' && record[field]
					? [record[field] as string]
					: [],
		)
		if ('aliases' in entry && Array.isArray(entry.aliases))
			names.push(...entry.aliases)
		return {
			...entry,
			occurrences: paragraphs.flatMap(({ chapterId, ids, text }) =>
				text.flatMap((paragraph, index) =>
					names.some((name) => paragraph.includes(name))
						? [{ chapterId, paragraphId: ids[index], quote: paragraph }]
						: [],
				),
			),
		}
	}
	const proposalIds = project.database
		.prepare(
			"SELECT proposal_id FROM proposal WHERE work_id = ? AND status = 'pending' AND kind IN ('bible','glossary') ORDER BY created_at, proposal_id",
		)
		.all(input.workId)
		.flatMap((row) => {
			const proposal = getBibleProposal(
				project,
				input.workId,
				String(row.proposal_id),
			)
			return 'volumeId' in proposal.payload &&
				proposal.payload.volumeId === input.volumeId
				? [proposal.id]
				: []
		})
	return {
		revision: bibleRevision(bible),
		characters: bible.character.map(locate),
		locations: bible.location.map(locate),
		relations: bible.relation.map(locate),
		timeline: bible.timeline.map(locate),
		foreshadowing: bible.foreshadowing.map(locate),
		styles: bible.style.map(locate),
		glossary: bible.glossary.map(locate),
		proposalIds,
	}
}

function fileFor(kind: Kind, id: string) {
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

function stalePrefixes(before: Bible, after: Bible) {
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

async function apply(project: Project, workId: string, payload: Payload) {
	const before = await readBible(project)
	if (bibleRevision(before) !== payload.expectedRevision) return false
	await workContext(project, workId, payload.volumeId)
	const chapters = new Set<string>()
	const series = await project.read(projectFiles.series)
	for (const volumeId of series.volumeIds) {
		const volume = await project.read(projectFiles.volume(volumeId))
		for (const id of volume.workIds)
			for (const chapter of (
				await project.read(projectFiles.work(volumeId, id))
			).chapterIds)
				chapters.add(chapter)
	}
	validatePatch(
		before,
		payload.kind === 'bible' ? payload.changes : [],
		payload.kind === 'glossary' ? payload.changes : [],
		chapters,
		chapters,
		false,
	)
	const after = structuredClone(before)
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
	const ids = new Set(after.character.map(({ id }) => id))
	for (const relation of after.relation)
		if (!ids.has(relation.from) || !ids.has(relation.to))
			throw { code: 'invalid_config', message: '角色仍被关系引用，不能删除' }
	for (const character of after.character)
		for (const address of character.addresses ?? [])
			if (!ids.has(address.speakerId))
				throw { code: 'invalid_config', message: '角色仍被称呼引用，不能删除' }
	const writes = new Map<string, Entry[]>()
	for (const kind of touched) {
		if (kind === 'character' || kind === 'location') {
			for (const entry of [...before[kind], ...after[kind]])
				writes.set(
					fileFor(kind, entry.id),
					after[kind].filter(({ id }) => id === entry.id),
				)
		} else writes.set(fileFor(kind, ''), after[kind])
	}
	for (const [path, entries] of writes)
		await project.writeFile(
			path,
			`${JSON.stringify({ formatVersion, entries }, null, '\t')}\n`,
		)
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
	return true
}

export async function applyBibleProposal(
	project: Project,
	proposal: Proposal,
): Promise<'applied' | 'stale'> {
	const payload = proposal.payload
	if (payload.kind !== 'bible' && payload.kind !== 'glossary')
		throw { code: 'unsupported', message: '不是设定或术语候选' }
	return exclusive(project, async () =>
		(await apply(project, proposal.workId, payload)) ? 'applied' : 'stale',
	)
}

export async function resolveBibleProposal(
	project: Project,
	input: CommandInput<'proposal.resolve'>,
): Promise<CommandOutput<'proposal.resolve'>> {
	return exclusive(project, async () => {
		const proposal = getBibleProposal(project, input.workId, input.proposalId)
		if (
			proposal.payload.kind !== 'bible' &&
			proposal.payload.kind !== 'glossary'
		)
			throw { code: 'unsupported', message: '不是设定或术语候选' }
		if (proposal.status !== 'pending') return { status: 'resolved', proposal }
		if (
			input.decision.kind === 'approve' &&
			!(await apply(project, proposal.workId, proposal.payload))
		)
			return { status: 'stale', proposal }
		proposal.status =
			input.decision.kind === 'approve' ? 'approved' : 'rejected'
		if (input.decision.kind === 'reject')
			proposal.feedback = input.decision.reason
		project.database
			.prepare(
				'UPDATE proposal SET status = ?, feedback = ?, resolved_at = ? WHERE proposal_id = ? AND work_id = ?',
			)
			.run(
				proposal.status,
				proposal.feedback ?? null,
				Date.now(),
				proposal.id,
				proposal.workId,
			)
		return { status: 'resolved', proposal }
	})
}
