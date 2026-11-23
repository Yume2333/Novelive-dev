import type {
	CommandInput,
	CommandOutput,
	RewriteProposal,
} from '@novelive/creator/contract'
import { compileScript } from '@novelive/format/script'
import { effectiveMarkCss, mountMinimalPlayer } from '@novelive/player'
import { useEffect, useRef, useState } from 'react'
import { useOutletContext, useParams, useSearchParams } from 'react-router-dom'
import { Page } from '../../components/Page'
import { ScrollArea } from '../../components/ScrollArea'
import { JumpPoints } from './JumpPoints'
import { SceneImages } from './SceneImages'
import { ScriptEditor } from './ScriptEditor'
import { sceneAssets } from './scene-assets'
import '../player/player.css'
import './editor.css'

type Opening = CommandOutput<'editor.open'>
type Chapter = Opening['chapter']

export function EditorPage() {
	const { id = '' } = useParams()
	const setAgentPosition = useOutletContext<{
		setAgentPosition(position: CommandInput<'chat.send'>['position']): void
	}>()?.setAgentPosition
	const [params] = useSearchParams()
	const chapterId = params.get('chapterId') ?? 'ch0001'
	const [opening, setOpening] = useState<Opening>()
	const [sceneIndex, setSceneIndex] = useState(0)
	const [draft, setDraft] = useState('')
	const [line, setLine] = useState(1)
	const [position, setPosition] = useState({ line: 1, key: 0 })
	const [source, setSource] = useState(false)
	const [error, setError] = useState('')
	const [busy, setBusy] = useState(false)
	const [undoCount, setUndoCount] = useState(0)
	const [instruction, setInstruction] = useState('')
	const [proposal, setProposal] = useState<RewriteProposal>()
	const [selected, setSelected] = useState<string[]>([])
	const [insert, setInsert] = useState<{
		before: string
		after: string
		key: number
	}>()
	const [preview, setPreview] = useState(0)
	const [refresh, setRefresh] = useState(0)
	const [pendingRefresh, setPendingRefresh] = useState(false)
	const chapter = opening?.chapter
	const scene = chapter?.scenes[sceneIndex]
	const dirty =
		!!scene &&
		draft.replace(/\r\n?/g, '\n') !== scene.nvs.replace(/\r\n?/g, '\n')
	useEffect(() => {
		const changed = (event: Event) => {
			const { workId, chapterId: changedChapter } = (event as CustomEvent)
				.detail
			if (workId === id && changedChapter === chapterId) {
				if (dirty) {
					setPendingRefresh(true)
					setError('章节已更新，当前修改已保留；放弃修改后加载新版本')
				} else setRefresh((value) => value + 1)
			}
		}
		window.addEventListener('novelive:chapter-changed', changed)
		return () => window.removeEventListener('novelive:chapter-changed', changed)
	}, [id, chapterId, dirty])
	const stage = useRef<HTMLDivElement>(null)
	const sourceViewport = useRef<HTMLDivElement>(null)
	useEffect(() => {
		if (scene)
			setAgentPosition?.({
				kind: 'editor',
				chapterId,
				sceneId: scene.sceneId,
				sourceIds: scene.sourceIds,
			})
		return () => setAgentPosition?.(undefined)
	}, [scene, chapterId, setAgentPosition])
	useEffect(() => {
		if (source && scene)
			sourceViewport.current
				?.querySelector('[aria-pressed="true"]')
				?.scrollIntoView({ block: 'nearest' })
	}, [source, scene])
	// biome-ignore lint/correctness/useExhaustiveDependencies: 外部应用差异后重开编辑会话
	useEffect(() => {
		let disposed = false
		let opened: Opening | undefined
		setOpening(undefined)
		setError('')
		setUndoCount(0)
		setSceneIndex(0)
		setProposal(undefined)
		const close = (value: Opening) =>
			window.novelive
				.call('editor.close', {
					workId: id,
					chapterId,
					editorId: value.editorId,
				})
				.promise.catch(() => {})
		void window.novelive
			.call('editor.open', { workId: id, chapterId })
			.promise.then((value) => {
				opened = value
				if (disposed) {
					void close(value)
					return
				}
				setOpening(value)
				setDraft(value.chapter.scenes[0]?.nvs ?? '')
			})
			.catch((cause) => {
				if (!disposed) setError(cause.message ?? '无法打开编辑器')
			})
		return () => {
			disposed = true
			if (opened) void close(opened)
		}
	}, [id, chapterId, refresh])
	function accept(next: Chapter) {
		setOpening((value) => (value ? { ...value, chapter: next } : value))
		setDraft(next.scenes[sceneIndex]?.nvs ?? '')
		setProposal(undefined)
	}
	async function run(action: () => Promise<void>) {
		if (busy) return
		setBusy(true)
		setError('')
		try {
			await action()
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: ((cause as { message?: string }).message ?? '操作失败'),
			)
		} finally {
			setBusy(false)
		}
	}
	const target =
		opening && chapter
			? {
					workId: id,
					chapterId,
					editorId: opening.editorId,
					expectedRevision: chapter.revision,
				}
			: undefined
	function chooseScene(index: number) {
		if (busy) return
		if (dirty) {
			setError('请先保存或放弃当前修改')
			return
		}
		setSceneIndex(index)
		setDraft(chapter?.scenes[index]?.nvs ?? '')
		const first =
			(chapter?.scenes[index]?.nvs
				.split('\n')
				.findIndex((value) => / #[0-9a-f]{4}\s*$/.test(value)) ?? -1) + 1
		setPosition((value) => ({ line: first || 1, key: value.key + 1 }))
		setLine(first || 1)
		setProposal(undefined)
	}
	async function save() {
		if (!target || !scene) return
		const previous = scene.nvs.split(/\r\n?|\n/)
		const next = draft.split(/\r\n?|\n/)
		const changed = next.flatMap((value, index) =>
			value !== previous[index] ? [index] : [],
		)
		const index = changed[0]
		if (
			previous.length !== next.length ||
			changed.length !== 1 ||
			index === undefined
		)
			throw new Error('每次保存请只修改一句，不能增加或删除行')
		const lineId = previous[index]?.match(/ #([0-9a-f]{4})\s*$/)?.[1]
		if (
			!lineId ||
			!next[index]?.trim() ||
			next[index]?.match(/ #([0-9a-f]{4})\s*$/)?.[1] !== lineId
		)
			throw new Error('请选择带句子 ID 的文本行，保留末尾 ID')
		const saved = await window.novelive.call('editor.editLine', {
			...target,
			sceneId: scene.sceneId,
			edit: {
				kind: 'text',
				lineId,
				previous: previous[index] as string,
				next: next[index] as string,
			},
		}).promise
		accept(saved)
		if (saved.revision !== target.expectedRevision)
			setUndoCount((count) => count + 1)
	}
	function discard() {
		if (pendingRefresh) {
			setPendingRefresh(false)
			setRefresh((value) => value + 1)
		} else if (scene) setDraft(scene.nvs)
	}
	function undo() {
		if (dirty && scene) {
			discard()
			return
		}
		if (!target || !undoCount) return
		void run(async () => {
			accept(await window.novelive.call('editor.undo', target).promise)
			setUndoCount((count) => count - 1)
		})
	}
	useEffect(() => {
		if (!preview || !opening || !stage.current || !scene) return
		const abort = new AbortController()
		const script = opening.chapter.scenes
			.map((item, index) => (index === sceneIndex ? draft : item.nvs))
			.join('\n\n')
		const result = compileScript(script, {
			paragraphIds: opening.chapter.paragraphs.map((p) => p.id),
			sceneIds: opening.chapter.scenes.map((s) => s.sceneId),
			assets: opening.registry.entries,
			speakers: Object.keys(opening.speakerNames),
			customMarks: Object.keys(opening.settings.customMarks),
		})
		if (!result.ok) {
			setError(result.diagnostics.map((item) => item.message).join('\n'))
			return
		}
		const current = result.scenes[sceneIndex]
		if (!current) return
		const offset = opening.chapter.scenes
			.slice(0, sceneIndex)
			.reduce((sum, item) => sum + item.nvs.split(/\r\n?|\n/).length + 1, 0)
		const index = current.beats.findIndex(
			(beat) => beat.line && beat.line.line >= line + offset,
		)
		if (index < 0) {
			setError('当前位置之后没有可预览的句子')
			return
		}
		const beats = current.beats.slice(index)
		const initialActions = [
			...result.scenes
				.slice(0, sceneIndex)
				.flatMap((item) => item.beats.flatMap((beat) => beat.actions)),
			...current.beats.slice(0, index).flatMap((beat) => beat.actions),
		]
		const paths = new Map(
			opening.registry.entries.map((entry) => [entry.id, entry.path]),
		)
		const fail = () => {
			if (!abort.signal.aborted) setError('无法加载舞台素材')
		}
		void mountMinimalPlayer(
			stage.current,
			[{ ...current, beats }, ...result.scenes.slice(sceneIndex + 1)],
			{
				resolveAsset: (asset) => {
					const path = paths.get(asset)
					if (!path) throw new Error('找不到素材')
					return window.novelive.resourceUrl(path)
				},
			},
			abort.signal,
			fail,
			opening.speakerNames,
			undefined,
			{ customMarks: opening.settings.customMarks, initialActions },
		).catch(fail)
		return () => abort.abort()
	}, [preview, opening, scene, sceneIndex, draft, line])
	return (
		<Page
			title="编辑器"
			action={
				<button
					type="button"
					className="editor-preview"
					disabled={!scene || busy}
					onClick={() => setPreview((value) => value + 1)}
				>
					从当前句预览
				</button>
			}
		>
			<div className="editor-workbench" aria-busy={busy}>
				{error && <div role="alert">{error}</div>}
				{!opening && !error && <p role="status">正在打开编辑器</p>}
				{opening && (
					<>
						<h2>{chapter?.title}</h2>
						{chapter?.markSuggestions.map((mark) => (
							<section
								className="editor-banner"
								key={mark.id}
								aria-label="新标记提议"
							>
								<strong>新标记：{mark.name}</strong>
								<code title="播放生效的 CSS">
									{effectiveMarkCss(mark.name, mark.css) || '无可渲染样式'}
								</code>
								<span>{mark.perChar ? '逐字' : '整段'}</span>
								{(['accept', 'reject'] as const).map((decision) => (
									<button
										type="button"
										disabled={busy || dirty}
										key={decision}
										onClick={() =>
											void run(async () => {
												if (target) {
													accept(
														await window.novelive.call('editor.resolveMark', {
															...target,
															suggestionId: mark.id,
															decision,
														}).promise,
													)
													if (decision === 'accept')
														setOpening((value) =>
															value
																? {
																		...value,
																		settings: {
																			...value.settings,
																			customMarks: {
																				...value.settings.customMarks,
																				[mark.name]: {
																					css: mark.css,
																					perChar: mark.perChar,
																				},
																			},
																		},
																	}
																: value,
														)
												}
											})
										}
									>
										{decision === 'accept' ? '接受标记' : '拒绝标记'}
									</button>
								))}
							</section>
						))}
						{!scene ? (
							<p>本章还没有剧本</p>
						) : (
							<>
								<div className="editor-toolbar">
									<label>
										场景
										<select
											aria-label="场景"
											value={sceneIndex}
											disabled={busy}
											onChange={(event) =>
												chooseScene(Number(event.target.value))
											}
										>
											{chapter?.scenes.map((item, index) => (
												<option key={item.sceneId} value={index}>
													{item.nvs.match(/^scene (.+)/m)?.[1] ?? item.sceneId}
												</option>
											))}
										</select>
									</label>
									<button
										type="button"
										onClick={() => setSource((value) => !value)}
										aria-expanded={source}
									>
										原文对照
									</button>
									<button
										type="button"
										disabled={!dirty || busy}
										onClick={() => void run(save)}
									>
										保存当前句
									</button>
									<button
										type="button"
										disabled={(!dirty && !pendingRefresh) || busy}
										onClick={discard}
									>
										放弃修改
									</button>
									<button
										type="button"
										disabled={(!undoCount && !dirty) || busy}
										onClick={undo}
									>
										撤销
									</button>
									<span>当前行 {line}</span>
								</div>
								<section
									className="editor-stage"
									ref={stage}
									aria-label="舞台预览"
								/>
								<SceneImages
									key={scene.sceneId}
									workId={id}
									assets={sceneAssets(
										chapter.scenes.map((item) => item.nvs).join('\n\n'),
										{
											paragraphIds: chapter.paragraphs.map((p) => p.id),
											sceneIds: chapter.scenes.map((s) => s.sceneId),
											assets: opening.registry.entries,
											speakers: Object.keys(opening.speakerNames),
											customMarks: Object.keys(opening.settings.customMarks),
										},
										sceneIndex,
									)}
									disabled={busy || dirty}
									run={run}
									onApplied={async (assetId) => {
										const asset = await window.novelive.call(
											'production.resolveAsset',
											{ workId: id, assetId },
										).promise
										if (!asset) throw new Error('找不到素材')
										setOpening((value) =>
											value
												? {
														...value,
														registry: {
															...value.registry,
															entries: value.registry.entries.map((entry) =>
																entry.id === assetId
																	? { ...entry, path: asset.cachePath }
																	: entry,
															),
														},
													}
												: value,
										)
									}}
								/>
								<div
									className="editor-toolbar"
									role="toolbar"
									aria-label="文本效果"
								>
									{[
										['强调', '{em}', '{/em}'],
										['加粗', '{b}', '{/b}'],
										['注音', '{ruby よみ}', '{/ruby}'],
										['停顿', '{wait 0.5}', ''],
										['变速', '{speed 0.5}', '{/speed}'],
									].map(([label, before, after]) => (
										<button
											type="button"
											key={label}
											disabled={busy}
											onClick={() =>
												setInsert({
													before: before as string,
													after: after as string,
													key: Date.now(),
												})
											}
										>
											{label}
										</button>
									))}
									<label>
										文本标记
										<select
											aria-label="文本标记"
											value=""
											disabled={busy}
											onChange={(event) => {
												const name = event.target.value
												if (name)
													setInsert({
														before: `{${name}}`,
														after: `{/${name}}`,
														key: Date.now(),
													})
											}}
										>
											<option value="">选择标记</option>
											{[
												'em',
												'b',
												'dim',
												'whisper',
												'shout',
												'glitch',
												'hl',
												...Object.keys(opening.settings.customMarks),
											].map((name) => (
												<option key={name} value={name}>
													{name}
												</option>
											))}
										</select>
									</label>
									<JumpPoints
										script={draft}
										disabled={busy}
										onJump={(line) =>
											setPosition((value) => ({ line, key: value.key + 1 }))
										}
									/>
								</div>
								<div className="editor-columns">
									<ScriptEditor
										readOnly={busy}
										autoFocus={!chapter?.markSuggestions.length}
										value={draft}
										onChange={setDraft}
										onLine={setLine}
										position={position}
										insert={insert}
										onUndo={undo}
									/>
									{source && (
										<ScrollArea
											className="editor-source"
											viewportRef={sourceViewport}
										>
											<h3>原文</h3>
											{chapter?.paragraphs.map((paragraph) => (
												<button
													type="button"
													key={paragraph.id}
													disabled={busy}
													aria-pressed={scene.sourceIds.includes(paragraph.id)}
													onClick={() => {
														const index = chapter.scenes.findIndex((item) =>
															item.sourceIds.includes(paragraph.id),
														)
														if (index >= 0) chooseScene(index)
													}}
												>
													{paragraph.id} · {paragraph.text}
												</button>
											))}
										</ScrollArea>
									)}
								</div>
								<form
									className="editor-toolbar"
									onSubmit={(event) => {
										event.preventDefault()
										void run(async () => {
											if (!target) return
											const value = await window.novelive.call(
												'editor.rewriteScene',
												{
													workId: id,
													chapterId,
													sceneId: scene.sceneId,
													expectedRevision: target.expectedRevision,
													instruction,
													sourceIds: scene.sourceIds,
												},
											).promise
											setProposal(value)
											setSelected(value.hunks.map((hunk) => hunk.id))
										})
									}}
								>
									<input
										aria-label="重写要求"
										value={instruction}
										onChange={(event) => setInstruction(event.target.value)}
										placeholder="重写要求"
									/>
									<button
										type="submit"
										disabled={!instruction.trim() || dirty || busy}
									>
										重写场景
									</button>
								</form>
								{proposal && (
									<section aria-label="重写差异">
										<h3>差异列表</h3>
										<ScrollArea className="editor-diff">
											{proposal.hunks.map((hunk) => (
												<label key={hunk.id}>
													<input
														type="checkbox"
														checked={selected.includes(hunk.id)}
														onChange={(event) =>
															setSelected((value) =>
																event.target.checked
																	? [...value, hunk.id]
																	: value.filter((id) => id !== hunk.id),
															)
														}
													/>
													{hunk.id}
													<del>{hunk.before.join('\n')}</del>
													<ins>{hunk.after.join('\n')}</ins>
												</label>
											))}
										</ScrollArea>
										<button
											type="button"
											disabled={!selected.length || dirty || busy}
											onClick={() =>
												void run(async () => {
													accept(
														await window.novelive.call('editor.applyRewrite', {
															workId: id,
															chapterId,
															sceneId: proposal.sceneId,
															expectedRevision: proposal.expectedRevision,
															proposalId: proposal.proposalId,
															hunkIds: selected,
														}).promise,
													)
												})
											}
										>
											应用勾选差异
										</button>
										<button
											type="button"
											onClick={() => setProposal(undefined)}
										>
											取消重写
										</button>
									</section>
								)}
							</>
						)}
					</>
				)}
			</div>
		</Page>
	)
}
