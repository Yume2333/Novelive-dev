import type { Project } from './index'

export function chapterStates(project: Project, workId: string) {
	return new Map(
		project.database
			.prepare('SELECT chapter_id, user_state FROM chapter WHERE work_id = ?')
			.all(workId)
			.map(({ chapter_id, user_state }) => [String(chapter_id), user_state]),
	)
}

export function isChapterPublished(
	states: ReturnType<typeof chapterStates>,
	chapterId: string,
	hasScenes: boolean,
) {
	return states.size === 0 ? hasScenes : states.get(chapterId) === 'published'
}
