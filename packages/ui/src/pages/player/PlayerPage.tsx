import { type CompiledScene, compileScript } from '@novelive/format/script'
import { mountMinimalPlayer } from '@novelive/player'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type {
	SentenceRef,
	StageSnapshot,
} from '../../../../player/src/contract'
import type {
	PlaybackMode,
	SaveSlot,
} from '../../../../player/src/contract/progress'
import { PlaybackProgress } from '../../../../player/src/progress'
import { playerEditorRoute } from '../../routes/player'
import type { PlayerControlsController } from './controls/controller'
import {
	minimalControlsController,
	sentenceKey,
} from './controls/minimal-controller'
import { type ControlChapter, PlayerControls } from './controls/PlayerControls'
import { containsSentence } from './controls/position'
import { useChapterWait } from './controls/useChapterWait'
import './player.css'

export function PlayerPage() {
	const { id } = useParams()
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
	}>()
	const [error, setError] = useState('')
	const [loading, setLoading] = useState(false)
	useEffect(() => {
		void id
		progressReady.current = undefined
		progress.current = new PlaybackProgress(compare)
		latest.current = undefined
		directoryRef.current = undefined
		compiledChapters.current.clear()
		chapterOrder.current = []
		sentenceOrder.current.clear()
		setLoaded(undefined)
	}, [id, compare])
	const loadProject = useCallback(
		async (
			directory?: string,
			chapterId?: string,
			mode: PlaybackMode = 'main',
			waitForClick = false,
			restore?: StageSnapshot,
		) => {
			if (!id) return
			setError('')
			setLoading(true)
			try {
				progressReady.current ??= (async () => {
					const saved = await window.novelive.host.progress?.load(id)
					if (saved) progress.current = new PlaybackProgress(compare, saved)
				})()
				await progressReady.current
				const resume = !chapterId ? progress.current.data.mainline : null
				const {
					linked,
					script,
					chapter,
					registry,
					speakers,
					speakerNames,
					customMarks,
					chapters,
				} = await window.novelive.call('production.playerChapter', {
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
					customMarks,
				})
				if (!result.ok)
					throw new Error(
						result.diagnostics.map((item) => item.message).join('\n'),
					)
				if (!result.scenes.some((scene) => scene.beats.length))
					throw new Error('本章还没有可播放的剧本')
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
				setLoaded({
					workId: id,
					restore,
					start:
						resume && containsSentence(result.scenes, resume)
							? resume
							: undefined,
					linked,
					chapterId: chapter.chapterId,
					mode,
					scenes: result.scenes,
					paths: new Map(
						registry.entries.map((entry) => [entry.id, entry.path]),
					),
					speakerNames,
				})
			} catch (cause) {
				if (
					directory ||
					chapterId ||
					!cause ||
					typeof cause !== 'object' ||
					!('code' in cause) ||
					cause.code !== 'not_found'
				)
					setError(cause instanceof Error ? cause.message : '无法打开本地工程')
			} finally {
				setLoading(false)
			}
		},
		[id, compare],
	)
	useEffect(() => {
		void loadProject()
	}, [loadProject])
	async function openProject() {
		const directory = await window.novelive.pickFolder()
		if (directory) await loadProject(directory)
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
		setControl(controls)
		const unsubscribe = controls.subscribe(() => {
			setEnded(controls.frame().ended)
		})
		const fail = () => setError('无法加载舞台素材')
		let restoring = !!loaded.restore
		void mountMinimalPlayer(
			host.current,
			loaded.scenes,
			{
				resolveAsset: (asset) => {
					const path = loaded.paths.get(asset)
					if (!path) throw new Error('找不到素材')
					return window.novelive.resourceUrl(path)
				},
			},
			controller.signal,
			fail,
			loaded.speakerNames,
			controls.rendered,
			{
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
					if (id)
						void window.novelive.host.progress
							?.save(id, progress.current.data)
							.catch(() => setError('无法保存阅读进度'))
				},
			},
		).catch(fail)
		return () => {
			unsubscribe()
			controller.abort()
		}
	}, [loaded, awaitingClick, id])
	async function save(slot: SaveSlot) {
		const api = window.novelive.host.progress
		const stage = host.current?.querySelector('.nl-player-stage')
		if (!id || !api || !latest.current || !stage)
			throw new Error('当前无法存档')
		const bounds = stage.getBoundingClientRect()
		const entry = await api.saveSlot(id, slot, latest.current, {
			x: Math.max(0, Math.ceil(bounds.x)),
			y: Math.max(0, Math.ceil(bounds.y)),
			width: Math.floor(bounds.width),
			height: Math.floor(bounds.height),
		})
		progress.current.putSave(entry)
		await api.save(id, progress.current.data)
		redraw((value) => value + 1)
	}
	async function restore(snapshot: StageSnapshot | null) {
		if (snapshot)
			await loadProject(
				undefined,
				snapshot.position.chapterId,
				progress.current.mode,
				false,
				snapshot,
			)
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
	})
	return (
		<main
			className="nl-player"
			aria-label="播放器"
			data-mode={loaded?.mode}
			data-mainline={JSON.stringify(progress.current.data.mainline)}
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
			{loaded && (
				<PlayerControls
					controller={control}
					surface={host.current}
					chapters={chapters}
					editorLinked={loaded.linked}
					progress={progress.current.data}
					history={progress.current.history}
					workId={id ?? ''}
					onSave={save}
					onLoad={(slot) => restore(progress.current.loadSave(slot))}
					onHistory={(index) => void restore(progress.current.jump(index))}
					onHistoryStep={(direction) =>
						void restore(
							direction === 'back'
								? progress.current.rollback()
								: progress.current.forward(),
						)
					}
					onChapter={(chapterId) =>
						void loadProject(
							undefined,
							chapterId,
							progress.current.data.read.some(
								(position) => position.chapterId === chapterId,
							)
								? 'reread'
								: 'main',
						)
					}
					onEditor={(position) => {
						if (id) navigate(playerEditorRoute(id, position))
					}}
					waiting={ended && !nextChapter?.published ? nextChapter : undefined}
					awaitingClick={awaitingClick}
					onResume={() => setAwaitingClick(false)}
				/>
			)}
			{!loaded && (
				<button
					type="button"
					disabled={loading}
					onClick={() => void openProject()}
				>
					{loading ? '正在加载' : '打开本地工程'}
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
