import type { CommandOutput } from '@novelive/creator/contract'
import {
	ArrowUpRight,
	BarChart3,
	ChevronDown,
	FileText,
	Image,
	type LucideIcon,
	MessageSquareText,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Card, SectionLabel } from '../../components/Card'
import { Collapse } from '../../components/Collapse'
import { EmptyState, Page } from '../../components/Page'
import { scoped } from '../../i18n'
import { Select } from '../settings/ModelFields'
import styles from './UsagePage.module.css'

const t = scoped('usage')

type UsageRecord = CommandOutput<'usage.list'>['records'][number]['usage']

const all = ''

const dayOf = (at: number) => new Date(at).toLocaleDateString('sv')

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
	const [showExplanation, setShowExplanation] = useState(false)
	const [data, setData] = useState<CommandOutput<'usage.list'>>()
	const [error, setError] = useState('')
	const [workId, setWorkId] = useState(all)
	const [phase, setPhase] = useState(all)
	const [model, setModel] = useState(all)
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
		const off = window.novelive.on('creator.ready', load)
		load()
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
	const options = (pick: (record: UsageRecord) => string, label: string) =>
		[
			[all, label] as const,
			...[...new Set(records.map(pick))].sort().map((v) => [v, v] as const),
		] as const
	const shown = records.filter(
		(record) =>
			(!workId || record.link.workId === workId) &&
			(!phase || record.phase === phase) &&
			(!model || record.model === model),
	)
	const sum = totals(shown)
	const days = [...new Set(shown.map((r) => dayOf(r.at)))].sort()
	const perDay = days.map((day) => ({
		day,
		...totals(shown.filter((r) => dayOf(r.at) === day)),
	}))
	const maxDay = Math.max(1, ...perDay.map(({ calls }) => calls))
	const works = [...new Set(shown.map((r) => r.link.workId))].sort()
	const phases = [...new Set(shown.map((r) => r.phase))].sort()
	return (
		<Page title={t('用量')}>
			<div className={styles.content}>
				<div>
					<button
						type="button"
						className={styles.disclosure}
						aria-expanded={showExplanation}
						onClick={() => setShowExplanation((open) => !open)}
					>
						<ChevronDown size={16} aria-hidden="true" />
						{t('用量说明')}
					</button>
					<Collapse open={showExplanation}>
						{t(
							'仅供参考，统计已发生的调用；不估算费用，不设预算或自动停机。风格变更仅提示，不自动标记图片过期。',
						)}
					</Collapse>
				</div>
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
								options={options((r) => r.link.workId, t('全部作品'))}
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
									<SectionLabel>{t('各天调用量')}</SectionLabel>
									<div className={styles.chart}>
										{perDay.map(({ day, calls, input, output, images }) => (
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
												<span>{calls}</span>
												<span className={styles.barTrack}>
													<span
														className={styles.barFill}
														style={{
															height: `${Math.max(4, (calls / maxDay) * 100)}%`,
														}}
													/>
												</span>
												<time dateTime={day}>{day.slice(5)}</time>
											</div>
										))}
									</div>
								</Card>
								<Card className={styles.panel}>
									<SectionLabel>{t('按作品 × 阶段')}</SectionLabel>
									<div className={styles.tableScroll}>
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
														<td>{work}</td>
														{phases.map((p) => {
															const cell = totals(
																shown.filter(
																	(r) =>
																		r.link.workId === work && r.phase === p,
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
									</div>
								</Card>
								<Card className={styles.panel}>
									<SectionLabel>{t('已发生用量')}</SectionLabel>
									<ul className={styles.list}>
										{data.records
											.filter(({ usage }) => shown.includes(usage))
											.map(({ id, usage: record }) => (
												<li className={styles.row} key={id}>
													<strong>{record.model}</strong>
													<span>
														{record.link.workId} · {record.link.volumeId} ·{' '}
														{record.phase}
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
						<Card className={styles.panel}>
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
