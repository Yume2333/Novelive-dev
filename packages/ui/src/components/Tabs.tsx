import type { LucideIcon } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import styles from './Tabs.module.css'

/** Props for the panel controlled by tab `key` of the `Tabs` with this `id`. */
export const tabPanel = (id: string, key: string) =>
	({
		id: `${id}-panel-${key}`,
		role: 'tabpanel',
		'aria-labelledby': `${id}-tab-${key}`,
	}) as const

export function Tabs<Key extends string>({
	id,
	tabs,
	active,
	onChange,
	label,
}: {
	id: string
	tabs: { key: Key; label: string; icon?: LucideIcon }[]
	active: Key
	onChange: (key: Key) => void
	label?: string
}) {
	function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
		const index = tabs.findIndex(({ key }) => key === active)
		const next = {
			ArrowRight: index + 1,
			ArrowLeft: index - 1,
			Home: 0,
			End: tabs.length - 1,
		}[event.key]
		if (next === undefined) return
		event.preventDefault()
		const key = tabs[(next + tabs.length) % tabs.length].key
		onChange(key)
		document.getElementById(`${id}-tab-${key}`)?.focus()
	}
	return (
		<div
			className={styles.tabs}
			role="tablist"
			aria-label={label}
			onKeyDown={onKeyDown}
		>
			{tabs.map(({ key, label: text, icon: Icon }) => (
				<button
					key={key}
					id={`${id}-tab-${key}`}
					type="button"
					role="tab"
					aria-selected={key === active}
					aria-controls={`${id}-panel-${key}`}
					tabIndex={key === active ? 0 : -1}
					className={`label-caps label-caps-zh ${styles.tab}`}
					onClick={() => onChange(key)}
				>
					{Icon && <Icon size={14} strokeWidth={1.8} aria-hidden="true" />}
					{text}
				</button>
			))}
		</div>
	)
}
