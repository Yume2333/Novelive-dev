import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import styles from './Page.module.css'

export function Page({
	title,
	children,
}: {
	title: string
	children?: ReactNode
}) {
	return (
		<section className={styles.page}>
			<h1>{title}</h1>
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
