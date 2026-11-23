import { BookOpen, EyeOff, PencilLine, Play, Settings } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type {
	PlayerSettings,
	SentenceRef,
} from '../../../../../player/src/contract/playback'
import { ScrollArea } from '../../../components/ScrollArea'
import {
	defaultPlayerSettings,
	type PlayerControlsController,
	schedulePlayback,
} from './controller'
import './controls.css'
import { type ProgressControlsProps, ProgressPanel } from './ProgressPanel'

let rememberedSettings = { ...defaultPlayerSettings }

export interface ControlChapter {
	chapterId: string
	title: string
	published: boolean
	progress: string
	read: boolean
}

export function PlayerControls({
	workId,
	progress,
	history,
	onSave,
	onLoad,
	onHistory,
	onHistoryStep,
	controller,
	surface,
	chapters,
	onChapter,
	onEditor,
	editorLinked,
	waiting,
	awaitingClick,
	onResume,
}: ProgressControlsProps & {
	controller?: PlayerControlsController
	surface: HTMLElement | null
	chapters: ControlChapter[]
	onChapter(chapterId: string): void
	onEditor(position: SentenceRef): void
	editorLinked: boolean
	waiting?: ControlChapter
	awaitingClick: boolean
	onResume(): void
}) {
	const [screen, setScreen] = useState<
		'menu' | 'settings' | 'chapters' | 'save' | 'load' | 'history' | null
	>(null)
	const [hidden, setHidden] = useState(false)
	const [settings, setSettings] = useState(rememberedSettings)
	const [auto, setAuto] = useState(false)
	const [revision, setRevision] = useState(0)
	const [failure, setFailure] = useState('')
	const [notice, setNotice] = useState('')
	const panel = useRef<HTMLElement>(null)
	useEffect(() => {
		if (screen)
			panel.current
				?.querySelector<HTMLElement>('button, input, select')
				?.focus()
	}, [screen])
	useEffect(
		() => controller?.subscribe(() => setRevision((value) => value + 1)),
		[controller],
	)
	useEffect(() => {
		rememberedSettings = settings
		controller?.applySettings(settings)
	}, [settings, controller])
	useEffect(() => {
		if (!controller) return
		void revision
		return schedulePlayback(
			controller,
			settings,
			auto,
			!!screen || hidden || awaitingClick,
		)
	}, [controller, settings, auto, screen, hidden, revision, awaitingClick])
	useEffect(() => {
		if (surface) surface.dataset.uiHidden = String(hidden)
	}, [hidden, surface])
	useEffect(() => {
		const key = (event: KeyboardEvent) => {
			if (hidden) {
				event.preventDefault()
				event.stopImmediatePropagation()
				setHidden(false)
				return
			}
			if (event.key === 'Escape') {
				event.preventDefault()
				setScreen((value) => (value ? null : 'menu'))
			}
		}
		const context = (event: MouseEvent) => {
			event.preventDefault()
			if (hidden) setHidden(false)
			else setScreen('menu')
		}
		const click = (event: MouseEvent) => {
			if (!hidden) return
			event.preventDefault()
			event.stopImmediatePropagation()
			setHidden(false)
		}
		window.addEventListener('keydown', key, true)
		surface?.addEventListener('contextmenu', context)
		window.addEventListener('click', click, true)
		return () => {
			window.removeEventListener('keydown', key, true)
			surface?.removeEventListener('contextmenu', context)
			window.removeEventListener('click', click, true)
		}
	}, [hidden, surface])
	useEffect(() => {
		const sync = () =>
			setSettings((value) => ({
				...value,
				fullscreen: !!document.fullscreenElement,
			}))
		document.addEventListener('fullscreenchange', sync)
		return () => document.removeEventListener('fullscreenchange', sync)
	}, [])
	function update<K extends keyof PlayerSettings>(
		key: K,
		value: PlayerSettings[K],
	) {
		setSettings((settings) => ({ ...settings, [key]: value }))
	}
	async function fullscreen() {
		try {
			if (document.fullscreenElement) await document.exitFullscreen()
			else await document.documentElement.requestFullscreen()
		} catch {
			setFailure('无法切换全屏')
		}
	}
	function stopPlayback() {
		setAuto(false)
		setSettings((settings) => ({ ...settings, skipRead: false }))
	}
	async function slotAction(slot: Parameters<typeof onSave>[0], save: boolean) {
		setScreen(null)
		if (!save) stopPlayback()
		setNotice('')
		setFailure('')
		try {
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			)
			if (save) await onSave(slot)
			else await onLoad(slot)
			setNotice(save ? '存档成功' : '读档完成')
		} catch (error) {
			setFailure(error instanceof Error ? error.message : '存读档失败')
		}
	}
	const title =
		screen === 'menu'
			? '系统菜单'
			: screen === 'settings'
				? '设置'
				: screen === 'save'
					? '存档'
					: screen === 'load'
						? '读档'
						: screen === 'history'
							? '历史记录'
							: '章节'
	const toggle = (label: string, checked: boolean, change: () => void) => (
		<label className="nl-control-row">
			<span>{label}</span>
			<input type="checkbox" checked={checked} onChange={change} />
		</label>
	)
	const slider = (
		label: string,
		key:
			| 'autoPlaySpeedMultiplier'
			| 'fontSize'
			| 'dialogueOpacity'
			| 'textMillisecondsPerCharacter',
		min: number,
		max: number,
		step: number,
	) => (
		<label className="nl-control-row">
			<span>
				{label} <span>{settings[key]}</span>
			</span>
			<input
				type="range"
				aria-label={label}
				min={min}
				max={max}
				step={step}
				value={settings[key]}
				onChange={(event) => update(key, Number(event.target.value))}
			/>
		</label>
	)
	return (
		<>
			{notice && !screen && (
				<p className="nl-progress-notice" role="status">
					{notice}
				</p>
			)}
			{failure && !screen && (
				<p className="nl-progress-notice" role="alert">
					{failure}
				</p>
			)}
			{!hidden && (waiting || awaitingClick) && (
				<div className="nl-chapter-wait" role="status">
					{awaitingClick ? (
						<button type="button" onClick={onResume}>
							下一章已就绪，点击开始
						</button>
					) : (
						<>
							下一章 · {waiting?.title}
							<p>{waiting?.progress}</p>
						</>
					)}
				</div>
			)}
			{screen && (
				<div className="nl-controls-backdrop">
					<button
						className="nl-controls-dismiss"
						type="button"
						aria-label="关闭菜单"
						onClick={() => setScreen(null)}
					/>
					<section
						ref={panel}
						className={`nl-controls-panel ${screen !== 'menu' ? 'nl-controls-page' : ''}`}
						role="dialog"
						aria-modal="true"
						aria-label={title}
						onClick={(event) => event.stopPropagation()}
						onKeyDown={(event) => {
							if (event.key === 'Tab') {
								const nodes = event.currentTarget.querySelectorAll<HTMLElement>(
									'button:not(:disabled), input:not(:disabled), select:not(:disabled)',
								)
								const first = nodes[0]
								const last = nodes[nodes.length - 1]
								if (event.shiftKey && document.activeElement === first) {
									event.preventDefault()
									last?.focus()
								} else if (!event.shiftKey && document.activeElement === last) {
									event.preventDefault()
									first?.focus()
								}
							}
						}}
					>
						<h2>{title}</h2>
						<ScrollArea style={{ flex: 1, minHeight: 0 }}>
							{screen === 'menu' ? (
								<>
									<button type="button" onClick={() => setScreen(null)}>
										<Play size={18} strokeWidth={1.8} aria-hidden="true" />
										返回游戏
									</button>
									<button
										type="button"
										disabled={
											!window.novelive.host.progress ||
											!controller?.frame().position
										}
										onClick={() => void slotAction({ kind: 'quick' }, true)}
									>
										快速存档
									</button>
									<button
										type="button"
										disabled={
											!progress.saves.some(
												(entry) => entry.slot.kind === 'quick',
											)
										}
										onClick={() => void slotAction({ kind: 'quick' }, false)}
									>
										快速读档
									</button>
									<button
										type="button"
										disabled={
											!window.novelive.host.progress ||
											!controller?.frame().position
										}
										onClick={() => setScreen('save')}
									>
										存档
									</button>
									<button type="button" onClick={() => setScreen('load')}>
										读档
									</button>
									<button type="button" onClick={() => setScreen('history')}>
										历史记录
									</button>
									{toggle('自动播放', auto, () => setAuto(!auto))}
									{toggle('跳过已读', settings.skipRead, () =>
										update('skipRead', !settings.skipRead),
									)}
									<button
										type="button"
										onClick={() => {
											setScreen(null)
											setHidden(true)
										}}
									>
										<EyeOff size={18} strokeWidth={1.8} aria-hidden="true" />
										隐藏界面
									</button>
									<button type="button" onClick={() => setScreen('chapters')}>
										<BookOpen size={18} strokeWidth={1.8} aria-hidden="true" />
										章节
									</button>
									<button type="button" onClick={() => setScreen('settings')}>
										<Settings size={18} strokeWidth={1.8} aria-hidden="true" />
										设置
									</button>
									<button
										type="button"
										disabled={!editorLinked || !controller?.frame().position}
										title={
											editorLinked ? undefined : '请先将本地工程关联到作品'
										}
										onClick={() => {
											const position = controller?.frame().position
											if (position) onEditor(position)
										}}
									>
										<PencilLine
											size={18}
											strokeWidth={1.8}
											aria-hidden="true"
										/>
										在编辑器中打开这里
									</button>
								</>
							) : screen === 'settings' ? (
								<>
									{slider(
										'自动播放倍率',
										'autoPlaySpeedMultiplier',
										0.25,
										3,
										0.25,
									)}
									{slider(
										'文字速度（毫秒 / 字）',
										'textMillisecondsPerCharacter',
										3,
										153,
										1,
									)}
									{toggle(
										'瞬间显示',
										settings.textMillisecondsPerCharacter === 0,
										() =>
											update(
												'textMillisecondsPerCharacter',
												settings.textMillisecondsPerCharacter === 0 ? 30 : 0,
											),
									)}
									{slider('字号', 'fontSize', 15, 48, 1)}
									{slider('对话框不透明度', 'dialogueOpacity', 0.1, 1, 0.05)}
									{toggle('全屏', settings.fullscreen, () => void fullscreen())}
									<label className="nl-control-row">
										对话框样式
										<select
											value={settings.dialogueStyle}
											onChange={(event) =>
												update('dialogueStyle', event.target.value)
											}
										>
											<option value="soft">柔边通栏</option>
											<option value="paper">浅色纸笺</option>
										</select>
									</label>
								</>
							) : screen === 'save' ||
								screen === 'load' ||
								screen === 'history' ? (
								<ProgressPanel
									view={screen}
									workId={workId}
									progress={progress}
									history={history}
									onSave={onSave}
									onLoad={onLoad}
									onSlot={(slot) => void slotAction(slot, screen === 'save')}
									onHistory={(index) => {
										stopPlayback()
										setScreen(null)
										onHistory(index)
									}}
									onHistoryStep={(direction) => {
										stopPlayback()
										setScreen(null)
										onHistoryStep(direction)
									}}
								/>
							) : chapters.length ? (
								chapters.map((chapter) => (
									<button
										key={chapter.chapterId}
										type="button"
										disabled={!chapter.published}
										onClick={() => {
											onChapter(chapter.chapterId)
											setScreen(null)
										}}
									>
										{chapter.title} ·{' '}
										{chapter.published ? '已发布' : chapter.progress}
										{chapter.read ? ' · 已读' : ''}
									</button>
								))
							) : (
								<p>暂无章节</p>
							)}
						</ScrollArea>
						{failure && <p role="alert">{failure}</p>}
						{screen !== 'menu' && (
							<button type="button" onClick={() => setScreen('menu')}>
								返回菜单
							</button>
						)}
					</section>
				</div>
			)}
		</>
	)
}
