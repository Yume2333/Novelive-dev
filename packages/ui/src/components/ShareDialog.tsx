import type { ReactNode } from 'react'
import { Modal } from './Modal'
import styles from './ShareDialog.module.css'

export function ShareDialog({
	title,
	busy,
	onClose,
	children,
	actions,
}: {
	title: string
	busy: boolean
	onClose(): void
	children: ReactNode
	actions?: ReactNode
}) {
	return (
		<Modal
			open
			title={title}
			onClose={() => {
				if (!busy) onClose()
			}}
			closeDisabled={busy}
			width={560}
			footer={actions}
		>
			<div className={styles.content}>{children}</div>
		</Modal>
	)
}
