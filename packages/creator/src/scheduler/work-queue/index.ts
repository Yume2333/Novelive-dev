import type { DatabaseSync } from 'node:sqlite'
import type { ProductionQueue } from '../../contract/queue'

type QueueEntry =
	| NonNullable<ProductionQueue['active']>
	| ProductionQueue['queued'][number]
	| ProductionQueue['inactive'][number]
export type QueueWork = Pick<QueueEntry, 'link' | 'title' | 'projectDir'>
export type QueueMove = -1 | 1

type Participant = {
	read(): QueueEntry | null
	busy(): boolean
	wake(): void
}

export function readQueueWork(db: DatabaseSync, work: QueueWork) {
	const state = db
		.prepare(
			`SELECT status, pause_reason AS reason FROM work w WHERE work_id = ?
			AND EXISTS (SELECT 1 FROM chapter WHERE work_id = w.work_id)`,
		)
		.get(work.link.workId) as
		| Pick<Extract<QueueEntry, { reason: string }>, 'status' | 'reason'>
		| (Pick<Exclude<QueueEntry, { reason: string }>, 'status'> & {
				reason: null
		  })
		| undefined
	if (!state) return null
	const { status, reason } = state
	return {
		...work,
		status,
		...(reason === null ? {} : { reason }),
	} as QueueEntry
}

export class WorkQueue {
	private readonly restored = new Map<string, QueueEntry>()
	private readonly participants = new Map<string, Participant>()
	private order: string[] = []
	private owner: string | undefined
	private pending = false
	private closed = false

	constructor(private readonly onChange: (queue: ProductionQueue) => void) {}

	restore(entry: QueueEntry) {
		this.restored.set(entry.link.workId, entry)
	}

	attach(workId: string, participant: Participant) {
		this.participants.set(workId, participant)
	}

	detach(workId: string) {
		this.participants.delete(workId)
		this.changed()
	}

	enqueueFirst(workId: string) {
		this.order = [workId, ...this.order.filter((id) => id !== workId)]
	}

	granted(workId: string) {
		if (this.closed || this.owner !== workId) return false
		const item = this.participants.get(workId)
		const entry = item?.read()
		return (
			entry?.status === 'active' ||
			(entry?.status === 'queued' &&
				!item?.busy() &&
				this.syncOrder()[0]?.link.workId === workId)
		)
	}

	get busy() {
		return this.owner !== undefined
	}

	changed() {
		if (this.pending || this.closed) return
		this.pending = true
		queueMicrotask(() => {
			if (this.closed) return
			try {
				this.dispatch()
			} finally {
				this.pending = false
			}
			this.onChange(this.snapshot())
		})
	}

	move(workId: string, direction: QueueMove) {
		this.syncOrder()
		const from = this.order.indexOf(workId)
		const to = from + direction
		if (from < 0 || to < 0 || to >= this.order.length) return this.snapshot()
		const [item] = this.order.splice(from, 1)
		this.order.splice(to, 0, item)
		this.changed()
		return this.snapshot()
	}

	snapshot(): ProductionQueue {
		const queued = this.syncOrder()
		const snapshot: ProductionQueue = { active: null, queued, inactive: [] }
		for (const entry of this.restored.values()) {
			if (!this.participants.has(entry.link.workId)) add(entry)
		}
		for (const item of this.participants.values()) add(item.read())
		return snapshot

		function add(entry: QueueEntry | null) {
			if (!entry || entry.status === 'queued') return
			if (entry.status === 'active') snapshot.active = entry
			else snapshot.inactive.push(entry)
		}
	}

	close() {
		this.closed = true
	}

	private syncOrder() {
		const queued = new Map<string, ProductionQueue['queued'][number]>()
		for (const [id, item] of this.participants) {
			const entry = item.read()
			if (entry?.status === 'queued') queued.set(id, entry)
		}
		const ordered: ProductionQueue['queued'] = []
		for (const id of this.order) {
			const entry = queued.get(id)
			if (!entry) continue
			ordered.push(entry)
			queued.delete(id)
		}
		ordered.push(...queued.values())
		this.order = ordered.map(({ link }) => link.workId)
		return ordered
	}

	private dispatch() {
		const current = this.owner && this.participants.get(this.owner)
		// A stop or failure can release the DB status while requests are still unwinding.
		if (current && (current.read()?.status === 'active' || current.busy()))
			return
		this.syncOrder()
		this.owner = this.order[0]
		if (this.owner) this.participants.get(this.owner)?.wake()
	}
}
