import { Link } from 'react-router-dom'
import { Page } from '../../components/Page'
import { scoped } from '../../i18n'
import { workRoute } from '../../routes/production'
import { ChapterState } from '../production/ChapterState'
import styles from '../production/Production.module.css'
import { ProductionNotice } from '../production/ProductionNotice'
import { chapterTitle, useWorkProduction } from './WorkProduction'

const t = scoped('work')

export function WorkPage() {
	const { snapshot } = useWorkProduction()
	const { workId, phase, summary, chapters } = snapshot
	const firstPublished = chapters.find(
		(chapter) => chapter.status === 'published',
	)
	return (
		<Page title={snapshot.title ?? t('作品概览')}>
			<div className={styles.stack}>
				{summary && <p className={styles.lead}>{summary}</p>}
				<div className={styles.actions}>
					{firstPublished && (
						<Link className={styles.primary} to={workRoute('play', workId)}>
							{t('开始游玩')}
						</Link>
					)}
					<Link className={styles.button} to={workRoute('production', workId)}>
						{t('查看制作')}
					</Link>
				</div>
				{phase === 'confirm-visual' && (
					<ProductionNotice>
						<p>{t('第一卷角色和主视觉已就绪，等待确认。')}</p>
						<Link to={workRoute('confirmVisual', workId)}>
							{t('选择主视觉')}
						</Link>
					</ProductionNotice>
				)}
				{phase === 'confirm-first' && (
					<ProductionNotice>
						<p>{t('第一章已发布，可以先试玩，再继续制作。')}</p>
						<Link to={workRoute('confirmFirst', workId)}>
							{t('确认第一章')}
						</Link>
					</ProductionNotice>
				)}
				<section className={styles.card} aria-labelledby="work-chapters">
					<h2 id="work-chapters">{t('章节')}</h2>
					{chapters.length ? (
						<ol className={styles.list}>
							{chapters.map((chapter) => (
								<li className={styles.row} key={chapter.chapterId}>
									<span>{chapterTitle(snapshot, chapter.chapterId)}</span>
									<ChapterState chapter={chapter} />
								</li>
							))}
						</ol>
					) : (
						<p className={styles.lead}>{t('暂无章节')}</p>
					)}
				</section>
			</div>
		</Page>
	)
}
