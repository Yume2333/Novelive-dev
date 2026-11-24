import { Info, TriangleAlert, X } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { scoped } from '../../i18n'
import styles from './Production.module.css'

const t = scoped('production')

export function ProductionNotice({
	children,
	kind = 'info',
	action,
}: {
	children: ReactNode
	kind?: 'info' | 'warning'
	action?: ReactNode
}) {
	const [dismissed, setDismissed] = useState(false)
	if (dismissed) return null
	const Icon = kind === 'warning' ? TriangleAlert : Info
	return (
		<div className={styles.banner} data-kind={kind}>
			<Icon aria-hidden="true" size={17} strokeWidth={1.8} />
			<div>{children}</div>
			{action}
			<button
				className={styles.close}
				type="button"
				aria-label={t('关闭提示')}
				onClick={() => setDismissed(true)}
			>
				<X size={16} strokeWidth={1.8} aria-hidden="true" />
			</button>
		</div>
	)
}
