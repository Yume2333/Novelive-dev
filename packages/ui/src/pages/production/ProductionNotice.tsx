import { X } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { scoped } from '../../i18n'
import styles from './Production.module.css'

const t = scoped('production')

export function ProductionNotice({ children }: { children: ReactNode }) {
	const [dismissed, setDismissed] = useState(false)
	if (dismissed) return null
	return (
		<div className={styles.notice}>
			<div>{children}</div>
			<button
				className={styles.button}
				type="button"
				aria-label={t('关闭提示')}
				onClick={() => setDismissed(true)}
			>
				<X size={16} aria-hidden="true" />
			</button>
		</div>
	)
}
