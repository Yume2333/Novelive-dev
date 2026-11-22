import {
	BarChart3,
	LibraryBig,
	Monitor,
	Moon,
	Settings,
	Sun,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { ScrollArea } from '../components/ScrollArea'
import styles from './AppShell.module.css'

const navigation = [
	{ to: '/', icon: LibraryBig, name: '书库' },
	{ to: '/usage', icon: BarChart3, name: '用量' },
	{ to: '/settings', icon: Settings, name: '设置' },
]
const themes = [
	{ value: 'light', icon: Sun, name: '亮色' },
	{ value: 'dark', icon: Moon, name: '暗色' },
	{ value: 'system', icon: Monitor, name: '跟随系统' },
] as const
type Theme = (typeof themes)[number]['value']
const themeKey = 'novelive.theme'

export function AppShell() {
	const [theme, setTheme] = useState<Theme>(
		() =>
			themes.find(({ value }) => value === localStorage.getItem(themeKey))
				?.value ?? 'system',
	)
	const [ready, setReady] = useState(false)
	const { pathname } = useLocation()

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
		let sawEvent = false
		const onReady = window.novelive.on('creator.ready', () => {
			sawEvent = true
			setReady(true)
		})
		const onDown = window.novelive.on('creator.down', () => {
			sawEvent = true
			setReady(false)
		})
		void window.novelive.host.appState().then((state) => {
			if (active && !sawEvent) setReady(state.creator === 'ready')
		})
		return () => {
			active = false
			onReady()
			onDown()
		}
	}, [])

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
						<fieldset className={styles.themes} aria-label="主题">
							{themes.map(({ value, icon: Icon, name }) => (
								<button
									key={value}
									type="button"
									aria-label={name}
									title={name}
									aria-pressed={theme === value}
									onClick={() => {
										localStorage.setItem(themeKey, value)
										setTheme(value)
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
				<ScrollArea key={pathname} className={styles.mainScroll}>
					<Outlet />
				</ScrollArea>
			</main>
		</div>
	)
}
