import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
	type AssetRegistry,
	type ImageJobResult,
	projectFiles,
} from '@novelive/format/model'
import { formatScene, type Scene } from '@novelive/format/script'
import type { CommandInput, CommandOutput } from '../../contract'
import type { RewriteProposal, RewriteRequest } from '../../contract/editor'
import type { Project } from '../../project'
import { existing } from '../../synthesis/patch'
import type { ProjectEditor } from '../history'
import {
	contentRevision,
	recordHistory,
	withProjectEdits,
} from '../history/storage'

/** The production session pieces that revisions reuse: writer, artist and scheduler. */
export interface RevisionWorker {
	rewriteScene(
		chapterId: string,
		scene: { sourceIds: readonly string[]; nvs: string; instruction: string },
		signal: AbortSignal,
	): Promise<Scene>
	redraw(
		assetId: string,
		target: { path: string; instruction?: string },
		signal: AbortSignal,
	): Promise<ImageJobResult>
	adoptImage(assetId: string, source: string): Promise<string>
	redo(chapterId: string): Promise<unknown>
}

type Snapshot = CommandOutput<'editor.applyRewrite'>
type ImageTarget = CommandInput<'editor.selectImage'>
type Hunk = RewriteProposal['hunks'][number]
type StoredRewrite = { proposal: RewriteProposal; nvs: string }

const idSuffix = /\s+#([0-9a-f]{4})$/
const candidateId = /^[0-9a-f-]{36}$/
const registryFile = projectFiles.assetRegistry({ level: 'series' })
const rewriteFile = (proposalId: string) =>
	`source/production/rewrites/${proposalId}.json`
const candidatePath = (assetId: string, id: string) =>
	`candidates/redraw/${assetId}/${id}.webp`
const stale = (message: string) => ({ code: 'stale_revision', message })

export class CreativeRevisions {
	constructor(
		private readonly project: Project,
		private readonly workId: string,
		private readonly editor: ProjectEditor,
		private readonly worker: RevisionWorker,
	) {}

	async rewriteScene(
		request: RewriteRequest,
		signal = new AbortController().signal,
	): Promise<RewriteProposal> {
		const before = await this.currentScene(request)
		const sourceIds = request.sourceIds ?? before.scene.sourceIds
		if (sourceIds.some((id) => !before.scene.sourceIds.includes(id)))
			throw { code: 'not_found', message: '所选原文不属于这个场景。' }
		const rewritten = await this.worker.rewriteScene(
			request.chapterId,
			{ sourceIds, nvs: before.scene.nvs, instruction: request.instruction },
			signal,
		)
		const after = await this.currentScene(request)
		if (after.scene.nvs !== before.scene.nvs)
			throw stale('场景已改变，请刷新后重试。')
		const hunks = rewriteHunks(before.compiled, rewrittenLines(rewritten))
		if (!hunks.length)
			throw { code: 'invalid_config', message: '重写结果与当前场景相同。' }
		const { workId, chapterId, sceneId, expectedRevision } = request
		const proposal: RewriteProposal = {
			workId,
			chapterId,
			sceneId,
			proposalId: randomUUID(),
			expectedRevision,
			hunks,
		}
		await this.project.writeFile(
			rewriteFile(proposal.proposalId),
			JSON.stringify({
				proposal,
				nvs: before.scene.nvs,
			} satisfies StoredRewrite),
		)
		return proposal
	}

	async applyRewrite(
		input: CommandInput<'editor.applyRewrite'>,
	): Promise<Snapshot> {
		const stored = await existing(
			async () =>
				JSON.parse(
					(
						await this.project.readFile(rewriteFile(input.proposalId))
					).toString(),
				) as StoredRewrite,
		)
		const { proposal } = stored ?? {}
		if (
			!stored ||
			!proposal ||
			proposal.workId !== input.workId ||
			proposal.chapterId !== input.chapterId ||
			proposal.sceneId !== input.sceneId
		)
			throw { code: 'not_found', message: '找不到这次重写。' }
		if (input.expectedRevision !== proposal.expectedRevision)
			throw stale('章节已改变，请重新生成重写。')
		const selected = proposal.hunks.filter(({ id }) =>
			input.hunkIds.includes(id),
		)
		if (selected.length !== input.hunkIds.length)
			throw { code: 'not_found', message: '找不到所选的重写差异。' }
		return this.editor.replaceScene(
			{ ...proposal, instruction: '' },
			'rewrite',
			(nvs) => {
				if (nvs !== stored.nvs) throw stale('场景已改变，请重新生成重写。')
				return applyHunks(nvs, selected)
			},
		)
	}

	async regenerateImage(
		input: CommandInput<'editor.regenerateImage'>,
		signal = new AbortController().signal,
	): Promise<CommandOutput<'editor.regenerateImage'>> {
		await this.checkImage(input)
		const ids = Array.from({ length: input.count }, () => randomUUID())
		for (const id of ids) {
			const result = await this.worker.redraw(
				input.assetId,
				{
					path: candidatePath(input.assetId, id),
					...(input.instruction ? { instruction: input.instruction } : {}),
				},
				signal,
			)
			if (result.status !== 'drawn')
				throw {
					code: result.status === 'unsupported' ? 'unsupported' : 'internal',
					message: result.issue,
				}
		}
		if (ids.length === 1)
			return {
				status: 'applied',
				...(await this.selectImage({ ...input, candidateId: ids[0] })),
			}
		return {
			status: 'candidates',
			candidates: ids.map((id) => ({
				id,
				cachePath: candidatePath(input.assetId, id),
			})),
		}
	}

	selectImage(input: ImageTarget): Promise<{ revision: string }> {
		return withProjectEdits(this.project, async () => {
			const { assetId } = input
			if (!candidateId.test(input.candidateId))
				throw { code: 'not_found', message: '找不到候选图。' }
			const source = candidatePath(assetId, input.candidateId)
			if (!(await existing(() => this.project.readFile(source))))
				throw { code: 'not_found', message: '找不到候选图。' }
			const { entry, bytes } = await this.checkImage(input)
			const archive = bytes
				? `history/assets/${assetId}/${randomUUID()}.webp`
				: null
			if (archive && bytes) await this.project.writeFile(archive, bytes)
			await this.worker.adoptImage(assetId, source)
			try {
				this.project.database
					.prepare(
						`UPDATE asset SET status = 'drawn', version = version + 1,
						draw_count = draw_count + 1 WHERE work_id = ? AND asset_key = ?`,
					)
					.run(this.workId, assetId)
				recordHistory(this.project, this.workId, {
					origin: 'agent',
					kind: 'image',
					assetId,
					previous: archive,
					next: entry.path,
				})
			} catch (error) {
				if (bytes) await this.project.writeFile(entry.path, bytes)
				throw error
			}
			return { revision: (await this.imageState(assetId)).revision }
		})
	}

	async redoChapter(input: {
		workId: string
		chapterId: string
		expectedRevision: string
	}) {
		await this.currentChapter(input)
		return this.worker.redo(input.chapterId)
	}

	chapterRevision(chapterId: string) {
		return this.editor
			.snapshot({ workId: this.workId, chapterId })
			.then(({ revision }) => revision)
	}

	async imageRevision(assetId: string) {
		return (await this.imageState(assetId)).revision
	}

	private async currentChapter(input: {
		workId: string
		chapterId: string
		expectedRevision: string
	}) {
		const snapshot = await this.editor.snapshot(input)
		if (snapshot.revision !== input.expectedRevision)
			throw stale('章节已改变，请刷新后重试。')
		return snapshot
	}

	private async currentScene(request: RewriteRequest) {
		const current = await this.editor.compiledScene(request, request.sceneId)
		if (current.snapshot.revision !== request.expectedRevision)
			throw stale('章节已改变，请刷新后重试。')
		return current
	}

	private async checkImage(
		input: ImageTarget | CommandInput<'editor.regenerateImage'>,
	) {
		if (input.workId !== this.workId)
			throw { code: 'not_found', message: '工程中找不到这部作品。' }
		const state = await this.imageState(input.assetId)
		if (state.revision !== input.expectedRevision)
			throw stale('图片已改变，请刷新后重试。')
		return state
	}

	private async imageState(assetId: string) {
		const registry = await existing(() => this.project.read(registryFile))
		const entry: AssetRegistry['entries'][number] | undefined =
			registry?.entries.find(({ id }) => id === assetId)
		if (!entry) throw { code: 'not_found', message: '找不到这张图。' }
		const bytes = await existing(() => this.project.readFile(entry.path))
		const row = this.project.database
			.prepare(
				'SELECT status, version FROM asset WHERE work_id = ? AND asset_key = ?',
			)
			.get(this.workId, assetId)
		return {
			entry,
			bytes,
			revision: contentRevision([
				this.workId,
				entry,
				bytes && createHash('sha256').update(bytes).digest('hex'),
				row ?? null,
			]),
		}
	}
}

type Line = Scene['lines'][number]

function lineText(scene: Scene, line: Line) {
	const { id: _, ...rest } = line as Line & { id?: string }
	return formatScene({ ...scene, lines: [rest as Line] }).split('\n')[3]
}

function rewrittenLines(scene: Scene) {
	return scene.lines
		.filter(({ type }) => type !== 'action')
		.map((line) => lineText(scene, line))
}

function rewriteHunks(previous: Scene, next: readonly string[]) {
	const old = previous.lines.flatMap((line) =>
		'id' in line && line.id
			? [{ id: line.id, text: lineText(previous, line) }]
			: [],
	)
	const lcs = Array.from({ length: old.length + 1 }, () =>
		new Array<number>(next.length + 1).fill(0),
	)
	for (let i = old.length - 1; i >= 0; i--)
		for (let j = next.length - 1; j >= 0; j--)
			lcs[i][j] =
				old[i].text === next[j]
					? lcs[i + 1][j + 1] + 1
					: Math.max(lcs[i + 1][j], lcs[i][j + 1])
	const taken = new Set(old.map(({ id }) => id))
	const fresh = () => {
		let id: string
		do id = randomBytes(2).toString('hex')
		while (taken.has(id))
		taken.add(id)
		return id
	}
	const hunks: Hunk[] = []
	let anchor: string | null = null
	let removed: typeof old = []
	let added: string[] = []
	const flush = () => {
		if (removed.length || added.length)
			hunks.push({
				id: `h${hunks.length + 1}`,
				afterLineId: anchor,
				before: removed.map(({ id, text }) => `${text} #${id}`),
				after: added.map((text) => `${text} #${fresh()}`),
			})
		removed = []
		added = []
	}
	let i = 0
	let j = 0
	while (i < old.length || j < next.length) {
		if (i < old.length && j < next.length && old[i].text === next[j]) {
			flush()
			anchor = old[i].id
			i++
			j++
		} else if (
			j < next.length &&
			(i === old.length || lcs[i][j + 1] >= lcs[i + 1][j])
		) {
			added.push(next[j++])
		} else removed.push(old[i++])
	}
	flush()
	return hunks
}

function applyHunks(nvs: string, hunks: readonly Hunk[]) {
	const newline = nvs.includes('\r\n') ? '\r\n' : '\n'
	const raw = nvs.split(/\r?\n/)
	const index = new Map<string, number>()
	for (const [i, line] of raw.entries()) {
		const id = line.trim().match(idSuffix)?.[1]
		if (id) index.set(id, i)
	}
	const at = (id: string) => {
		const position = index.get(id)
		if (position === undefined) throw stale('剧本行已改变，请重新生成重写。')
		return position
	}
	const removed = new Set<number>()
	const inserts = new Map<number, string[]>()
	const end = raw.findLastIndex((line) => line.trim()) + 1
	for (const hunk of hunks) {
		const positions = hunk.before.map((line) => {
			const id = line.match(idSuffix)?.[1]
			const position = id === undefined ? undefined : at(id)
			if (position === undefined || raw[position].trim() !== line)
				throw stale('剧本行已改变，请重新生成重写。')
			removed.add(position)
			return position
		})
		const first = index.values().next().value
		const target =
			positions[0] ??
			(hunk.afterLineId !== null ? at(hunk.afterLineId) + 1 : (first ?? end))
		inserts.set(target, [...(inserts.get(target) ?? []), ...hunk.after])
	}
	const output: string[] = []
	for (let i = 0; i <= raw.length; i++) {
		output.push(...(inserts.get(i) ?? []))
		if (i < raw.length && !removed.has(i)) output.push(raw[i])
	}
	return output.join(newline)
}
