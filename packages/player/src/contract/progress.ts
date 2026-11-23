import type { SentenceRef } from './playback'
import type { StageSnapshot } from './stage'

export const historyLimit = 200
export const manualSaveSlots = 60
export const saveThumbnail = {
	width: 480,
	height: 270,
	mime: 'image/webp',
} as const

export interface PlaybackHistory {
	entries: readonly StageSnapshot[]
	cursor: number | null
}

export type PlaybackMode = 'main' | 'reread'

export type SaveSlot = { kind: 'quick' } | { kind: 'manual'; slot: number }

export interface SaveEntry {
	slot: SaveSlot
	savedAt: string
	snapshot: StageSnapshot
	thumbnailRef: string
}

export interface WorkProgress {
	mainline: SentenceRef | null
	read: readonly SentenceRef[]
	saves: readonly SaveEntry[]
}

export interface LegacySaveGroup {
	version: number
	saves: readonly SaveEntry[]
}

export interface ProgressMigrationInput {
	workId: string
	fromVersion: number
	toVersion: number
	positions: readonly SentenceRef[]
	progress: WorkProgress
	legacySaves: readonly LegacySaveGroup[]
}

export interface ProgressMigrationResult {
	progress: WorkProgress
	legacySaves: readonly LegacySaveGroup[]
}

export interface ProgressStore {
	load(workId: string): Promise<WorkProgress | null>
	save(workId: string, progress: WorkProgress): Promise<void>
}
