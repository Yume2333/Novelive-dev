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
}: {
	icon: LucideIcon
	text: string
}) {
	return (
		<div className={styles.empty}>
			<span className={styles.icon}>
				<Icon aria-hidden="true" size={28} strokeWidth={1.8} />
			</span>
			<p>{text}</p>
		</div>
	)
}
