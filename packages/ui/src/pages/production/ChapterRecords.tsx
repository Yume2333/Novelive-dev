import {
	type EventEnvelope,
	type IssueKind,
	type ProductionSnapshot,
	productionChapterRecordEvent,
} from '@novelive/creator/contract'
import { ChevronDown, CircleCheck, CircleX, Clock, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Collapse, Drawer, EmptyState, Spinner } from '../../components'
import { formatErrorText, humanizeError } from '../../format/errors'
import { scoped } from '../../i18n'
import { stepName, steps } from './ChapterState'
import styles from './Production.module.css'

const t = scoped('production')

/** 一条章节运行记录：production.chapterRecord 事件载荷加上事件信封的序号与时间 */
interface ChapterRunRecord {
	workId: string
	chapterId: string
	step: 'write' | 'review' | 'stage' | 'draw'
	status: 'running' | 'done' | 'failed' | 'cancelled'
	errorKind?: IssueKind
	detail?: string
	seq: number
	at: string
}

function chapterRecord(
	envelope: EventEnvelope,
	workId: string,
	chapterId: string,
): ChapterRunRecord | undefined {
	const { event, seq, at } = envelope
	if (
		envelope.scope !== 'work' ||
		envelope.scopeId !== workId ||
		!productionChapterRecordEvent.check(event) ||
		event.payload.workId !== workId ||
		event.payload.chapterId !== chapterId
	)
		return
	return { ...event.payload, seq, at }
}

const recordStatus = {
	running: { tone: 'running', label: () => t('进行中') },
	done: { tone: 'done', label: () => t('完成') },
	failed: { tone: 'failed', label: () => t('失败') },
	cancelled: { tone: 'cancelled', label: () => t('已取消') },
} as const

function StatusMark({ status }: { status: ChapterRunRecord['status'] }) {
	const meta = recordStatus[status]
	return (
		<span className={styles.recordStatus} data-tone={meta.tone}>
			{status === 'running' ? (
				<Spinner size={12} />
			) : status === 'done' ? (
				<CircleCheck aria-hidden="true" size={12} strokeWidth={1.8} />
			) : status === 'failed' ? (
				<CircleX aria-hidden="true" size={12} strokeWidth={1.8} />
			) : (
				<XCircle aria-hidden="true" size={12} strokeWidth={1.8} />
			)}
			<span className={status === 'running' ? 'ink-shimmer' : undefined}>
				{meta.label()}
			</span>
		</span>
	)
}

function RecordCard({ record }: { record: ChapterRunRecord }) {
	const [open, setOpen] = useState(false)
	return (
		<li className={`glass-panel ${styles.recordCard}`}>
			<div className={styles.recordCardMain}>
				<span className={styles.recordMessage}>
					{record.errorKind
						? `${t(stepName[record.step])} · ${formatErrorText(
								humanizeError({
									kind: record.errorKind,
									detail: record.detail,
								}),
							)}`
						: `${t(stepName[record.step])} · ${recordStatus[record.status].label()}`}
				</span>
				{record.detail ? (
					<button
						type="button"
						className={styles.recordDetailToggle}
						aria-expanded={open}
						onClick={() => setOpen((value) => !value)}
					>
						{t('详情')}
						<ChevronDown
							aria-hidden="true"
							size={12}
							className="nl-chevron"
							data-open={open ? 'true' : 'false'}
						/>
					</button>
				) : null}
				<time className={styles.recordTime} dateTime={record.at}>
					{new Date(record.at).toLocaleString()}
				</time>
			</div>
			{record.detail ? (
				<Collapse open={open}>
					<div className={styles.recordDetail}>
						<p>{record.detail}</p>
					</div>
				</Collapse>
			) : null}
		</li>
	)
}

function Records({ workId, chapterId }: { workId: string; chapterId: string }) {
	const [records, setRecords] = useState<ChapterRunRecord[]>([])
	const [state, setState] = useState<'loading' | 'ready' | 'gap' | 'failed'>(
		'loading',
	)
	useEffect(() => {
		let active = true
		function merge(events: EventEnvelope[]) {
			const entries = events.flatMap((envelope) => {
				const record = chapterRecord(envelope, workId, chapterId)
				return record ? [record] : []
			})
			if (entries.length)
				setRecords((previous) => {
					const bySeq = new Map(
						[...entries, ...previous].map((record) => [record.seq, record]),
					)
					return [...bySeq.values()].sort((a, b) => a.seq - b.seq)
				})
		}
		const unsubscribe = window.novelive.on('event', (event) => merge([event]))
		const load = window.novelive.call('events.list', {
			scope: 'work',
			scopeId: workId,
			afterSeq: 0,
		})
		void load.promise.then(
			({ events, gap }) => {
				if (!active) return
				merge(events)
				setState(gap ? 'gap' : 'ready')
			},
			() => {
				if (active) setState('failed')
			},
		)
		return () => {
			active = false
			unsubscribe()
			load.cancel()
		}
	}, [workId, chapterId])

	const byStep = steps
		.map((step) => ({
			step,
			entries: records.filter((record) => record.step === step),
		}))
		.filter(({ entries }) => entries.length > 0)

	const empty = state !== 'loading' && state !== 'failed' && !records.length
	return (
		<>
			{state === 'loading' && (
				<p className={styles.recordNotice} role="status">
					{t('正在读取运行记录…')}
				</p>
			)}
			{state === 'failed' && (
				<p className={styles.recordNotice} role="alert">
					{t('无法读取历史记录，请关闭后重试。')}
				</p>
			)}
			{state === 'gap' && !empty && (
				<p className={styles.recordNotice} role="status">
					{t('部分较早的运行记录已不可用。')}
				</p>
			)}
			{empty ? (
				<EmptyState
					icon={Clock}
					title={t('尚未开始制作')}
					text={t(
						'排到本章后，写手、审稿、演出和出图的运行记录会实时显示在这里。',
					)}
				/>
			) : null}
			<div className={styles.recordSteps}>
				{byStep.map(({ step, entries }) => {
					const latest = entries[entries.length - 1]
					return (
						<section className={styles.recordStep} key={step}>
							<div className={styles.recordHead}>
								<span className={`glass-panel ${styles.recordIndex}`}>
									{steps.indexOf(step) + 1}
								</span>
								<span className={styles.recordStepName}>
									{t(stepName[step])}
								</span>
								<StatusMark status={latest.status} />
								<span className={styles.recordRule} />
							</div>
							<ol className={styles.recordCards}>
								{entries.map((record) => (
									<RecordCard key={record.seq} record={record} />
								))}
							</ol>
						</section>
					)
				})}
			</div>
		</>
	)
}

/**
 * 一章的制作运行记录抽屉：写 → 审稿 → 演出 → 出图分段，
 * 与 Agent 面板同一套视觉（编号玻璃分节、状态标记、可折叠详情卡），全部只读。
 */
export function ChapterRecords({
	workId,
	chapter,
	title,
	open,
	onClose,
}: {
	workId: string
	chapter: ProductionSnapshot['chapters'][number] | undefined
	title: string
	open: boolean
	onClose: () => void
}) {
	const chapterId = chapter?.chapterId ?? ''
	return (
		<Drawer
			open={open}
			title={t('运行记录 · {{title}}', { title })}
			onClose={onClose}
			width={520}
		>
			<section aria-label={t('章节运行记录')}>
				{open && chapter ? (
					<Records key={chapterId} workId={workId} chapterId={chapterId} />
				) : null}
			</section>
		</Drawer>
	)
}
