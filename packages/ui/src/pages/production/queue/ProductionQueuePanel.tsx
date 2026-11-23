import { ArrowDown, ArrowUp } from 'lucide-react'
import { useId } from 'react'
import { Link } from 'react-router-dom'
import { workRoute } from '../../../routes/production'
import styles from '../Production.module.css'
import queueStyles from './ProductionQueuePanel.module.css'

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
	if (work.status === 'done') return '已完成'
	switch (work.reason) {
		case 'confirm_visual':
			return '待确认主视觉'
		case 'confirm_first':
			return '待确认第一章'
		case 'chapter_failed':
			return '章节需要处理'
		case 'image_unsupported':
			return '出图需要处理'
		case 'crashed':
			return '异常退出后已暂停'
		default:
			return '已暂停'
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
			<h2 id={heading}>制作队列</h2>
			{!queue.active && !queue.queued.length && !queue.inactive.length && (
				<p className={styles.lead}>暂无制作任务</p>
			)}
			{queue.active && (
				<div className={`${styles.row} ${queueStyles.row}`}>
					<WorkLink work={queue.active} label="制作中" />
					<button
						className={`${styles.button} ${queueStyles.actions}`}
						type="button"
						disabled={busy}
						onClick={() => queue.active && onStop(queue.active.link.workId)}
					>
						立即停止
					</button>
				</div>
			)}
			{queue.queued.length > 0 && (
				<ol className={styles.list} aria-label="排队中">
					{queue.queued.map((work, index) => (
						<li
							className={`${styles.row} ${queueStyles.row}`}
							key={work.link.workId}
						>
							<WorkLink work={work} label={`排队中 · ${index + 1}`} />
							<div className={`${styles.actions} ${queueStyles.actions}`}>
								<button
									className={styles.button}
									type="button"
									aria-label={`提前：${work.title}`}
									disabled={busy || index === 0}
									onClick={() => onMove(work.link.workId, -1)}
								>
									<ArrowUp aria-hidden="true" size={16} />
								</button>
								<button
									className={styles.button}
									type="button"
									aria-label={`延后：${work.title}`}
									disabled={busy || index === queue.queued.length - 1}
									onClick={() => onMove(work.link.workId, 1)}
								>
									<ArrowDown aria-hidden="true" size={16} />
								</button>
							</div>
						</li>
					))}
				</ol>
			)}
			{queue.inactive.length > 0 && (
				<ul className={styles.list} aria-label="未在排队">
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
								<button
									className={`${styles.button} ${queueStyles.actions}`}
									type="button"
									disabled={busy}
									onClick={() => onContinue(work.link.workId)}
								>
									继续制作
								</button>
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
