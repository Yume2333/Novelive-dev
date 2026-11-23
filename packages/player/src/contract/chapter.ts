import type { ChapterProduction } from '@novelive/format/model'
import type { PlaybackBeat } from './playback'

export interface PlaybackChapter {
	chapterId: string
	beats: readonly PlaybackBeat[]
}

export type ChapterEnd =
	| { kind: 'end' }
	| { kind: 'ready'; chapterId: string }
	| { kind: 'waiting'; chapterId: string }
	| {
			kind: 'producing'
			chapterId: string
			step: Extract<ChapterProduction, { status: 'producing' }>['step']
	  }

export interface PlayerChapters {
	load(chapterId: string): Promise<PlaybackChapter>
	/** Emits the current state first, then changes until unsubscribed. */
	watchNext(
		currentChapterId: string,
		onChange: (next: ChapterEnd) => void,
	): () => void
}
