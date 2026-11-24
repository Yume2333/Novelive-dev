import type { CommandOutput } from '@novelive/creator/contract'
import {
	ArrowUpRight,
	BarChart3,
	FileText,
	Image,
	type LucideIcon,
	MessageSquareText,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Card, SectionLabel } from '../../components/Card'
import { InfoTooltip } from '../../components/InfoTooltip'
import { EmptyState, Page } from '../../components/Page'
import { scoped } from '../../i18n'
import { Select } from '../settings/ModelFields'
import styles from './UsagePage.module.css'

const t = scoped('usage')

type UsageRecord = CommandOutput<'usage.list'>['records'][number]['usage']

const all = ''

const dayOf = (at: number) => new Date(at).toLocaleDateString('sv')

type Granularity = 'day' | 'month'

function totals(records: UsageRecord[]) {
	let input = 0
	let output = 0
	let images = 0
	for (const record of records)
		if (record.kind === 'image') images += record.imageCount
		else {
			input += record.inputTokens
			output += record.outputTokens
		}
	return { calls: records.length, input, output, images }
}

function Stat({
	icon: Icon,
	label,
	value,
}: {
	icon: LucideIcon
	label: string
	value: number
}) {
	return (
		<Card className={styles.stat}>
			<span className={styles.statLabel}>
				<Icon size={15} aria-hidden="true" />
				<span className="label-caps label-caps-zh">{label}</span>
			</span>
			<strong className={styles.statValue}>{value.toLocaleString()}</strong>
		</Card>
	)
}

export function UsagePage() {
	const [granularity, setGranularity] = useState<Granularity>('day')
	const [from, setFrom] = useState('')
	const [to, setTo] = useState('')
	const [data, setData] = useState<CommandOutput<'usage.list'>>()
	const [error, setError] = useState('')
	const [workId, setWorkId] = useState(all)
	const [phase, setPhase] = useState(all)
	const [model, setModel] = useState(all)
	const [titles, setTitles] = useState(new Map<string, string>())
	useEffect(() => {
		let active = true
		let request:
			| ReturnType<typeof window.novelive.call<'usage.list'>>
			| undefined
		function load() {
			request?.cancel()
			request = window.novelive.call('usage.list', {})
			request.promise.then(
				(value) => {
					if (active) {
						setData(value)
						setError('')
					}
				},
				() => {
					if (active) setError(t('无法读取用量记录'))
				},
			)
		}
		const off = window.novelive.on('creator.ready', () => {
			load()
			loadTitles()
		})
		function loadTitles() {
			window.novelive.call('library.list', {}).promise.then(
				({ works }) => {
					if (!active) return
					const count = new Map<string, number>()
					for (const w of works) count.set(w.title, (count.get(w.title) ?? 0) + 1)
					setTitles(
						new Map(
							works.map((w) => {
								const volume = (w as { project?: { volumeTitle?: string } })
									.project?.volumeTitle
								return [
									w.workId,
									(count.get(w.title) ?? 0) > 1 && volume
										? `${w.title} · ${volume}`
										: w.title,
								]
							}),
						),
					)
				},
				() => {},
			)
		}
		load()
		loadTitles()
		return () => {
			active = false
			off()
			request?.cancel()
		}
	}, [])
	const records = useMemo(
		() => data?.records.map(({ usage }) => usage) ?? [],
		[data],
	)
	const titleOf = (workId: string) => titles.get(workId) ?? workId
	const options = (
		pick: (record: UsageRecord) => string,
		label: string,
		name: (value: string) => string = (value) => value,
	) =>
		[
			[all, label] as const,
			...[...new Set(records.map(pick))]
				.sort()
				.map((v) => [v, name(v)] as const),
		] as const
	const periodOf = (at: number) =>
		granularity === 'month' ? dayOf(at).slice(0, 7) : dayOf(at)
	const periods = records.map((r) => periodOf(r.at)).sort()
	const first = periods[0] ?? ''
	const last = periods.at(-1) ?? ''
	const shown = records.filter((record) => {
		const period = periodOf(record.at)
		return (
			(!workId || record.link.workId === workId) &&
			(!phase || record.phase === phase) &&
			(!model || record.model === model) &&
			(!from || period >= from) &&
			(!to || period <= to)
		)
	})
	const sum = totals(shown)
	const shownSet = new Set(shown)
	const byPeriod = new Map<string, UsageRecord[]>()
	for (const record of shown) {
		const period = periodOf(record.at)
		const rows = byPeriod.get(period)
		if (rows) rows.push(record)
		else byPeriod.set(period, [record])
	}
	const perDay = [...byPeriod]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([day, rows]) => ({ day, ...totals(rows) }))
	const labelEvery = Math.ceil(perDay.length / 16)
	const maxDay = Math.max(1, ...perDay.map(({ calls }) => calls))
	const works = [...new Set(shown.map((r) => r.link.workId))].sort()
	const phases = [...new Set(shown.map((r) => r.phase))].sort()
	return (
		<Page
			title={t('用量统计')}
			actions={
				<span className={styles.granularity}>
					<Select<Granularity>
						label={t('统计粒度')}
						options={[
							['day', t('按天')],
							['month', t('按月')],
						]}
						value={granularity}
						onChange={(value) => {
							setGranularity(value)
							setFrom('')
							setTo('')
						}}
					/>
				</span>
			}
		>
			<div className={styles.content}>
				{error && <p role="alert">{error}</p>}
				{!data && !error && <p role="status">{t('正在读取用量')}</p>}
				{data && (
					<>
						{data.unreadableProjects.length > 0 && (
							<section role="alert" aria-label={t('部分项目无法读取')}>
								<h2>{t('部分项目无法读取')}</h2>
								<p>{t('以下项目未计入统计，其他项目的记录仍然显示。')}</p>
								<ul>
									{data.unreadableProjects.map((project) => (
										<li key={project.projectId}>
											{t('{{projectId}}：{{reason}}', {
												projectId: project.projectId,
												reason: project.reason,
											})}
										</li>
									))}
								</ul>
							</section>
						)}
						<div className={styles.filters}>
							<Select<string>
								label={t('作品')}
								options={options((r) => r.link.workId, t('全部作品'), titleOf)}
								value={workId}
								onChange={setWorkId}
							/>
							<Select<string>
								label={t('阶段')}
								options={options((r) => r.phase, t('全部阶段'))}
								value={phase}
								onChange={setPhase}
							/>
							<Select<string>
								label={t('模型')}
								options={options((r) => r.model, t('全部模型'))}
								value={model}
								onChange={setModel}
							/>
							<span className={styles.range}>
								<input
									type={granularity === 'month' ? 'month' : 'date'}
									aria-label={t('开始日期')}
									value={from || first}
									max={to || last || undefined}
									onChange={(event) => setFrom(event.target.value)}
								/>
								<span>{t('到')}</span>
								<input
									type={granularity === 'month' ? 'month' : 'date'}
									aria-label={t('结束日期')}
									value={to || last}
									min={from || first || undefined}
									onChange={(event) => setTo(event.target.value)}
								/>
							</span>
							<InfoTooltip
								label={t('用量说明')}
								text={t(
									'仅供参考，统计已发生的调用；不估算费用，不设预算或自动停机。风格变更仅提示，不自动标记图片过期。',
								)}
							/>
						</div>
						{!shown.length ? (
							<EmptyState
								icon={BarChart3}
								title={t('暂无用量记录')}
								text={t('换个过滤条件试试。')}
								card
							/>
						) : (
							<>
								<div className={styles.totals}>
									<Stat
										icon={ArrowUpRight}
										label={t('调用次数')}
										value={sum.calls}
									/>
									<Stat
										icon={MessageSquareText}
										label={t('文本输入 tokens')}
										value={sum.input}
									/>
									<Stat
										icon={FileText}
										label={t('文本输出 tokens')}
										value={sum.output}
									/>
									<Stat icon={Image} label={t('图片数量')} value={sum.images} />
								</div>
								<Card className={styles.panel}>
									<SectionLabel>
										{granularity === 'month'
											? t('各月调用量')
											: t('各天调用量')}
									</SectionLabel>
									<div
										className={
											labelEvery > 1
												? `${styles.chart} ${styles.dense}`
												: styles.chart
										}
									>
										{perDay.map(
											({ day, calls, input, output, images }, index) => (
												<div
													key={day}
													className={styles.bar}
													title={t(
														'{{day}}：{{calls}} 次 · 输入 {{input}} / 输出 {{output}} · {{images}} 张图片',
														{
															day,
															calls,
															input,
															output,
															images,
														},
													)}
												>
													<span>{labelEvery > 1 ? '' : calls}</span>
													<span className={styles.barTrack}>
														<span
															className={styles.barFill}
															style={{
																height: `${Math.max(4, (calls / maxDay) * 100)}%`,
															}}
														/>
													</span>
													<time
														dateTime={day}
														hidden={index % labelEvery !== 0}
													>
														{granularity === 'month'
															? day
															: day.slice(5).replace('-', '/')}
													</time>
												</div>
											),
										)}
									</div>
								</Card>
								<Card className={styles.panel}>
									<SectionLabel>{t('按作品 × 阶段')}</SectionLabel>
									<table className={styles.table}>
										<thead>
											<tr>
												<th>{t('作品')}</th>
												{phases.map((p) => (
													<th key={p}>{p}</th>
												))}
											</tr>
										</thead>
										<tbody>
											{works.map((work) => (
												<tr key={work} className="hover-row">
													<td>{titleOf(work)}</td>
													{phases.map((p) => {
														const cell = totals(
															shown.filter(
																(r) => r.link.workId === work && r.phase === p,
															),
														)
														return (
															<td key={p}>
																{cell.calls ? (
																	t('{{calls}} 次', { calls: cell.calls }) +
																	(cell.images
																		? t(' · {{images}} 张', {
																				images: cell.images,
																			})
																		: '')
																) : (
																	<span className={styles.none}>—</span>
																)}
															</td>
														)
													})}
												</tr>
											))}
										</tbody>
									</table>
								</Card>
								<Card
									className={styles.panel}
									role="region"
									aria-label={t('已发生用量')}
								>
									<SectionLabel>{t('已发生用量')}</SectionLabel>
									<ul className={styles.list}>
										{data.records
											.filter(({ usage }) => shownSet.has(usage))
											.map(({ id, usage: record }) => (
												<li className={styles.row} key={id}>
													<strong>{record.model}</strong>
													<span>
														{titleOf(record.link.workId)} ·{' '}
														{record.link.volumeId} · {record.phase}
													</span>
													<span>
														{record.kind === 'image'
															? t('{{imageCount}} 张图片', {
																	imageCount: record.imageCount,
																})
															: t(
																	'输入 {{inputTokens}} / 输出 {{outputTokens}} · 缓存读取 {{cacheReadTokens}} / 写入 {{cacheWriteTokens}}',
																	{
																		inputTokens: record.inputTokens,
																		outputTokens: record.outputTokens,
																		cacheReadTokens: record.cacheReadTokens,
																		cacheWriteTokens: record.cacheWriteTokens,
																	},
																)}
													</span>
													<time>{new Date(record.at).toLocaleString()}</time>
												</li>
											))}
									</ul>
								</Card>
							</>
						)}
						<Card
							className={styles.panel}
							role="region"
							aria-label={t('过期素材')}
						>
							<SectionLabel>{t('过期素材')}</SectionLabel>
							{!data.staleAssets.length ? (
								<p>{t('暂无过期素材')}</p>
							) : (
								<ul className={styles.list}>
									{data.staleAssets.map((asset) => (
										<li
											className={styles.row}
											key={`${asset.workId}/${asset.assetKey}`}
										>
											<span>{asset.assetKey}</span>
											<span>{asset.workId}</span>
										</li>
									))}
								</ul>
							)}
						</Card>
					</>
				)}
			</div>
		</Page>
	)
}
