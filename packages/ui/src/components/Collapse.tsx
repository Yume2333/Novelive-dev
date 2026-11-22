import type { ReactNode } from 'react'
import styles from './Collapse.module.css'

export function Collapse({
	open,
	children,
}: {
	open: boolean
	children: ReactNode
}) {
	return (
		<div
			className={styles.collapse}
			data-open={open}
			aria-hidden={!open}
			inert={!open}
		>
			<div>{children}</div>
		</div>
	)
}
