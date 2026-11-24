import type { LucideIcon } from 'lucide-react'
import styles from './Tabs.module.css'

export function Tabs<Key extends string>({
	tabs,
	active,
	onChange,
	label,
}: {
	tabs: { key: Key; label: string; icon?: LucideIcon }[]
	active: Key
	onChange: (key: Key) => void
	label?: string
}) {
	return (
		<div className={styles.tabs} role="tablist" aria-label={label}>
			{tabs.map(({ key, label: text, icon: Icon }) => (
				<button
					key={key}
					type="button"
					role="tab"
					aria-selected={key === active}
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
