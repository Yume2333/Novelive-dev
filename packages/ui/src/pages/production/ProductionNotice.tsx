import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { Banner, IconButton } from '../../components'
import { scoped } from '../../i18n'

const t = scoped('production')

/** 制作页提示横幅：共享 Banner + 可关闭（Design：横幅只在需要创作者动手时出现，可以关掉） */
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
	return (
		<Banner
			kind={kind}
			action={
				<>
					{action}
					<IconButton
						icon={X}
						label={t('关闭提示')}
						size={28}
						onClick={() => setDismissed(true)}
					/>
				</>
			}
		>
			{children}
		</Banner>
	)
}
