import type { HTMLAttributes, ReactNode } from 'react'
import styles from './Card.module.css'

export function Card({
	className,
	children,
	...rest
}: HTMLAttributes<HTMLDivElement> & { children?: ReactNode }) {
	return (
		<div
			{...rest}
			className={['glass-panel', styles.card, className]
				.filter(Boolean)
				.join(' ')}
		>
			{children}
		</div>
	)
}

export function ProgressBar({
	value,
	height = 6,
	active,
	label,
}: {
	value: number
	height?: number
	active?: boolean
	label?: string
}) {
	const percent = Math.round(Math.max(0, Math.min(1, value)) * 100)
	return (
		<div
			className={styles.track}
			style={{ height }}
			role="progressbar"
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={percent}
		>
			<div
				className={active ? `progress-sheen ${styles.fill}` : styles.fill}
				style={{ width: `${percent}%` }}
			/>
		</div>
	)
}

export function Chip({
	active,
	children,
}: {
	active?: boolean
	children: ReactNode
}) {
	return (
		<span
			className={active ? `${styles.chip} ${styles.chipActive}` : styles.chip}
		>
			{children}
		</span>
	)
}

export function SectionLabel({ children }: { children: ReactNode }) {
	return (
		<div className={`label-caps label-caps-zh ${styles.section}`}>
			{children}
		</div>
	)
}
