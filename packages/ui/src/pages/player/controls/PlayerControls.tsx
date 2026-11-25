import {
	BookmarkCheck,
	BookmarkPlus,
	BookOpen,
	EyeOff,
	FastForward,
	FolderOpen,
	History,
	LibraryBig,
	LogOut,
	type LucideIcon,
	Menu,
	PencilLine,
	Play,
	RotateCcw,
	Save,
	ScrollText,
	Settings2,
	Undo2,
	X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type {
	PlayerSettings,
	SentenceRef,
} from '../../../../../player/src/contract/playback'
import type { SaveSlot } from '../../../../../player/src/contract/progress'
import { Button } from '../../../components/Button'
import { Chip, ProgressBar } from '../../../components/Card'
import { ConfirmDialog, Slider } from '../../../components/Extended'
import { Toggle } from '../../../components/Form'
import { ScrollArea } from '../../../components/ScrollArea'
import {
	defaultPlayerSettings,
	type PlayerControlsController,
	schedulePlayback,
} from './controller'
import './controls.css'
import { msg, scoped } from '../../../i18n'
import { type ProgressControlsProps, ProgressPanel } from './ProgressPanel'

const t = scoped('player')
const progressWords = new Set<string>([
	msg('制作中'),
	msg('写作'),
	msg('审稿'),
	msg('演出'),
	msg('出图'),
	msg('等待'),
	msg('完成'),
	msg('已发布'),
])
const progressText = (progress?: string) =>
	progress
		?.split(' · ')
		.map((part) => (progressWords.has(part) ? t(part) : part))
		.join(' · ')

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
	legacySaves,
	onSave,
	onLoad,
	onHistory,
	onHistoryStep,
	controller,
	surface,
	chapters,
	onChapter,
	onLibrary,
	onEditor,
	editorLinked,
	waiting,
	awaitingClick,
	onResume,
	workTitle,
	onWorkPage,
	ended = false,
	reread = false,
	nextChapter,
	onReplayChapter,
	onOverlayChange,
}: ProgressControlsProps & {
	controller?: PlayerControlsController
	surface: HTMLElement | null
	chapters: ControlChapter[]
	onChapter(chapterId: string): void
	onLibrary?: () => void
	onEditor(position: SentenceRef): void
	editorLinked: boolean
	waiting?: ControlChapter
	awaitingClick: boolean
	onResume(): void
	workTitle?: string
	onWorkPage?: () => void
	ended?: boolean
	reread?: boolean
	nextChapter?: ControlChapter
	onReplayChapter?: () => void
	onOverlayChange?: (active: boolean) => void
}) {
	const [screen, setScreen] = useState<
		'menu' | 'settings' | 'chapters' | 'save' | 'load' | 'history' | null
	>(null)
	const [hidden, setHidden] = useState(false)
	const [confirmExit, setConfirmExit] = useState(false)
	const [settings, setSettings] = useState(rememberedSettings)
	const [auto, setAuto] = useState(false)
	const [revision, setRevision] = useState(0)
	const [failure, setFailure] = useState('')
	const [notice, setNotice] = useState('')
	const [chapterThumbs, setChapterThumbs] = useState<Record<string, string>>({})
	const panel = useRef<HTMLElement>(null)
	useEffect(() => {
		if (screen)
			panel.current
				?.querySelector<HTMLElement>(
					'button:not(:disabled, [hidden], .nl-page-close, .nl-focus-skip), input:not(:disabled), select:not(:disabled)',
				)
				?.focus()
	}, [screen])
	useEffect(() => {
		onOverlayChange?.(Boolean(screen) || hidden || confirmExit)
	}, [screen, hidden, confirmExit, onOverlayChange])
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
				if (confirmExit) setConfirmExit(false)
				else setScreen((value) => (value ? null : 'menu'))
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
	}, [hidden, surface, confirmExit])
	useEffect(() => {
		const sync = () =>
			setSettings((value) => ({
				...value,
				fullscreen: !!document.fullscreenElement,
			}))
		document.addEventListener('fullscreenchange', sync)
		return () => document.removeEventListener('fullscreenchange', sync)
	}, [])
	useEffect(() => {
		if (screen !== 'chapters') return
		let cancelled = false
		const slotsByChapter = new Map<string, SaveSlot>()
		for (const entry of progress.saves)
			if (!slotsByChapter.has(entry.snapshot.position.chapterId))
				slotsByChapter.set(entry.snapshot.position.chapterId, entry.slot)
		void Promise.all(
			chapters.map(async (chapter) => {
				const slot = slotsByChapter.get(chapter.chapterId)
				if (!slot) return null
				const image = await window.novelive.host.progress?.thumbnail(
					workId,
					slot,
				)
				return image ? ([chapter.chapterId, image] as const) : null
			}),
		)
			.then((images) => {
				if (!cancelled)
					setChapterThumbs(
						Object.fromEntries(images.filter((entry) => entry !== null)),
					)
			})
			.catch(() => {})
		return () => {
			cancelled = true
		}
	}, [screen, workId, progress.saves, chapters])
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
			setFailure(t('无法切换全屏'))
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
			const { promise, resolve } = Promise.withResolvers<void>()
			requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
			await promise
			if (save) await onSave(slot)
			else await onLoad(slot)
			setNotice(save ? t('存档成功') : t('读档完成'))
		} catch (error) {
			setFailure(error instanceof Error ? error.message : t('存读档失败'))
		}
	}
	const title =
		screen === 'menu'
			? t('系统菜单')
			: screen === 'settings'
				? t('设置')
				: screen === 'save'
					? t('存档')
					: screen === 'load'
						? t('读档')
						: screen === 'history'
							? t('历史记录')
							: t('章节')
	const icon = (Icon: LucideIcon, size = 18) => (
		<Icon size={size} strokeWidth={1.8} aria-hidden="true" />
	)
	const quick = (
		Icon: LucideIcon,
		label: string,
		action: () => void,
		options: { pressed?: boolean; disabled?: boolean; end?: boolean } = {},
	) => (
		<button
			type="button"
			className="nl-qbtn"
			data-tip={label}
			data-end={options.end || undefined}
			aria-label={label}
			aria-pressed={options.pressed}
			disabled={options.disabled}
			onClick={(event) => {
				event.stopPropagation()
				action()
			}}
		>
			{icon(Icon)}
		</button>
	)
	const pageIcon =
		screen === 'settings'
			? Settings2
			: screen === 'save'
				? Save
				: screen === 'load'
					? FolderOpen
					: screen === 'history'
						? ScrollText
						: BookOpen
	const canSave =
		!!window.novelive.host.progress && !!controller?.frame().position
	const hasQuickSave = progress.saves.some(
		(entry) => entry.slot.kind === 'quick',
	)
	const switchRow = (
		label: string,
		on: boolean,
		change: (next: boolean) => void,
	) => (
		<div className="nl-control-row">
			<span>{label}</span>
			<Toggle on={on} onChange={change} aria-label={label} />
		</div>
	)
	const sliderRow = (
		label: string,
		key:
			| 'autoPlaySpeedMultiplier'
			| 'fontSize'
			| 'dialogueOpacity'
			| 'textMillisecondsPerCharacter',
		min: number,
		max: number,
		step: number,
		suffix?: string,
	) => (
		<div className="nl-setting-slider">
			<span className="nl-setting-label">{label}</span>
			<Slider
				aria-label={label}
				min={min}
				max={max}
				step={step}
				value={Math.round(settings[key] * 100) / 100}
				suffix={suffix}
				onChange={(value) => update(key, Math.round(value * 100) / 100)}
			/>
		</div>
	)
	const waitSteps: Record<string, number> = {
		[msg('写作')]: 0.25,
		[msg('审稿')]: 0.5,
		[msg('演出')]: 0.72,
		[msg('出图')]: 0.88,
	}
	const waitProgress = waiting
		? waitSteps[
				waiting.progress.split(' · ').find((part) => part in waitSteps) ?? ''
			]
		: undefined
	const finalePrimary = onWorkPage
		? { label: t('返回作品页'), action: onWorkPage }
		: onLibrary
			? { label: t('返回书库'), action: onLibrary }
			: null
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
			{!hidden && waiting && (
				<div className="nl-end-overlay" role="status">
					<div className="nl-end-card nl-chapter-wait">
						<span className="nl-end-label">{t('本章结束')}</span>
						<h3 className="nl-end-headline">
							{t('下一章 · {{title}}', { title: waiting.title })}
						</h3>
						{waiting.progress.includes(msg('等待')) &&
						!waiting.progress.includes(msg('制作中')) ? (
							<p className="nl-end-note">
								{progressText(waiting.progress)} · {t('做完会自动载入开头')}
							</p>
						) : (
							<div className="nl-end-progress">
								<ProgressBar value={waitProgress ?? 0.55} height={6} active />
								<p className="nl-end-note">
									{progressText(waiting.progress)} · {t('做完会自动载入开头')}
								</p>
							</div>
						)}
					</div>
				</div>
			)}
			{!hidden && !waiting && awaitingClick && (
				<div className="nl-end-overlay" role="status">
					<div className="nl-end-card nl-end-card-click">
						<span className="nl-end-label">{t('已载入开头')}</span>
						{nextChapter && (
							<h3 className="nl-end-headline">
								{t('「{{title}}」', { title: nextChapter.title })}
							</h3>
						)}
						<Button variant="primary" icon={Play} onClick={onResume}>
							{t('下一章已就绪，点击开始')}
						</Button>
					</div>
				</div>
			)}
			{!hidden &&
				ended &&
				!waiting &&
				!awaitingClick &&
				!screen &&
				!nextChapter?.published && (
					<div className="nl-end-overlay" role="status">
						<div className="nl-end-card nl-end-card-center">
							<span className="nl-end-icon">
								<BookOpen size={22} strokeWidth={1.8} aria-hidden="true" />
							</span>
							<h3 className="nl-end-headline">
								{reread ? t('重看结束') : t('已读到最新进度')}
							</h3>
							<div className="nl-end-actions">
								{finalePrimary && (
									<Button
										variant="primary"
										icon={onWorkPage ? LogOut : LibraryBig}
										onClick={finalePrimary.action}
									>
										{finalePrimary.label}
									</Button>
								)}
								<Button
									variant="secondary"
									icon={RotateCcw}
									onClick={() => onReplayChapter?.()}
								>
									{t('重新播放')}
								</Button>
							</div>
						</div>
					</div>
				)}
			{!hidden && !screen && (auto || settings.skipRead) && (
				<div className="nl-play-indicator" aria-hidden="true">
					{icon(settings.skipRead ? FastForward : Play, 15)}
					{settings.skipRead ? t('跳过中') : t('自动')}
				</div>
			)}
			{!hidden && !screen && controller && (
				<div className="nl-quick-bar">
					{quick(
						BookmarkPlus,
						t('快存'),
						() => void slotAction({ kind: 'quick' }, true),
						{
							disabled: !canSave,
						},
					)}
					{quick(
						BookmarkCheck,
						hasQuickSave ? t('快读') : t('暂无快速存档'),
						() => void slotAction({ kind: 'quick' }, false),
						{ disabled: !hasQuickSave },
					)}
					{quick(Save, t('存档'), () => setScreen('save'), {
						disabled: !canSave,
					})}
					{quick(FolderOpen, t('读档'), () => setScreen('load'))}
					<span className="nl-qsep" />
					{quick(Play, t('自动'), () => setAuto(!auto), { pressed: auto })}
					{quick(
						FastForward,
						t('跳过'),
						() => update('skipRead', !settings.skipRead),
						{
							pressed: settings.skipRead,
						},
					)}
					<span className="nl-qsep" />
					{quick(
						Undo2,
						t('回滚'),
						() => {
							stopPlayback()
							onHistoryStep('back')
						},
						{ disabled: !history.cursor },
					)}
					{quick(ScrollText, t('记录'), () => setScreen('history'))}
					{quick(BookOpen, t('章节'), () => setScreen('chapters'))}
					{quick(Settings2, t('设置'), () => setScreen('settings'))}
					<span className="nl-qsep" />
					{quick(EyeOff, t('隐藏'), () => setHidden(true))}
					{quick(Menu, t('菜单'), () => setScreen('menu'), { end: true })}
				</div>
			)}
			{screen && (
				<div
					className={`nl-controls-backdrop ${screen !== 'menu' ? 'nl-controls-screen' : ''}`}
				>
					<button
						className="nl-controls-dismiss"
						type="button"
						aria-label={t('关闭菜单')}
						onClick={() => setScreen(null)}
					/>
					<section
						ref={panel}
						className={`nl-controls-panel ${screen !== 'menu' ? 'nl-controls-page' : ''}`}
						data-screen={screen}
						role="dialog"
						aria-modal="true"
						aria-label={title}
						onClick={(event) => event.stopPropagation()}
						onKeyDown={(event) => {
							if (event.key === 'Tab') {
								const nodes = event.currentTarget.querySelectorAll<HTMLElement>(
									'button:not(:disabled, [hidden], .nl-page-close), input:not(:disabled), select:not(:disabled)',
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
						{screen === 'menu' ? (
							<h2 className="nl-menu-title">{workTitle || title}</h2>
						) : (
							<header className="nl-page-header">
								<h2>
									{icon(pageIcon, 22)}
									{title}
								</h2>
								<button
									type="button"
									className="nl-page-close"
									aria-label={t('关闭')}
									onClick={() => setScreen(null)}
								>
									{icon(X)}
								</button>
							</header>
						)}
						<ScrollArea style={{ flex: 1, minHeight: 0 }}>
							{screen === 'menu' ? (
								<>
									<button type="button" onClick={() => setScreen(null)}>
										{icon(Play, 17)}
										{t('返回游戏')}
									</button>
									<button
										type="button"
										disabled={
											!window.novelive.host.progress ||
											!controller?.frame().position
										}
										onClick={() => setScreen('save')}
									>
										{icon(Save, 17)}
										{t('存档')}
									</button>
									<button type="button" onClick={() => setScreen('load')}>
										{icon(FolderOpen, 17)}
										{t('读档')}
									</button>
									<button type="button" onClick={() => setScreen('history')}>
										{icon(History, 17)}
										{t('历史记录')}
									</button>
									<button type="button" onClick={() => setScreen('chapters')}>
										{icon(BookOpen, 17)}
										{t('章节')}
									</button>
									<button type="button" onClick={() => setScreen('settings')}>
										{icon(Settings2, 17)}
										{t('设置')}
									</button>
									<button
										type="button"
										disabled={!editorLinked || !controller?.frame().position}
										title={
											editorLinked ? undefined : t('请先将本地工程关联到作品')
										}
										onClick={() => {
											const position = controller?.frame().position
											if (position) onEditor(position)
										}}
									>
										{icon(PencilLine, 17)}
										{t('在编辑器中打开这里')}
									</button>
									{onWorkPage && (
										<button type="button" onClick={() => setConfirmExit(true)}>
											{icon(LogOut, 17)}
											{t('返回作品页')}
										</button>
									)}
									<hr className="nl-menu-divider" />
									<div className="nl-menu-secondary">
										<button
											type="button"
											disabled={
												!window.novelive.host.progress ||
												!controller?.frame().position
											}
											onClick={() => void slotAction({ kind: 'quick' }, true)}
										>
											{icon(BookmarkPlus, 17)}
											{t('快速存档')}
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
											{icon(BookmarkCheck, 17)}
											{t('快速读档')}
										</button>
										{switchRow(t('自动播放'), auto, () => setAuto(!auto))}
										{switchRow(t('跳过已读'), settings.skipRead, () =>
											update('skipRead', !settings.skipRead),
										)}
										<button
											type="button"
											onClick={() => {
												setScreen(null)
												setHidden(true)
											}}
										>
											{icon(EyeOff, 17)}
											{t('隐藏界面')}
										</button>
									</div>
									{onLibrary && (
										<>
											<hr className="nl-menu-divider" />
											<button type="button" onClick={onLibrary}>
												{icon(LibraryBig, 17)}
												{t('返回书库')}
											</button>
										</>
									)}
								</>
							) : screen === 'settings' ? (
								<div className="nl-settings-card">
									{sliderRow(
										t('自动播放倍率'),
										'autoPlaySpeedMultiplier',
										0.25,
										3,
										0.25,
										'×',
									)}
									{sliderRow(
										t('文字速度（毫秒 / 字）'),
										'textMillisecondsPerCharacter',
										3,
										153,
										1,
										'ms',
									)}
									{switchRow(
										t('瞬间显示'),
										settings.textMillisecondsPerCharacter === 0,
										() =>
											update(
												'textMillisecondsPerCharacter',
												settings.textMillisecondsPerCharacter === 0 ? 30 : 0,
											),
									)}
									{sliderRow(t('字号'), 'fontSize', 15, 48, 1, 'px')}
									{sliderRow(
										t('对话框不透明度'),
										'dialogueOpacity',
										0.1,
										1,
										0.05,
									)}
									<hr className="nl-menu-divider" />
									{switchRow(
										t('全屏'),
										settings.fullscreen,
										() => void fullscreen(),
									)}
									<hr className="nl-menu-divider" />
									<div className="nl-control-row">
										<span>{t('对话框样式')}</span>
										<fieldset
											className="nl-segmented"
											aria-label={t('对话框样式')}
										>
											{(
												[
													['soft', t('柔边通栏')],
													['paper', t('浅色纸笺')],
												] as const
											).map(([value, label]) => (
												<button
													key={value}
													type="button"
													aria-pressed={settings.dialogueStyle === value}
													onClick={() => update('dialogueStyle', value)}
												>
													{label}
												</button>
											))}
										</fieldset>
									</div>
								</div>
							) : screen === 'save' ||
								screen === 'load' ||
								screen === 'history' ? (
								<ProgressPanel
									view={screen}
									workId={workId}
									progress={progress}
									history={history}
									chapters={chapters}
									legacySaves={legacySaves}
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
								<div className="nl-chapter-list">
									{chapters.map((chapter, index) => (
										<button
											key={chapter.chapterId}
											type="button"
											disabled={!chapter.published}
											onClick={() => {
												onChapter(chapter.chapterId)
												setScreen(null)
											}}
											className="nl-chapter-row"
										>
											{chapterThumbs[chapter.chapterId] ? (
												<img
													className="nl-chapter-thumb"
													src={chapterThumbs[chapter.chapterId]}
													width={112}
													height={63}
													alt=""
												/>
											) : (
												<span
													className={`nl-chapter-thumb nl-chapter-thumb-${index % 4}`}
													data-dim={!chapter.published || undefined}
													aria-hidden="true"
												>
													<span className="nl-chapter-thumb-badge">
														{index + 1}
													</span>
												</span>
											)}
											<span className="nl-chapter-text">
												<span className="nl-chapter-title">
													{t('第 {{index}} 章 · {{title}}', {
														index: index + 1,
														title: chapter.title,
													})}
												</span>
												<span className="nl-chapter-meta">
													{chapter.published
														? t('已发布')
														: progressText(chapter.progress)}
													{chapter.read && <Chip>{t('已读')}</Chip>}
												</span>
											</span>
										</button>
									))}
								</div>
							) : (
								<p>{t('暂无章节')}</p>
							)}
						</ScrollArea>
						{failure && <p role="alert">{failure}</p>}
						{screen !== 'menu' && (
							<button type="button" onClick={() => setScreen('menu')}>
								{t('返回菜单')}
							</button>
						)}
					</section>
				</div>
			)}
			<ConfirmDialog
				open={confirmExit}
				title={t('返回作品页？')}
				message={t('当前阅读进度已自动保存。')}
				confirmLabel={t('返回')}
				cancelLabel={t('继续玩')}
				onConfirm={() => {
					setConfirmExit(false)
					onWorkPage?.()
				}}
				onCancel={() => setConfirmExit(false)}
			/>
		</>
	)
}
