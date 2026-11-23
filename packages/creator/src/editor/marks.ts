import { randomUUID } from 'node:crypto'
import { projectFiles } from '@novelive/format/model'
import type { ProposedMark } from '../pipeline/writing/marks'
import type { Project } from '../project'

export const markProposalKind = 'custom-mark'
type StoredMark = ProposedMark & { chapterId: string }
type Target = { workId: string; chapterId: string }

export function pendingMarks(project: Project, { workId, chapterId }: Target) {
	return project.database
		.prepare(
			`SELECT proposal_id, payload FROM proposal WHERE work_id = ? AND status = 'pending'
			AND kind = ? AND json_extract(payload, '$.chapterId') = ? ORDER BY rowid`,
		)
		.all(workId, markProposalKind, chapterId)
		.map(({ proposal_id, payload }) => {
			const { name, css, perChar } = JSON.parse(String(payload)) as StoredMark
			return { id: String(proposal_id), name, css, perChar }
		})
}

export async function saveMarkSuggestions(
	project: Project,
	volumeId: string,
	target: Target,
	marks: readonly ProposedMark[],
) {
	if (!marks.length) return
	const { workId, chapterId } = target
	const { settings } = await project.read(projectFiles.work(volumeId, workId))
	const names = new Set(pendingMarks(project, target).map(({ name }) => name))
	const insert = project.database.prepare(
		'INSERT INTO proposal (proposal_id, work_id, kind, prompt, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
	)
	for (const mark of marks) {
		if (Object.hasOwn(settings.customMarks, mark.name) || names.has(mark.name))
			continue
		insert.run(
			randomUUID(),
			workId,
			markProposalKind,
			mark.name,
			JSON.stringify({ ...mark, chapterId } satisfies StoredMark),
			Date.now(),
		)
		names.add(mark.name)
	}
}

export function discardMark(project: Project, workId: string, id: string) {
	project.database
		.prepare(
			'DELETE FROM proposal WHERE work_id = ? AND kind = ? AND proposal_id = ?',
		)
		.run(workId, markProposalKind, id)
}

export function discardAcceptedMarks(
	project: Project,
	workId: string,
	name: string,
) {
	project.database
		.prepare(
			`DELETE FROM proposal WHERE work_id = ? AND kind = ? AND status = 'pending'
			AND json_extract(payload, '$.name') = ?`,
		)
		.run(workId, markProposalKind, name)
}
