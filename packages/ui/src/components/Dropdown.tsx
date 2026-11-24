import type { LucideIcon } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './Dropdown.module.css'
import { ScrollArea } from './ScrollArea'

export interface DropdownItem {
	label: string
	icon?: LucideIcon
	danger?: boolean
	disabled?: boolean
	onSelect(): void
}

export function Dropdown({
	trigger,
	label,
	items,
	className,
}: {
	trigger: ReactNode
	label: string
	items: DropdownItem[]
	className?: string
}) {
	const [open, setOpen] = useState(false)
	const [position, setPosition] = useState({ top: 0, right: 0, maxHeight: 0 })
	const button = useRef<HTMLButtonElement>(null)
	const menu = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (!open) return
		const onPointer = (event: MouseEvent) => {
			const target = event.target as Node
			if (!button.current?.contains(target) && !menu.current?.contains(target))
				setOpen(false)
		}
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return
			event.preventDefault()
			setOpen(false)
			button.current?.focus()
		}
		const close = () => setOpen(false)
		const onScroll = (event: Event) => {
			if (!menu.current?.contains(event.target as Node)) close()
		}
		document.addEventListener('mousedown', onPointer)
		window.addEventListener('keydown', onKey)
		window.addEventListener('scroll', onScroll, true)
		window.addEventListener('resize', close)
		menu.current?.querySelector<HTMLButtonElement>('button')?.focus()
		return () => {
			document.removeEventListener('mousedown', onPointer)
			window.removeEventListener('keydown', onKey)
			window.removeEventListener('scroll', onScroll, true)
			window.removeEventListener('resize', close)
		}
	}, [open])

	return (
		<>
			<button
				ref={button}
				type="button"
				className={className}
				aria-label={label}
				title={label}
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={() => {
					const rect = button.current?.getBoundingClientRect()
					if (rect)
						setPosition({
							top: rect.bottom + 6,
							right: window.innerWidth - rect.right,
							maxHeight: window.innerHeight - rect.bottom - 18,
						})
					setOpen((value) => !value)
				}}
			>
				{trigger}
			</button>
			{open &&
				createPortal(
					<div
						ref={menu}
						role="menu"
						aria-label={label}
						className={`glass-panel ${styles.menu}`}
						style={{ top: position.top, right: position.right }}
					>
						<ScrollArea viewportStyle={{ maxHeight: position.maxHeight }}>
							{items.map(
								({ label: text, icon: Icon, danger, disabled, onSelect }) => (
									<button
										key={text}
										type="button"
										role="menuitem"
										disabled={disabled}
										data-danger={danger}
										className={`nl-dropdown-item ${styles.item}`}
										onClick={() => {
											setOpen(false)
											onSelect()
										}}
									>
										{Icon && (
											<Icon size={15} strokeWidth={1.8} aria-hidden="true" />
										)}
										{text}
									</button>
								),
							)}
						</ScrollArea>
					</div>,
					document.body,
				)}
		</>
	)
}
