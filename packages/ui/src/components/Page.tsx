import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import styles from './Page.module.css'

export function Page({
	title,
	action,
	children,
}: {
	title: string
	action?: ReactNode
	children?: ReactNode
}) {
	return (
		<section className={styles.page}>
			<header className={styles.header}>
				<h1>{title}</h1>
				{action}
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
}: {
	icon: LucideIcon
	text: string
	title?: string
	card?: boolean
}) {
	return (
		<div
			className={card ? `${styles.empty} ${styles.emptyCard}` : styles.empty}
		>
			<span className={styles.icon}>
				<Icon aria-hidden="true" size={28} strokeWidth={1.8} />
			</span>
			{title && <h2>{title}</h2>}
			<p>{text}</p>
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
