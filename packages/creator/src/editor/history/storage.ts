import { createHash, randomUUID } from 'node:crypto'
import type { CommandInput, CommandOutput } from '../../contract'
import type { Project } from '../../project'

type HistoryEntry = CommandOutput<'editor.history'>['entries'][number]
type Change = Omit<HistoryEntry, 'id' | 'at'>

const queue = new Map<string, Promise<unknown>>()

export function withProjectEdits<T>(project: Project, run: () => Promise<T>) {
	const prior = queue.get(project.root) ?? Promise.resolve()
	const result = prior.catch(() => {}).then(run)
	queue.set(project.root, result)
	return result.finally(() => {
		if (queue.get(project.root) === result) queue.delete(project.root)
	})
}

export function contentRevision(value: unknown) {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function chapterHistoryHead(
	project: Project,
	workId: string,
	chapterId: string,
) {
	return project.database
		.prepare(
			`SELECT history_id FROM history
			WHERE work_id = ? AND chapter_id = ? AND scene_id IS NOT NULL
			ORDER BY rowid DESC LIMIT 1`,
		)
		.get(workId, chapterId)?.history_id
}

export function listHistory(
	project: Project,
	query: CommandInput<'editor.history'>,
): CommandOutput<'editor.history'> {
	const { workId, chapterId } = query
	const queryRows = project.database.prepare(
		`SELECT history_id, at, origin, kind, chapter_id, scene_id, line_id,
			asset_id, previous, next FROM history WHERE work_id = ?
			${chapterId === undefined ? '' : 'AND chapter_id = ?'}
			ORDER BY at DESC, rowid DESC`,
	)
	const entries = queryRows
		.all(...(chapterId === undefined ? [workId] : [workId, chapterId]))
		.map((row) => {
			const { chapter_id, scene_id, line_id, asset_id } = row
			return {
				id: String(row.history_id),
				at: new Date(Number(row.at)).toISOString(),
				origin: row.origin as HistoryEntry['origin'],
				kind: String(row.kind),
				...(chapter_id === null ? {} : { chapterId: String(chapter_id) }),
				...(scene_id === null ? {} : { sceneId: String(scene_id) }),
				...(line_id === null ? {} : { lineId: String(line_id) }),
				...(asset_id === null ? {} : { assetId: String(asset_id) }),
				previous:
					row.previous === null ? null : JSON.parse(String(row.previous)),
				next: row.next === null ? null : JSON.parse(String(row.next)),
			}
		})
	return { entries }
}

export function recordHistory(
	project: Project,
	workId: string,
	change: Change,
) {
	const id = randomUUID()
	project.database
		.prepare(
			`INSERT INTO history (history_id, work_id, at, origin, kind,
				chapter_id, scene_id, line_id, asset_id, previous, next)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			id,
			workId,
			Date.now(),
			change.origin,
			change.kind,
			change.chapterId ?? null,
			change.sceneId ?? null,
			change.lineId ?? null,
			change.assetId ?? null,
			JSON.stringify(change.previous),
			JSON.stringify(change.next),
		)
	return id
}

export async function writeAuditedFile(
	project: Project,
	path: string,
	before: string,
	after: string,
	record: () => string,
) {
	await project.writeFile(path, after)
	try {
		return record()
	} catch (error) {
		try {
			await project.writeFile(path, before)
		} catch (rollbackError) {
			throw new AggregateError(
				[error, rollbackError],
				'Could not roll back the project edit',
			)
		}
		throw error
	}
}
