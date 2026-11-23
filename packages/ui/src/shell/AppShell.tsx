import type {
	CommandInput,
	CommandOutput,
	ConfigUpdate,
	MaskedConfig,
} from '@novelive/creator/contract'
import {
	AlertTriangle,
	BarChart3,
	Contrast,
	LibraryBig,
	MessageSquareText,
	Moon,
	Pencil,
	Play,
	Settings,
	Sun,
	Workflow,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useMatch } from 'react-router-dom'
import { ScrollArea } from '../components/ScrollArea'
import { AgentPanel } from '../panels/agent/AgentPanel'
import { workRoute } from '../routes/production'
import styles from './AppShell.module.css'
import { GlobalProductionQueue } from './GlobalProductionQueue'

const navigation = [
	{ to: '/', icon: LibraryBig, name: '书库' },
	{ to: '/usage', icon: BarChart3, name: '用量' },
	{ to: '/settings', icon: Settings, name: '设置' },
]
const themes = [
	{ value: 'light', icon: Sun, name: '亮色' },
	{ value: 'dark', icon: Moon, name: '暗色' },
	{ value: 'system', icon: Contrast, name: '跟随系统' },
] as const
const workNavigation = [
	{ route: 'work', icon: LibraryBig, name: '概览' },
	{ route: 'play', icon: Play, name: '游玩' },
	{ route: 'production', icon: Workflow, name: '制作' },
	{ route: 'editor', icon: Pencil, name: '编辑' },
	{ route: 'bible', icon: LibraryBig, name: '设定集' },
] as const
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
	const workId = useMatch('/work/:id/*')?.params.id
	const [agentOpen, setAgentOpen] = useState(false)
	const [agentFull, setAgentFull] = useState(false)
	const [agentPosition, setAgentPosition] =
		useState<CommandInput<'chat.send'>['position']>()
	const theme = config && 'theme' in config ? config.theme : 'system'
	const updateConfig = useCallback(async (patch: ConfigUpdate) => {
		const saved = await window.novelive.call('config.update', patch).promise
		setConfig(saved)
		return saved
	}, [])
	const resetConfig = useCallback(async () => {
		setConfig(await window.novelive.call('config.reset', {}).promise)
	}, [])

	useEffect(() => {
		const query = window.matchMedia('(prefers-color-scheme: dark)')
		const apply = () => {
			document.documentElement.dataset.theme =
				theme === 'system' ? (query.matches ? 'dark' : 'light') : theme
		}
		apply()
		query.addEventListener('change', apply)
		return () => query.removeEventListener('change', apply)
	}, [theme])

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
				action === 'openLogDir' ? '无法打开日志目录' : '无法重新启动创作端',
			)
		}
	}

	useEffect(() => {
		if (!workId) return
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
	}, [workId])

	return (
		<div className={styles.shell}>
			<aside className={styles.sidebar}>
				<ScrollArea className={styles.sideScroll}>
					<div className={styles.sideContent}>
						<div className={styles.brand}>Novelive</div>
						<nav aria-label="全局导航" className={styles.navigation}>
							{navigation.map(({ to, icon: Icon, name }) => (
								<NavLink
									key={to}
									end={to === '/'}
									className={styles.navLink}
									to={to}
								>
									<Icon aria-hidden="true" size={19} strokeWidth={1.8} />
									{name}
								</NavLink>
							))}
						</nav>
						{workId && (
							<nav aria-label="作品导航" className={styles.navigation}>
								{workNavigation.map(({ route, icon: Icon, name }) => (
									<NavLink
										key={route}
										end
										className={styles.navLink}
										to={workRoute(route, workId)}
									>
										<Icon aria-hidden="true" size={19} strokeWidth={1.8} />
										{name}
									</NavLink>
								))}
								<button
									type="button"
									className={styles.navLink}
									aria-pressed={agentOpen}
									title="Agent（Ctrl/⌘+J）"
									onClick={() => setAgentOpen(!agentOpen)}
								>
									<MessageSquareText
										aria-hidden="true"
										size={19}
										strokeWidth={1.8}
									/>
									Agent
								</button>
							</nav>
						)}
						<GlobalProductionQueue />
						<fieldset className={styles.themes} aria-label="主题">
							{themes.map(({ value, icon: Icon, name }) => (
								<button
									key={value}
									type="button"
									aria-label={name}
									title={name}
									aria-pressed={theme === value}
									disabled={!ready || !config || 'configError' in config}
									onClick={() => {
										void updateConfig({ theme: value }).catch(() =>
											setHostError('无法保存主题'),
										)
									}}
								>
									<Icon aria-hidden="true" size={17} strokeWidth={1.8} />
								</button>
							))}
						</fieldset>
						<p role="status" className={styles.announcer}>
							{ready ? '创作端已就绪' : '创作端未就绪'}
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
								? '创作端连续 3 次未能启动，自动重启已暂停。'
								: interruption === 'failed'
									? '创作端启动失败。'
									: '创作端已断开，正在尝试重新连接。'}
						</span>
						<button
							type="button"
							onClick={() => void runHostAction('openLogDir')}
						>
							日志
						</button>
						<button
							type="button"
							onClick={() => void runHostAction('restartCreator')}
						>
							重新启动
						</button>
					</div>
				)}
				{hostError && (
					<p className={styles.warning} role="alert">
						{hostError}
					</p>
				)}
				<ScrollArea key={pathname} className={styles.mainScroll}>
					<Outlet
						context={
							{
								config,
								updateConfig,
								resetConfig,
								setAgentPosition,
							} satisfies SettingsHost & {
								setAgentPosition: typeof setAgentPosition
							}
						}
					/>
				</ScrollArea>
				{workId && agentOpen && (
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
