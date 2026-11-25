import { ArrowDown, ArrowUp } from 'lucide-react'
import { useId } from 'react'
import { Link } from 'react-router-dom'
import { Button, IconButton } from '../../../components'
import { scoped } from '../../../i18n'
import { workRoute } from '../../../routes/production'
import styles from '../Production.module.css'
import queueStyles from './ProductionQueuePanel.module.css'

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

function inactiveLabel(work: InactiveRow) {
	if (work.status === 'done') return t('已完成')
	if (work.status === 'awaiting_confirm')
		return work.reason === 'confirm_visual'
			? t('待确认主视觉')
			: t('待确认第一章')
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

export function ProductionQueuePanel({
	queue,
	busy,
	onMove,
	onContinue,
	onStop,
}: Props) {
	const heading = useId()
	return (
		<section
			className={`${styles.card} ${queueStyles.panel}`}
			aria-labelledby={heading}
		>
			<h2 id={heading}>{t('制作队列')}</h2>
			{!queue.active && !queue.queued.length && !queue.inactive.length && (
				<p className={styles.lead}>{t('暂无制作任务')}</p>
			)}
			{queue.active && (
				<div className={`${styles.row} ${queueStyles.row}`}>
					<WorkLink work={queue.active} label={t('制作中')} />
					<span className={queueStyles.actions}>
						<Button
							variant="danger"
							size="sm"
							disabled={busy}
							onClick={() => queue.active && onStop(queue.active.link.workId)}
						>
							{t('立即停止')}
						</Button>
					</span>
				</div>
			)}
			{queue.queued.length > 0 && (
				<ol className={styles.list} aria-label={t('排队中')}>
					{queue.queued.map((work, index) => (
						<li
							className={`${styles.row} ${queueStyles.row}`}
							key={work.link.workId}
						>
							<WorkLink
								work={work}
								label={t('排队中 · {{value}}', { value: index + 1 })}
							/>
							<div className={`${styles.actions} ${queueStyles.actions}`}>
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
							</div>
						</li>
					))}
				</ol>
			)}
			{queue.inactive.length > 0 && (
				<ul className={styles.list} aria-label={t('未在排队')}>
					{queue.inactive.map((work) => (
						<li
							className={`${styles.row} ${queueStyles.row}`}
							key={work.link.workId}
						>
							<WorkLink
								work={work}
								label={inactiveLabel(work)}
								route={
									work.status !== 'awaiting_confirm'
										? 'production'
										: work.reason === 'confirm_visual'
											? 'confirmVisual'
											: 'confirmFirst'
								}
							/>
							{work.status === 'paused' && work.reason !== 'chapter_failed' && (
								<span className={queueStyles.actions}>
									<Button
										variant="secondary"
										size="sm"
										disabled={busy}
										onClick={() => onContinue(work.link.workId)}
									>
										{t('继续制作')}
									</Button>
								</span>
							)}
						</li>
					))}
				</ul>
			)}
		</section>
	)
}

function WorkLink({
	work,
	label,
	route = 'production',
}: {
	work: WorkRow
	label: string
	route?: 'production' | 'confirmVisual' | 'confirmFirst'
}) {
	return (
		<div className={styles.actions}>
			<Link to={workRoute(route, work.link.workId)}>{work.title}</Link>
			<span className={styles.badge}>{label}</span>
		</div>
	)
}
