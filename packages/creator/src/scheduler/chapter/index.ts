import { randomUUID } from 'node:crypto'
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type {
	ChapterProduction,
	ImageJobResult,
	ImageQueueItem,
	WorkPhase,
} from '@novelive/format/model'
import type { ProductionSnapshot } from '../../contract/production'

export const transientRetries = 2
export const defaultImageConcurrency = 8

export type ChapterLink = 'previous' | 'preview-summary' | 'none'
export type ChapterStep = 'write' | 'review' | 'stage'
export type StepContext = {
	workId: string
	chapterId: string
	link: ChapterLink
	desensitized: boolean
	signal: AbortSignal
}
export type DrawJob = {
	assetId: string
	kind: 'base' | 'variant' | 'cg'
	baseAssetId?: string
}
export type DrawContext = {
	workId: string
	desensitized: boolean
	signal: AbortSignal
}
export interface ProductionWorker {
	write(context: StepContext): Promise<void>
	review(context: StepContext): Promise<void>
	stage(context: StepContext): Promise<ImageQueueItem[]>
	isDrawn(workId: string, job: DrawJob): Promise<boolean>
	draw(job: DrawJob, context: DrawContext): Promise<ImageJobResult>
}

export class ProductionTaskError extends Error {
	constructor(
		readonly kind: 'transient' | 'moderation' | 'final',
		message: string,
	) {
		super(message)
	}
}

export type SchedulerOptions = {
	imageConcurrency?: number
	now?: () => number
	onChange?: () => void
}

export type RunLogEntry = {
	runId: string
	kind: 'chapter' | 'image'
	ref: string
	status: string
	errorType: string | null
	errorMessage: string | null
	steps: {
		role: string
		purpose: string
		status: string
		errorType: string | null
	}[]
}

type TaskRow = {
	task_id: string
	work_id: string
	kind: 'chapter' | 'image'
	ref_id: string
	status: string
	phase: string
	attempts: number
	desensitized: number
	run_id: string | null
}
type Inflight = { runId: string; controller: AbortController }
type PauseReason =
	| 'chapter_failed'
	| 'image_unsupported'
	| 'stopped'
	| 'crashed'
	| 'confirm_visual'
	| 'confirm_first'

const steps: ChapterStep[] = ['write', 'review', 'stage']
const roles = {
	write: 'writer',
	review: 'reviewer',
	stage: 'art_director',
	draw: 'artist',
} as const
const nextPhase = {
	write: 'review',
	review: 'stage',
	stage: 'await_draw',
} as const
const shownStep = {
	queued: 'write',
	write: 'write',
	review: 'review',
	stage: 'stage',
	await_draw: 'draw',
	done: 'draw',
} as const
const assetKind = {
	character: 'base',
	location: 'base',
	expression: 'variant',
	variant: 'variant',
	cg: 'cg',
} as const

export class ChapterScheduler {
	private readonly inflight = new Map<string, Inflight>()
	private readonly running = new Set<Promise<void>>()
	private readonly imageConcurrency: number
	private readonly now: () => number
	private readonly onChange?: () => void
	private disposed = false

	constructor(
		private readonly db: DatabaseSync,
		private readonly worker: ProductionWorker,
		options: SchedulerOptions = {},
	) {
		this.imageConcurrency = options.imageConcurrency ?? defaultImageConcurrency
		this.now = options.now ?? Date.now
		this.onChange = options.onChange
		this.recover()
	}

	start(
		workId: string,
		chapterIds: readonly string[],
		visual: readonly ImageQueueItem[] = [],
	): ProductionSnapshot {
		this.transaction(() => {
			let previous: string | undefined
			chapterIds.forEach((chapterId, index) => {
				const first = index === 0 ? 1 : 0
				this.exec(
					'INSERT INTO chapter (work_id, chapter_id, ord, prioritized) VALUES (?, ?, ?, ?)',
					workId,
					chapterId,
					index + 1,
					first,
				)
				const taskId = this.insertTask(workId, 'chapter', chapterId, first)
				if (previous) this.addDep(taskId, previous, true)
				previous = taskId
			})
			for (const item of visual) this.ensureImageTask(workId, item)
			this.setWork(workId, 'awaiting_confirm', 'confirm_visual')
		})
		this.pump()
		return this.snapshot(workId)
	}

	confirmVisual(workId: string): ProductionSnapshot {
		if (this.pauseReason(workId) === 'confirm_visual') {
			this.resumeWork(workId)
			this.pump()
		}
		return this.snapshot(workId)
	}

	continue(workId: string): ProductionSnapshot {
		const work = this.work(workId)
		if (work.status === 'awaiting_confirm' && work.reason === 'confirm_first') {
			this.resumeWork(workId)
		} else if (work.status === 'paused' && work.reason !== 'chapter_failed') {
			this.transaction(() => {
				for (const task of this.all<{ task_id: string; ref_id: string }>(
					`SELECT task_id, ref_id FROM task
					WHERE work_id = ? AND kind = 'image' AND status = 'needs_attention'`,
					workId,
				)) {
					this.exec(
						"UPDATE task SET status = 'queued', attempts = 0, desensitized = 0, error_type = NULL WHERE task_id = ?",
						task.task_id,
					)
					this.exec(
						"UPDATE asset SET status = 'pending' WHERE work_id = ? AND asset_key = ?",
						workId,
						task.ref_id,
					)
				}
				this.requeueWork(workId)
			})
		}
		this.pump()
		return this.snapshot(workId)
	}

	stop(workId: string) {
		let cancelledQueued = 0
		let abortedRunning = 0
		this.transaction(() => {
			cancelledQueued = Number(
				this.exec(
					"UPDATE task SET status = 'cancelled' WHERE work_id = ? AND status = 'queued'",
					workId,
				).changes,
			)
			for (const task of this.all<TaskRow>(
				"SELECT * FROM task WHERE work_id = ? AND status = 'running'",
				workId,
			)) {
				this.interrupt(task)
				abortedRunning++
			}
			const work = this.work(workId)
			if (work.status === 'active' || work.status === 'queued') {
				this.setWork(workId, 'paused', 'stopped')
			}
		})
		this.pump()
		return {
			workId,
			mode: 'immediate' as const,
			cancelledQueued,
			abortedRunning,
		}
	}

	prioritizeChapter(workId: string, chapterId: string): ProductionSnapshot {
		this.transaction(() => {
			this.exec(
				'UPDATE chapter SET prioritized = 1 WHERE work_id = ? AND chapter_id = ?',
				workId,
				chapterId,
			)
			this.exec(
				"UPDATE task SET priority = MAX(priority, 1) WHERE work_id = ? AND kind = 'chapter' AND ref_id = ?",
				workId,
				chapterId,
			)
		})
		this.pump()
		return this.snapshot(workId)
	}

	retryChapter(workId: string, chapterId: string): ProductionSnapshot {
		const task = this.get<TaskRow>(
			"SELECT * FROM task WHERE work_id = ? AND kind = 'chapter' AND ref_id = ? AND status = 'needs_attention'",
			workId,
			chapterId,
		)
		if (task) {
			this.transaction(() => {
				this.exec(
					`UPDATE task SET status = 'queued', attempts = 0, desensitized = 0, error_type = NULL,
					priority = (SELECT MAX(priority) + 1 FROM task WHERE work_id = ? AND kind = 'chapter')
					WHERE task_id = ?`,
					workId,
					task.task_id,
				)
				this.exec(
					'UPDATE chapter SET flagged = 0 WHERE work_id = ? AND chapter_id = ?',
					workId,
					chapterId,
				)
				if (this.pauseReason(workId) === 'chapter_failed') {
					this.resumeWork(workId)
				}
			})
			this.pump()
		}
		return this.snapshot(workId)
	}

	snapshot(workId: string): ProductionSnapshot {
		const work = this.work(workId)
		const rows = this.all<{
			chapter_id: string
			user_state: 'waiting' | 'producing' | 'published'
			flagged: number
			prioritized: number
			placeholder: number
			task_id: string
			phase: keyof typeof shownStep
		}>(
			`SELECT c.chapter_id, c.user_state, c.flagged, c.prioritized, c.placeholder, t.task_id, t.phase
			FROM chapter c JOIN task t ON t.work_id = c.work_id AND t.kind = 'chapter' AND t.ref_id = c.chapter_id
			WHERE c.work_id = ? ORDER BY c.ord`,
			workId,
		)
		let blockedChapterId: string | undefined
		const chapters = rows.map((row): ChapterProduction => {
			const issue = row.flagged ? this.chapterIssue(row) : undefined
			if (work.reason === 'chapter_failed' && this.failed(row.task_id)) {
				blockedChapterId = row.chapter_id
			}
			const base = {
				chapterId: row.chapter_id,
				priority: row.prioritized === 1,
				...(issue ? { issue } : {}),
			}
			if (row.user_state === 'producing') {
				return { ...base, status: 'producing', step: shownStep[row.phase] }
			}
			return { ...base, status: row.user_state }
		})
		const [phase, status] = this.phaseOf(workId, work)
		return {
			workId,
			phase,
			status,
			chapters,
			...(blockedChapterId ? { blockedChapterId } : {}),
			visual: null,
		}
	}

	runLog(workId: string): RunLogEntry[] {
		return this.all<{
			run_id: string
			kind: 'chapter' | 'image'
			ref: string
			status: string
			error_type: string | null
			error_message: string | null
		}>(
			`SELECT run_id, kind, ref, status, error_type, error_message FROM run
			WHERE work_id = ? ORDER BY started_at, rowid`,
			workId,
		).map((run) => ({
			runId: run.run_id,
			kind: run.kind,
			ref: run.ref,
			status: run.status,
			errorType: run.error_type,
			errorMessage: run.error_message,
			steps: this.all<{
				role: string
				purpose: string
				status: string
				error_type: string | null
			}>(
				'SELECT role, purpose, status, error_type FROM run_step WHERE run_id = ? ORDER BY seq',
				run.run_id,
			).map((step) => ({
				role: step.role,
				purpose: step.purpose,
				status: step.status,
				errorType: step.error_type,
			})),
		}))
	}

	async idle(): Promise<void> {
		while (this.running.size > 0) await Promise.race(this.running)
	}

	dispose() {
		this.disposed = true
		for (const { controller } of this.inflight.values()) controller.abort()
		this.inflight.clear()
	}

	private recover() {
		this.transaction(() => {
			for (const task of this.all<TaskRow>(
				"SELECT * FROM task WHERE status = 'running'",
			)) {
				this.interrupt(task)
			}
			this.exec(
				`UPDATE asset SET status = 'pending' WHERE status = 'drawing' AND NOT EXISTS (
					SELECT 1 FROM task t WHERE t.work_id = asset.work_id AND t.kind = 'image'
					AND t.ref_id = asset.asset_key AND t.status = 'running')`,
			)
			this.exec(
				`UPDATE work SET status = 'paused', pause_reason = 'crashed'
				WHERE status IN ('active', 'queued')
				AND EXISTS (SELECT 1 FROM task t WHERE t.work_id = work.work_id AND t.kind = 'chapter')`,
			)
		})
	}

	private pump() {
		if (this.disposed) return
		this.acquireSlot()
		const active = this.get<{ work_id: string }>(
			"SELECT work_id FROM work WHERE status = 'active'",
		)
		if (
			active &&
			!this.get(
				"SELECT 1 FROM task WHERE work_id = ? AND kind = 'chapter' AND status = 'running'",
				active.work_id,
			)
		) {
			const next = this.nextChapter(active.work_id)
			if (next)
				this.launch(next.task, () => this.runChapter(next.task, next.link))
		}
		this.dispatchImages()
		this.onChange?.()
	}

	private acquireSlot() {
		if (this.get("SELECT 1 FROM work WHERE status = 'active'")) return
		const next = this.get<{ work_id: string }>(
			`SELECT work_id FROM work w WHERE status = 'queued'
			AND EXISTS (SELECT 1 FROM task t WHERE t.work_id = w.work_id AND t.kind = 'chapter')
			ORDER BY queue_pos LIMIT 1`,
		)
		if (!next) return
		this.transaction(() => {
			this.exec(
				"UPDATE work SET status = 'active', pause_reason = NULL WHERE work_id = ?",
				next.work_id,
			)
			this.exec(
				"UPDATE task SET status = 'queued' WHERE work_id = ? AND status IN ('interrupted', 'cancelled')",
				next.work_id,
			)
		})
	}

	private nextChapter(workId: string) {
		// Until the first chapter is published, nothing past it runs: the creator may stop at confirm point 2.
		const candidates = this.all<TaskRow & { prioritized: number }>(
			`SELECT t.*, c.prioritized FROM task t
			JOIN chapter c ON c.work_id = t.work_id AND c.chapter_id = t.ref_id
			WHERE t.work_id = ? AND t.kind = 'chapter' AND t.status = 'queued' AND t.phase <> 'await_draw'
			AND (c.ord = (SELECT MIN(ord) FROM chapter WHERE work_id = t.work_id)
				OR EXISTS (SELECT 1 FROM chapter f WHERE f.work_id = t.work_id AND f.user_state = 'published'
					AND f.ord = (SELECT MIN(ord) FROM chapter WHERE work_id = t.work_id)))
			ORDER BY t.priority DESC, c.ord`,
			workId,
		)
		for (const task of candidates) {
			const deps = this.all<{ soft: number; status: string; phase: string }>(
				`SELECT d.soft, t.status, t.phase FROM task_dep d JOIN task t ON t.task_id = d.depends_on
				WHERE d.task_id = ?`,
				task.task_id,
			)
			let link: ChapterLink = 'none'
			const ready = deps.every((dep) => {
				if (!dep.soft) return dep.status === 'done'
				if (!['queued', 'write'].includes(dep.phase)) {
					link = 'previous'
					return true
				}
				link = 'preview-summary'
				return task.prioritized === 1
			})
			if (ready) return { task, link }
		}
		return undefined
	}

	private dispatchImages() {
		let slots =
			this.imageConcurrency -
			Number(
				this.get<{ n: number }>(
					"SELECT COUNT(*) AS n FROM task WHERE kind = 'image' AND status = 'running'",
				)?.n,
			)
		const queued = this.all<TaskRow & { base_status: string | null }>(
			`SELECT t.*, b.status AS base_status FROM task t
			JOIN work w ON w.work_id = t.work_id
			JOIN asset a ON a.work_id = t.work_id AND a.asset_key = t.ref_id
			LEFT JOIN asset b ON b.work_id = a.work_id AND b.asset_key = a.base_key
			WHERE t.kind = 'image' AND t.status = 'queued' AND w.status IN ('active', 'awaiting_confirm')
			ORDER BY t.priority DESC, t.seq`,
		)
		for (const task of queued) {
			if (task.base_status === 'placeholder' || task.base_status === 'failed') {
				this.transaction(() =>
					this.settleImage(
						task,
						null,
						'placeholder',
						'基准图没画成，差分改用占位图',
					),
				)
				continue
			}
			if (task.base_status !== null && task.base_status !== 'drawn') continue
			if (slots <= 0) break
			slots--
			this.launch(task, () => this.runImage(task))
		}
	}

	private launch(task: TaskRow, body: () => Promise<void>) {
		const runId = randomUUID()
		const controller = new AbortController()
		const kind = task.kind
		this.transaction(() => {
			this.exec(
				`INSERT INTO run (run_id, work_id, kind, ref, status, started_at, meta)
				VALUES (?, ?, ?, ?, 'running', ?, ?)`,
				runId,
				task.work_id,
				kind,
				task.ref_id,
				this.now(),
				JSON.stringify({ taskId: task.task_id, phase: task.phase }),
			)
			this.exec(
				`UPDATE task SET status = 'running', run_id = ?, starts = starts + 1,
				started_at = ? WHERE task_id = ?`,
				runId,
				this.now(),
				task.task_id,
			)
			if (kind === 'chapter') {
				this.exec(
					"UPDATE chapter SET user_state = 'producing' WHERE work_id = ? AND chapter_id = ?",
					task.work_id,
					task.ref_id,
				)
			} else {
				this.exec(
					"UPDATE asset SET status = 'drawing' WHERE work_id = ? AND asset_key = ?",
					task.work_id,
					task.ref_id,
				)
			}
		})
		task.run_id = runId
		this.inflight.set(task.task_id, { runId, controller })
		const done = body()
			.catch(() => undefined)
			.finally(() => {
				this.running.delete(done)
				if (this.inflight.get(task.task_id)?.runId === runId) {
					this.inflight.delete(task.task_id)
				}
				this.pump()
			})
		this.running.add(done)
	}

	private current(task: TaskRow) {
		return (
			!this.disposed && this.inflight.get(task.task_id)?.runId === task.run_id
		)
	}

	private async attempt<T>(
		task: TaskRow,
		purpose: string,
		call: (desensitized: boolean, signal: AbortSignal) => Promise<T>,
	): Promise<{ ok: true; value: T } | { ok: false; error: Error } | null> {
		const signal = this.inflight.get(task.task_id)?.controller.signal
		if (!signal) return null
		for (;;) {
			const started = this.now()
			try {
				const value = await call(task.desensitized === 1, signal)
				if (!this.current(task)) return null
				this.step(task, purpose, started, 'completed')
				return { ok: true, value }
			} catch (cause) {
				if (!this.current(task)) return null
				const error = cause instanceof Error ? cause : new Error(String(cause))
				const kind = error instanceof ProductionTaskError ? error.kind : 'final'
				this.step(task, purpose, started, 'failed', kind, error.message)
				if (kind === 'transient' && task.attempts < transientRetries) {
					task.attempts++
					this.exec(
						'UPDATE task SET attempts = ? WHERE task_id = ?',
						task.attempts,
						task.task_id,
					)
					continue
				}
				if (kind === 'moderation' && task.desensitized === 0) {
					task.desensitized = 1
					this.exec(
						'UPDATE task SET desensitized = 1 WHERE task_id = ?',
						task.task_id,
					)
					continue
				}
				return { ok: false, error }
			}
		}
	}

	private async runChapter(task: TaskRow, link: ChapterLink) {
		const start =
			task.phase === 'queued' ? 0 : steps.indexOf(task.phase as ChapterStep)
		for (const name of steps.slice(start)) {
			this.exec(
				'UPDATE task SET phase = ? WHERE task_id = ?',
				name,
				task.task_id,
			)
			task.phase = name
			this.onChange?.()
			const result = await this.attempt(task, name, (desensitized, signal) => {
				const context = {
					workId: task.work_id,
					chapterId: task.ref_id,
					link,
					desensitized,
					signal,
				}
				return name === 'stage'
					? this.worker.stage(context)
					: this.worker[name](context).then(() => [])
			})
			if (!result) return
			if (!result.ok) {
				this.transaction(() => this.failChapter(task, result.error))
				return
			}
			this.transaction(() => {
				task.attempts = 0
				this.exec(
					'UPDATE task SET phase = ?, attempts = 0 WHERE task_id = ?',
					nextPhase[name],
					task.task_id,
				)
				if (name !== 'stage') return
				for (const item of result.value) {
					const imageTask = this.ensureImageTask(
						task.work_id,
						item,
						task.ref_id,
					)
					this.addDep(task.task_id, imageTask, false)
					const settled = this.get<{ status: string; asset: string }>(
						`SELECT t.status, a.status AS asset FROM task t
						JOIN asset a ON a.work_id = t.work_id AND a.asset_key = t.ref_id WHERE t.task_id = ?`,
						imageTask,
					)
					if (settled?.asset === 'placeholder') {
						this.flagFromImage(task.task_id, task.work_id, 'placeholder')
					} else if (settled?.status === 'needs_attention') {
						this.flagFromImage(task.task_id, task.work_id, 'unsupported')
					}
				}
				this.exec(
					"UPDATE task SET status = 'queued', run_id = NULL WHERE task_id = ?",
					task.task_id,
				)
				this.endRun(task, 'done')
				this.inflight.delete(task.task_id)
				this.maybePublish(task.task_id)
			})
		}
	}

	private async runImage(task: TaskRow) {
		const asset = this.get<{ kind: DrawJob['kind']; base_key: string | null }>(
			'SELECT kind, base_key FROM asset WHERE work_id = ? AND asset_key = ?',
			task.work_id,
			task.ref_id,
		)
		if (!asset) return
		const job: DrawJob = {
			assetId: task.ref_id,
			kind: asset.kind,
			...(asset.base_key ? { baseAssetId: asset.base_key } : {}),
		}
		const result = await this.attempt(
			task,
			'draw',
			async (desensitized, signal) =>
				(await this.worker.isDrawn(task.work_id, job))
					? ({ status: 'drawn' } as const)
					: this.worker.draw(job, {
							workId: task.work_id,
							desensitized,
							signal,
						}),
		)
		if (!result) return
		this.transaction(() => {
			if (!result.ok) {
				this.settleImage(task, task.run_id, 'placeholder', result.error.message)
			} else if (result.value.status === 'drawn') {
				this.settleImage(task, task.run_id, 'drawn')
			} else {
				this.settleImage(
					task,
					task.run_id,
					result.value.status,
					result.value.issue,
				)
			}
			this.inflight.delete(task.task_id)
		})
	}

	private settleImage(
		task: TaskRow,
		runId: string | null,
		outcome: ImageJobResult['status'],
		issue?: string,
	) {
		const assetStatus = outcome === 'unsupported' ? 'failed' : outcome
		this.exec(
			`UPDATE asset SET status = ?, draw_count = draw_count + ?
			WHERE work_id = ? AND asset_key = ?`,
			assetStatus,
			outcome === 'drawn' ? 1 : 0,
			task.work_id,
			task.ref_id,
		)
		this.exec(
			`UPDATE task SET status = ?, error_type = ?, ended_at = ?,
			done_once = CASE WHEN ? = 'done' THEN 1 ELSE done_once END WHERE task_id = ?`,
			outcome === 'unsupported' ? 'needs_attention' : 'done',
			outcome === 'drawn' ? null : outcome,
			this.now(),
			outcome === 'unsupported' ? 'needs_attention' : 'done',
			task.task_id,
		)
		if (runId) {
			task.run_id = runId
			this.endRun(
				task,
				outcome === 'unsupported' ? 'needs_attention' : 'done',
				outcome === 'drawn' ? undefined : outcome,
				issue,
			)
		} else {
			this.exec(
				`INSERT INTO run (run_id, work_id, kind, ref, status, started_at, ended_at, error_type, error_message, meta)
				VALUES (?, ?, 'image', ?, 'done', ?, ?, ?, ?, ?)`,
				randomUUID(),
				task.work_id,
				task.ref_id,
				this.now(),
				this.now(),
				outcome,
				issue ?? null,
				JSON.stringify({ taskId: task.task_id }),
			)
		}
		const dependents = this.all<{ task_id: string }>(
			"SELECT d.task_id FROM task_dep d JOIN task t ON t.task_id = d.task_id WHERE d.depends_on = ? AND t.kind = 'chapter'",
			task.task_id,
		)
		for (const { task_id } of dependents) {
			this.flagFromImage(task_id, task.work_id, outcome)
			this.maybePublish(task_id)
		}
		if (
			outcome === 'unsupported' &&
			['active', 'queued'].includes(this.work(task.work_id).status)
		) {
			this.setWork(task.work_id, 'paused', 'image_unsupported')
		}
	}

	private flagFromImage(
		chapterTaskId: string,
		workId: string,
		outcome: ImageJobResult['status'],
	) {
		if (outcome === 'drawn') return
		this.exec(
			`UPDATE chapter SET flagged = 1, placeholder = CASE WHEN ? = 'placeholder' THEN 1 ELSE placeholder END
			WHERE work_id = ? AND chapter_id = (SELECT ref_id FROM task WHERE task_id = ?)`,
			outcome,
			workId,
			chapterTaskId,
		)
	}

	private failChapter(task: TaskRow, error: Error) {
		const kind = error instanceof ProductionTaskError ? error.kind : 'final'
		this.exec(
			"UPDATE task SET status = 'needs_attention', error_type = ?, ended_at = ? WHERE task_id = ?",
			kind,
			this.now(),
			task.task_id,
		)
		this.endRun(task, 'needs_attention', kind, error.message)
		this.inflight.delete(task.task_id)
		this.exec(
			'UPDATE chapter SET flagged = 1 WHERE work_id = ? AND chapter_id = ?',
			task.work_id,
			task.ref_id,
		)
		this.setWork(task.work_id, 'paused', 'chapter_failed')
	}

	private maybePublish(chapterTaskId: string) {
		const task = this.get<TaskRow>(
			"SELECT * FROM task WHERE task_id = ? AND kind = 'chapter' AND status = 'queued' AND phase = 'await_draw'",
			chapterTaskId,
		)
		if (
			!task ||
			this.get(
				`SELECT 1 FROM task_dep d JOIN task t ON t.task_id = d.depends_on
				WHERE d.task_id = ? AND d.soft = 0 AND t.status <> 'done'`,
				chapterTaskId,
			)
		) {
			return
		}
		this.exec(
			"UPDATE task SET status = 'done', phase = 'done', done_once = 1, ended_at = ? WHERE task_id = ?",
			this.now(),
			chapterTaskId,
		)
		this.exec(
			"UPDATE chapter SET user_state = 'published' WHERE work_id = ? AND chapter_id = ?",
			task.work_id,
			task.ref_id,
		)
		const work = this.work(task.work_id)
		const first =
			this.get<{ ord: number }>(
				'SELECT MIN(ord) AS ord FROM chapter WHERE work_id = ?',
				task.work_id,
			)?.ord ===
			this.get<{ ord: number }>(
				'SELECT ord FROM chapter WHERE work_id = ? AND chapter_id = ?',
				task.work_id,
				task.ref_id,
			)?.ord
		if (first && work.status === 'active') {
			this.setWork(task.work_id, 'awaiting_confirm', 'confirm_first')
		} else if (
			!this.get(
				"SELECT 1 FROM task WHERE work_id = ? AND kind = 'chapter' AND status <> 'done'",
				task.work_id,
			)
		) {
			this.setWork(task.work_id, 'done', null)
		}
	}

	private interrupt(task: TaskRow) {
		this.inflight.get(task.task_id)?.controller.abort()
		this.inflight.delete(task.task_id)
		this.exec(
			"UPDATE task SET status = 'interrupted' WHERE task_id = ?",
			task.task_id,
		)
		if (task.run_id) {
			this.endRun(task, 'interrupted')
			this.exec(
				`INSERT INTO run_step (step_id, run_id, seq, operation_name, role, purpose, status, started_at, ended_at)
				SELECT ?, ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ?, 'cancelled', ?, ? FROM run_step WHERE run_id = ?`,
				randomUUID(),
				task.run_id,
				task.kind === 'image' ? 'generate_content' : 'chat',
				task.kind === 'image'
					? roles.draw
					: (roles[task.phase as ChapterStep] ?? roles.write),
				task.kind === 'image' ? 'draw' : task.phase,
				this.now(),
				this.now(),
				task.run_id,
			)
		}
		if (task.kind === 'image') {
			this.exec(
				"UPDATE asset SET status = 'pending' WHERE work_id = ? AND asset_key = ? AND status = 'drawing'",
				task.work_id,
				task.ref_id,
			)
		}
	}

	private step(
		task: TaskRow,
		purpose: string,
		started: number,
		status: 'completed' | 'failed',
		errorType?: string,
		errorMessage?: string,
	) {
		this.exec(
			`INSERT INTO run_step (step_id, run_id, seq, operation_name, role, purpose, status,
			error_type, error_message, started_at, ended_at)
			SELECT ?, ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ? FROM run_step WHERE run_id = ?`,
			randomUUID(),
			task.run_id,
			purpose === 'draw' ? 'generate_content' : 'chat',
			roles[purpose as keyof typeof roles],
			purpose,
			status,
			errorType ?? null,
			errorMessage ?? null,
			started,
			this.now(),
			task.run_id,
		)
	}

	private endRun(
		task: TaskRow,
		status: 'done' | 'needs_attention' | 'interrupted',
		errorType?: string,
		errorMessage?: string,
	) {
		this.exec(
			`UPDATE run SET status = ?, ended_at = ?, error_type = ?, error_message = ?
			WHERE run_id = ? AND status = 'running'`,
			status,
			this.now(),
			errorType ?? null,
			errorMessage ?? null,
			task.run_id,
		)
	}

	private ensureImageTask(
		workId: string,
		item: ImageQueueItem,
		chapterId?: string,
	) {
		this.exec(
			`INSERT INTO asset (work_id, asset_key, kind, base_key, chapter_id)
			VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
			workId,
			item.assetId,
			assetKind[item.kind],
			'baseAssetId' in item ? item.baseAssetId : null,
			chapterId ?? null,
		)
		const existing = this.get<{ task_id: string }>(
			"SELECT task_id FROM task WHERE work_id = ? AND kind = 'image' AND ref_id = ?",
			workId,
			item.assetId,
		)
		return existing?.task_id ?? this.insertTask(workId, 'image', item.assetId)
	}

	private insertTask(
		workId: string,
		kind: 'chapter' | 'image',
		refId: string,
		priority = 0,
	) {
		const taskId = randomUUID()
		this.exec(
			`INSERT INTO task (task_id, work_id, kind, ref_id, priority, created_at, seq)
			SELECT ?, ?, ?, ?, ?, ?, COALESCE(MAX(seq), 0) + 1 FROM task`,
			taskId,
			workId,
			kind,
			refId,
			priority,
			this.now(),
		)
		return taskId
	}

	private addDep(taskId: string, dependsOn: string, soft: boolean) {
		this.exec(
			'INSERT INTO task_dep (task_id, depends_on, soft) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
			taskId,
			dependsOn,
			soft ? 1 : 0,
		)
	}

	private resumeWork(workId: string) {
		if (
			!this.get(
				"SELECT 1 FROM task WHERE work_id = ? AND kind = 'chapter' AND status <> 'done'",
				workId,
			)
		) {
			this.setWork(workId, 'done', null)
		} else if (
			this.get(
				"SELECT 1 FROM task WHERE work_id = ? AND kind = 'image' AND status = 'needs_attention'",
				workId,
			)
		) {
			this.setWork(workId, 'paused', 'image_unsupported')
		} else {
			this.requeueWork(workId)
		}
	}

	private requeueWork(workId: string) {
		this.exec(
			`UPDATE work SET status = 'queued', pause_reason = NULL,
			queue_pos = (SELECT MIN(queue_pos) - 1 FROM work) WHERE work_id = ?`,
			workId,
		)
	}

	private setWork(
		workId: string,
		status: 'active' | 'awaiting_confirm' | 'paused' | 'done',
		reason: PauseReason | null,
	) {
		this.exec(
			'UPDATE work SET status = ?, pause_reason = ? WHERE work_id = ?',
			status,
			reason,
			workId,
		)
	}

	private work(workId: string) {
		const row = this.get<{ status: string; pause_reason: PauseReason | null }>(
			'SELECT status, pause_reason FROM work WHERE work_id = ?',
			workId,
		)
		if (!row) throw new Error(`Unknown work ${workId}`)
		return { status: row.status, reason: row.pause_reason }
	}

	private pauseReason(workId: string) {
		return this.work(workId).reason
	}

	private phaseOf(
		workId: string,
		work: { status: string; reason: PauseReason | null },
	): [WorkPhase, ProductionSnapshot['status']] {
		if (work.reason === 'confirm_visual') return ['confirm-visual', 'confirm']
		if (work.reason === 'confirm_first') return ['confirm-first', 'confirm']
		if (work.status === 'done') return ['done', 'idle']
		if (
			!this.get(
				"SELECT 1 FROM task WHERE work_id = ? AND kind = 'chapter'",
				workId,
			)
		) {
			return ['preview', 'idle']
		}
		return ['producing', work.status === 'paused' ? 'stopped' : 'producing']
	}

	private failed(taskId: string) {
		return !!this.get(
			"SELECT 1 FROM task WHERE task_id = ? AND status = 'needs_attention'",
			taskId,
		)
	}

	private chapterIssue(row: { task_id: string; placeholder: number }) {
		const failure = this.get<{ error_message: string | null }>(
			`SELECT r.error_message FROM run r
			JOIN task t ON t.task_id = json_extract(r.meta, '$.taskId')
			WHERE r.status = 'needs_attention' AND t.status = 'needs_attention'
				AND (t.task_id = ? OR t.task_id IN (SELECT depends_on FROM task_dep WHERE task_id = ?))
			ORDER BY r.started_at DESC, r.rowid DESC LIMIT 1`,
			row.task_id,
			row.task_id,
		)
		if (failure?.error_message) return failure.error_message
		if (row.placeholder) {
			const count = this.get<{ n: number }>(
				`SELECT COUNT(*) AS n FROM task_dep d JOIN task t ON t.task_id = d.depends_on
				JOIN asset a ON a.work_id = t.work_id AND a.asset_key = t.ref_id
				WHERE d.task_id = ? AND a.status = 'placeholder'`,
				row.task_id,
			)?.n
			return `${count} 张图用了占位图`
		}
		return undefined
	}

	private transaction(body: () => void) {
		if (this.db.isTransaction) return body()
		this.db.exec('BEGIN IMMEDIATE')
		try {
			body()
			this.db.exec('COMMIT')
		} catch (error) {
			this.db.exec('ROLLBACK')
			throw error
		}
	}

	private exec(sql: string, ...params: SQLInputValue[]) {
		return this.db.prepare(sql).run(...params)
	}

	private get<T = unknown>(sql: string, ...params: SQLInputValue[]) {
		return this.db.prepare(sql).get(...params) as T | undefined
	}

	private all<T>(sql: string, ...params: SQLInputValue[]) {
		return this.db.prepare(sql).all(...params) as T[]
	}
}
