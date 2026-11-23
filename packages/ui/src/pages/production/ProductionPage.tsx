import type { ProductionSnapshot } from '@novelive/creator/contract'
import { ChevronDown, CircleStop, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Collapse } from '../../components/Collapse'
import { Page } from '../../components/Page'
import { msg, scoped } from '../../i18n'
import { workRoute } from '../../routes/production'
import { chapterTitle, useWorkProduction } from '../work/WorkProduction'
import { ChapterRecords } from './ChapterRecords'
import { ChapterState } from './ChapterState'
import styles from './Production.module.css'
import { ProductionNotice } from './ProductionNotice'

const t = scoped('production')

const workStatus = {
	idle: msg('空闲'),
	producing: msg('制作中'),
	stopped: msg('已停止'),
	confirm: msg('待确认'),
}

function ChapterRow({
	chapter,
}: {
	chapter: ProductionSnapshot['chapters'][number]
}) {
	const { snapshot, busy, run } = useWorkProduction()
	const { chapterId, issue, priority, status } = chapter
	const { workId, blockedChapterId, phase } = snapshot
	const [showRecords, setShowRecords] = useState(false)
	const title = chapterTitle(snapshot, chapterId)

	return (
		<li aria-label={title}>
			<div className={styles.row}>
				<strong>{title}</strong>
				<ChapterState chapter={chapter} />
			</div>
			{issue && <p className={styles.lead}>{issue}</p>}
			<div
				className={`${styles.actions} ${styles.chapterActions}`}
				data-expanded={showRecords}
			>
				{blockedChapterId === chapterId && (
					<button
						className={styles.button}
						type="button"
						disabled={busy}
						onClick={() =>
							void run('production.retryChapter', { workId, chapterId })
						}
					>
						<RotateCcw size={16} aria-hidden="true" />
						{t('重试')}
					</button>
				)}
				{phase === 'producing' &&
					status === 'waiting' &&
					blockedChapterId !== chapterId && (
						<button
							className={styles.button}
							type="button"
							disabled={busy || priority}
							onClick={() =>
								void run('production.prioritizeChapter', { workId, chapterId })
							}
						>
							{priority ? t('已优先') : t('优先制作')}
						</button>
					)}
				<button
					className={styles.button}
					type="button"
					aria-expanded={showRecords}
					onClick={() => setShowRecords((open) => !open)}
				>
					<ChevronDown size={16} aria-hidden="true" />
					{t('运行记录')}
				</button>
			</div>
			<Collapse open={showRecords}>
				{showRecords && (
					<ChapterRecords workId={workId} chapterId={chapterId} />
				)}
			</Collapse>
		</li>
	)
}

export function ProductionPage() {
	const { snapshot, run, busy } = useWorkProduction()
	const { workId, phase, status, blockedChapterId, chapters } = snapshot
	const published = chapters.filter(
		(chapter) => chapter.status === 'published',
	).length
	const flagged = chapters.filter((chapter) => chapter.issue)
	const gate =
		phase === 'confirm-visual'
			? 'confirmVisual'
			: phase === 'confirm-first'
				? 'confirmFirst'
				: undefined

	return (
		<Page title={t('制作')}>
			<div className={styles.stack}>
				<section className={styles.card} aria-label={t('制作状态')}>
					<div className={styles.row}>
						<h2>{snapshot.title ?? t('作品进度')}</h2>
						<span className={styles.badge}>{t(workStatus[status])}</span>
					</div>
					<div className={styles.row}>
						<span>
							{t('已发布 {{published}} / {{length}} 章', {
								published,
								length: chapters.length,
							})}
						</span>
						<div className={styles.actions}>
							{status === 'producing' && (
								<button
									className={styles.button}
									type="button"
									disabled={busy}
									onClick={() => void run('production.stop', { workId })}
								>
									<CircleStop size={16} aria-hidden="true" />
									{t('立即停止')}
								</button>
							)}
							{status === 'stopped' && !blockedChapterId && !gate && (
								<button
									className={styles.primary}
									type="button"
									disabled={busy}
									onClick={() => void run('production.continue', { workId })}
								>
									{t('继续制作')}
								</button>
							)}
							{gate && (
								<Link className={styles.primary} to={workRoute(gate, workId)}>
									{gate === 'confirmVisual' ? t('选择主视觉') : t('确认第一章')}
								</Link>
							)}
						</div>
					</div>
					{chapters.length > 0 && (
						<progress
							className={styles.progress}
							aria-label={t('已发布章节进度')}
							value={published}
							max={chapters.length}
						/>
					)}
				</section>
				{flagged.length > 0 && (
					<ProductionNotice
						key={JSON.stringify([
							blockedChapterId,
							...flagged.map(({ chapterId, issue }) => [chapterId, issue]),
						])}
					>
						<p>{t('{{length}} 章需要处理', { length: flagged.length })}</p>
						{blockedChapterId && (
							<p>{t('制作已暂停，请在失败的章节中重试。')}</p>
						)}
					</ProductionNotice>
				)}
				<section className={styles.card} aria-labelledby="production-chapters">
					<h2 id="production-chapters">{t('章节制作')}</h2>
					{chapters.length ? (
						<ol className={styles.list}>
							{chapters.map((chapter) => (
								<ChapterRow key={chapter.chapterId} chapter={chapter} />
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
