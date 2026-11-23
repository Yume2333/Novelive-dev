import { useEffect } from 'react'
import type { PlaybackMode } from '../../../../../player/src/contract/progress'
import { scoped } from '../../../i18n'
import type { ControlChapter } from './PlayerControls'

const t = scoped('player')

export function useChapterWait({
	workId,
	current,
	ended,
	nextChapterId,
	nextChapterPublished,
	nextChapterRead,
	directory,
	loadChapter,
	setChapters,
	onError,
}: {
	workId?: string
	current?: { chapterId: string; mode: PlaybackMode }
	ended: boolean
	nextChapterId?: string
	nextChapterPublished: boolean
	nextChapterRead: boolean
	directory?: string
	loadChapter(
		directory: undefined,
		chapterId: string,
		mode: PlaybackMode,
		waitForClick: boolean,
	): Promise<unknown>
	setChapters(update: (chapters: ControlChapter[]) => ControlChapter[]): void
	onError(message: string): void
}) {
	const waiting = ended && !nextChapterPublished
	useEffect(() => {
		if (!waiting || !nextChapterId || !workId) return
		window.dispatchEvent(
			new CustomEvent('novelive:player-waiting', { detail: workId }),
		)
		return () => {
			window.dispatchEvent(
				new CustomEvent('novelive:player-waiting', { detail: null }),
			)
		}
	}, [waiting, nextChapterId, workId])
	useEffect(() => {
		if (!ended || !current || !workId || !nextChapterId) return
		const mode = nextChapterRead ? 'reread' : 'main'
		if (nextChapterPublished) {
			void loadChapter(undefined, nextChapterId, mode, true)
			return
		}
		if (!waiting) return
		const work = workId
		let cancelled = false
		let busy = false
		async function refresh() {
			if (busy) return
			busy = true
			try {
				const result = await window.novelive.call('production.playerStatus', {
					workId: work,
					...(directory ? { directory } : {}),
				}).promise
				if (cancelled) return
				const ready = result.chapters.find(
					(chapter) => chapter.chapterId === nextChapterId,
				)
				if (ready?.published) {
					cancelled = true
					await loadChapter(undefined, ready.chapterId, mode, true)
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
				if (!cancelled) onError(t('无法更新章节制作进度'))
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
		nextChapterPublished,
		nextChapterRead,
		waiting,
		directory,
		loadChapter,
		setChapters,
		onError,
	])
}
