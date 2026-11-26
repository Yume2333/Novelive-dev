import type {
	CommandInput,
	CommandOutput,
	ConfigUpdate,
	MaskedConfig,
} from '@novelive/creator/contract'
import {
	AlertTriangle,
	BarChart3,
	BookOpen,
	BookOpenText,
	Check,
	ChevronsUpDown,
	Clapperboard,
	Contrast,
	LibraryBig,
	type LucideIcon,
	Moon,
	NotebookPen,
	PlayCircle,
	Settings,
	Sparkles,
	Sun,
} from 'lucide-react'
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
	NavLink,
	Outlet,
	useLocation,
	useMatch,
	useNavigate,
} from 'react-router-dom'
import { Dropdown } from '../components/Dropdown'
import { ErrorNotice } from '../components/Feedback'
import { GradientCover } from '../components/GradientCover'
import { usePresence } from '../components/Motion'
import { ScrollArea } from '../components/ScrollArea'
import { formatWorkTitle, workTitlesFromList } from '../format/work'
import { msg, scoped } from '../i18n'
import { AgentPanel } from '../panels/agent/AgentPanel'
import { workRoute } from '../routes/production'
import styles from './AppShell.module.css'
import { type ThemeMode, useAppearance } from './appearance'
import markLight from './brand/novelive-mark.svg'
import markDark from './brand/novelive-mark-dark.svg'
import { GlobalProductionQueue } from './GlobalProductionQueue'

const t = scoped('shell')

const navigation = [
	{ to: '/', icon: LibraryBig, name: msg('书库') },
	{ to: '/usage', icon: BarChart3, name: msg('用量') },
	{ to: '/settings', icon: Settings, name: msg('设置') },
]
const themes: { value: ThemeMode; icon: LucideIcon; name: string }[] = [
	{ value: 'light', icon: Sun, name: msg('亮色') },
	{ value: 'dark', icon: Moon, name: msg('暗色') },
	{ value: 'system', icon: Contrast, name: msg('跟随系统') },
]
const workNavigation = [
	{ route: 'work', icon: BookOpen, name: msg('概览') },
	{ route: 'play', icon: PlayCircle, name: msg('游玩') },
	{ route: 'production', icon: Clapperboard, name: msg('制作') },
	{ route: 'editor', icon: NotebookPen, name: msg('编辑') },
	{ route: 'bible', icon: BookOpenText, name: msg('设定集') },
] as const

const recentWorkKey = 'novelive.recentWork'

/** `project` is filled by newer creators; older ones only list works. */
export type LibraryWork = CommandOutput<'library.list'>['works'][number] & {
	project?: {
		directory: string
		seriesId: string
		seriesTitle: string
		volumeId: string
		volumeTitle: string
		volumeIndex: number
	}
}

type InstalledWork = Awaited<
	ReturnType<NonNullable<typeof window.novelive.host.installed>['list']>
>[number]

/** Recent imported packages are stored as `package:<workId>:<version>`. */
function parsePackageRef(ref: string | undefined) {
	const match = ref?.match(/^package:([^:]+):(.+)$/)
	return match ? { workId: match[1], version: match[2] } : undefined
}

function readRecentWork() {
	try {
		return localStorage.getItem(recentWorkKey) ?? undefined
	} catch {
		return undefined
	}
}

function NavItem({
	to,
	end,
	icon: Icon,
	children,
}: {
	to: string
	end?: boolean
	icon: LucideIcon
	children: ReactNode
}) {
	return (
		<NavLink to={to} end={end} className={styles.navLink}>
			{({ isActive }) => (
				<span
					className={`nl-nav-item ${styles.navBody}`}
					data-active={isActive ? 'true' : 'false'}
				>
					<Icon aria-hidden="true" size={18} strokeWidth={1.8} />
					<span>{children}</span>
				</span>
			)}
		</NavLink>
	)
}
export interface SettingsHost {
	config: CommandOutput<'config.get'> | undefined
	updateConfig(patch: ConfigUpdate): Promise<MaskedConfig>
	resetConfig(): Promise<void>
}

export interface ShellOutletContext extends SettingsHost {
	agentOpen: boolean
	openAgent(): void
	closeAgent(): void
	setAgentPosition(position: CommandInput<'chat.send'>['position']): void
	agentContextLabel: string | null
	setAgentContextLabel(label: string | null): void
	refreshLibrary(): void
}

interface ShellApi {
	agentOpen: boolean
	openAgent(): void
	closeAgent(): void
	agentPosition: CommandInput<'chat.send'>['position'] | undefined
	setAgentPosition(position: CommandInput<'chat.send'>['position']): void
	agentContextLabel: string | null
	setAgentContextLabel(label: string | null): void
}

const ShellContext = createContext<ShellApi>({
	agentOpen: false,
	openAgent: () => {},
	closeAgent: () => {},
	agentPosition: undefined,
	setAgentPosition: () => {},
	agentContextLabel: null,
	setAgentContextLabel: () => {},
})

export function useShell() {
	return useContext(ShellContext)
}

export function AppShell() {
	const [config, setConfig] = useState<SettingsHost['config']>()
	const [ready, setReady] = useState(false)
	const [interruption, setInterruption] = useState<
		'down' | 'failed' | 'breaker'
	>()
	const [hostError, setHostError] = useState('')
	const { pathname } = useLocation()
	const routeWorkId = useMatch('/work/:id/*')?.params.id
	const navigate = useNavigate()
	const [works, setWorks] = useState<LibraryWork[]>([])
	const [libraryRevision, setLibraryRevision] = useState(0)
	const [recentWorkId, setRecentWorkId] = useState(readRecentWork)
	const installed = window.novelive.host.installed
	const [packages, setPackages] = useState<InstalledWork[]>([])
	const packageRef = routeWorkId ? undefined : parsePackageRef(recentWorkId)
	const recentPackage = packageRef
		? packages.find((item) => item.workId === packageRef.workId)
		: undefined
	const routePackage = routeWorkId
		? packages.find((item) => String(item.workId) === String(routeWorkId))
		: undefined
	const workId = routeWorkId ?? (packageRef ? undefined : recentWorkId)
	const work = works.find((item) => item.workId === workId)
	// 侧边栏与切换菜单的作品名统一经过格式化：查不到绝不回退到 UUID
	const workTitles = workTitlesFromList(works)
	const showWork = Boolean(routeWorkId || work)
	const isImportedPackage =
		Boolean(recentPackage) || Boolean(routePackage && !work)
	const isProject = Boolean(workId && showWork && !isImportedPackage)
	const [agentOpen, setAgentOpen] = useState(false)
	const [agentFull, setAgentFull] = useState(false)
	const [agentPosition, setAgentPosition] =
		useState<CommandInput<'chat.send'>['position']>()
	const [agentContextLabel, setAgentContextLabel] = useState<string | null>(
		null,
	)
	const [pendingTheme, setPendingTheme] = useState<ThemeMode>()
	const { theme, setTheme } = useAppearance(config)
	const { i18n } = useTranslation()
	const updateConfig = useCallback(async (patch: ConfigUpdate) => {
		const saved = await window.novelive.call('config.update', patch).promise
		setConfig(saved)
		return saved
	}, [])
	const resetConfig = useCallback(async () => {
		setConfig(await window.novelive.call('config.reset', {}).promise)
	}, [])

	useEffect(() => {
		let active = true
		let revision = 0
		const onReady = () => {
			const current = ++revision
			setReady(true)
			setInterruption(undefined)
			setHostError('')
			void window.novelive.call('config.get', {}).promise.then(
				(saved) => {
					if (active && current === revision) setConfig(saved)
				},
				() => {},
			)
		}
		const unsubscribeReady = window.novelive.on('creator.ready', onReady)
		const unsubscribeDown = window.novelive.on('creator.down', () => {
			const current = ++revision
			setReady(false)
			setInterruption('down')
			void window.novelive.host.appState().then(
				(state) => {
					if (active && current === revision && state.creator === 'failed')
						setInterruption(state.breakerOpen ? 'breaker' : 'failed')
				},
				() => {},
			)
		})
		void window.novelive.host.appState().then(
			(state) => {
				if (!active || revision !== 0) return
				if (state.creator === 'ready') onReady()
				else if (state.creator === 'failed')
					setInterruption(state.breakerOpen ? 'breaker' : 'failed')
			},
			() => {},
		)
		return () => {
			active = false
			unsubscribeReady()
			unsubscribeDown()
		}
	}, [])

	async function runHostAction(action: 'openLogDir' | 'restartCreator') {
		setHostError('')
		try {
			await window.novelive.host[action]()
		} catch {
			setHostError(
				action === 'openLogDir'
					? t('无法打开日志目录')
					: t('无法重新启动创作端'),
			)
		}
	}

	useEffect(() => {
		if (!routeWorkId) return
		setRecentWorkId(routeWorkId)
		try {
			localStorage.setItem(recentWorkKey, routeWorkId)
		} catch {}
	}, [routeWorkId])
	// biome-ignore lint/correctness/useExhaustiveDependencies: refresh titles after navigation
	useEffect(() => {
		if (!ready) return
		const request = window.novelive.call('library.list', {})
		request.promise.then(
			(value) => setWorks(value.works as LibraryWork[]),
			() => {},
		)
		return () => request.cancel()
	}, [ready, pathname, libraryRevision])
	// biome-ignore lint/correctness/useExhaustiveDependencies: refresh after navigation
	useEffect(() => {
		if (!installed) return
		let active = true
		void installed.list().then(
			(list) => {
				if (active) setPackages(list)
			},
			() => {},
		)
		return () => {
			active = false
		}
	}, [installed, pathname, libraryRevision])
	// biome-ignore lint/correctness/useExhaustiveDependencies: 换作品时清空 Agent 的上下文与位置；同作品内的页面切换保留
	useEffect(() => {
		setAgentContextLabel(null)
		setAgentPosition(undefined)
	}, [workId])
	const showAgent = isProject
	const agentVisible = agentOpen && showAgent
	const agentPresence = usePresence(agentVisible, 200)
	const lastAgentWorkId = useRef<string | undefined>(undefined)
	if (workId && showAgent) lastAgentWorkId.current = workId
	// 作品消失（例如回到书库）时退出动画仍需要有效的 workId
	const panelWorkId = showAgent ? workId : lastAgentWorkId.current
	const mainScrollRef = useRef<HTMLDivElement>(null)
	// 所有页面共用一个滚动容器，换页时回到顶部
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset scroll on navigation only
	useEffect(() => {
		mainScrollRef.current?.scrollTo({ top: 0 })
	}, [pathname])
	const closeAgent = useCallback(() => {
		setAgentOpen(false)
		setAgentFull(false)
	}, [])
	const openAgent = useCallback(() => {
		if (showAgent) setAgentOpen(true)
	}, [showAgent])
	// 主题点击立即生效；创作端就绪或配置可用后补写持久化
	useEffect(() => {
		if (!pendingTheme || !ready || !config || 'configError' in config) return
		const value = pendingTheme
		setPendingTheme(undefined)
		void updateConfig({ theme: value }).catch(() =>
			setHostError(t('无法保存主题')),
		)
	}, [pendingTheme, ready, config, updateConfig])

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (
				(event.ctrlKey || event.metaKey) &&
				!event.altKey &&
				!event.shiftKey &&
				event.key.toLowerCase() === 'j'
			) {
				if (!showAgent) return
				event.preventDefault()
				setAgentOpen((open) => !open)
				return
			}
			if (event.key === 'Escape') {
				if (
					event.defaultPrevented ||
					document.querySelector('[role="dialog"], dialog[open]')
				)
					return
				if (agentFull) setAgentFull(false)
				else if (agentVisible) closeAgent()
			}
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [showAgent, agentFull, agentVisible, closeAgent])

	const shell: ShellApi = {
		agentOpen: agentVisible,
		openAgent,
		closeAgent,
		agentPosition,
		setAgentPosition,
		agentContextLabel,
		setAgentContextLabel,
	}
	const outletContext: ShellOutletContext = {
		config,
		updateConfig,
		resetConfig,
		agentOpen: agentVisible,
		openAgent,
		closeAgent,
		setAgentPosition,
		agentContextLabel,
		setAgentContextLabel,
		refreshLibrary: () => setLibraryRevision((n) => n + 1),
	}

	const rememberRecent = (ref: string) => {
		setRecentWorkId(ref)
		try {
			localStorage.setItem(recentWorkKey, ref)
		} catch {}
	}
	// 切换菜单按「工程 / 作品包」分组：分组标题是禁用的菜单项，
	// 靠 menuitem 样式内的 disabled 态渲染成分组标签（不干预 Dropdown 组件）。
	const projectItems = works.map((item) => ({
		label: workTitles.get(item.workId) ?? item.title,
		icon: item.workId === workId ? Check : NotebookPen,
		onSelect: () => navigate(workRoute('work', item.workId)),
	}))
	const packageItems = packages.map((item) => {
		const ref = `package:${item.workId}:${item.version}`
		return {
			label: t('{{title}} · v{{version}}', {
				title: item.title,
				version: item.version,
			}),
			icon: recentPackage === item ? Check : PlayCircle,
			onSelect: () => {
				rememberRecent(ref)
				if (item.published > 0)
					navigate(`/package/${item.workId}/${item.version}`)
				else if (routeWorkId) navigate('/?tab=imported')
			},
		}
	})
	const switchItems = [
		...(projectItems.length
			? [
					{
						label: t('工程'),
						disabled: true,
						onSelect: () => {},
					},
					...projectItems,
				]
			: []),
		...(packageItems.length
			? [
					{
						label: t('作品包'),
						disabled: true,
						onSelect: () => {},
					},
					...packageItems,
				]
			: []),
	]
	const switcher = switchItems.length > 1 && (
		<Dropdown
			label={t('换一部作品')}
			className={`nl-icon-btn ${styles.switcher}`}
			trigger={
				<ChevronsUpDown aria-hidden="true" size={16} strokeWidth={1.8} />
			}
			items={switchItems}
		/>
	)
	const packageSection = isImportedPackage
		? routePackage && !work
			? routePackage
			: recentPackage
		: undefined

	return (
		<ShellContext.Provider value={shell}>
			<div className={styles.shell}>
				<aside className={styles.sidebar}>
					<ScrollArea className={styles.sideScroll}>
						<div className={styles.sideContent}>
							<div className={styles.brand}>
								<img
									className="brand-mark-light"
									src={markLight}
									alt=""
									width={24}
									height={24}
								/>
								<img
									className="brand-mark-dark"
									src={markDark}
									alt=""
									width={24}
									height={24}
								/>
								<span>NOVELIVE</span>
							</div>
							<nav aria-label={t('全局导航')} className={styles.navigation}>
								{navigation.map(({ to, icon, name }) => (
									<NavItem key={to} to={to} end={to === '/'} icon={icon}>
										{t(name)}
									</NavItem>
								))}
							</nav>
							{packageSection && (
								<>
									<div
										className={`label-caps label-caps-zh ${styles.sectionTitle}`}
									>
										{routePackage && !work ? t('当前作品') : t('最近打开')}
									</div>
									<div className={styles.currentWork}>
										<div className={styles.workCover}>
											<GradientCover seed={packageSection.workId} compact />
										</div>
										<div className={styles.workText}>
											<div className={styles.workTitle}>
												{packageSection.title}
											</div>
											<div className={styles.workMeta}>
												{t(
													'v{{version}} · 已发布 {{published}} / {{chapters}} 章',
													{
														version: packageSection.version,
														published: packageSection.published,
														chapters: packageSection.chapters,
													},
												)}
											</div>
										</div>
										{switcher}
									</div>
									<nav aria-label={t('作品导航')} className={styles.navigation}>
										<NavItem to="/?tab=imported" end icon={BookOpen}>
											{t('概览')}
										</NavItem>
										{packageSection.published > 0 && (
											<NavItem
												to={`/package/${packageSection.workId}/${packageSection.version}`}
												icon={PlayCircle}
											>
												{t('游玩')}
											</NavItem>
										)}
									</nav>
								</>
							)}
							{workId && showWork && !isImportedPackage && (
								<>
									<div
										className={`label-caps label-caps-zh ${styles.sectionTitle}`}
									>
										{routeWorkId ? t('当前作品') : t('最近打开')}
									</div>
									<div className={styles.currentWork}>
										<div className={styles.workCover}>
											<GradientCover seed={workId} compact />
										</div>
										<div className={styles.workText}>
											<div className={styles.workTitle}>
												{work?.title ?? formatWorkTitle(workTitles, workId)}
											</div>
											{work && (
												<div className={styles.workMeta}>
													{work.project
														? t('{{series}} · 第 {{index}} 卷', {
																series: work.project.seriesTitle,
																index: work.project.volumeIndex,
															})
														: t('已发布 {{published}} / {{chapters}} 章', {
																published: work.published,
																chapters: work.chapters,
															})}
												</div>
											)}
										</div>
										{switcher}
									</div>
									<nav aria-label={t('作品导航')} className={styles.navigation}>
										{workNavigation.map(({ route, icon, name }) => (
											<NavItem
												key={route}
												end
												to={workRoute(route, workId)}
												icon={icon}
											>
												{t(name)}
											</NavItem>
										))}
									</nav>
									{showAgent && (
										<button
											type="button"
											className={`glass-panel ${styles.agent}`}
											aria-pressed={agentVisible}
											onClick={() => setAgentOpen((open) => !open)}
										>
											<Sparkles
												aria-hidden="true"
												size={17}
												strokeWidth={1.8}
											/>
											<span>Novelive Agent</span>
											<kbd>Ctrl/⌘+J</kbd>
										</button>
									)}
								</>
							)}
							<div className={styles.footer}>
								<GlobalProductionQueue />
								<fieldset className={styles.themes} aria-label={t('主题')}>
									{themes.map(({ value, icon: Icon, name }) => (
										<button
											key={value}
											type="button"
											aria-label={t(name)}
											title={t(name)}
											aria-pressed={theme === value}
											onClick={() => {
												setTheme(value)
												if (ready && config && !('configError' in config)) {
													setPendingTheme(undefined)
													void updateConfig({ theme: value }).catch(() =>
														setHostError(t('无法保存主题')),
													)
												} else {
													setPendingTheme(value)
												}
											}}
										>
											<Icon aria-hidden="true" size={16} strokeWidth={1.8} />
										</button>
									))}
								</fieldset>
							</div>
							<p role="status" className={styles.announcer}>
								{ready ? t('创作端已就绪') : t('创作端未就绪')}
							</p>
						</div>
					</ScrollArea>
				</aside>
				<main className={styles.main}>
					{interruption && (
						<div className={styles.warning} role="alert">
							<AlertTriangle aria-hidden="true" size={18} />
							<span>
								{interruption === 'breaker'
									? t('创作端连续 3 次未能启动，自动重启已暂停。')
									: interruption === 'failed'
										? t('创作端启动失败。')
										: t('创作端已断开，正在尝试重新连接。')}
							</span>
							<button
								type="button"
								onClick={() => void runHostAction('openLogDir')}
							>
								{t('查看诊断信息')}
							</button>
							<button
								type="button"
								onClick={() => void runHostAction('restartCreator')}
							>
								{t('重新启动')}
							</button>
						</div>
					)}
					{hostError && <ErrorNotice message={hostError} />}
					<ScrollArea viewportRef={mainScrollRef} className={styles.mainScroll}>
						<Outlet key={i18n.language} context={outletContext} />
					</ScrollArea>
					{agentPresence.mounted && panelWorkId && (
						<div
							className={styles.agentOverlay}
							data-state={agentPresence.state}
						>
							<AgentPanel
								key={panelWorkId}
								workId={panelWorkId}
								position={agentPosition}
								full={agentFull}
								onToggleFull={() => setAgentFull((value) => !value)}
								onClose={closeAgent}
							/>
						</div>
					)}
				</main>
			</div>
		</ShellContext.Provider>
	)
}
