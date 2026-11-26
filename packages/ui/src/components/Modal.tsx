import { X } from 'lucide-react'
import { type ReactNode, useEffect, useId } from 'react'
import { createPortal } from 'react-dom'
import { scoped } from '../i18n'
import { IconButton } from './Button'
import styles from './Modal.module.css'
import { usePresence } from './Motion'
import { ScrollArea } from './ScrollArea'

export { Dropdown, type DropdownItem } from './Dropdown'

const t = scoped('components')

export function Modal({
	open,
	title,
	onClose,
	children,
	footer,
	width = 520,
	closeDisabled = false,
}: {
	open: boolean
	title: string
	onClose: () => void
	children: ReactNode
	footer?: ReactNode
	width?: number
	closeDisabled?: boolean
}) {
	const { mounted, state } = usePresence(open, 180)
	const headingId = useId()

	useEffect(() => {
		if (!open) return
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.stopPropagation()
				if (!closeDisabled) onClose()
			}
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [open, onClose, closeDisabled])

	if (!mounted) return null
	return createPortal(
		<div className={styles.overlay} data-state={state}>
			<button
				type="button"
				tabIndex={-1}
				aria-hidden="true"
				className={styles.scrim}
				data-state={state}
				onClick={() => {
					if (!closeDisabled) onClose()
				}}
			/>
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby={headingId}
				className={`glass-panel ${styles.panel}`}
				data-state={state}
				style={{ width }}
			>
				<div className={styles.header}>
					<h2 id={headingId} className={`headline ${styles.title}`}>
						{title}
					</h2>
					<IconButton
						icon={X}
						label={t('关闭')}
						disabled={closeDisabled}
						onClick={onClose}
					/>
				</div>
				<ScrollArea
					style={{ flex: 1 }}
					viewportStyle={{ padding: '8px 24px 20px' }}
				>
					{children}
				</ScrollArea>
				{footer ? <div className={styles.footer}>{footer}</div> : null}
			</div>
		</div>,
		document.body,
	)
}
