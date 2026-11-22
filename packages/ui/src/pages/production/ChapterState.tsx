import type { ProductionSnapshot } from '@novelive/creator/contract'
import { CircleAlert } from 'lucide-react'
import styles from './Production.module.css'

type Chapter = ProductionSnapshot['chapters'][number]
export const stepName = {
	write: '写剧本',
	review: '审稿',
	stage: '演出',
	draw: '出图',
}

export function ChapterState({ chapter }: { chapter: Chapter }) {
	const label = { waiting: '等待', producing: '制作中', published: '已发布' }[
		chapter.status
	]
	return (
		<div className={styles.actions}>
			<span
				className={
					chapter.status === 'published' ? styles.published : styles.badge
				}
			>
				{label}
			</span>
			{chapter.status === 'producing' && <span>{stepName[chapter.step]}</span>}
			{chapter.issue && (
				<span className={styles.issue}>
					<CircleAlert aria-hidden="true" size={15} />
					需要处理
				</span>
			)}
		</div>
	)
}
