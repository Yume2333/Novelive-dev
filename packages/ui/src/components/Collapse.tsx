import type { CSSProperties, ReactNode } from 'react'
import styles from './Collapse.module.css'

/** 纸墨风平滑折叠容器（基于 grid-template-rows 0fr → 1fr） */
export function Collapse({
	open,
	children,
	style,
	className,
}: {
	open: boolean
	children: ReactNode
	style?: CSSProperties
	className?: string
}) {
	return (
		<div
			className={
				className ? `${styles.collapse} ${className}` : styles.collapse
			}
			data-open={open}
			aria-hidden={!open}
			inert={!open}
			style={style}
		>
			<div>{children}</div>
		</div>
	)
}
