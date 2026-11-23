import type { CommandOutput, Proposal } from '@novelive/creator/contract'
import { useEffect, useId, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Collapse } from '../../components/Collapse'
import { Page } from '../../components/Page'
import { ScrollArea } from '../../components/ScrollArea'
import styles from './BiblePage.module.css'

type Bible = CommandOutput<'bible.get'>
type Entry =
	| Bible['characters'][number]
	| Bible['locations'][number]
	| Bible['glossary'][number]
	| Bible['relations'][number]
	| Bible['styles'][number]
	| Bible['timeline'][number]
	| Bible['foreshadowing'][number]
const categories = [
	['characters', '角色'],
	['locations', '地点'],
	['glossary', '术语'],
	['relations', '关系'],
	['timeline', '时间线'],
	['foreshadowing', '伏笔'],
	['styles', '风格'],
] as const
const message = (error: unknown) =>
	error && typeof error === 'object' && 'message' in error
		? String(error.message)
		: '读取失败，请重试。'
const labels: Record<string, string> = {
	name: '名字',
	originalName: '原文名字',
	aliases: '别名',
	major: '主要角色',
	addresses: '称呼',
	speakerId: '说话人',
	identity: '身份',
	personality: '性格',
	speech: '说话方式',
	appearance: '外貌',
	description: '描述',
	anchorFeatures: '锚点特征',
	keyColors: '关键颜色',
	hair: '发色',
	eyes: '瞳色',
	clothing: '服装',
	costumes: '造型',
	fromChapter: '起始章',
	expressions: '表情',
	references: '参考图',
	reuse: '复用方式',
	knows: '已知事实',
	fact: '事实',
	changes: '剧情变化',
	chapterId: '章节',
	field: '字段',
	value: '内容',
	firstSeenChapter: '首次出场',
	revealedChapter: '揭示章节',
	from: '角色',
	to: '关联角色',
	variants: '变体',
	event: '事件',
	storyTime: '故事时间',
	plantedChapter: '埋设章节',
	resolvedChapter: '回收章节',
	narration: '旁白语气',
	original: '原文写法',
	written: '作品写法',
	pronunciation: '注音',
	category: '类别',
	note: '备注',
	path: '路径',
	id: 'ID',
}
function print(value: unknown): string {
	if (Array.isArray(value))
		return value.length ? value.map(print).join('；') : '无'
	if (value && typeof value === 'object')
		return Object.entries(value)
			.map(([key, item]) => `${labels[key] ?? key}：${print(item)}`)
			.join('，')
	if (typeof value === 'boolean') return value ? '是' : '否'
	return value === undefined || value === null ? '未设置' : String(value)
}
const title = (entry: Entry) =>
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

function approvalNotice(proposal: Proposal, bible: Bible) {
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
	return `已接受候选${images ? '；受影响的已有图片已标记过期。' : '。'}${style ? '风格变更仅提示，不自动过期。' : ''}`
}

function Fields({ entry }: { entry: Entry }) {
	return (
		<dl className={styles.fields}>
			{Object.entries(entry)
				.filter(
					([key]) => !['id', 'status', 'occurrences', 'conflict'].includes(key),
				)
				.map(([key, value]) => (
					<div key={key}>
						<dt>{labels[key] ?? key}</dt>
						<dd>{print(value)}</dd>
					</div>
				))}
		</dl>
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
				跨章节定位（{occurrences.length}）
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
						<p>暂无原文匹配</p>
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
		<article className={styles.card} aria-label={proposal.prompt}>
			<h3>{proposal.prompt}</h3>
			<p>{action.reason ?? '待确认'}</p>
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
								{ add: '新增', update: '更新', delete: '删除', none: '不变' }[
									op
								]
							}
						</h4>
						{conflicts.length > 0 && (
							<div className={styles.conflict}>
								<strong>与已确认内容冲突</strong>
								{conflicts.map(([key, value]) => (
									<p key={key}>
										{labels[key] ?? key}：
										{print(
											(confirmed as unknown as Record<string, unknown>)[key],
										) ?? '未设置'}{' '}
										→ {value === undefined ? '移除' : print(value)}
									</p>
								))}
							</div>
						)}
						{entry.conflict && <p>{entry.conflict}</p>}
						<Fields entry={entry} />
						{confirmed && <Occurrences entry={confirmed} />}
						{kind === 'style' && (
							<p>风格变更不会自动标记图片过期，请自行检查已有图片。</p>
						)}
					</section>
				)
			})}
			<div className={styles.actions}>
				<button
					type="button"
					disabled={busy || stale}
					onClick={() => resolve(proposal.id)}
				>
					接受候选
				</button>
				<label>
					拒绝理由
					<input
						value={reason}
						onChange={(event) => setReason(event.target.value)}
					/>
				</label>
				<button
					type="button"
					disabled={busy}
					onClick={() => resolve(proposal.id, reason)}
				>
					拒绝候选
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
					? '候选已过期，未修改已确认内容。'
					: result.status === 'restricted'
						? result.reason
						: reason === undefined
							? bible
								? approvalNotice(result.proposal, bible)
								: '已接受候选。'
							: '已拒绝候选，理由已保存。',
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
	return (
		<Page title="设定集">
			<div className={styles.layout}>
				<form
					className={styles.actions}
					onSubmit={(event) => {
						event.preventDefault()
						changeVolume(volumeDraft)
					}}
				>
					<label>
						卷 ID
						<input
							aria-label="卷 ID"
							value={volumeDraft}
							onChange={(event) => setVolumeDraft(event.target.value)}
						/>
					</label>
					<button type="submit" disabled={busy}>
						切换卷
					</button>
					<button type="button" disabled={busy} onClick={refresh}>
						刷新
					</button>
				</form>
				{error && <p role="alert">{error}</p>}
				{notice && <p role="status">{notice}</p>}
				{!bible && !error && <p role="status">正在读取设定集…</p>}
				{bible && (
					<>
						<nav className={styles.actions} aria-label="设定分类">
							{categories.map(([key, label]) => (
								<button
									type="button"
									key={key}
									aria-pressed={category === key}
									onClick={() => setCategory(key)}
								>
									{label}（{bible[key].length}）
								</button>
							))}
						</nav>
						<ScrollArea className={styles.scroll}>
							<div className={styles.columns}>
								<section aria-label="已登记内容">
									<h2>{categories.find(([key]) => key === category)?.[1]}</h2>
									{bible[category].length === 0 && <p>暂无条目</p>}
									{bible[category].map((entry) => (
										<article className={styles.card} key={entry.id}>
											<h3>{title(entry)}</h3>
											<p>{entry.status === 'confirmed' ? '已确认' : '候选'}</p>
											<Fields entry={entry} />
											<Occurrences entry={entry} />
										</article>
									))}
								</section>
								<section aria-label="待确认候选">
									<h2>待确认候选（{proposals.length}）</h2>
									{!proposals.length && <p>暂无待确认候选</p>}
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
						</ScrollArea>
					</>
				)}
			</div>
		</Page>
	)
}
