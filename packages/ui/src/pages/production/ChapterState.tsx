import type { ProductionSnapshot } from '@novelive/creator/contract'
import { CircleAlert, CircleCheck, LoaderCircle } from 'lucide-react'
import { msg, scoped } from '../../i18n'
import styles from './Production.module.css'

const t = scoped('production')

type Chapter = ProductionSnapshot['chapters'][number]
export const stepName = {
	write: msg('写剧本'),
	review: msg('审稿'),
	stage: msg('演出'),
	draw: msg('出图'),
}
const steps = Object.keys(stepName) as (keyof typeof stepName)[]

export function stepProgress(chapter: Chapter) {
	if (chapter.status === 'published') return 1
	if (chapter.status !== 'producing') return 0
	return (steps.indexOf(chapter.step) + 0.5) / steps.length
}

export function ChapterState({ chapter }: { chapter: Chapter }) {
	return (
		<span className={styles.mark}>
			{chapter.status === 'published' ? (
				<>
					<CircleCheck aria-hidden="true" size={13} />
					{t('已发布')}
				</>
			) : (
				<span className={styles.pill} data-status={chapter.status}>
					{chapter.status === 'producing' && (
						<LoaderCircle
							className={styles.spin}
							aria-hidden="true"
							size={12}
						/>
					)}
					{chapter.status === 'producing'
						? t(stepName[chapter.step])
						: t('等待')}
				</span>
			)}
			{chapter.issue && (
				<span className={styles.attention} title={chapter.issue}>
					<CircleAlert aria-hidden="true" size={13} />
					{t('需要处理')}
				</span>
			)}
		</span>
	)
}
