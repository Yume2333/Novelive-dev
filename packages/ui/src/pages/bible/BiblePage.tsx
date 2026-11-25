import type { CommandOutput, Proposal } from '@novelive/creator/contract'
import {
	ChevronRight,
	Clock,
	Eye,
	Handshake,
	Languages,
	type LucideIcon,
	Mountain,
	Palette,
	RefreshCw,
	Users,
} from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Collapse } from '../../components/Collapse'
import { Page } from '../../components/Page'
import { ScrollArea } from '../../components/ScrollArea'
import { msg, scoped } from '../../i18n'
import {
	Fields,
	fieldLabels,
	formatConflictValue,
	labelFor,
} from './BibleFields'
import styles from './BiblePage.module.css'
import { CharacterDetail } from './CharacterDetail'

const t = scoped('bible')

type Bible = CommandOutput<'bible.get'>
type Entry =
	| Bible['characters'][number]
	| Bible['locations'][number]
	| Bible['glossary'][number]
	| Bible['relations'][number]
	| Bible['styles'][number]
	| Bible['timeline'][number]
	| Bible['foreshadowing'][number]
type ProposalEntry = Extract<
	Proposal['payload'],
	{ kind: 'bible' }
>['changes'][number]['entry']
const categories = [
	['characters', msg('角色')],
	['relations', msg('关系')],
	['locations', msg('地点')],
	['timeline', msg('时间线')],
	['foreshadowing', msg('伏笔')],
	['styles', msg('风格')],
	['glossary', msg('术语')],
] as const
const icons: Record<(typeof categories)[number][0], LucideIcon> = {
	characters: Users,
	relations: Handshake,
	locations: Mountain,
	timeline: Clock,
	foreshadowing: Eye,
	styles: Palette,
	glossary: Languages,
}
const message = (error: unknown) =>
	error && typeof error === 'object' && 'message' in error
		? String(error.message)
		: t('读取失败，请重试。')
const title = (entry: Entry | ProposalEntry) =>
	'name' in entry
		? String(entry.name)
		: 'written' in entry
			? String(entry.written)
			: entry.id
const collection = {
	character: 'characters',
	location: 'locations',
	glossary: 'glossary',
	relation: 'relations',
	timeline: 'timeline',
	foreshadowing: 'foreshadowing',
	style: 'styles',
} as const

function characterDescription(entry: Entry | ProposalEntry) {
	if ('description' in entry && typeof entry.description === 'string')
		return entry.description
}

export function approvalNotice(proposal: Proposal, bible: Bible) {
	let images = false
	let style = false
	if (proposal.payload.kind === 'bible') {
		for (const { kind, op, entry } of proposal.payload.changes) {
			if (op === 'none') continue
			if (kind === 'character') {
				const current = bible.characters.find(({ id }) => id === entry.id)
				images ||=
					!!current &&
					(op === 'delete' ||
						characterDescription(current) !== characterDescription(entry) ||
						JSON.stringify(current.appearance) !==
							JSON.stringify(entry.appearance) ||
						(current.costumes ?? []).some(
							(costume) =>
								costume.description !==
								entry.costumes?.find(({ id }) => id === costume.id)
									?.description,
						))
			} else if (kind === 'location') {
				const current = bible.locations.find(({ id }) => id === entry.id)
				images ||=
					!!current &&
					(op === 'delete' || current.description !== entry.description)
			} else if (kind === 'style') {
				const current = bible.styles.find(({ id }) => id === entry.id)
				style ||=
					op === 'delete' ||
					!current ||
					(['description', 'narration', 'references'] as const).some(
						(field) =>
							JSON.stringify(current[field]) !== JSON.stringify(entry[field]),
					)
			}
		}
	}
	return (
		t('已接受候选') +
		(images ? t('；受影响的已有图片已标记过期。') : t('。')) +
		(style ? t('风格变更仅提示，不自动过期。') : '')
	)
}

function Occurrences({ entry }: { entry: Entry }) {
	const [open, setOpen] = useState(false)
	const id = useId()
	const occurrences =
		(
			entry as Entry & {
				occurrences?: {
					chapterId: string
					paragraphId: string
					quote: string
				}[]
			}
		).occurrences ?? []
	return (
		<div>
			<button
				type="button"
				className={styles.disclosure}
				aria-expanded={open}
				aria-controls={id}
				onClick={() => setOpen((value) => !value)}
			>
				{t('跨章节定位（{{length}}）', { length: occurrences.length })}
			</button>
			<Collapse open={open}>
				<div id={id}>
					{occurrences.length ? (
						<ul>
							{occurrences.map(({ chapterId, paragraphId, quote }) => (
								<li key={`${chapterId}/${paragraphId}`}>
									<strong>
										{chapterId} · {paragraphId}
									</strong>
									<p>{quote}</p>
								</li>
							))}
						</ul>
					) : (
						<p>{t('暂无原文匹配')}</p>
					)}
				</div>
			</Collapse>
		</div>
	)
}

function Candidate({
	proposal,
	bible,
	busy,
	resolve,
}: {
	proposal: Proposal
	bible: Bible
	busy: boolean
	resolve(id: string, reason?: string): void
}) {
	const [reason, setReason] = useState('')
	const payload = proposal.payload
	if (payload.kind !== 'bible' && payload.kind !== 'glossary') return null
	const changes =
		payload.kind === 'bible'
			? payload.changes
			: payload.changes.map((entry) => ({
					kind: 'glossary' as const,
					op: 'update' as const,
					entry,
				}))
	const action = bible.proposalActions[proposal.id]
	const stale = !action.canApprove
	return (
		<article
			className={`${styles.card} ${styles.candidate}`}
			aria-label={proposal.prompt}
		>
			<header className={styles.cardHead}>
				<h3>{proposal.prompt}</h3>
				<span className={styles.chip} data-tone="candidate">
					{t('候选')}
				</span>
			</header>
			<p className={styles.muted}>{action.reason ?? t('待确认')}</p>
			{changes.map(({ kind, op, entry }) => {
				const confirmed = (bible[collection[kind]] as Entry[]).find(
					({ id }) => id === entry.id,
				)
				const conflicts =
					confirmed?.status === 'confirmed'
						? [...new Set([...Object.keys(confirmed), ...Object.keys(entry)])]
								.map(
									(key) =>
										[
											key,
											(entry as unknown as Record<string, unknown>)[key],
										] as const,
								)
								.filter(
									([key, value]) =>
										!['status', 'conflict', 'occurrences'].includes(key) &&
										!(
											kind === 'character' &&
											op === 'update' &&
											key === 'aliases' &&
											value === undefined
										) &&
										JSON.stringify(
											(confirmed as unknown as Record<string, unknown>)[key],
										) !== JSON.stringify(value),
								)
						: []
				return (
					<section key={`${kind}/${entry.id}`}>
						<h4>
							{title(entry)} ·{' '}
							{
								{
									add: t('新增'),
									update: t('更新'),
									delete: t('删除'),
									none: t('不变'),
								}[op]
							}
						</h4>
						{conflicts.length > 0 && (
							<div className={styles.conflict}>
								<strong>{t('与已确认内容冲突')}</strong>
								{conflicts.map(([key, value]) => (
									<p key={key}>
										{t('{{label}}：{{before}} → {{after}}', {
											label: labelFor(key),
											before: formatConflictValue(
												(confirmed as unknown as Record<string, unknown>)[key],
											),
											after:
												value === undefined
													? t('移除')
													: formatConflictValue(value),
										})}
									</p>
								))}
							</div>
						)}
						{entry.conflict && <p>{entry.conflict}</p>}
						<Fields entry={entry as unknown as Record<string, unknown>} />
						{kind === 'style' && (
							<p>{t('风格变更不会自动标记图片过期，请自行检查已有图片。')}</p>
						)}
					</section>
				)
			})}
			<div className={styles.decision}>
				<input
					aria-label={t('拒绝理由')}
					placeholder={t('拒绝理由')}
					value={reason}
					onChange={(event) => setReason(event.target.value)}
				/>
				<button
					type="button"
					className={styles.ghost}
					disabled={busy}
					onClick={() => resolve(proposal.id, reason)}
				>
					{t('拒绝候选')}
				</button>
				<button
					type="button"
					className={styles.primary}
					disabled={busy || stale}
					onClick={() => resolve(proposal.id)}
				>
					{t('接受候选')}
				</button>
			</div>
		</article>
	)
}

export function BiblePage() {
	const { id: workId } = useParams()
	const [params, setParams] = useSearchParams()
	const volumeId = params.get('volume') ?? 'v0001'
	const [attempt, setAttempt] = useState(0)
	return (
		<BibleProjection
			key={`${workId}/${volumeId}/${attempt}`}
			workId={workId}
			volumeId={volumeId}
			changeVolume={(volume) => setParams({ volume })}
			refresh={() => setAttempt((value) => value + 1)}
		/>
	)
}

function BibleProjection({
	workId,
	volumeId,
	changeVolume,
	refresh,
}: {
	workId: string | undefined
	volumeId: string
	changeVolume(volume: string): void
	refresh(): void
}) {
	const [bible, setBible] = useState<Bible>()
	const [proposals, setProposals] = useState<Proposal[]>([])
	const [category, setCategory] =
		useState<(typeof categories)[number][0]>('characters')
	const [error, setError] = useState('')
	const [notice, setNotice] = useState('')
	const [busy, setBusy] = useState(false)
	const [volumeDraft, setVolumeDraft] = useState(volumeId)
	const [candidatesOpen, setCandidatesOpen] = useState(false)
	const [focused, setFocused] = useState('')
	useEffect(() => {
		if (!workId) return
		let active = true
		setError('')
		async function load() {
			try {
				const next = await window.novelive.call('bible.get', {
					workId: workId as string,
					volumeId,
				}).promise
				const candidates = await Promise.all(
					next.proposalIds.map(
						(proposalId) =>
							window.novelive.call('proposal.get', {
								workId: workId as string,
								proposalId,
							}).promise,
					),
				)
				if (active) {
					setBible(next)
					setProposals(candidates)
				}
			} catch (failure) {
				if (active) setError(message(failure))
			}
		}
		void load()
		const off = window.novelive.on('creator.ready', () => void load())
		return () => {
			active = false
			off()
		}
	}, [workId, volumeId])
	async function resolve(proposalId: string, reason?: string) {
		if (!workId || busy) return
		setBusy(true)
		setError('')
		try {
			const result = await window.novelive.call('proposal.resolve', {
				workId,
				proposalId,
				decision:
					reason === undefined
						? { kind: 'approve' }
						: { kind: 'reject', reason },
			}).promise
			setNotice(
				result.status === 'stale'
					? t('候选已过期，未修改已确认内容。')
					: result.status === 'restricted'
						? result.reason
						: reason === undefined
							? bible
								? approvalNotice(result.proposal, bible)
								: t('已接受候选。')
							: t('已拒绝候选，理由已保存。'),
			)
			const next = await window.novelive.call('bible.get', { workId, volumeId })
				.promise
			const candidates = await Promise.all(
				next.proposalIds.map(
					(proposalId) =>
						window.novelive.call('proposal.get', { workId, proposalId })
							.promise,
				),
			)
			setBible(next)
			setProposals(candidates)
		} catch (failure) {
			setError(message(failure))
		} finally {
			setBusy(false)
		}
	}
	const label = t(categories.find(([key]) => key === category)?.[1] ?? '')
	const entries: Entry[] = bible ? bible[category] : []
	const selected = entries.find((entry) => entry.id === focused) ?? entries[0]
	const card = (entry: Entry) => (
		<article
			className={styles.card}
			key={entry.id}
			id={`bible-entry-${entry.id}`}
			data-focused={focused === entry.id || undefined}
		>
			<header className={styles.cardHead}>
				<h3>{title(entry)}</h3>
				<span
					className={styles.chip}
					data-tone={entry.status === 'confirmed' ? 'confirmed' : 'candidate'}
				>
					{entry.status === 'confirmed' ? t('已确认') : t('候选')}
				</span>
			</header>
			<Fields entry={entry as unknown as Record<string, unknown>} />
			<Occurrences entry={entry} />
		</article>
	)

	return (
		<Page
			title={t('设定集')}
			width={1200}
			eyebrow={t('卷 {{volume}}', { volume: volumeId })}
			actions={
				<form
					className={styles.volume}
					onSubmit={(event) => {
						event.preventDefault()
						changeVolume(volumeDraft)
					}}
				>
					<input
						aria-label={t('卷 ID')}
						placeholder={t('卷 ID')}
						value={volumeDraft}
						onChange={(event) => setVolumeDraft(event.target.value)}
					/>
					<button type="submit" className={styles.ghost} disabled={busy}>
						{t('切换卷')}
					</button>
					<button
						type="button"
						className={styles.icon}
						aria-label={t('刷新')}
						title={t('刷新')}
						disabled={busy}
						onClick={refresh}
					>
						<RefreshCw aria-hidden="true" size={16} strokeWidth={1.8} />
					</button>
				</form>
			}
		>
			<div className={styles.root}>
				{error && (
					<p className={styles.alert} role="alert">
						{error}
					</p>
				)}
				{notice && (
					<p className={styles.notice} role="status">
						{notice}
					</p>
				)}
				{!bible && !error && (
					<p className={styles.muted} role="status">
						{t('正在读取设定集…')}
					</p>
				)}
				{bible && (
					<ScrollArea className={styles.scroll}>
						<div className={styles.layout}>
							<nav className={styles.nav} aria-label={t('设定分类')}>
								{categories.map(([key, name]) => {
									const Icon = icons[key]
									return (
										<button
											type="button"
											key={key}
											className={styles.navItem}
											title={t(name)}
											aria-pressed={category === key}
											onClick={() => {
												setCategory(key)
												setFocused('')
											}}
										>
											<Icon aria-hidden="true" size={17} strokeWidth={1.8} />
											<span className={styles.navText}>{t(name)}</span>
											<span className={styles.navCount}>
												{bible[key].length}
											</span>
										</button>
									)
								})}
							</nav>
							<div className={styles.content}>
								<div className={styles.contentHead}>
									<h2>{label}</h2>
									<button
										type="button"
										className={styles.candidateChip}
										aria-expanded={candidatesOpen}
										onClick={() => {
											setCandidatesOpen(!candidatesOpen)
											if (!candidatesOpen)
												requestAnimationFrame(() =>
													document
														.getElementById('bible-candidates')
														?.scrollIntoView({ block: 'nearest' }),
												)
										}}
									>
										{proposals.length
											? t('候选与冲突 · {{length}} 项待处理', {
													length: proposals.length,
												})
											: t('候选与冲突 · 暂无待处理')}
										<ChevronRight
											aria-hidden="true"
											size={13}
											strokeWidth={2}
											data-open={candidatesOpen || undefined}
										/>
									</button>
								</div>
								<div
									className={styles.parts}
									data-candidates={candidatesOpen || undefined}
								>
									<section
										className={styles.entries}
										aria-label={t('已登记内容')}
									>
										{entries.length === 0 && (
											<p className={styles.empty}>{t('暂无条目')}</p>
										)}
										{category === 'characters' && entries.length > 0 ? (
											<div className={styles.characters}>
												<div className={styles.characterList}>
													{entries.map((entry) => (
														<button
															type="button"
															key={entry.id}
															className={styles.characterItem}
															aria-current={selected === entry || undefined}
															onClick={() => setFocused(entry.id)}
														>
															<span
																className={styles.avatar}
																aria-hidden="true"
															>
																{title(entry).slice(0, 1)}
															</span>
															<span className={styles.characterName}>
																{title(entry)}
															</span>
														</button>
													))}
												</div>
												<div className={styles.cards}>
													<CharacterDetail
														character={selected as Bible['characters'][number]}
														characters={bible.characters}
														focused={focused === selected.id}
														occurrences={<Occurrences entry={selected} />}
													/>
												</div>
											</div>
										) : category === 'glossary' && entries.length > 0 ? (
											<div className={styles.glossary}>
												<table>
													<thead>
														<tr>
															{(
																[
																	'original',
																	'written',
																	'pronunciation',
																	'category',
																	'note',
																] as const
															).map((key) => (
																<th key={key} scope="col">
																	{t(fieldLabels[key])}
																</th>
															))}
															<th scope="col">{t('定位')}</th>
														</tr>
													</thead>
													<tbody>
														{(entries as Bible['glossary']).map((entry) => (
															<tr
																key={entry.id}
																id={`bible-entry-${entry.id}`}
																data-focused={focused === entry.id || undefined}
															>
																<td>{entry.original}</td>
																<th scope="row">
																	{entry.written}
																	{entry.status !== 'confirmed' && (
																		<span className={styles.chip}>
																			{t('候选')}
																		</span>
																	)}
																</th>
																<td>{entry.pronunciation || '—'}</td>
																<td>
																	<span className={styles.chip}>
																		{entry.category}
																	</span>
																</td>
																<td>{entry.note || '—'}</td>
																<td>
																	<Occurrences entry={entry} />
																</td>
															</tr>
														))}
													</tbody>
												</table>
											</div>
										) : (
											<div className={styles.cards}>{entries.map(card)}</div>
										)}
									</section>
									<section
										id="bible-candidates"
										className={styles.candidates}
										aria-label={t('待确认候选')}
										hidden={!candidatesOpen}
									>
										<h2 className={styles.label}>
											{t('待确认候选（{{length}}）', {
												length: proposals.length,
											})}
										</h2>
										{!proposals.length && (
											<p className={styles.empty}>{t('暂无待确认候选')}</p>
										)}
										{proposals.map((proposal) => (
											<Candidate
												key={proposal.id}
												proposal={proposal}
												bible={bible}
												busy={busy}
												resolve={(id, reason) => void resolve(id, reason)}
											/>
										))}
									</section>
								</div>
							</div>
						</div>
					</ScrollArea>
				)}
			</div>
		</Page>
	)
}
