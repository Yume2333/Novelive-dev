import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { ButtonLink } from './Feedback'
import styles from './Page.module.css'

export function Page({
	title,
	eyebrow,
	subtitle,
	actions,
	width = 960,
	children,
}: {
	title: ReactNode
	eyebrow?: ReactNode
	subtitle?: ReactNode
	actions?: ReactNode
	width?: number | 'full'
	children?: ReactNode
}) {
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
				{actions && <div className={styles.actions}>{actions}</div>}
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
	icon,
	to,
	children,
}: {
	icon: LucideIcon
	to: string
	children: ReactNode
}) {
	return (
		<ButtonLink variant="primary" icon={icon} to={to}>
			{children}
		</ButtonLink>
	)
}
