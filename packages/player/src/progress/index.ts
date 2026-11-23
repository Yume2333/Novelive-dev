import type { CompiledAction } from '@novelive/format/script'
import {
	type ActivePerformance,
	historyLimit,
	manualSaveSlots,
	type PlaybackHistory,
	type PlaybackMode,
	type SaveEntry,
	type SaveSlot,
	type SentenceRef,
	type StageSnapshot,
	type WorkProgress,
} from '../contract'

const key = ({ chapterId, sceneId, sentenceId }: SentenceRef) =>
	JSON.stringify([chapterId, sceneId, sentenceId])

export function captureSnapshot(
	position: SentenceRef,
	stage: StageSnapshot['stage'],
	active: readonly ActivePerformance[],
): StageSnapshot {
	return structuredClone({ position, stage, active })
}

export function slotKey(slot: SaveSlot): string {
	if (slot.kind === 'quick') return 'quick'
	if (
		!Number.isInteger(slot.slot) ||
		slot.slot < 1 ||
		slot.slot > manualSaveSlots
	)
		throw new RangeError('存档槽位必须在 1 到 60 之间')
	return `manual-${slot.slot}`
}

export interface SnapshotRenderer {
	setState(stage: StageSnapshot['stage']): void | Promise<void>
	replayState(action: CompiledAction): void | Promise<void>
	restartText(
		text: StageSnapshot['stage']['text'],
		page: 0,
	): void | Promise<void>
}

export async function restoreSnapshot(
	snapshot: StageSnapshot,
	renderer: SnapshotRenderer,
): Promise<void> {
	const saved = structuredClone(snapshot)
	await renderer.setState(saved.stage)
	for (const active of saved.active) {
		if (active.restore === 'replay-state')
			await renderer.replayState(active.action)
	}
	await renderer.restartText(saved.stage.text, 0)
}

export class PlaybackProgress {
	private progress: WorkProgress
	private entries: StageSnapshot[] = []
	private cursor: number | null = null
	mode: PlaybackMode = 'main'

	constructor(
		private readonly compare: (a: SentenceRef, b: SentenceRef) => number,
		progress: WorkProgress = { mainline: null, read: [], saves: [] },
	) {
		this.progress = structuredClone(progress)
	}

	get data(): WorkProgress {
		return structuredClone(this.progress)
	}

	get history(): PlaybackHistory {
		return structuredClone({ entries: this.entries, cursor: this.cursor })
	}

	isRead(position: SentenceRef): boolean {
		return this.progress.read.some((entry) => key(entry) === key(position))
	}

	private markRead(position: SentenceRef) {
		if (!this.isRead(position))
			this.progress.read = [...this.progress.read, structuredClone(position)]
	}

	openChapter(chapterId: string): PlaybackMode {
		this.mode =
			this.progress.mainline?.chapterId !== chapterId &&
			this.progress.read.some((entry) => entry.chapterId === chapterId)
				? 'reread'
				: 'main'
		return this.mode
	}

	record(snapshot: StageSnapshot): void {
		this.entries = this.entries.slice(0, (this.cursor ?? -1) + 1)
		this.entries.push(structuredClone(snapshot))
		this.entries = this.entries.slice(-historyLimit)
		this.cursor = this.entries.length - 1
		this.markRead(snapshot.position)
		const mainline = this.progress.mainline
		if (
			this.mode === 'main' &&
			(mainline === null || this.compare(snapshot.position, mainline) > 0)
		)
			this.progress.mainline = structuredClone(snapshot.position)
	}

	jump(index: number): StageSnapshot | null {
		if (!Number.isInteger(index) || index < 0 || index >= this.entries.length)
			return null
		const start = this.cursor ?? index
		for (let i = Math.min(start, index); i <= Math.max(start, index); i++)
			this.markRead(this.entries[i].position)
		this.cursor = index
		return structuredClone(this.entries[index])
	}

	rollback(): StageSnapshot | null {
		return this.jump((this.cursor ?? 0) - 1)
	}

	forward(): StageSnapshot | null {
		return this.jump((this.cursor ?? -1) + 1)
	}

	putSave(entry: SaveEntry): void {
		const name = slotKey(entry.slot)
		this.progress.saves = [
			...this.progress.saves.filter((save) => slotKey(save.slot) !== name),
			structuredClone(entry),
		]
	}

	loadSave(slot: SaveSlot): StageSnapshot | null {
		const name = slotKey(slot)
		const entry = this.progress.saves.find(
			(save) => slotKey(save.slot) === name,
		)
		if (!entry) return null
		this.entries = [structuredClone(entry.snapshot)]
		this.cursor = 0
		this.mode = 'main'
		this.markRead(entry.snapshot.position)
		return structuredClone(entry.snapshot)
	}
}
