import { Link } from 'react-router-dom'
import { Page } from '../../components/Page'
import { workRoute } from '../../routes/production'
import { ChapterState } from '../production/ChapterState'
import styles from '../production/Production.module.css'
import { ProductionNotice } from '../production/ProductionNotice'
import { ExportPackage } from './share/ExportPackage'
import { chapterTitle, useWorkProduction } from './WorkProduction'

export function WorkPage() {
	const { snapshot } = useWorkProduction()
	const { workId, phase, summary, chapters, exportTarget } = snapshot
	const share = window.novelive.host.share
	const pickDestination = window.novelive.pickPackageDestination
	const firstPublished = chapters.find(
		(chapter) => chapter.status === 'published',
	)
	return (
		<Page title={snapshot.title ?? '作品概览'}>
			<div className={styles.stack}>
				{summary && <p className={styles.lead}>{summary}</p>}
				<div className={styles.actions}>
					{firstPublished && (
						<Link className={styles.primary} to={workRoute('play', workId)}>
							开始游玩
						</Link>
					)}
					<Link className={styles.button} to={workRoute('production', workId)}>
						查看制作
					</Link>
					{share && pickDestination && exportTarget && (
						<ExportPackage
							api={share}
							pickDestination={pickDestination}
							workId={workId}
							{...exportTarget}
						/>
					)}
				</div>
				{phase === 'confirm-visual' && (
					<ProductionNotice>
						<p>第一卷角色和主视觉已就绪，等待确认。</p>
						<Link to={workRoute('confirmVisual', workId)}>选择主视觉</Link>
					</ProductionNotice>
				)}
				{phase === 'confirm-first' && (
					<ProductionNotice>
						<p>第一章已发布，可以先试玩，再继续制作。</p>
						<Link to={workRoute('confirmFirst', workId)}>确认第一章</Link>
					</ProductionNotice>
				)}
				<section className={styles.card} aria-labelledby="work-chapters">
					<h2 id="work-chapters">章节</h2>
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
						<p className={styles.lead}>暂无章节</p>
					)}
				</section>
			</div>
		</Page>
	)
}
