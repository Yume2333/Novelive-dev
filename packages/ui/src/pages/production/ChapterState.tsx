import type { ProductionSnapshot } from '@novelive/creator/contract'
import { CircleAlert } from 'lucide-react'
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

export function ChapterState({ chapter }: { chapter: Chapter }) {
	const label = {
		waiting: t('等待'),
		producing: t('制作中'),
		published: t('已发布'),
	}[chapter.status]
	return (
		<div className={styles.actions}>
			<span
				className={
					chapter.status === 'published' ? styles.published : styles.badge
				}
			>
				{label}
			</span>
			{chapter.status === 'producing' && (
				<span>{t(stepName[chapter.step])}</span>
			)}
			{chapter.issue && (
				<span className={styles.issue}>
					<CircleAlert aria-hidden="true" size={15} />
					{t('需要处理')}
				</span>
			)}
		</div>
	)
}
