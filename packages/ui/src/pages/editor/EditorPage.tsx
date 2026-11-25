import type {
	CommandInput,
	CommandOutput,
	RewriteProposal,
} from '@novelive/creator/contract'
import { compileScript } from '@novelive/format/script'
import { effectiveMarkCss, mountMinimalPlayer } from '@novelive/player'
import {
	BookmarkPlus,
	BookOpen,
	ChevronRight,
	History,
	Info,
	MoreHorizontal,
	Play,
	Redo2,
	RotateCcw,
	Sparkles,
	Undo2,
	User,
	WandSparkles,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext, useParams, useSearchParams } from 'react-router-dom'
import { Button } from '../../components/Button'
import { Chip } from '../../components/Card'
import { Dropdown } from '../../components/Dropdown'
import { Banner, Tooltip } from '../../components/Extended'
import { CompactSelect } from '../../components/Form'
import { Page } from '../../components/Page'
import { useToast } from '../../components/Toast'
import { scoped } from '../../i18n'
import { EditorPanels } from './EditorPanels'
import { EditorStage } from './EditorStage'
import { JumpPoints } from './JumpPoints'
import { RewriteModal, SourceRewriteModal } from './RewriteModal'
import { SceneImages } from './SceneImages'
import { ScriptEditor } from './ScriptEditor'
import { SentenceList } from './SentenceList'
import { SourcePanel } from './SourcePanel'
import {
	buildParagraphFirstLine,
	lineExpression,
	sceneAssets,
	stageSnapshotAtLine,
} from './scene-assets'
import {
	parseSentenceLines,
	type SentenceLine,
	updateSentenceLine,
} from './sentence-lines'
import '../player/player.css'
import './editor.css'

const t = scoped('editor')

type Opening = CommandOutput<'editor.open'>
type Chapter = Opening['chapter']
type LineEdit = CommandInput<'editor.editLine'>['edit']

export function EditorPage() {
	const { id = '' } = useParams()
	const outlet = useOutletContext<{
		setAgentPosition?(position: CommandInput<'chat.send'>['position']): void
		setAgentContext?(label: string | null): void
		openAgent?(): void
	}>()
	const [params, setParams] = useSearchParams()
	const chapterId = params.get('chapterId') ?? 'ch0001'
	const sceneIdParam = params.get('sceneId')
	const lineIdParam = params.get('lineId')
	const [workTitle, setWorkTitle] = useState<string>()
	const [workChapters, setWorkChapters] = useState<
		{ chapterId: string; index: number; title: string; published: boolean }[]
	>([])
	const toast = useToast()

	useEffect(() => {
		const pending = window.novelive.call('library.list', {})
		pending.promise.then(
			(library) => {
				const item = library.works.find((entry) => entry.workId === id)
				setWorkTitle(
					item &&
						(item.project
							? `${item.project.seriesTitle} · ${item.title}`
							: item.title),
				)
			},
			() => setWorkTitle(undefined),
		)
		return () => pending.cancel()
	}, [id])
	useEffect(() => {
		const pending = window.novelive.call('production.playerStatus', {
			workId: id,
		})
		pending.promise.then(
			(status) =>
				setWorkChapters(
					status.chapters.map((item, index) => ({
						chapterId: item.chapterId,
						index: index + 1,
						title: item.title,
						published: item.published,
					})),
				),
			() => setWorkChapters([]),
		)
		return () => pending.cancel()
	}, [id])

	const [opening, setOpening] = useState<Opening>()
	const [sceneIndex, setSceneIndex] = useState(0)
	const [draft, setDraft] = useState('')
	const [line, setLine] = useState(1)
	const [position, setPosition] = useState({ line: 1, key: 0 })
	const [source, setSource] = useState(false)
	const [rewriteOpen, setRewriteOpen] = useState(false)
	const rewriteRequest = useRef(0)
	const [error, setError] = useState('')
	const [busy, setBusy] = useState(false)
	const [undoLines, setUndoLines] = useState<string[]>([])
	const [instruction, setInstruction] = useState('')
	const [proposal, setProposal] = useState<RewriteProposal>()
	const [selected, setSelected] = useState<string[]>([])
	const [insert, setInsert] = useState<{
		before: string
		after: string
		key: number
	}>()
	const [preview, setPreview] = useState(0)
	const [paused, setPaused] = useState(false)
	const previewStartLineRef = useRef(1)
	const liveBeatLineRef = useRef(1)
	const [refresh, setRefresh] = useState(0)
	const [pendingRefresh, setPendingRefresh] = useState(false)
	const [advancedMode, setAdvancedMode] = useState(false)
	const [historyOpen, setHistoryOpen] = useState(false)
	const [rulesOpen, setRulesOpen] = useState(false)
	const [regeneratingTarget, setRegeneratingTarget] = useState<
		'bg' | 'portrait' | null
	>(null)
	const [rewriteSourceParagraph, setRewriteSourceParagraph] = useState<
		{ id: string; text: string } | undefined
	>()
	const [sourceAskParagraph, setSourceAskParagraph] = useState<{
		id: string
		text: string
	} | null>(null)
	const [sourceAskInstruction, setSourceAskInstruction] = useState('')
	const undoEditsRef = useRef<{ sceneId: string; edit: LineEdit }[]>([])
	const [redoStack, setRedoStack] = useState<
		{ sceneId: string; edit: LineEdit }[]
	>([])
	const [editedLineIds, setEditedLineIds] = useState<ReadonlySet<string>>(
		new Set(),
	)

	const chapter = opening?.chapter
	const scene = chapter?.scenes[sceneIndex]
	const dirty =
		!!scene &&
		draft.replace(/\r\n?/g, '\n') !== scene.nvs.replace(/\r\n?/g, '\n')
	const sentences = useMemo(() => parseSentenceLines(draft), [draft])
	const expression = useMemo(
		() =>
			opening && chapter && scene
				? lineExpression(chapter.scenes, sceneIndex, line, {
						paragraphIds: chapter.paragraphs.map((p) => p.id),
						assets: opening.registry.entries,
						speakers: Object.keys(opening.speakerNames),
						customMarks: Object.keys(opening.settings.customMarks),
					})
				: undefined,
		[opening, chapter, scene, sceneIndex, line],
	)

	const snapshot = useMemo(
		() =>
			opening && chapter && scene
				? stageSnapshotAtLine(
						chapter.scenes.map((s, idx) =>
							idx === sceneIndex ? { ...s, nvs: draft } : s,
						),
						sceneIndex,
						line,
						{
							paragraphIds: chapter.paragraphs.map((p) => p.id),
							assets: opening.registry.entries,
							speakers: Object.keys(opening.speakerNames),
							customMarks: Object.keys(opening.settings.customMarks),
						},
					)
				: { sceneTitle: '', cast: [], paragraphFirstLine: {} },
		[opening, chapter, scene, sceneIndex, draft, line],
	)

	const activeSentence =
		sentences.find((s) => s.lineNumber === line) ?? sentences[0]
	const activeSentenceIdx = activeSentence
		? sentences.findIndex((s) => s.lineNumber === activeSentence.lineNumber)
		: -1

	const currentChapterIndex =
		workChapters.find((c) => c.chapterId === chapterId)?.index ?? 0

	// --- Agent integration ---
	useEffect(() => {
		if (scene)
			outlet?.setAgentPosition?.({
				kind: 'editor',
				chapterId,
				sceneId: scene.sceneId,
				sourceIds: scene.sourceIds,
			})
		return () => outlet?.setAgentPosition?.(undefined)
	}, [scene, chapterId, outlet])

	useEffect(() => {
		if (scene && activeSentence) {
			outlet?.setAgentContext?.(
				t('第 {{chapter}} 章 · {{scene}} · 第 {{sentence}} 句', {
					chapter: currentChapterIndex || 1,
					scene: snapshot.sceneTitle,
					sentence: activeSentenceIdx + 1,
				}),
			)
		}
		return () => outlet?.setAgentContext?.(null)
	}, [
		scene,
		activeSentence,
		currentChapterIndex,
		snapshot.sceneTitle,
		activeSentenceIdx,
		outlet,
	])

	function handleAskAgent(sentence: SentenceLine) {
		if (dirty && sentence.lineNumber !== line) {
			setError(t('请先保存或放弃当前修改'))
			return
		}
		selectSentenceLine(sentence.lineNumber)
		if (scene) {
			outlet?.setAgentPosition?.({
				kind: 'editor',
				chapterId,
				sceneId: scene.sceneId,
				sourceIds: scene.sourceIds,
			})
			outlet?.setAgentContext?.(
				t('第 {{chapter}} 章 · {{scene}} · 第 {{sentence}} 句', {
					chapter: currentChapterIndex || 1,
					scene: snapshot.sceneTitle,
					sentence:
						sentences.findIndex((s) => s.lineNumber === sentence.lineNumber) +
						1,
				}),
			)
		}
		if (outlet?.openAgent) {
			outlet.openAgent()
		} else if (
			!document.querySelector('[role="complementary"][aria-label="Agent"]')
		) {
			window.dispatchEvent(
				new KeyboardEvent('keydown', {
					key: 'j',
					ctrlKey: true,
					bubbles: true,
				}),
			)
		}
	}

	// --- Chapter/asset change listeners ---
	useEffect(() => {
		const changed = (event: Event) => {
			const { workId, chapterId: changedChapter } = (event as CustomEvent)
				.detail
			if (workId === id && changedChapter === chapterId) {
				if (dirty) {
					setPendingRefresh(true)
					setError(t('章节已更新，当前修改已保留；放弃修改后加载新版本'))
				} else
					void window.novelive
						.call('editor.snapshot', {
							workId: id,
							chapterId,
							editorId: opening?.editorId,
						})
						.promise.then((fresh) => {
							setOpening((value) =>
								value
									? {
											...value,
											chapter: fresh.chapter,
											settings: fresh.settings,
											settingsRevision: fresh.settingsRevision,
										}
									: value,
							)
							setDraft(fresh.chapter.scenes[sceneIndex]?.nvs ?? '')
							setUndoLines(fresh.undoLines)
							setProposal(undefined)
						})
						.catch(() => setRefresh((value) => value + 1))
			}
		}
		const assetChanged = (event: Event) => {
			const { workId, assetId } = (event as CustomEvent).detail as {
				workId: string
				assetId: string
			}
			if (workId !== id) return
			void window.novelive
				.call('production.resolveAsset', { workId: id, assetId })
				.promise.then((asset) => {
					if (!asset) return
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
					setPreview((value) => (value ? value + 1 : value))
				})
				.catch(() => {})
		}
		window.addEventListener('novelive:chapter-changed', changed)
		window.addEventListener('novelive:asset-changed', assetChanged)
		return () => {
			window.removeEventListener('novelive:chapter-changed', changed)
			window.removeEventListener('novelive:asset-changed', assetChanged)
		}
	}, [id, chapterId, dirty, opening, sceneIndex])

	const stage = useRef<HTMLDivElement>(null)
	const stageBox = useRef<HTMLElement>(null)
	const sourceViewport = useRef<HTMLDivElement>(null)

	// biome-ignore lint/correctness/useExhaustiveDependencies: 外部应用差异后重开编辑会话
	useEffect(() => {
		let disposed = false
		let opened: Opening | undefined
		setOpening(undefined)
		setError('')
		setUndoLines([])
		setSceneIndex(0)
		setProposal(undefined)
		undoEditsRef.current = []
		setRedoStack([])
		setEditedLineIds(new Set())
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
				// Deep link: find target scene from sceneId param
				const targetSceneIdx = sceneIdParam
					? Math.max(
							value.chapter.scenes.findIndex((s) => s.sceneId === sceneIdParam),
							0,
						)
					: 0
				const targetNvs = value.chapter.scenes[targetSceneIdx]?.nvs ?? ''
				// Deep link: find target line from lineId param
				let targetLine = 1
				if (lineIdParam) {
					const rows = targetNvs.split(/\r\n?|\n/)
					for (const [idx, row] of rows.entries()) {
						if (row.match(/ #([0-9a-f]{4})\s*$/)?.[1] === lineIdParam) {
							targetLine = idx + 1
							break
						}
					}
				}
				if (targetLine === 1) {
					const firstSentence =
						(targetNvs
							.split(/\r\n?|\n/)
							.findIndex((row) => / #[0-9a-f]{4}\s*$/.test(row)) ?? -1) + 1
					targetLine = firstSentence || 1
				}
				setSceneIndex(targetSceneIdx)
				setDraft(targetNvs)
				setLine(targetLine)
				setPosition((prev) => ({ line: targetLine, key: prev.key + 1 }))
			})
			.catch((cause) => {
				if (!disposed) setError(cause.message ?? t('无法打开编辑器'))
			})
		return () => {
			disposed = true
			if (opened) void close(opened)
		}
	}, [id, chapterId, refresh])

	// Deep link: react to param changes within the same chapter
	const deepLinkRef = useRef({ sceneIndex, line, dirty, draft, scene })
	deepLinkRef.current = { sceneIndex, line, dirty, draft, scene }
	const chooseSceneRef = useRef(chooseScene)
	chooseSceneRef.current = chooseScene
	useEffect(() => {
		if (!opening || !chapter) return
		const current = deepLinkRef.current
		if (sceneIdParam) {
			const idx = chapter.scenes.findIndex((s) => s.sceneId === sceneIdParam)
			if (idx >= 0 && idx !== current.sceneIndex) {
				if (current.dirty) return
				let targetLine: number | undefined
				if (lineIdParam) {
					const targetNvs = chapter.scenes[idx]?.nvs ?? ''
					for (const [rowIdx, row] of targetNvs.split(/\r\n?|\n/).entries()) {
						if (row.match(/ #([0-9a-f]{4})\s*$/)?.[1] === lineIdParam) {
							targetLine = rowIdx + 1
							break
						}
					}
				}
				chooseSceneRef.current(idx, targetLine)
				return
			}
		}
		if (lineIdParam && current.scene) {
			const rows = current.draft.split(/\r\n?|\n/)
			for (const [idx, row] of rows.entries()) {
				if (row.match(/ #([0-9a-f]{4})\s*$/)?.[1] === lineIdParam) {
					const targetLineNum = idx + 1
					if (targetLineNum !== current.line) {
						if (!current.dirty) {
							setLine(targetLineNum)
							setPosition((prev) => ({
								line: targetLineNum,
								key: prev.key + 1,
							}))
						}
					}
					break
				}
			}
		}
	}, [sceneIdParam, lineIdParam, opening, chapter])

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
					: ((cause as { message?: string }).message ?? t('操作失败')),
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

	function chooseScene(index: number, targetLine?: number) {
		if (busy) return
		if (dirty) {
			setError(t('请先保存或放弃当前修改'))
			return
		}
		stopPreview()
		setSceneIndex(index)
		setDraft(chapter?.scenes[index]?.nvs ?? '')
		const foundIndex =
			chapter?.scenes[index]?.nvs
				.split(/\r\n?|\n/)
				.findIndex((value) => / #[0-9a-f]{4}\s*$/.test(value)) ?? -1
		const nextLine = targetLine ?? (foundIndex >= 0 ? foundIndex + 1 : 1)
		setPosition((value) => ({ line: nextLine, key: value.key + 1 }))
		setLine(nextLine)
		setProposal(undefined)
		previewStartLineRef.current = nextLine
		liveBeatLineRef.current = nextLine
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
			throw new Error(t('每次保存请只修改一句，不能增加或删除行'))
		const lineId = previous[index]?.match(/ #([0-9a-f]{4})\s*$/)?.[1]
		if (
			!lineId ||
			!next[index]?.trim() ||
			next[index]?.match(/ #([0-9a-f]{4})\s*$/)?.[1] !== lineId
		)
			throw new Error(t('请选择带句子 ID 的文本行，保留末尾 ID'))
		const edit: LineEdit = {
			kind: 'text',
			lineId,
			previous: previous[index] as string,
			next: next[index] as string,
		}
		const saved = await window.novelive.call('editor.editLine', {
			...target,
			sceneId: scene.sceneId,
			edit,
		}).promise
		accept(saved)
		if (saved.revision !== target.expectedRevision) {
			setUndoLines((lines) => [...lines, `${scene.sceneId}:${lineId}`])
			undoEditsRef.current.push({ sceneId: scene.sceneId, edit })
			setRedoStack([])
			setEditedLineIds((ids) => new Set(ids).add(lineId))
		}
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
		if (!target || !undoLines.length) return
		void run(async () => {
			accept(await window.novelive.call('editor.undo', target).promise)
			setUndoLines((lines) => lines.slice(0, -1))
			// Move the last undo edit to the redo stack
			const popped = undoEditsRef.current.pop()
			if (popped) setRedoStack((stack) => [...stack, popped])
		})
	}

	function redo() {
		if (!target || !redoStack.length || dirty) return
		const entry = redoStack[redoStack.length - 1]
		if (!entry) return
		void run(async () => {
			const saved = await window.novelive.call('editor.editLine', {
				...target,
				sceneId: entry.sceneId,
				edit: entry.edit,
			}).promise
			accept(saved)
			setRedoStack((stack) => stack.slice(0, -1))
			undoEditsRef.current.push(entry)
			const lineId =
				entry.edit.kind === 'text' || entry.edit.kind === 'expression'
					? entry.edit.lineId
					: undefined
			if (lineId) {
				setUndoLines((lines) => [...lines, `${entry.sceneId}:${lineId}`])
				setEditedLineIds((ids) => new Set(ids).add(lineId))
			}
			toast(t('已重做'), Redo2)
		})
	}

	// --- Preview ---
	useEffect(() => {
		if (!preview || paused || !opening || !stage.current || !scene) return
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
		const startLine = previewStartLineRef.current
		const index = current.beats.findIndex(
			(beat) => beat.line && beat.line.line >= startLine + offset,
		)
		if (index < 0) {
			setError(t('当前位置之后没有可预览的句子'))
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
			if (!abort.signal.aborted) setError(t('无法加载舞台素材'))
		}
		void mountMinimalPlayer(
			stage.current,
			[{ ...current, beats }, ...result.scenes.slice(sceneIndex + 1)],
			{
				resolveAsset: (asset) => {
					const path = paths.get(asset)
					if (!path) throw new Error(t('找不到素材'))
					return window.novelive.resourceUrl(path)
				},
			},
			abort.signal,
			fail,
			opening.speakerNames,
			(beat) => {
				if (beat?.line && beat.line.line > offset) {
					const localLine = beat.line.line - offset
					if (localLine >= 1 && localLine <= draft.split(/\r\n?|\n/).length)
						liveBeatLineRef.current = localLine
				}
			},
			{
				customMarks: opening.settings.customMarks,
				initialActions,
				endText: t('本章结束'),
			},
		).catch(fail)
		return () => abort.abort()
	}, [preview, paused, opening, scene, sceneIndex, draft])

	function stopPreview() {
		setPreview(0)
		setPaused(false)
	}

	const hasScene = !!scene
	useEffect(() => {
		const box = stageBox.current
		if (!box || !hasScene) return
		const syncScale = () =>
			box.style.setProperty(
				'--editor-stage-scale',
				String(box.clientWidth / 960),
			)
		syncScale()
		const observer = new ResizeObserver(syncScale)
		observer.observe(box)
		return () => observer.disconnect()
	}, [hasScene])

	// --- Keyboard shortcuts ---
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const modalOpen =
				rewriteOpen || historyOpen || rulesOpen || !!sourceAskParagraph
			if (
				preview > 0 &&
				e.key === 'Escape' &&
				!modalOpen &&
				!document.querySelector('[role="dialog"]')
			) {
				e.preventDefault()
				stopPreview()
				return
			}
			const target = e.target as HTMLElement
			if (
				target.tagName === 'INPUT' ||
				target.tagName === 'TEXTAREA' ||
				target.tagName === 'SELECT' ||
				target.isContentEditable
			)
				return
			const mod = e.metaKey || e.ctrlKey
			if (mod && e.key.toLowerCase() === 'z') {
				e.preventDefault()
				if (e.shiftKey) redo()
				else undo()
				return
			}
			if (mod && e.key.toLowerCase() === 'y' && !e.shiftKey) {
				e.preventDefault()
				redo()
				return
			}
			if (
				!advancedMode &&
				!modalOpen &&
				!busy &&
				sentences.length > 0 &&
				!document.querySelector('[role="menu"], [role="dialog"]')
			) {
				if (e.key === 'ArrowUp') {
					e.preventDefault()
					const idx = sentences.findIndex((s) => s.lineNumber === line)
					if (idx > 0) {
						const prev = sentences[idx - 1]
						if (prev) selectSentenceLine(prev.lineNumber)
					}
				} else if (e.key === 'ArrowDown') {
					e.preventDefault()
					const idx = sentences.findIndex((s) => s.lineNumber === line)
					if (idx >= 0 && idx < sentences.length - 1) {
						const next = sentences[idx + 1]
						if (next) selectSentenceLine(next.lineNumber)
					}
				}
			}
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	})

	const alert = (
		<div className="editor-alert" role="alert">
			{error}
		</div>
	)
	const rewriting = rewriteOpen || !!proposal

	const listed = workChapters.filter(
		(item) => item.published || item.chapterId === chapterId,
	)
	const chapters = listed.some((item) => item.chapterId === chapterId)
		? listed.map((item) =>
				item.chapterId === chapterId
					? { ...item, title: item.title ?? chapter?.title }
					: item,
			)
		: [...listed, { chapterId, index: 0, title: chapter?.title }]

	const chooseChapter = (value: string) =>
		setParams((current) => {
			const next = new URLSearchParams(current)
			next.set('chapterId', value)
			next.delete('sceneId')
			next.delete('lineId')
			return next
		})

	const closeRewrite = () => {
		rewriteRequest.current += 1
		setRewriteOpen(false)
		setProposal(undefined)
		setRewriteSourceParagraph(undefined)
	}

	function changeExpression(next: string) {
		if (!target || !scene || !expression || next === expression.current) return
		const edit: LineEdit = {
			kind: 'expression',
			lineId: expression.lineId,
			previous: expression.current,
			next,
		}
		void run(async () => {
			const saved = await window.novelive.call('editor.editLine', {
				...target,
				sceneId: scene.sceneId,
				edit,
			}).promise
			accept(saved)
			if (saved.revision !== target.expectedRevision) {
				setUndoLines((lines) => [
					...lines,
					`${scene.sceneId}:${expression.lineId}`,
				])
				undoEditsRef.current.push({ sceneId: scene.sceneId, edit })
				setRedoStack([])
				setEditedLineIds((ids) => new Set(ids).add(expression.lineId))
			}
		})
	}

	function selectSentenceLine(nextLine: number) {
		if (dirty && nextLine !== line) {
			setError(t('请先保存或放弃当前修改'))
			return
		}
		setError('')
		setLine(nextLine)
		setPosition((value) => ({ line: nextLine, key: value.key + 1 }))
	}

	function updateSentence(
		lineNumber: number,
		patch: { text?: string; displayAs?: string },
	) {
		setDraft((current) => updateSentenceLine(current, lineNumber, patch))
	}

	function generateRewrite() {
		if (!target || !scene) return
		void run(async () => {
			const request = ++rewriteRequest.current
			const value = await window.novelive.call('editor.rewriteScene', {
				workId: id,
				chapterId,
				sceneId: scene.sceneId,
				expectedRevision: target.expectedRevision,
				instruction,
				sourceIds: rewriteSourceParagraph
					? [rewriteSourceParagraph.id]
					: scene.sourceIds,
			}).promise
			if (request !== rewriteRequest.current) return
			setProposal(value)
			setSelected(value.hunks.map((hunk) => hunk.id))
		})
	}

	function applyRewrite() {
		if (!proposal || !target) return
		void run(async () => {
			const applied = await window.novelive.call('editor.applyRewrite', {
				workId: id,
				chapterId,
				sceneId: proposal.sceneId,
				expectedRevision: proposal.expectedRevision,
				proposalId: proposal.proposalId,
				hunkIds: selected,
			}).promise
			const fresh = await window.novelive.call('editor.snapshot', {
				workId: id,
				chapterId,
				editorId: opening?.editorId,
			}).promise
			setUndoLines(fresh.undoLines)
			accept(applied)
			setRewriteOpen(false)
			setRedoStack([])
		})
	}

	// Active portrait for SceneImages
	const speakingCastMember = activeSentence?.speaker
		? snapshot.cast.find((m) => m.charId === activeSentence.speaker)
		: undefined
	const activePortraitId =
		speakingCastMember?.assetId ?? snapshot.cast[0]?.assetId

	return (
		<Page
			title={t('编辑器')}
			width="full"
			eyebrow={workTitle}
			subtitle={
				scene &&
				chapter && (
					<div className="editor-subtitle">
						<CompactSelect
							aria-label={t('章节')}
							value={chapterId}
							disabled={busy || dirty}
							onChange={chooseChapter}
							options={chapters.map((item) => ({
								value: item.chapterId,
								label: item.index
									? t('第 {{index}} 章 {{title}}', {
											index: item.index,
											title: item.title ?? item.chapterId,
										})
									: (item.title ?? item.chapterId),
							}))}
						/>
						<ChevronRight
							aria-hidden="true"
							className="editor-subtitle-separator"
							size={14}
							strokeWidth={1.8}
						/>
						<CompactSelect
							aria-label={t('场景')}
							value={String(sceneIndex)}
							disabled={busy}
							onChange={(v) => chooseScene(Number(v))}
							options={chapter.scenes.map((item, index) => ({
								value: String(index),
								label: item.nvs.match(/^scene (.+)/m)?.[1] ?? item.sceneId,
							}))}
						/>
						<Tooltip text={t('只列已发布的章节')}>
							<Info
								aria-hidden="true"
								size={15}
								strokeWidth={1.8}
								className="editor-info-icon"
							/>
						</Tooltip>
					</div>
				)
			}
			actions={
				<div className="editor-actions">
					<Tooltip text={t('打开 / 收起原文对照')}>
						<Button
							icon={BookOpen}
							aria-label={t('原文对照')}
							aria-expanded={source}
							data-active={source || undefined}
							disabled={!scene}
							onClick={() => setSource((v) => !v)}
						/>
					</Tooltip>
					<Tooltip
						text={
							preview > 0
								? t('重新从当前句预览')
								: t('预览：从当前句开始在舞台上播放')
						}
					>
						<Button
							icon={Play}
							aria-label={t('从当前句预览')}
							disabled={!scene || busy}
							onClick={() => {
								previewStartLineRef.current = line
								liveBeatLineRef.current = line
								setPaused(false)
								setPreview((v) => v + 1)
							}}
						/>
					</Tooltip>
					<Tooltip
						text={
							undoLines.length || dirty
								? t('撤销（Ctrl/⌘+Z）')
								: t('没有可撤销的修改')
						}
					>
						<Button
							icon={Undo2}
							aria-label={t('撤销')}
							disabled={(!undoLines.length && !dirty) || busy}
							onClick={undo}
						/>
					</Tooltip>
					<Tooltip
						text={
							redoStack.length
								? t('重做（Ctrl/⌘+Shift+Z）')
								: t('没有可重做的修改')
						}
					>
						<Button
							icon={Redo2}
							aria-label={t('重做')}
							disabled={!redoStack.length || dirty || busy}
							onClick={redo}
						/>
					</Tooltip>
					<Dropdown
						label={t('更多')}
						className="editor-toolbar-dropdown nl-btn glass-panel"
						trigger={
							<MoreHorizontal aria-hidden="true" size={16} strokeWidth={1.8} />
						}
						items={[
							{
								label: t('修改历史'),
								icon: History,
								disabled: !scene || busy,
								onSelect: () => setHistoryOpen(true),
							},
							{
								label: t('存为规则'),
								icon: BookmarkPlus,
								disabled: !scene || busy,
								onSelect: () => setRulesOpen(true),
							},
						]}
					/>
					<Button
						variant="primary"
						icon={WandSparkles}
						disabled={!scene || busy || dirty}
						onClick={() => {
							setRewriteSourceParagraph(undefined)
							setRewriteOpen(true)
						}}
					>
						{t('让 Agent 重写本场景')}
					</Button>
					{(dirty || pendingRefresh) && (
						<div className="editor-draft-actions">
							{dirty && <Chip>{t('未保存')}</Chip>}
							<Button
								variant="ghost"
								icon={RotateCcw}
								disabled={busy}
								onClick={discard}
							>
								{t('放弃修改')}
							</Button>
							<Button disabled={!dirty || busy} onClick={() => void run(save)}>
								{t('保存当前句')}
							</Button>
						</div>
					)}
				</div>
			}
		>
			<div className="editor-workbench" aria-busy={busy}>
				{error && !rewriting && alert}
				{!opening && !error && (
					<p className="editor-muted" role="status">
						{t('正在打开编辑器')}
					</p>
				)}
				{opening && (
					<>
						{chapter?.markSuggestions.map((mark) => (
							<section
								className="editor-banner-wrap"
								key={mark.id}
								aria-label={t('新标记提议')}
							>
								<Banner
									kind="warning"
									icon={Sparkles}
									action={
										<span className="editor-banner-actions">
											<Button
												size="sm"
												variant="ghost"
												disabled={busy || dirty}
												onClick={() =>
													void run(async () => {
														if (!target) return
														const resolved = await window.novelive.call(
															'editor.resolveMark',
															{
																...target,
																suggestionId: mark.id,
																decision: 'reject',
															},
														).promise
														accept(resolved)
													})
												}
											>
												{t('拒绝标记')}
											</Button>
											<Button
												size="sm"
												variant="primary"
												disabled={busy || dirty}
												onClick={() =>
													void run(async () => {
														if (!target) return
														const resolved = await window.novelive.call(
															'editor.resolveMark',
															{
																...target,
																suggestionId: mark.id,
																decision: 'accept',
															},
														).promise
														const fresh = await window.novelive.call(
															'editor.snapshot',
															{
																workId: id,
																chapterId,
																editorId: opening?.editorId,
															},
														).promise
														setOpening((value) =>
															value
																? {
																		...value,
																		settings: fresh.settings,
																		settingsRevision: fresh.settingsRevision,
																	}
																: value,
														)
														accept(resolved)
													})
												}
											>
												{t('接受标记')}
											</Button>
										</span>
									}
								>
									<strong>{t('新标记：{{name}}', { name: mark.name })}</strong>{' '}
									<code>
										{effectiveMarkCss(mark.name, mark.css) || t('无可渲染样式')}
									</code>{' '}
									{mark.perChar ? t('逐字') : t('整段')}
								</Banner>
							</section>
						))}
						{!scene ? (
							<p className="editor-empty">{t('本章还没有剧本')}</p>
						) : (
							<div className="editor-main" data-source={source || undefined}>
								<div className="editor-stage-column">
									<div className="editor-stage-frame">
										<EditorStage
											stageRef={stage}
											stageBoxRef={stageBox}
											snapshot={snapshot}
											sentences={sentences}
											activeSentence={activeSentence}
											speakerNames={opening.speakerNames}
											customMarks={opening.settings.customMarks}
											playing={preview > 0}
											paused={paused}
											regenerating={regeneratingTarget}
											onSelectLine={selectSentenceLine}
											onTogglePause={() => {
												if (!paused) {
													// Pausing: sync the live beat line and freeze
													const atLine = liveBeatLineRef.current
													setLine(atLine)
													setPosition((p) => ({
														line: atLine,
														key: p.key + 1,
													}))
													setPaused(true)
												} else {
													// Resuming: use current line (may have been edited)
													previewStartLineRef.current = line
													setPaused(false)
												}
											}}
											onStopPlay={stopPreview}
											onCastClick={(charId) => {
												const found = sentences.find(
													(s) => s.speaker === charId,
												)
												if (found) selectSentenceLine(found.lineNumber)
												else
													toast(
														t('{{name}}在这一场没有台词', {
															name: opening.speakerNames[charId] ?? charId,
														}),
														User,
													)
											}}
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
													customMarks: Object.keys(
														opening.settings.customMarks,
													),
												},
												sceneIndex,
											)}
											activeBackgroundId={
												(snapshot.cg ?? snapshot.background)?.id
											}
											activePortraitId={activePortraitId}
											speakerNames={opening.speakerNames}
											disabled={busy || dirty}
											run={run}
											onRegeneratingChange={setRegeneratingTarget}
											onApplied={async (assetId) => {
												const asset = await window.novelive.call(
													'production.resolveAsset',
													{ workId: id, assetId },
												).promise
												if (!asset) throw new Error(t('找不到素材'))
												setOpening((value) =>
													value
														? {
																...value,
																registry: {
																	...value.registry,
																	entries: value.registry.entries.map(
																		(entry) =>
																			entry.id === assetId
																				? {
																						...entry,
																						path: asset.cachePath,
																					}
																				: entry,
																	),
																},
															}
														: value,
												)
											}}
										/>
									</div>
								</div>
								<section className="editor-panel editor-script-panel">
									<header className="editor-panel-head">
										<span className="editor-label">
											{advancedMode ? t('NVS 剧本') : t('这一场的句子')}
										</span>
										<span className="editor-muted">
											{advancedMode
												? t('当前行 {{line}}', { line })
												: t('共 {{count}} 句', { count: sentences.length })}
										</span>
										<button
											type="button"
											className="editor-chip-button editor-mode-toggle"
											aria-pressed={advancedMode}
											disabled={busy}
											onClick={() => setAdvancedMode((value) => !value)}
										>
											{t('高级模式')}
										</button>
									</header>
									{advancedMode ? (
										<>
											<div
												className="editor-marks"
												role="toolbar"
												aria-label={t('文本效果')}
											>
												{[
													[t('强调'), '{em}', '{/em}'],
													[t('加粗'), '{b}', '{/b}'],
													[t('注音'), t('{ruby よみ}'), '{/ruby}'],
													[t('停顿'), '{wait 0.5}', ''],
													[t('变速'), '{speed 0.5}', '{/speed}'],
												].map(([label, before, after]) => (
													<button
														type="button"
														className="editor-chip-button"
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
												<Dropdown
													label={t('文本标记')}
													className="editor-chip-button"
													trigger={<span>{t('更多标记')}</span>}
													items={[
														'em',
														'b',
														'dim',
														'whisper',
														'shout',
														'glitch',
														'hl',
														...Object.keys(opening.settings.customMarks),
													].map((name) => ({
														label: name,
														onSelect: () =>
															setInsert({
																before: `{${name}}`,
																after: `{/${name}}`,
																key: Date.now(),
															}),
													}))}
												/>
												{expression && (
													<CompactSelect
														aria-label={t('表情')}
														value={expression.current}
														disabled={busy || dirty}
														onChange={changeExpression}
														options={expression.choices.map((choiceId) => ({
															value: choiceId,
															label: choiceId,
														}))}
													/>
												)}
												<JumpPoints
													script={draft}
													disabled={busy}
													onJump={(jumpLine) =>
														setPosition((value) => ({
															line: jumpLine,
															key: value.key + 1,
														}))
													}
												/>
											</div>
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
										</>
									) : (
										<SentenceList
											sentences={sentences}
											savedNvs={scene.nvs}
											activeLine={line}
											dirty={dirty}
											pendingRefresh={pendingRefresh}
											busy={busy}
											playing={preview > 0}
											hasSource={scene.sourceIds.length > 0}
											editedLineIds={editedLineIds}
											speakerNames={opening.speakerNames}
											customMarks={opening.settings.customMarks}
											expression={expression}
											onSelectLine={selectSentenceLine}
											onUpdateLine={updateSentence}
											onChangeExpression={changeExpression}
											onSave={() => void run(save)}
											onDiscard={discard}
											onUndo={undo}
											onAskAgent={handleAskAgent}
										/>
									)}
								</section>
								{source && (
									<section className="editor-panel editor-source-panel">
										<SourcePanel
											paragraphs={chapter?.paragraphs ?? []}
											activeSourceIds={scene.sourceIds}
											disabled={busy}
											viewportRef={sourceViewport}
											onClose={() => setSource(false)}
											onJumpParagraph={(paragraphId) => {
												const targetSceneIdx = chapter?.scenes.findIndex(
													(item) => item.sourceIds.includes(paragraphId),
												)
												if (targetSceneIdx === undefined || targetSceneIdx < 0)
													return
												const targetScene = chapter?.scenes[targetSceneIdx]
												const targetLine = targetScene
													? buildParagraphFirstLine(
															targetScene.nvs,
															targetScene.sourceIds,
														)[paragraphId]
													: undefined
												if (targetSceneIdx !== sceneIndex) {
													if (dirty) {
														setError(t('请先保存或放弃当前修改'))
														return
													}
													chooseScene(targetSceneIdx, targetLine)
												} else if (targetLine) {
													selectSentenceLine(targetLine)
												}
											}}
											onAskParagraph={(paragraph) => {
												setSourceAskParagraph(paragraph)
												setSourceAskInstruction('')
											}}
										/>
									</section>
								)}
							</div>
						)}
						{scene && (
							<EditorPanels
								workId={id}
								chapterId={chapterId}
								chapterIndex={currentChapterIndex}
								rulesRevision={opening.settingsRevision}
								workRules={opening.settings.rules}
								chapterRules={opening.settings.chapterRules[chapterId] ?? []}
								disabled={busy}
								revision={chapter?.revision ?? ''}
								historyOpen={historyOpen}
								rulesOpen={rulesOpen}
								canUndo={undoLines.length > 0 && !dirty}
								onCloseHistory={() => setHistoryOpen(false)}
								onCloseRules={() => setRulesOpen(false)}
								onUndo={undo}
								run={run}
								onSavedRules={(targetScope, nextRevision, rules) =>
									setOpening((value) =>
										value
											? {
													...value,
													settingsRevision: nextRevision,
													settings: {
														...value.settings,
														...(targetScope === 'work'
															? { rules }
															: {
																	chapterRules: {
																		...value.settings.chapterRules,
																		[chapterId]: rules,
																	},
																}),
													},
												}
											: value,
									)
								}
							/>
						)}
						{scene && (
							<RewriteModal
								open={rewriting}
								instruction={instruction}
								sourceParagraph={rewriteSourceParagraph}
								proposal={proposal}
								selected={selected}
								loading={busy && rewriting && !proposal}
								error={rewriting ? error : ''}
								dirty={dirty}
								busy={busy}
								speakerNames={opening.speakerNames}
								customMarks={opening.settings.customMarks}
								onInstructionChange={setInstruction}
								onToggleHunk={(hunkId, checked) =>
									setSelected((value) =>
										checked
											? [...value, hunkId]
											: value.filter((v) => v !== hunkId),
									)
								}
								onGenerate={generateRewrite}
								onApply={applyRewrite}
								onClose={closeRewrite}
							/>
						)}
						<SourceRewriteModal
							paragraph={sourceAskParagraph}
							instruction={sourceAskInstruction}
							busy={busy}
							onInstructionChange={setSourceAskInstruction}
							onClose={() => setSourceAskParagraph(null)}
							onConfirm={() => {
								if (!sourceAskParagraph) return
								const paragraph = sourceAskParagraph
								setSourceAskParagraph(null)
								// Jump to the scene containing this paragraph
								const foundIdx = chapter?.scenes.findIndex((item) =>
									item.sourceIds.includes(paragraph.id),
								)
								const resolvedIdx =
									foundIdx !== undefined && foundIdx >= 0
										? foundIdx
										: sceneIndex
								const targetScene = chapter?.scenes[resolvedIdx]
								if (resolvedIdx !== sceneIndex) {
									if (dirty) {
										setError(t('请先保存或放弃当前修改'))
										return
									}
									chooseScene(resolvedIdx)
								}
								setRewriteSourceParagraph(paragraph)
								const instructionText =
									sourceAskInstruction.trim() ||
									t('按原文「{{id}}」调整这一场', { id: paragraph.id })
								setInstruction(instructionText)
								setRewriteOpen(true)
								// Kick off rewrite immediately
								if (!target || !targetScene) return
								void run(async () => {
									const request = ++rewriteRequest.current
									const value = await window.novelive.call(
										'editor.rewriteScene',
										{
											workId: id,
											chapterId,
											sceneId: targetScene.sceneId,
											expectedRevision: target.expectedRevision,
											instruction: instructionText,
											sourceIds: [paragraph.id],
										},
									).promise
									if (request !== rewriteRequest.current) return
									setProposal(value)
									setSelected(value.hunks.map((hunk) => hunk.id))
								})
							}}
						/>
					</>
				)}
			</div>
		</Page>
	)
}
