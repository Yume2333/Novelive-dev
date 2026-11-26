import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Message } from '@earendil-works/pi-ai'
import type {
	CommandInput,
	CommandOutput,
	Proposal,
	RewriteProposal,
} from '../contract'
import { subtaskRoles } from '../contract'
import { markProposalKind } from '../editor/marks'

export type Snapshot = CommandOutput<'chat.get'>
export type Entry = Snapshot['entries'][number]
export type ChatMessage = Extract<Entry, { kind: 'message' }>
export type Part = ChatMessage['parts'][number]
export type Attachment = CommandOutput<'chat.attach'>
export type Position = CommandInput<'chat.send'>['position']
export type Turn = Extract<Message, { role: 'assistant' | 'toolResult' }>[]

type Row = { id: string; parentId: string | null; at: number }
type EntryRow = Row &
	(
		| {
				kind: 'message'
				data: {
					role: ChatMessage['role']
					parts: Part[]
					status?: ChatMessage['status']
					turn?: Turn
					position?: Position
				}
		  }
		| {
				kind: 'compaction'
				data: { summary: string; pendingProposalIds?: string[] }
		  }
	)
export type ProposalSource = {
	path: string
	revision: string
	entry?: { kind: string; id: string }
	bases?: { kind: string; id: string; revision: string }[]
	baseRevision?: string
}
type ProposalData = Pick<Proposal, 'chapterIds' | 'payload'> & {
	rewrite?: RewriteProposal
	source?: ProposalSource
}
type ProposalRow = Omit<Proposal, 'chapterIds' | 'payload' | 'feedback'> & {
	data: string
	feedback: string | null
	toolCallId: string | null
}
const timestamp = (at: number) => new Date(at).toISOString()
const sessionFields = `work_id AS workId, session_id AS sessionId, title,
	strftime('%Y-%m-%dT%H:%M:%fZ', updated_at / 1000.0, 'unixepoch') AS updatedAt`
const proposalFields = `work_id AS workId, proposal_id AS id, session_id AS sessionId,
	prompt, status, feedback, payload AS data, tool_call_id AS toolCallId`

export function chatError(
	code: 'not_found' | 'stale_revision' | 'invalid_config',
	message: string,
) {
	return Object.assign(new Error(message), { code })
}

export class ChatStore {
	constructor(
		private readonly db: DatabaseSync,
		readonly workId: string,
	) {}

	private transaction<T>(run: () => T): T {
		this.db.exec('BEGIN IMMEDIATE')
		try {
			const result = run()
			this.db.exec('COMMIT')
			return result
		} catch (error) {
			this.db.exec('ROLLBACK')
			throw error
		}
	}

	list() {
		return this.db
			.prepare(`SELECT ${sessionFields} FROM session
			WHERE work_id = ? AND role = 'main' ORDER BY updated_at DESC, rowid DESC`)
			.all(this.workId) as Snapshot['session'][]
	}

	create(title: string) {
		const id = randomUUID()
		const now = Date.now()
		this.db
			.prepare(`INSERT INTO session (session_id, work_id, role, title, created_at, updated_at)
			VALUES (?, ?, 'main', ?, ?, ?)`)
			.run(id, this.workId, title, now, now)
		return this.session(id)
	}

	session(id: string) {
		const session = this.db
			.prepare(`SELECT ${sessionFields} FROM session
			WHERE session_id = ? AND work_id = ? AND role = 'main'`)
			.get(id, this.workId)
		if (!session) throw chatError('not_found', '会话不存在')
		return session as Snapshot['session']
	}

	rename(id: string, title: string) {
		this.session(id)
		this.db
			.prepare(
				'UPDATE session SET title = ?, updated_at = ? WHERE session_id = ?',
			)
			.run(title, Date.now(), id)
		return this.session(id)
	}

	delete(id: string) {
		this.session(id)
		return this.transaction(() => {
			// Keep the approval audit, but detached pending cards must not be actionable.
			this.db
				.prepare(`UPDATE proposal SET session_id = NULL, status = 'rejected',
				feedback = '会话已删除', resolved_at = ? WHERE session_id = ? AND status = 'pending'`)
				.run(Date.now(), id)
			this.db
				.prepare('UPDATE proposal SET session_id = NULL WHERE session_id = ?')
				.run(id)
			this.db.prepare('DELETE FROM session_entry WHERE session_id = ?').run(id)
			this.db.prepare('DELETE FROM session WHERE session_id = ?').run(id)
		})
	}

	entries(id: string): EntryRow[] {
		return this.db
			.prepare(`SELECT entry_id AS id, parent_id AS parentId, at, kind, content
			FROM session_entry WHERE session_id = ? AND kind IN ('message', 'compaction')
			ORDER BY rowid`)
			.all(id)
			.map(
				({ content, ...row }) =>
					({ ...row, data: JSON.parse(String(content)) }) as EntryRow,
			)
	}

	private insert(id: string, entry: EntryRow) {
		this.db
			.prepare(`INSERT INTO session_entry (session_id, entry_id, parent_id, kind, at, content)
			VALUES (?, ?, ?, ?, ?, ?)`)
			.run(
				id,
				entry.id,
				entry.parentId,
				entry.kind,
				entry.at,
				JSON.stringify(entry.data),
			)
	}

	start(
		id: string,
		user: Extract<EntryRow, { kind: 'message' }>,
		assistant: ChatMessage,
		expectedHeadId: string | null,
	) {
		this.transaction(() => {
			const head = this.db
				.prepare(`SELECT entry_id AS id FROM session_entry
				WHERE session_id = ? AND kind = 'message' ORDER BY rowid DESC LIMIT 1`)
				.get(id)
			if ((head?.id ?? null) !== expectedHeadId)
				throw chatError('stale_revision', '会话分支已更新，请刷新后重试')
			this.insert(id, user)
			this.insert(id, {
				...assistant,
				at: Date.parse(assistant.at),
				data: { role: 'assistant', parts: [] },
			})
			this.db
				.prepare('UPDATE session SET updated_at = ? WHERE session_id = ?')
				.run(Date.now(), id)
		})
	}

	save(id: string, message: ChatMessage, turn: Turn) {
		this.db
			.prepare(
				`UPDATE session_entry SET content = ? WHERE session_id = ? AND entry_id = ?`,
			)
			.run(
				JSON.stringify({
					role: 'assistant',
					parts: message.parts,
					status: message.status,
					turn,
				}),
				id,
				message.id,
			)
	}

	compact(
		id: string,
		parentId: string,
		summary: string,
		pendingProposalIds: string[],
	) {
		this.insert(id, {
			id: randomUUID(),
			parentId,
			at: Date.now(),
			kind: 'compaction',
			data: { summary, pendingProposalIds },
		})
	}

	attach(id: string, attachment: Attachment) {
		this.db
			.prepare(`INSERT INTO session_entry (session_id, entry_id, kind, at, content)
			VALUES (?, ?, 'custom', ?, ?)`)
			.run(id, attachment.id, Date.now(), JSON.stringify(attachment))
	}

	attachments(id: string): Attachment[] {
		return this.db
			.prepare(
				`SELECT content FROM session_entry WHERE session_id = ? AND kind = 'custom'`,
			)
			.all(id)
			.map(({ content }) => JSON.parse(String(content)) as Attachment)
	}

	recordProposal(
		proposal: Proposal,
		toolCallId: string,
		message: ChatMessage,
		turn: Turn,
	) {
		this.transaction(() => {
			const { id, sessionId, prompt, payload, chapterIds } = proposal
			this.db
				.prepare(`INSERT INTO proposal (proposal_id, work_id, session_id, tool_call_id, kind, prompt, payload, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
				.run(
					id,
					this.workId,
					sessionId,
					toolCallId,
					payload.kind,
					prompt,
					JSON.stringify({ chapterIds, payload }),
					Date.now(),
				)
			if (sessionId) this.save(sessionId, message, turn)
		})
	}

	recordStandaloneProposal(
		proposal: Proposal,
		source: ProposalSource,
		currentRevision: string,
	) {
		const { id, prompt, payload, chapterIds } = proposal
		this.db
			.prepare(`INSERT OR IGNORE INTO proposal (proposal_id, work_id, kind, prompt, payload, created_at)
			VALUES (?, ?, ?, ?, ?, ?)`)
			.run(
				id,
				this.workId,
				payload.kind,
				prompt,
				JSON.stringify({ chapterIds, payload, source }),
				Date.now(),
			)
		const existing = this.proposal(id)
		if (
			existing.proposal.status === 'pending' &&
			'expectedRevision' in existing.proposal.payload &&
			existing.proposal.payload.expectedRevision === currentRevision &&
			source.baseRevision === currentRevision &&
			(!existing.source?.bases ||
				existing.source.baseRevision !== currentRevision) &&
			source.bases
		)
			this.db
				.prepare(`UPDATE proposal SET payload = json_set(payload, '$.source', json(?))
			WHERE proposal_id = ? AND work_id = ? AND status = 'pending'`)
				.run(JSON.stringify(source), id, this.workId)
		return this.proposal(id)
	}

	proposal(id: string) {
		const row = this.db
			.prepare(
				`SELECT ${proposalFields} FROM proposal WHERE proposal_id = ? AND work_id = ? AND kind != ?`,
			)
			.get(id, this.workId, markProposalKind) as ProposalRow | undefined
		if (!row) throw chatError('not_found', '提议不存在')
		const { data, feedback, toolCallId, ...base } = row
		const { payload, chapterIds, rewrite, source } = JSON.parse(
			data,
		) as ProposalData
		return {
			proposal: {
				...base,
				payload,
				chapterIds,
				...(feedback === null ? {} : { feedback }),
			},
			rewrite,
			source,
			toolCallId,
		}
	}

	resolve(
		proposal: Proposal,
		status: 'approved' | 'rejected',
		feedback?: string,
		rewrite?: RewriteProposal,
	) {
		const { chapterIds, payload, id } = proposal
		const { source } = this.proposal(id)
		this.db
			.prepare(`UPDATE proposal SET status = ?, feedback = ?, payload = ?, resolved_at = ?
			WHERE proposal_id = ? AND work_id = ? AND status = 'pending'`)
			.run(
				status,
				feedback ?? null,
				JSON.stringify({ chapterIds, payload, rewrite, source }),
				Date.now(),
				id,
				this.workId,
			)
		return this.proposal(id)
	}

	project(row: EntryRow): Entry {
		const entry = { id: row.id, parentId: row.parentId, at: timestamp(row.at) }
		return row.kind === 'compaction'
			? { ...entry, kind: row.kind, summary: row.data.summary }
			: {
					...entry,
					kind: row.kind,
					role: row.data.role,
					parts: this.hydrate(row.data.parts, false),
					...(row.data.status ? { status: row.data.status } : {}),
				}
	}

	hydrate(parts: Part[], streaming: boolean): Part[] {
		return parts.map((part) =>
			part.type === 'proposal'
				? {
						...part,
						proposal: this.proposal(part.proposal.id).proposal,
						rewrite: this.proposal(part.proposal.id).rewrite,
					}
				: normalizeSubtask(part, streaming),
		)
	}
}

export function lineage(rows: EntryRow[], headId: string | null) {
	const messages = new Map(
		rows.filter((row) => row.kind === 'message').map((row) => [row.id, row]),
	)
	const path = []
	for (let id = headId; id !== null; ) {
		const row = messages.get(id)
		if (!row) throw chatError('not_found', '会话分支不存在')
		path.push(row)
		id = row.parentId
	}
	return path.reverse()
}

type SubtaskRole = (typeof subtaskRoles)[number]

/**
 * 旧版存档的子任务没有 `role` 字段，角色存在 `label` 里；
 * 读入时归一化为新形状，保证 chat.get 输出始终过契约校验。
 */
function normalizeSubtask(part: Part, streaming: boolean): Part {
	if (part.type !== 'subtask') return part
	type Subtask = Extract<Part, { type: 'subtask' }>
	let subtask: Subtask
	if ('role' in part) {
		subtask = part as Subtask
	} else {
		// 旧形状：label 存的是角色枚举值
		const { label, ...rest } = part as Omit<Subtask, 'role'>
		const role = subtaskRoles.includes(label as SubtaskRole)
			? (label as SubtaskRole)
			: 'organizer'
		subtask = { ...rest, role, label: role }
	}
	return !streaming && subtask.status === 'running'
		? { ...subtask, status: 'cancelled' }
		: subtask
}
