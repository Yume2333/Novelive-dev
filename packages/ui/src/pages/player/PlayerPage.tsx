import { type CompiledScene, compileScript } from '@novelive/format/script'
import { mountMinimalPlayer } from '@novelive/player'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { PlaybackMode } from '../../../../player/src/contract/progress'
import { playerEditorRoute } from '../../routes/player'
import type { PlayerControlsController } from './controls/controller'
import {
	type ControlsProgress,
	minimalControlsController,
} from './controls/minimal-controller'
import { type ControlChapter, PlayerControls } from './controls/PlayerControls'
import { useChapterWait } from './controls/useChapterWait'
import './player.css'

export function PlayerPage() {
	const { id } = useParams()
	const navigate = useNavigate()
	const host = useRef<HTMLDivElement>(null)
	const directoryRef = useRef<string>(undefined)
	const compiledChapters = useRef(new Map<string, CompiledScene[]>())
	const progress = useRef<ControlsProgress>({
		read: new Set(),
		mainline: null,
		readChapters: new Set(),
		chapterIds: [],
	})
	const [control, setControl] = useState<PlayerControlsController>()
	const [chapters, setChapters] = useState<ControlChapter[]>([])
	const [ended, setEnded] = useState(false)
	const [awaitingClick, setAwaitingClick] = useState(false)
	const [loaded, setLoaded] = useState<{
		chapterId: string
		mode: PlaybackMode
		scenes: CompiledScene[]
		paths: Map<string, string>
		speakerNames: Record<string, string>
	}>()
	const [error, setError] = useState('')
	const [loading, setLoading] = useState(false)
	const loadProject = useCallback(
		async (
			directory?: string,
			chapterId?: string,
			mode: PlaybackMode = 'main',
			waitForClick = false,
		) => {
			if (!id) return
			setError('')
			setLoading(true)
			try {
				const {
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
					...(chapterId ? { chapterId } : {}),
					workId: id,
				}).promise
				const result = compileScript(script, {
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
				progress.current.chapterIds = chapters.map(
					(chapter) => chapter.chapterId,
				)
				if (directory) directoryRef.current = directory
				setChapters(
					chapters.map((chapter) => ({
						...chapter,
						read: progress.current.readChapters.has(chapter.chapterId),
					})),
				)
				setEnded(false)
				setAwaitingClick(waitForClick)
				setLoaded({
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
		[id],
	)
	useEffect(() => {
		void loadProject()
	}, [loadProject])
	async function openProject() {
		const directory = await window.novelive.pickFolder()
		if (directory) await loadProject(directory)
	}
	useEffect(() => {
		if (!loaded || !host.current) return
		const controller = new AbortController()
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
			setChapters((chapters) =>
				chapters.map((chapter) => ({
					...chapter,
					read: progress.current.readChapters.has(chapter.chapterId),
				})),
			)
		})
		const fail = () => setError('无法加载舞台素材')
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
		).catch(fail)
		return () => {
			unsubscribe()
			controller.abort()
		}
	}, [loaded])
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
			data-mainline={JSON.stringify(progress.current.mainline)}
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
					onChapter={(chapterId) =>
						void loadProject(
							undefined,
							chapterId,
							progress.current.readChapters.has(chapterId) ? 'reread' : 'main',
						)
					}
					onEditor={(position) => {
						if (id) navigate(playerEditorRoute(id, position))
					}}
					waiting={ended ? nextChapter : undefined}
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
