import { installedProgressKey } from '@novelive/creator/contract'
import type { WorkSettings } from '@novelive/format/model'
import { type CompiledScene, compileScript } from '@novelive/format/script'
import { mountMinimalPlayer } from '@novelive/player'
import { ChevronDown } from 'lucide-react'
import {
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type {
	SentenceRef,
	StageSnapshot,
} from '../../../../player/src/contract'
import type {
	PlaybackMode,
	SaveSlot,
} from '../../../../player/src/contract/progress'
import { PlaybackProgress, slotKey } from '../../../../player/src/progress'
import { playerEditorRoute } from '../../routes/player'
import type { PlayerControlsController } from './controls/controller'
import type { LegacySaveActions } from './controls/legacy-saves/LegacySavePanel'
import {
	minimalControlsController,
	sentenceKey,
} from './controls/minimal-controller'
import { type ControlChapter, PlayerControls } from './controls/PlayerControls'
import { containsSentence, restoredChapterMode } from './controls/position'
import { useChapterWait } from './controls/useChapterWait'
import './player.css'
import { scoped } from '../../i18n'

const t = scoped('player')

function NextGlyph({ host }: { host: RefObject<HTMLDivElement | null> }) {
	const glyph = useRef<HTMLSpanElement>(null)
	useLayoutEffect(() => {
		const span = glyph.current
		const main = span?.closest('.nl-player')
		const surface = host.current
		if (!span || !main || !surface) return
		const place = () => {
			const viewport = surface.querySelector<HTMLElement>('.nl-player-text')
			if (!viewport) return
			const display = viewport.querySelector<HTMLElement>('.nl-text-display')
			const revealed = Number(viewport.dataset.revealed ?? 0)
			const last = display?.querySelector<HTMLElement>(
				`[data-glyph="${revealed - 1}"]`,
			)
			if (!last) return
			const bounds = main.getBoundingClientRect()
			const rect = last.getBoundingClientRect()
			const size = span.offsetHeight || 13
			span.style.left = `${rect.right - bounds.left + 10}px`
			span.style.top = `${rect.top - bounds.top + (rect.height - size) / 2}px`
			span.style.visibility = 'visible'
		}
		span.style.visibility = 'hidden'
		place()
		const frame = requestAnimationFrame(place)
		const observer = new MutationObserver(place)
		observer.observe(surface, {
			subtree: true,
			childList: true,
			attributes: true,
		})
		window.addEventListener('resize', place)
		return () => {
			cancelAnimationFrame(frame)
			observer.disconnect()
			window.removeEventListener('resize', place)
		}
	}, [host])
	return (
		<span ref={glyph} className="nl-next-glyph" aria-hidden="true">
			<ChevronDown size={13} strokeWidth={1.8} />
		</span>
	)
}

export function PlayerPage({
	legacySaves,
}: {
	legacySaves?: LegacySaveActions
}) {
	const { id, version } = useParams()
	const [searchParams] = useSearchParams()
	const requestedChapter = searchParams.get('chapter') ?? undefined
	const progressId =
		id && version ? installedProgressKey(id, Number(version)) : id
	const progressApi = window.novelive.host.progress
	const navigate = useNavigate()
	const host = useRef<HTMLDivElement>(null)
	const directoryRef = useRef<string>(undefined)
	const compiledChapters = useRef(new Map<string, CompiledScene[]>())
	const chapterOrder = useRef<string[]>([])
	const sentenceOrder = useRef(new Map<string, number>())
	const compare = useCallback(
		(a: SentenceRef, b: SentenceRef) =>
			chapterOrder.current.indexOf(a.chapterId) -
				chapterOrder.current.indexOf(b.chapterId) ||
			(sentenceOrder.current.get(sentenceKey(a)) ?? 0) -
				(sentenceOrder.current.get(sentenceKey(b)) ?? 0),
		[],
	)
	const progress = useRef(new PlaybackProgress(compare))
	const progressReady = useRef<Promise<void> | undefined>(undefined)
	const latest = useRef<StageSnapshot | undefined>(undefined)
	const [, redraw] = useState(0)
	const [control, setControl] = useState<PlayerControlsController>()
	const [chapters, setChapters] = useState<ControlChapter[]>([])
	const [ended, setEnded] = useState(false)
	const [awaitingClick, setAwaitingClick] = useState(false)
	const [loaded, setLoaded] = useState<{
		workId: string
		linked: boolean
		restore?: StageSnapshot
		start?: SentenceRef
		chapterId: string
		mode: PlaybackMode
		scenes: CompiledScene[]
		paths: Map<string, string>
		speakerNames: Record<string, string>
		customMarks: WorkSettings['customMarks']
	}>()
	const [workTitle, setWorkTitle] = useState<string>()
	const [overlayActive, setOverlayActive] = useState(false)
	const [veiled, setVeiled] = useState(true)
	const [textFinished, setTextFinished] = useState(false)
	const wheelAt = useRef(0)
	const [error, setError] = useState('')
	const [loading, setLoading] = useState(false)
	useEffect(() => {
		void progressId
		progressReady.current = undefined
		progress.current = new PlaybackProgress(compare)
		latest.current = undefined
		directoryRef.current = undefined
		compiledChapters.current.clear()
		chapterOrder.current = []
		sentenceOrder.current.clear()
		setLoaded(undefined)
	}, [progressId, compare])
	// biome-ignore lint/correctness/useExhaustiveDependencies: 进入播放器（progressId 变化）时重新播放进场黑幕
	useEffect(() => {
		setVeiled(true)
		// 黑幕只覆盖装载与舞台亮相过程：首个文本内容一旦出现就立刻撤下，
		// 之后的任何舞台截图都不会再叠到半透明黑幕。1250ms 兜底对应无文本章节。
		const timer = window.setTimeout(() => setVeiled(false), 1250)
		const surface = host.current
		if (!surface) return () => window.clearTimeout(timer)
		const unveil = () => {
			if (
				surface.querySelector(
					'.nl-player-text .nl-text-display, .nl-player-caption .nl-text-display',
				)
			) {
				setVeiled(false)
				observer.disconnect()
				window.clearTimeout(timer)
			}
		}
		const observer = new MutationObserver(unveil)
		observer.observe(surface, { childList: true, subtree: true })
		unveil()
		return () => {
			observer.disconnect()
			window.clearTimeout(timer)
		}
	}, [progressId])
	useEffect(() => {
		let active = true
		setWorkTitle(undefined)
		if (version && window.novelive.host.installed)
			window.novelive.host.installed.list().then(
				(works) => {
					if (!active) return
					setWorkTitle(
						works.find(
							(item) => item.workId === id && item.version === Number(version),
						)?.title,
					)
				},
				() => {},
			)
		else if (id)
			void window.novelive.call('library.list', {}).promise.then(
				(result) => {
					if (!active) return
					setWorkTitle(result.works.find((item) => item.workId === id)?.title)
				},
				() => {},
			)
		return () => {
			active = false
		}
	}, [id, version])
	const loadProject = useCallback(
		async (
			directory?: string,
			chapterId?: string,
			mode: PlaybackMode | 'select-chapter' = 'main',
			waitForClick = false,
			restore?: StageSnapshot,
			onValidated?: () => PlaybackMode,
			fromStart = false,
		) => {
			if (!id || !progressId) return
			setError('')
			setLoading(true)
			try {
				progressReady.current ??= (async () => {
					const saved = await progressApi?.load(progressId)
					if (saved) progress.current = new PlaybackProgress(compare, saved)
				})()
				await progressReady.current
				const resume =
					!chapterId && !fromStart ? progress.current.data.mainline : null
				const {
					linked,
					script,
					chapter,
					registry,
					speakers,
					speakerNames,
					customMarks,
					chapters,
				} =
					version && window.novelive.host.installed
						? await window.novelive.host.installed.chapter(
								id,
								Number(version),
								chapterId ?? resume?.chapterId,
							)
						: await window.novelive.call('production.playerChapter', {
								...((directory ?? directoryRef.current)
									? { directory: directory ?? directoryRef.current }
									: {}),
								...((chapterId ?? resume?.chapterId)
									? { chapterId: chapterId ?? resume?.chapterId }
									: {}),
								workId: id,
							}).promise
				let nextId = 0
				const result = compileScript(script, {
					makeId: (bytes) => (++nextId).toString(16).padStart(bytes * 2, '0'),
					previous: compiledChapters.current
						.get(chapter.chapterId)
						?.map(({ scene }) => scene),
					paragraphIds: chapter.paragraphIds,
					sceneIds: chapter.sceneIds,
					assets: registry.entries,
					speakers,
					customMarks: Object.keys(customMarks),
				})
				if (!result.ok)
					throw new Error(
						result.diagnostics.map((item) => item.message).join('\n'),
					)
				if (!result.scenes.some((scene) => scene.beats.length))
					throw new Error(t('本章还没有可播放的剧本'))
				if (restore && !containsSentence(result.scenes, restore.position))
					throw new Error(t('存档中的句子已不存在'))
				const validatedMode =
					onValidated?.() ??
					(mode === 'select-chapter'
						? progress.current.data.read.some(
								(position) => position.chapterId === chapter.chapterId,
							)
							? 'reread'
							: 'main'
						: mode)
				compiledChapters.current.set(chapter.chapterId, result.scenes)
				chapterOrder.current = chapters.map((chapter) => chapter.chapterId)
				let rank = 0
				for (const { scene, beats } of result.scenes)
					for (const beat of beats) {
						if (scene.id && beat.line?.id)
							sentenceOrder.current.set(
								sentenceKey({
									chapterId: chapter.chapterId,
									sceneId: scene.id,
									sentenceId: beat.line.id,
								}),
								rank++,
							)
					}
				if (directory) directoryRef.current = directory
				setChapters(
					chapters.map((chapter) => ({
						...chapter,
						read: progress.current.data.read.some(
							(position) => position.chapterId === chapter.chapterId,
						),
					})),
				)
				setEnded(false)
				setAwaitingClick(waitForClick)
				localStorage.setItem(
					'novelive.recentWork',
					version ? `package:${id}:${version}` : id,
				)
				setLoaded({
					workId: id,
					restore,
					start:
						resume && containsSentence(result.scenes, resume)
							? resume
							: undefined,
					linked,
					chapterId: chapter.chapterId,
					mode: validatedMode,
					scenes: result.scenes,
					paths: new Map(
						registry.entries.map((entry) => [entry.id, entry.path]),
					),
					speakerNames,
					customMarks,
				})
				return true
			} catch (cause) {
				if (
					directory ||
					chapterId ||
					!cause ||
					typeof cause !== 'object' ||
					!('code' in cause) ||
					cause.code !== 'not_found'
				)
					setError(
						cause instanceof Error ? cause.message : t('无法打开本地工程'),
					)
				return false
			} finally {
				setLoading(false)
			}
		},
		[id, compare, progressApi, progressId, version],
	)
	useEffect(() => {
		void loadProject(
			undefined,
			requestedChapter,
			requestedChapter ? 'select-chapter' : 'main',
		)
	}, [loadProject, requestedChapter])
	async function openProject() {
		const directory = await window.novelive.pickFolder()
		if (directory)
			await loadProject(
				directory,
				requestedChapter,
				requestedChapter ? 'select-chapter' : 'main',
			)
	}
	useEffect(() => {
		if (!loaded || loaded.workId !== id || awaitingClick || !host.current)
			return
		const controller = new AbortController()
		progress.current.mode = loaded.mode
		const controls = minimalControlsController(
			host.current,
			loaded.chapterId,
			loaded.scenes,
			loaded.mode,
			progress.current,
			controller.signal,
		)
		setTextFinished(false)
		setControl(controls)
		const unsubscribe = controls.subscribe(() => {
			const frame = controls.frame()
			setEnded(frame.ended)
			setTextFinished(
				!frame.ended &&
					host.current?.querySelector<HTMLElement>('.nl-player-text')?.dataset
						.textFinished === 'true',
			)
		})
		const fail = () => setError(t('无法加载舞台素材'))
		let restoring = !!loaded.restore
		void mountMinimalPlayer(
			host.current,
			loaded.scenes,
			{
				resolveAsset: (asset) => {
					const path = loaded.paths.get(asset)
					if (!path) throw new Error(t('找不到素材'))
					return window.novelive.resourceUrl(path)
				},
			},
			controller.signal,
			fail,
			loaded.speakerNames,
			controls.rendered,
			{
				customMarks: loaded.customMarks,
				endText: t('本章结束'),
				chapterId: loaded.chapterId,
				restore: loaded.restore,
				start: loaded.start,
				onSnapshot(snapshot) {
					latest.current = snapshot
					if (restoring) restoring = false
					else progress.current.record(snapshot)
					setChapters((chapters) =>
						chapters.map((chapter) => ({
							...chapter,
							read: progress.current.data.read.some(
								(position) => position.chapterId === chapter.chapterId,
							),
						})),
					)
					redraw((value) => value + 1)
					if (progressId)
						void progressApi
							?.save(progressId, progress.current.data)
							.catch(() => setError(t('无法保存阅读进度')))
				},
			},
		).catch(fail)
		return () => {
			unsubscribe()
			controller.abort()
		}
	}, [loaded, awaitingClick, id, progressApi, progressId])
	async function save(slot: SaveSlot) {
		const api = window.novelive.host.progress
		const stage = host.current?.querySelector('.nl-player-stage')
		if (!progressId || !api || !latest.current || !stage)
			throw new Error(t('当前无法存档'))
		const bounds = stage.getBoundingClientRect()
		const entry = await api.saveSlot(progressId, slot, latest.current, {
			x: Math.max(0, Math.ceil(bounds.x)),
			y: Math.max(0, Math.ceil(bounds.y)),
			width: Math.floor(bounds.width),
			height: Math.floor(bounds.height),
		})
		progress.current.putSave(entry)
		await api.save(progressId, progress.current.data)
		redraw((value) => value + 1)
	}
	async function restore(
		snapshot: StageSnapshot | null,
		onValidated: () => PlaybackMode,
	) {
		if (snapshot) {
			const loaded = await loadProject(
				undefined,
				snapshot.position.chapterId,
				progress.current.mode,
				false,
				snapshot,
				onValidated,
			)
			if (!loaded) throw new Error(t('无法读取存档'))
		}
	}
	function restoreHistory(index: number) {
		const snapshot = progress.current.history.entries[index]
		if (snapshot)
			void restore(snapshot, () => {
				progress.current.jump(index)
				return restoredChapterMode(
					progress.current.data,
					snapshot.position.chapterId,
				)
			}).catch(() => setError(t('无法读取历史记录')))
	}
	const nextChapter = loaded
		? chapters[
				chapters.findIndex(
					(chapter) => chapter.chapterId === loaded.chapterId,
				) + 1
			]
		: undefined
	useChapterWait({
		workId: id,
		current: loaded,
		ended,
		nextChapterId: nextChapter?.chapterId,
		nextChapterPublished: nextChapter?.published ?? false,
		nextChapterRead: nextChapter?.read ?? false,
		directory: directoryRef.current,
		loadChapter: loadProject,
		setChapters,
		onError: setError,
		offline: Boolean(version),
	})
	const replayChapter = useCallback(() => {
		if (!loaded) return
		setEnded(false)
		void loadProject(
			undefined,
			loaded.chapterId,
			loaded.mode,
			false,
			undefined,
			undefined,
			true,
		)
	}, [loaded, loadProject])
	// biome-ignore lint/correctness/useExhaustiveDependencies: restoreHistory 只读取 ref 中的进度数据，无需随渲染重建监听
	useEffect(() => {
		const key = (event: KeyboardEvent) => {
			if (event.key !== 'PageUp' && event.key !== 'PageDown') return
			if (!loaded || overlayActive || awaitingClick || ended) return
			const target = event.target
			if (
				target instanceof HTMLElement &&
				(target.tagName === 'INPUT' ||
					target.tagName === 'TEXTAREA' ||
					target.tagName === 'SELECT' ||
					target.isContentEditable)
			)
				return
			event.preventDefault()
			if (event.key === 'PageUp') {
				const cursor = progress.current.history.cursor ?? 0
				if (cursor > 0) restoreHistory(cursor - 1)
			} else control?.advance(false)
		}
		window.addEventListener('keydown', key)
		return () => window.removeEventListener('keydown', key)
	}, [loaded, overlayActive, awaitingClick, ended, control])
	const listLegacy = progressApi?.listLegacy
	const deleteLegacy = progressApi?.deleteLegacy
	const packageLegacySaves = useMemo(
		() =>
			version && listLegacy && deleteLegacy
				? { list: listLegacy, remove: deleteLegacy }
				: undefined,
		[version, listLegacy, deleteLegacy],
	)
	return (
		<main
			className="nl-player"
			aria-label={t('播放器')}
			data-mode={loaded?.mode}
			data-mainline={JSON.stringify(progress.current.data.mainline)}
			onWheel={(event) => {
				if (!loaded || overlayActive || awaitingClick || ended) return
				const now = Date.now()
				if (now - wheelAt.current < 140) return
				wheelAt.current = now
				if (event.deltaY < 0) {
					const cursor = progress.current.history.cursor ?? 0
					if (cursor > 0) restoreHistory(cursor - 1)
				} else if (event.deltaY > 0) control?.advance(false)
			}}
		>
			<div
				className="nl-player-surface"
				hidden={!loaded}
				ref={host}
				onClickCapture={(event) => {
					if (awaitingClick) {
						event.stopPropagation()
						setAwaitingClick(false)
					}
				}}
			/>
			{veiled && <div className="nl-enter-veil" aria-hidden="true" />}
			{loaded?.mode === 'reread' && !overlayActive && (
				<div className="nl-reread-badge" aria-hidden="true">
					{t('重看')}
				</div>
			)}
			{loaded && !ended && !awaitingClick && !overlayActive && textFinished && (
				<NextGlyph host={host} />
			)}
			{loaded && (
				<PlayerControls
					controller={control}
					surface={host.current}
					chapters={chapters}
					editorLinked={loaded.linked}
					onLibrary={version ? () => navigate('/') : undefined}
					progress={progress.current.data}
					history={progress.current.history}
					legacySaves={legacySaves ?? packageLegacySaves}
					workId={progressId ?? ''}
					onSave={save}
					onLoad={(slot) =>
						restore(
							progress.current.data.saves.find(
								(entry) => slotKey(entry.slot) === slotKey(slot),
							)?.snapshot ?? null,
							() => {
								progress.current.loadSave(slot)
								return progress.current.mode
							},
						)
					}
					onHistory={restoreHistory}
					onHistoryStep={(direction) =>
						restoreHistory(
							(progress.current.history.cursor ?? -1) +
								(direction === 'back' ? -1 : 1),
						)
					}
					onChapter={(chapterId) =>
						void loadProject(undefined, chapterId, 'select-chapter')
					}
					onEditor={(position) => {
						if (id) navigate(playerEditorRoute(id, position))
					}}
					waiting={
						!version && ended && !nextChapter?.published
							? nextChapter
							: undefined
					}
					awaitingClick={awaitingClick}
					onResume={() => setAwaitingClick(false)}
					workTitle={workTitle}
					onWorkPage={
						!version && id ? () => navigate(`/work/${id}`) : undefined
					}
					ended={ended}
					reread={loaded.mode === 'reread'}
					nextChapter={nextChapter}
					onReplayChapter={replayChapter}
					onOverlayChange={setOverlayActive}
				/>
			)}
			{!loaded && !version && (
				<button
					type="button"
					disabled={loading}
					onClick={() => void openProject()}
				>
					{loading ? t('正在加载') : t('打开本地工程')}
				</button>
			)}
			{error && (
				<div role="alert" className="nl-player-error">
					{error}
				</div>
			)}
		</main>
	)
}
