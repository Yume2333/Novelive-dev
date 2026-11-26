import { Info } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './InfoTooltip.module.css'

/** ⓘ 提示：悬停/聚焦/点击触发，外层定位壳与内层 fade-up 动画严格分离（与 Tooltip 同一模式） */
export function InfoTooltip({ label, text }: { label: string; text: string }) {
	const id = useId()
	const trigger = useRef<HTMLButtonElement>(null)
	const tip = useRef<HTMLSpanElement>(null)
	const [open, setOpen] = useState(false)

	useLayoutEffect(() => {
		if (!open) return
		const place = () => {
			const anchor = trigger.current
			const tooltip = tip.current
			if (!anchor || !tooltip) return
			const rect = anchor.getBoundingClientRect()
			const gap = rect.height / 2
			const half = tooltip.offsetWidth / 2
			const left = Math.max(
				half + gap,
				Math.min(window.innerWidth - half - gap, rect.left + rect.width / 2),
			)
			const below = rect.top < tooltip.offsetHeight + gap
			tooltip.style.left = `${left}px`
			tooltip.style.top = `${below ? rect.bottom + gap : rect.top - gap}px`
			tooltip.dataset.below = String(below)
		}
		place()
		window.addEventListener('resize', place)
		window.addEventListener('scroll', place, true)
		return () => {
			window.removeEventListener('resize', place)
			window.removeEventListener('scroll', place, true)
		}
	}, [open])

	useEffect(() => {
		if (!open) return
		const dismiss = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setOpen(false)
		}
		window.addEventListener('keydown', dismiss)
		return () => window.removeEventListener('keydown', dismiss)
	}, [open])

	return (
		<span className={styles.anchor}>
			<button
				ref={trigger}
				type="button"
				className={styles.trigger}
				aria-label={label}
				aria-describedby={open ? id : undefined}
				onMouseEnter={() => setOpen(true)}
				onMouseLeave={() => setOpen(false)}
				onFocus={() => setOpen(true)}
				onBlur={() => setOpen(false)}
				onClick={() => setOpen(true)}
			>
				<Info aria-hidden="true" size={14} strokeWidth={1.8} />
			</button>
			{open &&
				createPortal(
					<span className={styles.tipShell} ref={tip} id={id} role="tooltip">
						<span className={styles.tipBubble}>{text}</span>
					</span>,
					document.body,
				)}
		</span>
	)
}
