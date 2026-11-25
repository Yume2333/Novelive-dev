import type { CommandOutput } from '@novelive/creator/contract'
import {
	ArrowUpRight,
	BarChart3,
	FileText,
	Image,
	type LucideIcon,
	Wallet,
} from 'lucide-react'
import {
	type ReactNode,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from 'react'
import { createPortal } from 'react-dom'
import { Card, SectionLabel } from '../../components/Card'
import { CompactSelect } from '../../components/Form'
import { InfoTooltip } from '../../components/InfoTooltip'
import { EmptyState, Page } from '../../components/Page'
import { msg, scoped } from '../../i18n'
import styles from './UsagePage.module.css'

const t = scoped('usage')

type UsageRecord = CommandOutput<'usage.list'>['records'][number]['usage']

type LibraryWork = CommandOutput<'library.list'>['works'][number]

const all = ''

const dayOf = (at: number) => new Date(at).toLocaleDateString('sv')

type Granularity = 'day' | 'month'

const phaseName: Record<string, string> = {
	import: msg('导入'),
	preview: msg('全书预览'),
	synthesize: msg('综合'),
	chat: msg('对话'),
	write: msg('写'),
	review: msg('审稿'),
	stage: msg('演出'),
	draw: msg('出图'),
}
const phaseLabel = (phase: string) =>
	phaseName[phase] ? t(phaseName[phase]) : phase

const money = (usd: number) =>
	usd.toLocaleString(undefined, {
		style: 'currency',
		currency: 'USD',
		maximumFractionDigits: usd > 0 && usd < 1 ? 4 : 2,
	})

interface UsageTotals {
	calls: number
	input: number
	output: number
	images: number
	cost: number | null
	unpriced: number
}

function totals(records: UsageRecord[]): UsageTotals {
	let input = 0
	let output = 0
	let images = 0
	let cost = 0
	let priced = 0
	for (const record of records) {
		if (record.kind === 'image') images += record.imageCount
		else {
			input += record.inputTokens
			output += record.outputTokens
		}
		if (record.costUsd !== null) {
			cost += record.costUsd
			priced++
		}
	}
	return {
		calls: records.length,
		input,
		output,
		images,
		cost: priced ? cost : null,
		unpriced: records.length - priced,
	}
}

function volumeTitleOf(work: LibraryWork): string | undefined {
	if ('project' in work && work.project && typeof work.project === 'object') {
		const volume = (work.project as Record<string, unknown>).volumeTitle
		if (typeof volume === 'string') return volume
	}
	return undefined
}

function Stat({
	icon: Icon,
	label,
	value,
	hint,
}: {
	icon: LucideIcon
	label: string
	value: string
	hint?: string
}) {
	return (
		<Card className={styles.stat}>
			<span className={styles.statLabel}>
				<Icon size={15} strokeWidth={1.8} aria-hidden="true" />
				<span className="label-caps label-caps-zh">{label}</span>
			</span>
			<div className={styles.statValue}>{value}</div>
			{hint && <div className={styles.statHint}>{hint}</div>}
		</Card>
	)
}

interface BarTip {
	/** 悬停/聚焦柱条的 key，用于 aria-describedby 与激活高亮 */
	day: string
	/** 锚点柱条元素：定位随滚动/缩放重算 */
	anchor: HTMLElement
	content: ReactNode
}

/** 图表玻璃提示卡：createPortal 挂到 body。
    外层定位壳只做 fixed 定位与水平 clamp（translate(-50%, -100%) 向上抬起），
    内层气泡负责 fade-up 入场动画 —— 二者严格分离（DESIGN.md）。 */
function BarTooltip({ tip, id }: { tip: BarTip; id: string }) {
	const shellRef = useRef<HTMLSpanElement>(null)

	useLayoutEffect(() => {
		const shell = shellRef.current
		if (!shell) return
		const place = () => {
			const rect = tip.anchor.getBoundingClientRect()
			const half = shell.offsetWidth / 2
			const center = rect.left + rect.width / 2
			const minX = 12 + half
			const maxX = window.innerWidth - 12 - half
			shell.style.left = `${
				minX > maxX
					? window.innerWidth / 2
					: Math.max(minX, Math.min(maxX, center))
			}px`
			shell.style.top = `${rect.top - 8}px`
		}
		place()
		window.addEventListener('resize', place)
		window.addEventListener('scroll', place, true)
		return () => {
			window.removeEventListener('resize', place)
			window.removeEventListener('scroll', place, true)
		}
	}, [tip])

	return createPortal(
		<span ref={shellRef} className={styles.tipShell}>
			<span className={styles.tipCard} role="tooltip" id={id}>
				{tip.content}
			</span>
		</span>,
		document.body,
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
	const [tip, setTip] = useState<BarTip | null>(null)
	const tooltipId = useId()
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
					for (const w of works)
						count.set(w.title, (count.get(w.title) ?? 0) + 1)
					setTitles(
						new Map(
							works.map((w) => {
								const volume = volumeTitleOf(w)
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
	const selectOptions = (
		pick: (record: UsageRecord) => string,
		label: string,
		name: (value: string) => string = (value) => value,
	) => [
		{ value: all, label },
		...[...new Set(records.map(pick))]
			.sort()
			.map((value) => ({ value, label: name(value) })),
	]
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
	const byWork = new Map<
		string,
		{ records: UsageRecord[]; phases: Map<string, UsageRecord[]> }
	>()
	for (const record of shown) {
		const period = periodOf(record.at)
		const rows = byPeriod.get(period)
		if (rows) rows.push(record)
		else byPeriod.set(period, [record])
		let work = byWork.get(record.link.workId)
		if (!work) {
			work = { records: [], phases: new Map() }
			byWork.set(record.link.workId, work)
		}
		work.records.push(record)
		const phaseRows = work.phases.get(record.phase)
		if (phaseRows) phaseRows.push(record)
		else work.phases.set(record.phase, [record])
	}
	const perDay = [...byPeriod]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([day, rows]) => ({ day, ...totals(rows) }))
	const labelEvery = Math.ceil(perDay.length / 16)
	const maxDay = Math.max(1, ...perDay.map(({ calls }) => calls))
	const works = [...byWork].sort(([a], [b]) => a.localeCompare(b))
	const phaseOrder = Object.keys(phaseName)
	const phases = [...new Set(shown.map((r) => r.phase))].sort(
		(a, b) => phaseOrder.indexOf(a) - phaseOrder.indexOf(b),
	)

	const showTip = (
		day: string,
		dayTotals: UsageTotals,
		target: HTMLElement,
	) => {
		setTip({
			day,
			anchor: target,
			content: (
				<>
					<span className={styles.tipTitle}>{day}</span>
					<span className={styles.tipLine}>
						{t('{{calls}} 次', {
							calls: dayTotals.calls.toLocaleString(),
						})}
						{' · '}
						{t('输入 {{input}} / 输出 {{output}}', {
							input: dayTotals.input.toLocaleString(),
							output: dayTotals.output.toLocaleString(),
						})}
						{dayTotals.images
							? t(' · {{images}} 张', {
									images: dayTotals.images.toLocaleString(),
								})
							: ''}
					</span>
					<span className={styles.tipCost}>
						{dayTotals.cost === null
							? t('暂无单价')
							: t('参考 {{cost}}', { cost: money(dayTotals.cost) })}
					</span>
				</>
			),
		})
	}
	const hideTip = (day: string) =>
		setTip((current) => (current?.day === day ? null : current))

	// 提示卡打开期间按 Escape 关闭（与控件库 Tooltip 一致）；
	// 数据刷新后锚点柱条已不在当前过滤结果中时一并收起
	const tipGone = tip !== null && !perDay.some((row) => row.day === tip.day)
	useEffect(() => {
		if (!tip) return
		if (tipGone) {
			setTip(null)
			return
		}
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setTip(null)
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [tip, tipGone])

	return (
		<Page
			title={t('用量统计')}
			actions={
				<CompactSelect<Granularity>
					aria-label={t('统计粒度')}
					options={[
						{ value: 'day', label: t('按天') },
						{ value: 'month', label: t('按月') },
					]}
					value={granularity}
					onChange={(value) => {
						setGranularity(value)
						setFrom('')
						setTo('')
					}}
				/>
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
							<CompactSelect
								aria-label={t('作品')}
								options={selectOptions(
									(r) => r.link.workId,
									t('全部作品'),
									titleOf,
								)}
								value={workId}
								onChange={setWorkId}
							/>
							<CompactSelect
								aria-label={t('阶段')}
								options={selectOptions(
									(r) => r.phase,
									t('全部阶段'),
									phaseLabel,
								)}
								value={phase}
								onChange={setPhase}
							/>
							<CompactSelect
								aria-label={t('模型')}
								options={selectOptions((r) => r.model, t('全部模型'))}
								value={model}
								onChange={setModel}
							/>
							<span className={styles.range}>
								<input
									type={granularity === 'month' ? 'month' : 'date'}
									className={`nl-input ${styles.rangeInput}`}
									aria-label={t('开始日期')}
									value={from || first}
									max={to || last || undefined}
									onChange={(event) => setFrom(event.target.value)}
								/>
								<span>{t('到')}</span>
								<input
									type={granularity === 'month' ? 'month' : 'date'}
									className={`nl-input ${styles.rangeInput}`}
									aria-label={t('结束日期')}
									value={to || last}
									min={from || first || undefined}
									onChange={(event) => setTo(event.target.value)}
								/>
							</span>
							<InfoTooltip
								label={t('用量说明')}
								text={t(
									'文本按 tokens，图片按张数；参考金额只计入有单价的调用，仅供参考，不设预算或自动停机。风格变更仅提示，不自动标记图片过期。',
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
										value={sum.calls.toLocaleString()}
									/>
									<Stat
										icon={FileText}
										label={t('文本 tokens')}
										value={(sum.input + sum.output).toLocaleString()}
										hint={t('输入 {{input}} / 输出 {{output}}', {
											input: sum.input.toLocaleString(),
											output: sum.output.toLocaleString(),
										})}
									/>
									<Stat
										icon={Image}
										label={t('图片')}
										value={t('{{images}} 张', {
											images: sum.images.toLocaleString(),
										})}
									/>
									<Stat
										icon={Wallet}
										label={t('参考金额')}
										value={sum.cost === null ? t('没有单价') : money(sum.cost)}
										hint={
											sum.cost !== null && sum.unpriced
												? t('部分调用拿不到单价，未计入')
												: undefined
										}
									/>
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
										{perDay.map((dayRow, index) => {
											const active = tip?.day === dayRow.day
											return (
												<button
													key={dayRow.day}
													type="button"
													className={
														active
															? `${styles.bar} ${styles.barActive}`
															: styles.bar
													}
													aria-label={t(
														'{{day}}：{{calls}} 次 · 输入 {{input}} / 输出 {{output}} · {{images}} 张图片',
														{
															day: dayRow.day,
															calls: dayRow.calls,
															input: dayRow.input,
															output: dayRow.output,
															images: dayRow.images,
														},
													)}
													aria-describedby={active ? tooltipId : undefined}
													onMouseEnter={(event) =>
														showTip(dayRow.day, dayRow, event.currentTarget)
													}
													onMouseLeave={() => hideTip(dayRow.day)}
													onFocus={(event) =>
														showTip(dayRow.day, dayRow, event.currentTarget)
													}
													onBlur={() => hideTip(dayRow.day)}
													onClick={(event) =>
														showTip(dayRow.day, dayRow, event.currentTarget)
													}
												>
													<span className={styles.barCalls}>
														{labelEvery > 1 ? '' : dayRow.calls}
													</span>
													<span className={styles.barTrack}>
														<span
															className={
																active
																	? `${styles.barFill} ${styles.barFillActive}`
																	: styles.barFill
															}
															style={{
																height: `${Math.max(4, (dayRow.calls / maxDay) * 100)}%`,
															}}
														/>
													</span>
													<time
														dateTime={dayRow.day}
														hidden={index % labelEvery !== 0}
													>
														{granularity === 'month'
															? dayRow.day
															: dayRow.day.slice(5).replace('-', '/')}
													</time>
												</button>
											)
										})}
									</div>
									{tip ? <BarTooltip tip={tip} id={tooltipId} /> : null}
								</Card>
								<Card className={styles.panel}>
									<SectionLabel>{t('按作品 × 阶段')}</SectionLabel>
									<table className={styles.table}>
										<thead>
											<tr>
												<th>{t('作品')}</th>
												{phases.map((p) => (
													<th key={p}>{phaseLabel(p)}</th>
												))}
												<th>{t('参考金额')}</th>
											</tr>
										</thead>
										<tbody>
											{works.map(([work, bucket]) => {
												const row = totals(bucket.records)
												return (
													<tr key={work} className="hover-row">
														<td>{titleOf(work)}</td>
														{phases.map((p) => {
															const cell = totals(bucket.phases.get(p) ?? [])
															return (
																<td key={p} data-label={phaseLabel(p)}>
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
														<td data-label={t('参考金额')}>
															{row.cost === null ? (
																<span className={styles.none}>
																	{t('没有单价')}
																</span>
															) : (
																money(row.cost)
															)}
														</td>
													</tr>
												)
											})}
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
														{record.link.volumeId} · {phaseLabel(record.phase)}
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
