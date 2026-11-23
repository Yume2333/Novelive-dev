import { type CompiledScene, compileScript } from '@novelive/format/script'
import { mountMinimalPlayer } from '@novelive/player'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import './player.css'

export function PlayerPage() {
	const { id } = useParams()
	const host = useRef<HTMLDivElement>(null)
	const [loaded, setLoaded] = useState<{
		scenes: CompiledScene[]
		paths: Map<string, string>
		speakerNames: Record<string, string>
	}>()
	const [error, setError] = useState('')
	const [loading, setLoading] = useState(false)
	const loadProject = useCallback(
		async (directory?: string) => {
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
				} = await window.novelive.call('production.playerChapter', {
					...(directory ? { directory } : {}),
					workId: id,
				}).promise
				const result = compileScript(script, {
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
				setLoaded({
					scenes: result.scenes,
					paths: new Map(
						registry.entries.map((entry) => [entry.id, entry.path]),
					),
					speakerNames,
				})
			} catch (cause) {
				if (
					directory ||
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
		).catch(fail)
		return () => controller.abort()
	}, [loaded])
	return (
		<main className="nl-player" ref={host} aria-label="播放器">
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
