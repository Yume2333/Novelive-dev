import { type ReactNode, useEffect, useId, useRef } from 'react'
import { scoped } from '../i18n'
import { ScrollArea } from './ScrollArea'
import styles from './ShareDialog.module.css'

const t = scoped('components')

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
	const heading = useId()
	const dialog = useRef<HTMLDialogElement>(null)
	useEffect(() => {
		const element = dialog.current
		element?.showModal()
		return () => element?.close()
	}, [])
	return (
		<dialog
			ref={dialog}
			className={styles.dialog}
			aria-labelledby={heading}
			onCancel={(event) => {
				event.preventDefault()
				if (!busy) onClose()
			}}
		>
			<h2 id={heading}>{title}</h2>
			<ScrollArea className={styles.scroll}>
				<div className={styles.content}>{children}</div>
			</ScrollArea>
			<footer className={styles.actions}>
				<button
					type="button"
					className={styles.button}
					disabled={busy}
					onClick={onClose}
				>
					{t('关闭')}
				</button>
				{actions}
			</footer>
		</dialog>
	)
}
