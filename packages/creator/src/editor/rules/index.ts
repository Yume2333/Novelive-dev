import { isDeepStrictEqual } from 'node:util'
import { projectFiles, type WorkSettings } from '@novelive/format/model'
import type { CommandInput, CommandOutput } from '../../contract'
import type { Project } from '../../project'
import {
	contentRevision,
	recordHistory,
	withProjectEdits,
	writeAuditedFile,
} from '../history/storage'

function settingsVersion(project: Project, workId: string) {
	const work = project.database
		.prepare('SELECT settings_rev FROM work WHERE work_id = ?')
		.get(workId)
	if (!work) throw { code: 'not_found', message: '工程中找不到这部作品。' }
	return Number(work.settings_rev)
}

export function settingsRevision(
	project: Project,
	workId: string,
	settings: WorkSettings,
) {
	return contentRevision([settingsVersion(project, workId), settings])
}

function chapterRules(settings: WorkSettings, chapterId: string) {
	return Object.hasOwn(settings.chapterRules, chapterId)
		? settings.chapterRules[chapterId]
		: []
}

export async function captureChapterRules(
	project: Project,
	volumeId: string,
	workId: string,
	chapterId: string,
) {
	return withProjectEdits(project, async () => {
		const { settings, chapterIds } = await project.read(
			projectFiles.work(volumeId, workId),
		)
		if (!chapterIds.includes(chapterId))
			throw { code: 'not_found', message: '作品中找不到这一章。' }
		return {
			revision: settingsRevision(project, workId, settings),
			// Rules are prose. Keep both scopes so consumers can honor priority without guessing conflicts.
			chapterRules: [...chapterRules(settings, chapterId)],
			workRules: [...settings.rules],
		}
	})
}

export function formatChapterRules({
	chapterRules,
	workRules,
}: {
	chapterRules: readonly string[]
	workRules: readonly string[]
}) {
	const work = `Rules: ${workRules.join('; ')}`
	return chapterRules.length
		? `Chapter rules (take precedence over conflicting work rules): ${chapterRules.join('; ')}\n${work}`
		: work
}

export function saveRules(
	project: Project,
	volumeId: string,
	input: CommandInput<'editor.saveRules'>,
): Promise<CommandOutput<'editor.saveRules'>> {
	return withProjectEdits(project, async () => {
		const { workId, target, expectedRevision, previous, next } = input
		const file = projectFiles.work(volumeId, workId)
		const before = (await project.readFile(file.path)).toString('utf8')
		const work = await project.read(file)
		const version = settingsVersion(project, workId)
		const revision = contentRevision([version, work.settings])
		const chapterId = target.scope === 'chapter' ? target.chapterId : undefined
		if (chapterId !== undefined && !work.chapterIds.includes(chapterId))
			throw { code: 'not_found', message: '作品中找不到这一章。' }
		const current =
			chapterId === undefined
				? work.settings.rules
				: chapterRules(work.settings, chapterId)
		if (revision !== expectedRevision || !isDeepStrictEqual(current, previous))
			throw { code: 'stale_revision', message: '规则已改变，请刷新后重试。' }
		if (isDeepStrictEqual(current, next)) return { revision, rules: current }

		const settings = { ...work.settings }
		if (chapterId === undefined) {
			settings.rules = next
		} else {
			settings.chapterRules = { ...settings.chapterRules }
			if (next.length) settings.chapterRules[chapterId] = next
			else delete settings.chapterRules[chapterId]
		}
		await writeAuditedFile(
			project,
			file.path,
			before,
			`${JSON.stringify({ ...work, settings }, null, '\t')}\n`,
			() => {
				const db = project.database
				db.exec('BEGIN')
				try {
					const id = recordHistory(project, workId, {
						kind: 'rules',
						origin: 'creator',
						chapterId,
						previous: JSON.stringify(current),
						next: JSON.stringify(next),
					})
					db.prepare(
						'UPDATE work SET settings_rev = settings_rev + 1 WHERE work_id = ?',
					).run(workId)
					db.exec('COMMIT')
					return id
				} catch (error) {
					db.exec('ROLLBACK')
					throw error
				}
			},
		)
		return {
			revision: contentRevision([version + 1, settings]),
			rules: [...next],
		}
	})
}
