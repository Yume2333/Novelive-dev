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
	Check,
	ChevronsUpDown,
	Contrast,
	LibraryBig,
	type LucideIcon,
	Moon,
	NotebookPen,
	PlayCircle,
	Settings,
	Sparkles,
	Sun,
	Workflow,
} from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
	NavLink,
	Outlet,
	useLocation,
	useMatch,
	useNavigate,
} from 'react-router-dom'
import { Dropdown } from '../components/Dropdown'
import { GradientCover } from '../components/GradientCover'
import { ScrollArea } from '../components/ScrollArea'
import { msg, scoped } from '../i18n'
import { AgentPanel } from '../panels/agent/AgentPanel'
import { workRoute } from '../routes/production'
import styles from './AppShell.module.css'
import { useAppearance } from './appearance'
import markLight from './brand/novelive-mark.svg'
import markDark from './brand/novelive-mark-dark.svg'
import { GlobalProductionQueue } from './GlobalProductionQueue'

const t = scoped('shell')

const navigation = [
	{ to: '/', icon: LibraryBig, name: msg('书库') },
	{ to: '/usage', icon: BarChart3, name: msg('用量') },
	{ to: '/settings', icon: Settings, name: msg('设置') },
]
const themes = [
	{ value: 'light', icon: Sun, name: msg('亮色') },
	{ value: 'dark', icon: Moon, name: msg('暗色') },
	{ value: 'system', icon: Contrast, name: msg('跟随系统') },
] as const
const workNavigation = [
	{ route: 'work', icon: BookOpen, name: msg('概览') },
	{ route: 'play', icon: PlayCircle, name: msg('游玩') },
	{ route: 'production', icon: Workflow, name: msg('制作') },
	{ route: 'editor', icon: NotebookPen, name: msg('编辑') },
	{ route: 'bible', icon: LibraryBig, name: msg('设定集') },
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
		<NavLink to={to} end={end} className={`nl-nav-item ${styles.navLink}`}>
			{({ isActive }) => (
				<span className={styles.navBody} data-active={isActive}>
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
	const workId = routeWorkId ?? (packageRef ? undefined : recentWorkId)
	const work = works.find((item) => item.workId === workId)
	const [agentOpen, setAgentOpen] = useState(false)
	const [agentFull, setAgentFull] = useState(false)
	const [agentPosition, setAgentPosition] =
		useState<CommandInput<'chat.send'>['position']>()
	const { theme } = useAppearance(config)
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
	const showWork = Boolean(routeWorkId || work)
	const switchItems = [
		...works.map((item) => ({
			label: item.title,
			icon: item.workId === workId ? Check : NotebookPen,
			onSelect: () => navigate(workRoute('work', item.workId)),
		})),
		...packages.map((item) => {
			const ref = `package:${item.workId}:${item.version}`
			return {
				label: t('{{title}} · v{{version}}', {
					title: item.title,
					version: item.version,
				}),
				icon: recentPackage === item ? Check : PlayCircle,
				onSelect: () => {
					setRecentWorkId(ref)
					try {
						localStorage.setItem(recentWorkKey, ref)
					} catch {}
					if (routeWorkId) navigate('/')
				},
			}
		}),
	]
	const switcher = switchItems.length > 1 && (
		<Dropdown
			label={t('换一部作品')}
			className={`nl-icon-btn ${styles.switcher}`}
			trigger={
				<ChevronsUpDown aria-hidden="true" size={17} strokeWidth={1.8} />
			}
			items={switchItems}
		/>
	)
	useEffect(() => {
		if (!showWork) return
		const toggle = (event: KeyboardEvent) => {
			if (
				event.key.toLowerCase() !== 'j' ||
				!(event.ctrlKey || event.metaKey) ||
				event.altKey ||
				event.shiftKey
			)
				return
			event.preventDefault()
			setAgentOpen((open) => !open)
		}
		window.addEventListener('keydown', toggle)
		return () => window.removeEventListener('keydown', toggle)
	}, [showWork])

	return (
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
						{recentPackage && (
							<>
								<div
									className={`label-caps label-caps-zh ${styles.sectionTitle}`}
								>
									{t('最近打开')}
								</div>
								<div className={styles.currentWork}>
									<div className={styles.workCover}>
										<GradientCover seed={recentPackage.workId} compact />
									</div>
									<div className={styles.workText}>
										<div className={styles.workTitle}>
											{recentPackage.title}
										</div>
										<div className={styles.workMeta}>
											{t(
												'v{{version}} · 已发布 {{published}} / {{chapters}} 章',
												{
													version: recentPackage.version,
													published: recentPackage.published,
													chapters: recentPackage.chapters,
												},
											)}
										</div>
									</div>
									{switcher}
								</div>
								{recentPackage.published > 0 && (
									<nav aria-label={t('作品导航')} className={styles.navigation}>
										<NavItem
											to={`/package/${recentPackage.workId}/${recentPackage.version}`}
											icon={PlayCircle}
										>
											{t('游玩')}
										</NavItem>
									</nav>
								)}
							</>
						)}
						{workId && showWork && (
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
											{work?.title ?? workId}
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
								<button
									type="button"
									className={`glass-panel ${styles.agent}`}
									aria-pressed={agentOpen}
									title={t('Agent（Ctrl/⌘+J）')}
									onClick={() => setAgentOpen(!agentOpen)}
								>
									<Sparkles aria-hidden="true" size={17} strokeWidth={1.8} />
									<span>Novelive Agent</span>
									<kbd>Ctrl/⌘+J</kbd>
								</button>
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
										disabled={!ready || !config || 'configError' in config}
										onClick={() => {
											void updateConfig({ theme: value }).catch(() =>
												setHostError(t('无法保存主题')),
											)
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
							{t('日志')}
						</button>
						<button
							type="button"
							onClick={() => void runHostAction('restartCreator')}
						>
							{t('重新启动')}
						</button>
					</div>
				)}
				{hostError && (
					<p className={styles.warning} role="alert">
						{hostError}
					</p>
				)}
				<ScrollArea
					key={`${i18n.language}:${pathname}`}
					className={styles.mainScroll}
				>
					<Outlet
						context={
							{
								config,
								updateConfig,
								resetConfig,
								setAgentPosition,
								refreshLibrary: () => setLibraryRevision((n) => n + 1),
							} satisfies SettingsHost & {
								setAgentPosition: typeof setAgentPosition
								refreshLibrary(): void
							}
						}
					/>
				</ScrollArea>
				{workId && showWork && agentOpen && (
					<AgentPanel
						key={workId}
						workId={workId}
						position={agentPosition}
						full={agentFull}
						onToggleFull={() => setAgentFull(!agentFull)}
						onClose={() => setAgentOpen(false)}
					/>
				)}
			</main>
		</div>
	)
}
