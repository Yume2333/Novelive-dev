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
import { Banner } from '../../components/Extended'
import { Details, ErrorNotice, LoadingState } from '../../components/Feedback'
import { CompactSelect } from '../../components/Form'
import { InfoTooltip } from '../../components/InfoTooltip'
import { EmptyState, Page } from '../../components/Page'
import { formatCost } from '../../format/cost'
import { formatErrorText, humanizeError } from '../../format/errors'
import { formatWorkTitle, workTitlesFromList } from '../../format/work'
import { i18n, msg, scoped } from '../../i18n'
import styles from './UsagePage.module.css'

const t = scoped('usage')

type UsageRecord = CommandOutput<'usage.list'>['records'][number]['usage']

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

interface UsageTotals {
	calls: number
	input: number
	output: number
	cacheRead: number
	cacheWrite: number
	images: number
	cost: number | null
	unpriced: number
}

function totals(records: UsageRecord[]): UsageTotals {
	let input = 0
	let output = 0
	let cacheRead = 0
	let cacheWrite = 0
	let images = 0
	let cost = 0
	let priced = 0
	for (const record of records) {
		if (record.kind === 'image') images += record.imageCount
		else {
			input += record.inputTokens
			output += record.outputTokens
			cacheRead += record.cacheReadTokens
			cacheWrite += record.cacheWriteTokens
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
		cacheRead,
		cacheWrite,
		images,
		cost: priced ? cost : null,
		unpriced: records.length - priced,
	}
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

/** 汇总表的数字列：零值用安静的 —，表头/单元格文案一致（窄屏折叠时靠 data-label 回放） */
function AggregateTable({
	leadHeader,
	quietLead,
	rows,
}: {
	leadHeader: string
	/** 模型列等次级信息：不加粗、安静呈现（L11） */
	quietLead?: boolean
	rows: { key: string; label: string; dateTime?: string; totals: UsageTotals }[]
}) {
	const headers = [
		t('调用次数'),
		t('输入'),
		t('输出'),
		t('缓存命中'),
		t('缓存写入'),
		t('图片'),
		t('参考金额'),
	]
	const numeric = (row: UsageTotals) => [
		row.calls,
		row.input,
		row.output,
		row.cacheRead,
		row.cacheWrite,
		row.images,
	]
	return (
		<table className={styles.table}>
			<thead>
				<tr>
					<th>{leadHeader}</th>
					{headers.map((header) => (
						<th key={header}>{header}</th>
					))}
				</tr>
			</thead>
			<tbody>
				{rows.map((row) => (
					<tr key={row.key} className="hover-row">
						<td className={quietLead ? styles.quietLead : undefined}>
							{row.dateTime ? (
								<time dateTime={row.dateTime}>{row.label}</time>
							) : (
								row.label
							)}
						</td>
						{numeric(row.totals).map((value, index) => (
							<td key={headers[index]} data-label={headers[index]}>
								{value ? (
									value.toLocaleString(i18n.language)
								) : (
									<span className={styles.none}>—</span>
								)}
							</td>
						))}
						<td data-label={t('参考金额')}>
							{row.totals.cost === null ? (
								<span className={styles.none}>{t('没有单价')}</span>
							) : (
								formatCost(row.totals.cost)
							)}
						</td>
					</tr>
				))}
			</tbody>
		</table>
	)
}

/** 本地化日期显示：zh-CN/ja 取 Intl 短格式（如 2026/3/4），month 粒度只有年、月两段。 */
function formatPeriodDisplay(value: string, granularity: Granularity): string {
	const [year, month, day] = value.split('-').map(Number)
	if (!year || !month) return value
	return new Intl.DateTimeFormat(i18n.language, {
		year: 'numeric',
		month: granularity === 'month' ? 'long' : 'numeric',
		...(granularity === 'day' ? { day: 'numeric' } : {}),
		timeZone: 'UTC',
	}).format(new Date(Date.UTC(year, month - 1, day || 1)))
}

/** 柱状图轴标签：day 粒度用本地化月/日短格式（zh 3/4、en 3/4 顺序随 locale），
    month 粒度用本地化年月。 */
function formatAxisLabel(period: string, granularity: Granularity): string {
	if (granularity === 'month') return formatPeriodDisplay(period, granularity)
	const [year, month, day] = period.split('-').map(Number)
	return new Intl.DateTimeFormat(i18n.language, {
		month: 'numeric',
		day: 'numeric',
		timeZone: 'UTC',
	}).format(new Date(Date.UTC(year, month - 1, day || 1)))
}

/** 空输入时按 UI 语言推导的格式占位（如 yyyy/mm/dd、mm/dd/yyyy）：
    取 Intl 部件顺序，绝不写死英文 mm/dd/yyyy。 */
function formatPlaceholder(granularity: Granularity): string {
	const parts = new Intl.DateTimeFormat(i18n.language, {
		year: 'numeric',
		month: 'numeric',
		day: 'numeric',
	}).formatToParts(new Date(Date.UTC(2026, 2, 4)))
	const letter: Record<string, string> = {
		year: 'yyyy',
		month: 'mm',
		day: 'dd',
	}
	return parts
		.filter(
			(part) =>
				part.type === 'literal' ||
				(granularity === 'day' ? part.type in letter : part.type !== 'day'),
		)
		.map((part) =>
			part.type === 'literal' ? part.value : (letter[part.type] ?? ''),
		)
		.join('')
}

/** 日期/月范围输入：原生 input[type=date|month] 负责交互、校验与无障碍，
    lang 钉在 UI 语言上；未聚焦时原生编辑文本透明、用覆盖层展示本地化格式，
    规避 Linux Chromium/Electron 无视 lang、按系统区域显示 mm/dd/yyyy 的问题。 */
function RangeInput({
	granularity,
	ariaLabel,
	value,
	min,
	max,
	onChange,
}: {
	granularity: Granularity
	ariaLabel: string
	value: string
	min?: string
	max?: string
	onChange: (value: string) => void
}) {
	return (
		<span className={styles.dateField}>
			<input
				type={granularity === 'month' ? 'month' : 'date'}
				lang={i18n.language}
				className={`nl-input ${styles.rangeInput}`}
				aria-label={ariaLabel}
				value={value}
				min={min}
				max={max}
				onChange={(event) => onChange(event.target.value)}
			/>
			<span className={styles.dateOverlay} aria-hidden="true">
				{value ? (
					formatPeriodDisplay(value, granularity)
				) : (
					<span className={styles.datePlaceholder}>
						{formatPlaceholder(granularity)}
					</span>
				)}
			</span>
		</span>
	)
}

interface BarTip {
	/** 悬停/聚焦柱条的 key，用于 aria-describedby 与激活高亮 */
	day: string
	/** 锚点柱条元素：定位随滚动/缩放重算 */
	anchor: HTMLElement
	/** 点击柱条可把提示卡钉住（aria-pressed），再点或 Escape 收起 */
	pinned: boolean
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

/** 后端在 usage.list 里写死的简体中文原因（contract 尚未结构化），
    UI 侧映射到本地化文案；不认识的原因交给 humanizeError 兜底，
    原文只进折叠的「详细信息」。 */
const unreadableReason: Record<string, string> = {
	项目已移动或不存在: msg('项目已移动或删除'),
	项目无法读取: msg('项目无法读取'),
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
	const [titles, setTitles] = useState<ReadonlyMap<string, string>>(new Map())
	const [tip, setTip] = useState<BarTip | null>(null)
	const tooltipId = useId()
	useEffect(() => {
		let active = true
		let cancelCurrent: (() => void) | undefined
		function load() {
			cancelCurrent?.()
			const request = window.novelive.call('usage.list', {})
			cancelCurrent = () => request.cancel()
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
		function loadTitles() {
			window.novelive.call('library.list', {}).promise.then(
				({ works }) => {
					if (active) setTitles(workTitlesFromList(works))
				},
				() => {},
			)
		}
		const off = window.novelive.on('creator.ready', () => {
			load()
			loadTitles()
		})
		load()
		loadTitles()
		return () => {
			active = false
			off()
			cancelCurrent?.()
		}
	}, [])
	const records = useMemo(
		() => data?.records.map(({ usage }) => usage) ?? [],
		[data],
	)
	const titleOf = (workId: string) => formatWorkTitle(titles, workId)
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
	const byPeriod = new Map<string, UsageRecord[]>()
	const byModel = new Map<string, UsageRecord[]>()
	const byWork = new Map<
		string,
		{ records: UsageRecord[]; phases: Map<string, UsageRecord[]> }
	>()
	for (const record of shown) {
		const period = periodOf(record.at)
		const rows = byPeriod.get(period)
		if (rows) rows.push(record)
		else byPeriod.set(period, [record])
		const modelRows = byModel.get(record.model)
		if (modelRows) modelRows.push(record)
		else byModel.set(record.model, [record])
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
	const perPeriod = [...byPeriod]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([period, rows]) => ({ period, ...totals(rows) }))
	const perModel = [...byModel]
		.map(([name, rows]) => ({ key: name, label: name, totals: totals(rows) }))
		.sort((a, b) => b.totals.calls - a.totals.calls)
	const labelEvery = Math.ceil(perPeriod.length / 16)
	const maxDay = Math.max(1, ...perPeriod.map(({ calls }) => calls))
	const works = [...byWork].sort(([a], [b]) => a.localeCompare(b))
	const phaseOrder = Object.keys(phaseName)
	const phases = [...new Set(shown.map((r) => r.phase))].sort(
		(a, b) => phaseOrder.indexOf(a) - phaseOrder.indexOf(b),
	)

	// 无法读取的作品按本地化原因归组：每条原因一行，
	// 同因多部合成「N 部作品无法读取」（DESIGN.md 同类问题合成一条）
	const unreadableGroups = [
		...Map.groupBy(data?.unreadableProjects ?? [], (project) => {
			const known = unreadableReason[project.reason]
			return known ? t(known) : formatErrorText(humanizeError(project.reason))
		}).entries(),
	]

	const tipContent = (day: string, dayTotals: UsageTotals) => (
		<>
			<span className={styles.tipTitle}>
				{formatPeriodDisplay(day, granularity)}
			</span>
			<span className={styles.tipLine}>
				{t('{{calls}} 次', {
					calls: dayTotals.calls.toLocaleString(i18n.language),
				})}
				{' · '}
				{t('输入 {{input}} / 输出 {{output}}', {
					input: dayTotals.input.toLocaleString(i18n.language),
					output: dayTotals.output.toLocaleString(i18n.language),
				})}
				{dayTotals.images
					? t(' · {{images}} 张', {
							images: dayTotals.images.toLocaleString(i18n.language),
						})
					: ''}
			</span>
			<span className={styles.tipCost}>
				{dayTotals.cost === null
					? t('暂无单价')
					: t('参考 {{cost}}', { cost: formatCost(dayTotals.cost) })}
			</span>
		</>
	)
	const showTip = (
		day: string,
		dayTotals: UsageTotals,
		target: HTMLElement,
	) => {
		setTip((current) => ({
			day,
			anchor: target,
			pinned: current?.day === day ? current.pinned : false,
			content: tipContent(day, dayTotals),
		}))
	}
	/** 点击柱条切换钉住：钉住的提示卡不随 hover/blur 收起（aria-pressed） */
	const togglePin = (
		day: string,
		dayTotals: UsageTotals,
		target: HTMLElement,
	) => {
		setTip((current) =>
			current?.day === day && current.pinned
				? null
				: {
						day,
						anchor: target,
						pinned: true,
						content: tipContent(day, dayTotals),
					},
		)
	}
	// hover/blur 只收起未钉住的提示卡
	const hideTip = (day: string) =>
		setTip((current) =>
			current?.day === day && !current.pinned ? null : current,
		)

	// 提示卡打开期间按 Escape 关闭（与控件库 Tooltip 一致）；
	// 数据刷新后锚点柱条已不在当前过滤结果中时一并收起
	const tipGone =
		tip !== null && !perPeriod.some((row) => row.period === tip.day)
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
				{error && <ErrorNotice message={error} />}
				{!data && !error && <LoadingState text={t('正在读取用量')} />}
				{data && (
					<>
						{data.unreadableProjects.length > 0 && (
							<div role="alert">
								<Banner kind="warning">
									<span className={styles.unreadable}>
										<span className={styles.unreadableLead}>
											{t('部分作品无法读取，未计入统计')}
										</span>
										{unreadableGroups.map(([reason, group]) => (
											<span key={reason}>
												{group.length === 1
													? t('一部作品无法读取')
													: t('{{count}} 部作品无法读取', {
															count: group.length,
														})}
												{' · '}
												{reason}
											</span>
										))}
									</span>
								</Banner>
								<Details className={styles.unreadableDetails}>
									{data.unreadableProjects.map((project) => (
										<div key={project.projectId}>
											{project.projectId}
											{' · '}
											{project.reason}
										</div>
									))}
								</Details>
							</div>
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
								<RangeInput
									granularity={granularity}
									ariaLabel={t('开始日期')}
									value={from || first}
									max={to || last || undefined}
									onChange={setFrom}
								/>
								<span>{t('到')}</span>
								<RangeInput
									granularity={granularity}
									ariaLabel={t('结束日期')}
									value={to || last}
									min={from || first || undefined}
									onChange={setTo}
								/>
							</span>
							<InfoTooltip
								label={t('用量说明')}
								text={t(
									'文本按 tokens，图片按张数；参考金额只计入有单价的调用，仅供参考，不设预算或自动停机。',
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
										value={sum.calls.toLocaleString(i18n.language)}
									/>
									<Stat
										icon={FileText}
										label={t('文本 tokens')}
										value={(sum.input + sum.output).toLocaleString(
											i18n.language,
										)}
										hint={t('输入 {{input}} / 输出 {{output}}', {
											input: sum.input.toLocaleString(i18n.language),
											output: sum.output.toLocaleString(i18n.language),
										})}
									/>
									<Stat
										icon={Image}
										label={t('图片')}
										value={t('{{images}} 张', {
											images: sum.images.toLocaleString(i18n.language),
										})}
									/>
									<Stat
										icon={Wallet}
										label={t('参考金额')}
										value={
											sum.cost === null ? t('没有单价') : formatCost(sum.cost)
										}
										hint={
											sum.cost !== null && sum.unpriced
												? t('部分调用拿不到单价，未计入')
												: undefined
										}
									/>
								</div>
								<Card
									className={styles.panel}
									role="region"
									aria-label={
										granularity === 'month' ? t('各月调用量') : t('各天调用量')
									}
								>
									<SectionLabel>
										{granularity === 'month'
											? t('各月调用量')
											: t('各天调用量')}
									</SectionLabel>
									<div className={styles.chart}>
										{perPeriod.map((dayRow, index) => {
											const active = tip?.day === dayRow.period
											const pinned = active && tip.pinned
											return (
												<button
													key={dayRow.period}
													type="button"
													className={
														active
															? `${styles.bar} ${styles.barActive}`
															: styles.bar
													}
													aria-pressed={pinned}
													aria-label={t(
														'{{day}}：{{calls}} 次 · 输入 {{input}} / 输出 {{output}} · {{images}} 张图片',
														{
															day: formatPeriodDisplay(
																dayRow.period,
																granularity,
															),
															calls: dayRow.calls,
															input: dayRow.input,
															output: dayRow.output,
															images: dayRow.images,
														},
													)}
													aria-describedby={active ? tooltipId : undefined}
													onMouseEnter={(event) =>
														showTip(dayRow.period, dayRow, event.currentTarget)
													}
													onMouseLeave={() => hideTip(dayRow.period)}
													onFocus={(event) =>
														showTip(dayRow.period, dayRow, event.currentTarget)
													}
													onBlur={() => hideTip(dayRow.period)}
													onClick={(event) =>
														togglePin(
															dayRow.period,
															dayRow,
															event.currentTarget,
														)
													}
												>
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
													{index % labelEvery === 0 ? (
														<time
															className={styles.barTime}
															dateTime={dayRow.period}
														>
															{formatAxisLabel(dayRow.period, granularity)}
														</time>
													) : null}
												</button>
											)
										})}
									</div>
									{tip ? <BarTooltip tip={tip} id={tooltipId} /> : null}
								</Card>
								<Card
									className={styles.panel}
									role="region"
									aria-label={
										granularity === 'month' ? t('按月汇总') : t('按日汇总')
									}
								>
									<SectionLabel>
										{granularity === 'month' ? t('按月汇总') : t('按日汇总')}
									</SectionLabel>
									<AggregateTable
										leadHeader={granularity === 'month' ? t('月份') : t('日期')}
										rows={perPeriod.map((row) => ({
											key: row.period,
											label: formatPeriodDisplay(row.period, granularity),
											dateTime: row.period,
											totals: row,
										}))}
									/>
								</Card>
								<Card
									className={styles.panel}
									role="region"
									aria-label={t('按模型汇总')}
								>
									<SectionLabel>{t('按模型汇总')}</SectionLabel>
									<AggregateTable
										leadHeader={t('模型')}
										quietLead
										rows={perModel}
									/>
								</Card>
								<Card
									className={styles.panel}
									role="region"
									aria-label={t('按作品 × 阶段')}
								>
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
																		t('{{calls}} 次', {
																			calls: cell.calls.toLocaleString(
																				i18n.language,
																			),
																		}) +
																		(cell.images
																			? t(' · {{images}} 张', {
																					images: cell.images.toLocaleString(
																						i18n.language,
																					),
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
																formatCost(row.cost)
															)}
														</td>
													</tr>
												)
											})}
										</tbody>
									</table>
								</Card>
							</>
						)}
					</>
				)}
			</div>
		</Page>
	)
}
