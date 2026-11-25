import type { LucideIcon } from 'lucide-react'
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from 'react'
import { scoped } from '../i18n'
import styles from './Toast.module.css'

const t = scoped('components')

export type ToastFn = (text: string, icon?: LucideIcon) => void

interface ToastItem {
	id: number
	text: string
	icon?: LucideIcon
	exiting?: boolean
}

const ToastContext = createContext<ToastFn>(() => {})

export function useToast(): ToastFn {
	return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: ReactNode }) {
	const [items, setItems] = useState<ToastItem[]>([])
	const timersRef = useRef<Map<number, number>>(new Map())

	const dismiss = useCallback((id: number) => {
		const existing = timersRef.current.get(id)
		if (existing !== undefined) {
			window.clearTimeout(existing)
			timersRef.current.delete(id)
		}
		setItems((prev) =>
			prev.map((toast) =>
				toast.id === id ? { ...toast, exiting: true } : toast,
			),
		)
		const removeTimer = window.setTimeout(() => {
			timersRef.current.delete(id)
			setItems((prev) => prev.filter((toast) => toast.id !== id))
		}, 200)
		timersRef.current.set(id, removeTimer)
	}, [])

	const push = useCallback<ToastFn>(
		(text, icon) => {
			const id = Date.now() + Math.random()
			setItems((prev) => [...prev, { id, text, icon }])
			const autoTimer = window.setTimeout(() => dismiss(id), 2400)
			timersRef.current.set(id, autoTimer)
		},
		[dismiss],
	)

	useEffect(() => {
		const timers = timersRef.current
		return () => {
			for (const timer of timers.values()) window.clearTimeout(timer)
			timers.clear()
		}
	}, [])

	return (
		<ToastContext.Provider value={push}>
			{children}
			<div role="status" aria-live="polite" className={styles.stack}>
				{items.map((toast) => {
					const Icon = toast.icon
					return (
						<button
							key={toast.id}
							type="button"
							className={`glass-panel ${styles.toast}`}
							data-state={toast.exiting ? 'exit' : 'enter'}
							onClick={() => dismiss(toast.id)}
							title={t('点击关闭')}
						>
							{Icon ? (
								<Icon size={16} strokeWidth={1.8} aria-hidden="true" />
							) : null}
							{toast.text}
						</button>
					)
				})}
			</div>
		</ToastContext.Provider>
	)
}
