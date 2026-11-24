import type { ProductionSnapshot } from '@novelive/creator/contract'
import { ChevronsUp, CircleStop, History, Play, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Chip, ProgressBar } from '../../components/Card'
import { Collapse } from '../../components/Collapse'
import { Page } from '../../components/Page'
import { msg, scoped } from '../../i18n'
import { workRoute } from '../../routes/production'
import { chapterTitle, useWorkProduction } from '../work/WorkProduction'
import { ChapterRecords } from './ChapterRecords'
import { ChapterState, stepName, stepProgress } from './ChapterState'
import styles from './Production.module.css'
import { ProductionNotice } from './ProductionNotice'

const t = scoped('production')

const workStatus = {
	idle: msg('空闲'),
	producing: msg('制作中'),
	stopped: msg('已停止'),
	confirm: msg('待确认'),
}

export const chapterIndex = (index: number) =>
	String(index + 1).padStart(2, '0')

function ChapterRow({
	chapter,
	index,
}: {
	chapter: ProductionSnapshot['chapters'][number]
	index: number
}) {
	const { snapshot, busy, run } = useWorkProduction()
	const { chapterId, issue, priority, status } = chapter
	const { workId, blockedChapterId, phase } = snapshot
	const [showRecords, setShowRecords] = useState(false)
	const title = chapterTitle(snapshot, chapterId)

	return (
		<li aria-label={title}>
			<div className={styles.chapterRow}>
				<span className={styles.index}>{chapterIndex(index)}</span>
				<span className={styles.name}>{title}</span>
				{priority && status === 'waiting' && (
					<Chip>
						<ChevronsUp aria-hidden="true" size={12} />
						{t('已优先')}
					</Chip>
				)}
				<span className={styles.spacer} />
				{status === 'producing' && (
					<span className={styles.stepBar}>
						<ProgressBar value={stepProgress(chapter)} height={4} />
					</span>
				)}
				<ChapterState chapter={chapter} />
				<span className={styles.rowActions} data-expanded={showRecords}>
					{status === 'published' && (
						<Link className={styles.ghost} to={workRoute('play', workId)}>
							<Play aria-hidden="true" size={14} />
							{t('游玩')}
						</Link>
					)}
					{blockedChapterId === chapterId && (
						<button
							className={styles.ghost}
							type="button"
							disabled={busy}
							onClick={() =>
								void run('production.retryChapter', { workId, chapterId })
							}
						>
							<RotateCcw size={14} aria-hidden="true" />
							{t('重试')}
						</button>
					)}
					{phase === 'producing' &&
						status === 'waiting' &&
						!priority &&
						blockedChapterId !== chapterId && (
							<button
								className={styles.ghost}
								type="button"
								disabled={busy}
								onClick={() =>
									void run('production.prioritizeChapter', {
										workId,
										chapterId,
									})
								}
							>
								<ChevronsUp size={14} aria-hidden="true" />
								{t('优先制作')}
							</button>
						)}
					<button
						className={styles.ghost}
						type="button"
						aria-expanded={showRecords}
						onClick={() => setShowRecords((open) => !open)}
					>
						<History size={14} aria-hidden="true" />
						{t('运行记录')}
					</button>
				</span>
			</div>
			{issue && !showRecords && (
				<p className={`${styles.muted} ${styles.recordsSlot}`}>{issue}</p>
			)}
			<Collapse open={showRecords}>
				{showRecords && (
					<div className={styles.recordsSlot}>
						{issue && <p className={styles.muted}>{issue}</p>}
						<ChapterRecords workId={workId} chapterId={chapterId} />
					</div>
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
	const current = chapters.findIndex(
		(chapter) => chapter.status === 'producing',
	)
	const producing = chapters[current]
	const gate =
		phase === 'confirm-visual'
			? 'confirmVisual'
			: phase === 'confirm-first'
				? 'confirmFirst'
				: undefined
	const running = status === 'producing'

	return (
		<Page
			eyebrow={snapshot.title}
			title={t('制作')}
			actions={
				<div className={styles.actions}>
					{running && (
						<button
							className={styles.danger}
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
							<Play size={16} aria-hidden="true" />
							{t('继续制作')}
						</button>
					)}
					{gate && (
						<Link className={styles.primary} to={workRoute(gate, workId)}>
							{gate === 'confirmVisual' ? t('选择主视觉') : t('确认第一章')}
						</Link>
					)}
				</div>
			}
		>
			<div className={styles.flow}>
				{flagged.length > 0 && (
					<ProductionNotice
						kind="warning"
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
				<section
					className={`${styles.panel} ${styles.panelBody}`}
					aria-label={t('制作状态')}
				>
					<div className={styles.statusGrid}>
						<div>
							<p className={styles.sectionLabel}>
								{current === -1 ? t('作品进度') : t('当前章节')}
							</p>
							<h2 className={styles.headline}>
								{producing?.status !== 'producing'
									? published === chapters.length && chapters.length
										? t('全部章节已发布')
										: t('等待下一个章节')
									: `${chapterIndex(current)} · ${chapterTitle(snapshot, producing.chapterId)} · ${t(stepName[producing.step])}`}
							</h2>
							{chapters.length > 0 && (
								<ProgressBar
									value={published / chapters.length}
									label={t('已发布章节进度')}
								/>
							)}
							<span className={styles.muted}>
								{t('已发布 {{published}} / {{length}} 章', {
									published,
									length: chapters.length,
								})}
							</span>
						</div>
						<Chip active={running}>{t(workStatus[status])}</Chip>
					</div>
				</section>
				<h2 className={styles.sectionLabel} id="production-chapters">
					{t('章节')}
				</h2>
				<section className={styles.panel} aria-labelledby="production-chapters">
					{chapters.length ? (
						<ol className={styles.rows}>
							{chapters.map((chapter, index) => (
								<ChapterRow
									key={chapter.chapterId}
									chapter={chapter}
									index={index}
								/>
							))}
						</ol>
					) : (
						<p className={`${styles.muted} ${styles.panelBody}`}>
							{t('暂无章节')}
						</p>
					)}
				</section>
			</div>
		</Page>
	)
}
