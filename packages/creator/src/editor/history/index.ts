import { randomUUID } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
	type AssetRegistry,
	formatVersion,
	projectFiles,
} from '@novelive/format/model'
import {
	applyScriptLinePatch,
	compileEditorScript,
	editScriptLine,
	type ScriptLinePatch,
} from '../../../../format/src/script/editing'
import type { CommandInput, CommandOutput } from '../../contract'
import type { Project } from '../../project'
import { existing } from '../../synthesis/patch'
import { discardAcceptedMarks, discardMark, pendingMarks } from '../marks'
import { settingsRevision } from '../rules'
import {
	chapterHistoryHead,
	contentRevision,
	recordHistory,
	withProjectEdits,
	writeAuditedFile,
} from './storage'

export { listHistory, recordHistory, withProjectEdits } from './storage'

type Snapshot = CommandOutput<'editor.editLine'>
type LineEdit = CommandInput<'editor.editLine'>['edit']
type UndoStep = {
	sceneId: string
	lineId: string
	kind: LineEdit['kind']
	previous: string
	next: string
	patch: ScriptLinePatch
}
type OpenEditor = { chapterId: string; revision: string; undo: UndoStep[] }

export class ProjectEditor {
	private readonly editors = new Map<string, OpenEditor>()

	constructor(
		private readonly project: Project,
		private readonly volumeId: string,
		private readonly workId: string,
	) {}

	open(
		input: CommandInput<'editor.open'>,
	): Promise<CommandOutput<'editor.open'>> {
		return withProjectEdits(this.project, async () => {
			this.checkWork(input.workId)
			const model = await this.loadChapter(input.chapterId)
			const editorId = randomUUID()
			this.editors.set(editorId, {
				chapterId: input.chapterId,
				revision: model.snapshot.revision,
				undo: [],
			})
			return {
				editorId,
				chapter: model.snapshot,
				registry: { formatVersion, entries: model.options.assets },
				speakerNames: model.speakerNames,
				settings: model.settings,
				settingsRevision: settingsRevision(
					this.project,
					this.workId,
					model.settings,
				),
			}
		})
	}

	close(
		input: CommandInput<'editor.close'>,
	): Promise<CommandOutput<'editor.close'>> {
		return withProjectEdits(this.project, async () => ({
			closed:
				input.workId === this.workId &&
				this.editors.get(input.editorId)?.chapterId === input.chapterId &&
				this.editors.delete(input.editorId),
		}))
	}

	snapshot(input: CommandInput<'editor.open'>): Promise<Snapshot> {
		return withProjectEdits(this.project, async () => {
			this.checkWork(input.workId)
			return (await this.loadChapter(input.chapterId)).snapshot
		})
	}

	resolveMark(input: CommandInput<'editor.resolveMark'>): Promise<Snapshot> {
		return withProjectEdits(this.project, async () => {
			const editor = this.openEditor(input)
			const model = await this.loadChapter(input.chapterId)
			this.checkRevision(model.snapshot, input.expectedRevision)
			const { project, workId, volumeId } = this
			const mark = model.snapshot.markSuggestions.find(
				({ id }) => id === input.suggestionId,
			)
			if (!mark) throw { code: 'not_found', message: '找不到这个标记提议。' }
			const { name, css, perChar } = mark
			const db = project.database
			const accept = input.decision === 'accept'
			const record = () => {
				db.exec('BEGIN')
				try {
					if (accept) {
						discardAcceptedMarks(project, workId, name)
						db.prepare(
							'UPDATE work SET settings_rev = settings_rev + 1 WHERE work_id = ?',
						).run(workId)
					} else discardMark(project, workId, mark.id)
					const id = recordHistory(project, workId, {
						kind: 'resolve-mark',
						origin: 'creator',
						chapterId: input.chapterId,
						previous: JSON.stringify(mark),
						next: accept ? JSON.stringify({ name, css, perChar }) : null,
					})
					db.exec('COMMIT')
					return id
				} catch (error) {
					db.exec('ROLLBACK')
					throw error
				}
			}
			if (accept) {
				if (Object.hasOwn(model.settings.customMarks, name))
					throw {
						code: 'stale_revision',
						message: '这个标记已存在，请刷新后重试。',
					}
				const file = projectFiles.work(volumeId, workId)
				const before = (await project.readFile(file.path)).toString('utf8')
				const work = await project.read(file)
				const settings = {
					...work.settings,
					customMarks: {
						...work.settings.customMarks,
						[name]: { css, perChar },
					},
				}
				await writeAuditedFile(
					project,
					file.path,
					before,
					`${JSON.stringify({ ...work, settings }, null, '\t')}\n`,
					record,
				)
			} else record()
			const { snapshot } = await this.loadChapter(input.chapterId)
			if (editor.revision === model.snapshot.revision)
				editor.revision = snapshot.revision
			return snapshot
		})
	}

	/** Runs `run` under the edit lock only while the chapter still has `expectedRevision`. */
	whileCurrent<T>(
		input: { workId: string; chapterId: string; expectedRevision: string },
		run: () => Promise<T>,
	): Promise<T> {
		return withProjectEdits(this.project, async () => {
			this.checkWork(input.workId)
			const model = await this.loadChapter(input.chapterId)
			this.checkRevision(model.snapshot, input.expectedRevision)
			return run()
		})
	}

	/** The chapter snapshot with one scene compiled against the project's assets. */
	compiledScene(input: CommandInput<'editor.open'>, sceneId: string) {
		return withProjectEdits(this.project, async () => {
			this.checkWork(input.workId)
			const model = await this.loadChapter(input.chapterId)
			const index = model.scripts.findIndex((s) => s.sceneId === sceneId)
			if (index < 0) throw { code: 'not_found', message: '找不到场景。' }
			const compiled = compileEditorScript(model.scripts, model.options)
			return {
				snapshot: model.snapshot,
				scene: model.snapshot.scenes[index],
				compiled: compiled[index].scene,
			}
		})
	}

	editLine(input: CommandInput<'editor.editLine'>): Promise<Snapshot> {
		return withProjectEdits(this.project, async () => {
			const editor = this.openEditor(input)
			const model = await this.loadChapter(input.chapterId)
			this.checkRevision(model.snapshot, input.expectedRevision)
			const { edit, sceneId } = input
			const { patch, nvs, previous, next } = editScriptLine(
				model.scripts,
				sceneId,
				edit,
				model.options,
			)
			if (previous === next) return model.snapshot
			const snapshot = await this.writeLine(
				model,
				{
					sceneId,
					lineId: edit.lineId,
					kind: edit.kind,
					previous,
					next,
					patch,
				},
				nvs,
				'creator',
			)
			if (editor.revision !== model.snapshot.revision) editor.undo = []
			editor.undo.push({
				sceneId,
				lineId: edit.lineId,
				kind: edit.kind,
				previous: next,
				next: previous,
				patch: {
					offset: patch.offset,
					before: patch.after,
					after: patch.before,
				},
			})
			editor.revision = snapshot.revision
			return snapshot
		})
	}

	undo(input: CommandInput<'editor.undo'>): Promise<Snapshot> {
		return withProjectEdits(this.project, async () => {
			const editor = this.openEditor(input)
			const model = await this.loadChapter(input.chapterId)
			this.checkRevision(model.snapshot, input.expectedRevision)
			const step = editor.undo.at(-1)
			if (!step) return model.snapshot
			this.checkRevision(model.snapshot, editor.revision)
			const scene = model.scripts.find(
				({ sceneId }) => sceneId === step.sceneId,
			)
			if (!scene) throw { code: 'not_found', message: '找不到场景。' }
			const nvs = applyScriptLinePatch(scene.nvs, step.patch)
			compileEditorScript(
				model.scripts.map((item) =>
					item === scene ? { ...scene, nvs } : item,
				),
				model.options,
			)
			const snapshot = await this.writeLine(model, step, nvs, 'undo')
			editor.undo.pop()
			editor.revision = snapshot.revision
			return snapshot
		})
	}

	replaceScene(
		input: CommandInput<'editor.rewriteScene'>,
		kind: string,
		change: (nvs: string) => string,
	): Promise<Snapshot> {
		return withProjectEdits(this.project, async () => {
			this.checkWork(input.workId)
			const model = await this.loadChapter(input.chapterId)
			this.checkRevision(model.snapshot, input.expectedRevision)
			const scene = model.scripts.find(
				({ sceneId }) => sceneId === input.sceneId,
			)
			if (!scene) throw { code: 'not_found', message: '找不到场景。' }
			const nvs = change(scene.nvs)
			compileEditorScript(
				model.scripts.map((item) =>
					item === scene ? { ...scene, nvs } : item,
				),
				model.options,
			)
			const { chapterId, sceneId } = input
			await writeAuditedFile(
				this.project,
				projectFiles.scene(this.chapterRef(chapterId), sceneId),
				scene.nvs,
				nvs,
				() =>
					recordHistory(this.project, this.workId, {
						origin: 'agent',
						kind,
						chapterId,
						sceneId,
						previous: scene.nvs,
						next: nvs,
					}),
			)
			return (await this.loadChapter(chapterId)).snapshot
		})
	}

	private checkWork(workId: string) {
		if (workId !== this.workId)
			throw { code: 'not_found', message: '工程中找不到这部作品。' }
	}

	private checkRevision(snapshot: Snapshot, expectedRevision: string) {
		if (snapshot.revision !== expectedRevision)
			throw { code: 'stale_revision', message: '章节已改变，请刷新后重试。' }
	}

	private openEditor(input: CommandInput<'editor.close'>) {
		this.checkWork(input.workId)
		const editor = this.editors.get(input.editorId)
		if (!editor || editor.chapterId !== input.chapterId)
			throw { code: 'not_found', message: '编辑器已关闭。' }
		return editor
	}

	private async writeLine(
		model: Awaited<ReturnType<ProjectEditor['loadChapter']>>,
		step: UndoStep,
		nvs: string,
		origin: 'creator' | 'undo',
	): Promise<Snapshot> {
		const { sceneId, lineId, kind, previous, next } = step
		const scenes = model.snapshot.scenes.map((scene) =>
			scene.sceneId === sceneId ? { ...scene, nvs } : scene,
		)
		const { chapterId } = model.snapshot
		const path = projectFiles.scene(this.chapterRef(chapterId), sceneId)
		const before = model.scripts.find((scene) => scene.sceneId === sceneId)?.nvs
		if (before === undefined)
			throw { code: 'not_found', message: '找不到场景。' }
		const id = await writeAuditedFile(this.project, path, before, nvs, () =>
			recordHistory(this.project, this.workId, {
				origin,
				kind,
				chapterId,
				sceneId,
				lineId,
				previous,
				next,
				...(kind === 'expression' ? { assetId: next } : {}),
			}),
		)
		const { snapshot } = model
		return {
			...snapshot,
			scenes,
			revision: this.revision(model.chapter, { ...snapshot, scenes }, id),
		}
	}

	private chapterRef(chapterId: string) {
		return { volumeId: this.volumeId, workId: this.workId, chapterId }
	}

	private revision(
		chapter: unknown,
		{
			paragraphs,
			scenes,
			markSuggestions,
		}: Pick<Snapshot, 'paragraphs' | 'scenes' | 'markSuggestions'>,
		head: unknown,
	) {
		return contentRevision([
			this.workId,
			chapter,
			paragraphs,
			scenes,
			markSuggestions,
			head,
		])
	}

	private async loadChapter(chapterId: string) {
		const { project, volumeId, workId } = this
		const work = await project.read(projectFiles.work(volumeId, workId))
		if (!work.chapterIds.includes(chapterId))
			throw { code: 'not_found', message: '作品中找不到这一章。' }
		const ref = this.chapterRef(chapterId)
		const [chapter, body, { assets, speakerNames }] = await Promise.all([
			project.read(projectFiles.chapter(ref)),
			project.readFile(projectFiles.chapterText(chapterId)),
			this.resources(),
		])
		const source = body
			.toString('utf8')
			.trimEnd()
			.split(/\r?\n\r?\n/)
		const paragraphs = chapter.paragraphIds.map((id, index) => ({
			id,
			text: source[index],
		}))
		const scripts = await Promise.all(
			chapter.sceneIds.map(async (sceneId) => ({
				sceneId,
				nvs: (
					await project.readFile(projectFiles.scene(ref, sceneId))
				).toString('utf8'),
			})),
		)
		const options = {
			assets,
			speakers: Object.keys(speakerNames),
			customMarks: Object.keys(work.settings.customMarks),
			paragraphIds: chapter.paragraphIds,
		}
		const compiled = scripts.length ? compileEditorScript(scripts, options) : []
		const scenes = scripts.map((script, index) => {
			const { from, to } = compiled[index].scene.source
			return {
				...script,
				sourceIds: chapter.paragraphIds.slice(
					chapter.paragraphIds.indexOf(from),
					chapter.paragraphIds.indexOf(to) + 1,
				),
			}
		})
		const content = {
			workId,
			chapterId,
			title: chapter.title,
			paragraphs,
			scenes,
			markSuggestions: pendingMarks(project, { workId, chapterId }),
		}
		const snapshot: Snapshot = {
			...content,
			revision: this.revision(
				chapter,
				content,
				chapterHistoryHead(project, workId, chapterId),
			),
		}
		return {
			chapter,
			scripts,
			snapshot,
			options,
			speakerNames,
			settings: work.settings,
		}
	}

	private async resources() {
		const { project, volumeId, workId } = this
		const assets = new Map<string, AssetRegistry['entries'][number]>()
		const names = new Map<string, string>()
		for (const scope of [
			{ level: 'series' },
			{ level: 'volume', volumeId },
			{ level: 'work', volumeId, workId },
		] as const) {
			const registry = await existing(() =>
				project.read(projectFiles.assetRegistry(scope)),
			)
			for (const entry of registry?.entries ?? []) assets.set(entry.id, entry)
			const path = dirname(projectFiles.character(scope, 'character').path)
			const files = await existing(() =>
				readdir(join(project.root, path), { withFileTypes: true }),
			)
			for (const file of files ?? []) {
				if (!file.isFile() || !/^[a-z0-9][a-z0-9_-]*\.json$/.test(file.name))
					continue
				const { entries } = await project.read(
					projectFiles.character(scope, file.name.slice(0, -5)),
				)
				for (const { id, name } of entries) names.set(id, name)
			}
		}
		return {
			assets: [...assets.values()],
			speakerNames: Object.fromEntries(names),
		}
	}
}
