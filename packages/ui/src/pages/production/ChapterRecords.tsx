import {
	type EventEnvelope,
	productionChapterRecordEvent,
} from '@novelive/creator/contract'
import { useEffect, useState } from 'react'
import { stepName } from './ChapterState'
import styles from './Production.module.css'

function chapterRecord(
	envelope: EventEnvelope,
	workId: string,
	chapterId: string,
) {
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

type Record = NonNullable<ReturnType<typeof chapterRecord>>

export function ChapterRecords({
	workId,
	chapterId,
}: {
	workId: string
	chapterId: string
}) {
	const [records, setRecords] = useState<Record[]>([])
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

	return (
		<section className={styles.records} aria-label="章节运行记录">
			{state === 'loading' && <p role="status">正在读取运行记录…</p>}
			{state === 'failed' && (
				<p role="alert">无法读取历史记录，请关闭后重试。</p>
			)}
			{state === 'gap' && <p role="status">部分较早的运行记录已不可用。</p>}
			{state === 'ready' && !records.length && <p>暂无运行记录</p>}
			<ol className={styles.list}>
				{records.map(({ seq, at, step, status, message, detail }) => (
					<li key={seq}>
						<strong>
							{stepName[step]} ·{' '}
							{{ running: '进行中', done: '完成', failed: '失败' }[status]}
						</strong>
						<time dateTime={at}>{new Date(at).toLocaleString('zh-CN')}</time>
						<p>{message}</p>
						{detail && (
							<details>
								<summary>详情</summary>
								<p>{detail}</p>
							</details>
						)}
					</li>
				))}
			</ol>
		</section>
	)
}
