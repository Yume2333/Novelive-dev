import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { formatVersion, projectFiles, type Work } from '@novelive/format/model'
import { ChatStore, type ProposalSource } from '../../chat/store'
import type { CommandInput, CommandOutput, Proposal } from '../../contract'
import { Project } from '../../project'
import { existing, readBible } from '../../synthesis/patch'
import { prepareBiblePatch } from './patch'
import {
	bridgeBibleSources,
	fileFor,
	proposalActionability,
	sourceRevision,
} from './sources'

type Bible = Awaited<ReturnType<typeof readBible>>
type Kind = keyof Bible
type Entry = Bible[Kind][number]
type Payload = Extract<Proposal['payload'], { kind: 'bible' | 'glossary' }>
type ApplicationResult =
	| { status: 'applied' }
	| { status: 'stale' }
	| { status: 'restricted'; reason: string }
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
	return sourceRevision(bible)
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
	const chapters = new Set<string>()
	let selected: Work | undefined
	for (const id of series.volumeIds) {
		const volume = await project.read(projectFiles.volume(id))
		for (const candidateId of volume.workIds) {
			const work = await project.read(projectFiles.work(id, candidateId))
			for (const chapterId of work.chapterIds) chapters.add(chapterId)
			if ((!volumeId || id === volumeId) && candidateId === workId)
				selected = work
		}
	}
	if (selected) return { work: selected, chapters }
	throw { code: 'not_found', message: '工程中找不到这部作品或卷' }
}

export function getBibleProposal(
	project: Project,
	workId: string,
	proposalId: string,
): Proposal {
	return new ChatStore(project.database, workId).proposal(proposalId).proposal
}

export async function getBible(
	project: Project,
	input: CommandInput<'bible.get'>,
): Promise<CommandOutput<'bible.get'>> {
	const { work, chapters } = await workContext(
		project,
		input.workId,
		input.volumeId,
	)
	const bible = await readBible(project)
	project.database
		.prepare(
			'INSERT OR IGNORE INTO work (work_id, title, queue_pos, created_at) VALUES (?, ?, 0, ?)',
		)
		.run(input.workId, work.title, Date.now())
	await bridgeBibleSources(project, input, bible, work.chapterIds)
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
	const store = new ChatStore(project.database, input.workId)
	const proposalActions = Object.fromEntries(
		await Promise.all(
			proposalIds.map(async (id) => {
				const { proposal, source } = store.proposal(id)
				return [
					id,
					await proposalActionability(
						project,
						proposal,
						bible,
						chapters,
						source,
					),
				]
			}),
		),
	)
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
		proposalActions,
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

async function apply(
	project: Project,
	proposal: Proposal,
	payload: Payload,
	source?: ProposalSource,
): Promise<ApplicationResult> {
	const before = await readBible(project)
	const { chapters } = await workContext(
		project,
		proposal.workId,
		payload.volumeId,
	)
	const action = await proposalActionability(
		project,
		proposal,
		before,
		chapters,
		source,
	)
	if (!action.canApprove)
		return action.status === 'restricted'
			? { status: 'restricted', reason: action.reason }
			: { status: 'stale' }
	const { after, touched } = prepareBiblePatch(before, payload, chapters)
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
	return { status: 'applied' }
}

export async function applyBibleProposal(
	project: Project,
	proposal: Proposal,
): Promise<ApplicationResult> {
	const payload = proposal.payload
	if (payload.kind !== 'bible' && payload.kind !== 'glossary')
		throw { code: 'unsupported', message: '不是设定或术语候选' }
	return exclusive(project, async () => {
		const { source } = new ChatStore(
			project.database,
			proposal.workId,
		).proposal(proposal.id)
		return apply(project, proposal, payload, source)
	})
}
