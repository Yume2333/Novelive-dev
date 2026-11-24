import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import styles from './Page.module.css'

export function Page({
	title,
	eyebrow,
	subtitle,
	actions,
	action,
	width = 960,
	children,
}: {
	title: ReactNode
	eyebrow?: ReactNode
	subtitle?: ReactNode
	actions?: ReactNode
	/** Alias of `actions` kept for existing callers. */
	action?: ReactNode
	width?: number | 'full'
	children?: ReactNode
}) {
	const slot = actions ?? action
	return (
		<section
			className={styles.page}
			style={{ maxWidth: width === 'full' ? 'none' : width + 96 }}
		>
			<header className={styles.header}>
				<div className={styles.heading}>
					{eyebrow && (
						<div className={`label-caps label-caps-zh ${styles.eyebrow}`}>
							{eyebrow}
						</div>
					)}
					<h1 className={`display ${styles.title}`}>{title}</h1>
					{subtitle && <div className={styles.subtitle}>{subtitle}</div>}
				</div>
				{slot && <div className={styles.actions}>{slot}</div>}
			</header>
			{children}
		</section>
	)
}

export function EmptyState({
	icon: Icon,
	text,
	title,
	card,
	actions,
}: {
	icon: LucideIcon
	text: string
	title?: string
	card?: boolean
	actions?: ReactNode
}) {
	return (
		<div
			className={card ? `${styles.empty} ${styles.emptyCard}` : styles.empty}
		>
			<span className={`glass-panel ${styles.icon}`}>
				<Icon aria-hidden="true" size={28} strokeWidth={1.8} />
			</span>
			{title && <h2 className="headline">{title}</h2>}
			<p>{text}</p>
			{actions && <div className={styles.emptyActions}>{actions}</div>}
		</div>
	)
}

export function PageAction({
	icon: Icon,
	to,
	children,
}: {
	icon: LucideIcon
	to: string
	children: ReactNode
}) {
	return (
		<Link className={styles.primary} to={to}>
			<Icon aria-hidden="true" size={16} />
			{children}
		</Link>
	)
}
