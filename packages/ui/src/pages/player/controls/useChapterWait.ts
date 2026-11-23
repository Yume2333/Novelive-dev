import { useEffect } from 'react'
import type { PlaybackMode } from '../../../../../player/src/contract/progress'
import type { ControlChapter } from './PlayerControls'

export function useChapterWait({
	workId,
	current,
	ended,
	nextChapterId,
	directory,
	loadChapter,
	setChapters,
	onError,
}: {
	workId?: string
	current?: { chapterId: string; mode: PlaybackMode }
	ended: boolean
	nextChapterId?: string
	directory?: string
	loadChapter(
		directory: undefined,
		chapterId: string,
		mode: PlaybackMode,
		waitForClick: boolean,
	): Promise<void>
	setChapters(update: (chapters: ControlChapter[]) => ControlChapter[]): void
	onError(message: string): void
}) {
	useEffect(() => {
		if (!ended || !nextChapterId || !workId) return
		window.dispatchEvent(
			new CustomEvent('novelive:player-waiting', { detail: workId }),
		)
		return () => {
			window.dispatchEvent(
				new CustomEvent('novelive:player-waiting', { detail: null }),
			)
		}
	}, [ended, nextChapterId, workId])
	useEffect(() => {
		if (!ended || !current || !workId || !nextChapterId) return
		const work = workId
		const chapter = current
		let cancelled = false
		let busy = false
		async function refresh() {
			if (busy) return
			busy = true
			try {
				const result = await window.novelive.call('production.playerChapter', {
					workId: work,
					chapterId: chapter.chapterId,
					...(directory ? { directory } : {}),
				}).promise
				if (cancelled) return
				const ready = result.chapters.find(
					(chapter) => chapter.chapterId === nextChapterId,
				)
				if (ready?.published) {
					cancelled = true
					await loadChapter(undefined, ready.chapterId, chapter.mode, true)
				} else
					setChapters((previous) =>
						result.chapters.map((chapter) => ({
							...chapter,
							read:
								previous.find((item) => item.chapterId === chapter.chapterId)
									?.read ?? false,
						})),
					)
			} catch {
				if (!cancelled) onError('无法更新章节制作进度')
			} finally {
				busy = false
			}
		}
		void refresh()
		const timer = setInterval(() => void refresh(), 2000)
		return () => {
			cancelled = true
			clearInterval(timer)
		}
	}, [
		ended,
		current,
		workId,
		nextChapterId,
		directory,
		loadChapter,
		setChapters,
		onError,
	])
}
