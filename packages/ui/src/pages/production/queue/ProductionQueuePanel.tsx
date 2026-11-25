import { ArrowDown, ArrowUp, ChevronRight, Play, Square } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
	Button,
	GradientCover,
	IconButton,
	SectionLabel,
} from '../../../components'
import { scoped } from '../../../i18n'
import { workRoute } from '../../../routes/production'
import styles from './ProductionQueuePanel.module.css'

const t = scoped('production')

type WorkRow = { link: { workId: string }; title: string }
type InactiveRow = WorkRow & {
	status: 'awaiting_confirm' | 'paused' | 'done'
	reason?: string
}
type Props = {
	queue: { active: WorkRow | null; queued: WorkRow[]; inactive: InactiveRow[] }
	busy: boolean
	onMove(workId: string, direction: -1 | 1): void
	onContinue(workId: string): void
	onStop(workId: string): void
}

function pausedLabel(work: InactiveRow) {
	if (work.status === 'done') return t('已完成')
	if (work.status === 'awaiting_confirm')
		return work.reason === 'confirm_visual'
			? t('确认角色设定和主视觉')
			: t('第一章做好了，试玩后继续')
	switch (work.reason) {
		case 'confirm_visual':
			return t('待确认主视觉')
		case 'confirm_first':
			return t('待确认第一章')
		case 'chapter_failed':
			return t('章节需要处理')
		case 'image_unsupported':
			return t('出图需要处理')
		case 'budget_paused':
			return t('已暂停：模型预算不足')
		case 'crashed':
			return t('异常退出后已暂停')
		default:
			return t('已暂停')
	}
}

function confirmRoute(work: InactiveRow) {
	return work.reason === 'confirm_visual' ? 'confirmVisual' : 'confirmFirst'
}

function Cover({ workId }: { workId: string }) {
	return (
		<div className={styles.cover}>
			<GradientCover seed={workId} compact />
		</div>
	)
}

export function ProductionQueuePanel({
	queue,
	busy,
	onMove,
	onContinue,
	onStop,
}: Props) {
	const awaitingConfirm = queue.inactive.filter(
		(work) => work.status === 'awaiting_confirm',
	)
	const inactive = queue.inactive.filter(
		(work) => work.status !== 'awaiting_confirm',
	)
	const resumable = inactive.filter(
		(work) => work.status === 'paused' && work.reason !== 'chapter_failed',
	)
	const promoted =
		!queue.active && resumable.length > 0 ? resumable[0] : undefined
	return (
		<section className={styles.panel} aria-label={t('制作队列')}>
			{queue.active ? (
				<Button
					variant="danger"
					icon={Square}
					disabled={busy}
					onClick={() => queue.active && onStop(queue.active.link.workId)}
					className={styles.topAction}
				>
					{t('立即停止')}
				</Button>
			) : promoted ? (
				<Button
					variant="primary"
					icon={Play}
					disabled={busy}
					onClick={() => onContinue(promoted.link.workId)}
					className={styles.topAction}
				>
					{t('继续制作')}
				</Button>
			) : null}
			{(queue.active || queue.queued.length > 0) && (
				<section>
					<SectionLabel>{t('排队中')}</SectionLabel>
					<div className={styles.rows}>
						{queue.active && (
							<div className={`glass-panel ${styles.row}`}>
								<Cover workId={queue.active.link.workId} />
								<span className={styles.rowText}>
									<Link
										className={styles.rowLink}
										to={workRoute('production', queue.active.link.workId)}
									>
										<span className={styles.title}>{queue.active.title}</span>
									</Link>
									<span className={styles.status}>{t('正在制作')}</span>
								</span>
							</div>
						)}
						{queue.queued.length > 0 && (
							<ol className={styles.rows} aria-label={t('排队中')}>
								{queue.queued.map((work, index) => (
									<li
										className={`glass-panel ${styles.row}`}
										key={work.link.workId}
									>
										<Cover workId={work.link.workId} />
										<span className={styles.rowText}>
											<Link
												className={styles.rowLink}
												to={workRoute('production', work.link.workId)}
											>
												<span className={styles.title}>{work.title}</span>
											</Link>
											<span className={styles.status}>
												{t('排队中 · {{value}}', { value: index + 1 })}
											</span>
										</span>
										<IconButton
											icon={ArrowUp}
											label={t('提前：{{title}}', { title: work.title })}
											disabled={busy || index === 0}
											onClick={() => onMove(work.link.workId, -1)}
										/>
										<IconButton
											icon={ArrowDown}
											label={t('延后：{{title}}', { title: work.title })}
											disabled={busy || index === queue.queued.length - 1}
											onClick={() => onMove(work.link.workId, 1)}
										/>
									</li>
								))}
							</ol>
						)}
					</div>
				</section>
			)}
			{awaitingConfirm.length > 0 && (
				<section>
					<SectionLabel>{t('等你确认')}</SectionLabel>
					<ul className={styles.rows}>
						{awaitingConfirm.map((work) => (
							<li key={work.link.workId}>
								<Link
									className={`glass-panel ${styles.row}`}
									to={workRoute(confirmRoute(work), work.link.workId)}
								>
									<Cover workId={work.link.workId} />
									<span className={styles.rowText}>
										<span className={styles.title}>{work.title}</span>
										<span className={`${styles.status} ${styles.confirm}`}>
											{pausedLabel(work)}
										</span>
									</span>
									<ChevronRight
										size={18}
										strokeWidth={1.8}
										className={styles.chevron}
										aria-hidden="true"
									/>
								</Link>
							</li>
						))}
					</ul>
				</section>
			)}
			{inactive.length > 0 && (
				<section>
					<SectionLabel>{t('未在排队')}</SectionLabel>
					<ul className={styles.rows}>
						{inactive.map((work) => {
							const resumableRow =
								work.status === 'paused' &&
								work.reason !== 'chapter_failed' &&
								(queue.active !== null || resumable.length > 1)
							return (
								<li
									className={`glass-panel ${styles.row}`}
									key={work.link.workId}
								>
									<Cover workId={work.link.workId} />
									<span className={styles.rowText}>
										<Link
											className={styles.rowLink}
											to={workRoute('production', work.link.workId)}
										>
											<span className={styles.title}>{work.title}</span>
										</Link>
										<span className={styles.status}>{pausedLabel(work)}</span>
									</span>
									{resumableRow && (
										<Button
											variant="secondary"
											size="sm"
											disabled={busy}
											onClick={() => onContinue(work.link.workId)}
										>
											{t('继续制作')}
										</Button>
									)}
								</li>
							)
						})}
					</ul>
				</section>
			)}
			{!queue.active && !queue.queued.length && !queue.inactive.length && (
				<p className={styles.empty}>{t('暂无制作任务')}</p>
			)}
		</section>
	)
}
