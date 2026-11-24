import type { CommandOutput, RewriteProposal } from '@novelive/creator/contract'
import {
	Ban,
	Check,
	ChevronDown,
	CircleAlert,
	CircleCheck,
	CircleDashed,
	LoaderCircle,
	Wrench,
} from 'lucide-react'
import { type ComponentProps, useRef, useState } from 'react'
import { Streamdown } from 'streamdown'
import { Collapse } from '../../components/Collapse'
import { OverlayScrollbar } from '../../components/ScrollArea'
import { msg, scoped } from '../../i18n'
import styles from './AgentPanel.module.css'
import type { Attachment, Part } from './session'

const t = scoped('agent')

type ProposalPart = Extract<Part, { type: 'proposal' }>
type Proposal = ProposalPart['proposal']
type Resolved = CommandOutput<'proposal.resolve'>
export type Activity = 'streaming' | 'stopped' | 'idle'

export interface ProposalActions {
	chapterTitles: Record<string, string>
	resolve(
		proposal: Proposal,
		decision: { kind: 'approve' } | { kind: 'reject'; reason?: string },
	): Promise<Resolved>
}

const proposalKinds: Record<Proposal['payload']['kind'], string> = {
	bible: msg('修改设定集'),
	glossary: msg('修改术语表'),
	requirements: msg('修改改编要求'),
	rewriteScene: msg('重写场景'),
	redrawImage: msg('重画图片'),
	redoChapter: msg('重做章节'),
	resynthesizeVolume: msg('重新综合'),
}

function pretty(value: string) {
	try {
		return JSON.stringify(JSON.parse(value), null, 2)
	} catch {
		return value
	}
}

function Disclosure({
	label,
	status,
	icon,
	defaultOpen = false,
	children,
}: {
	label: string
	status?: string
	icon: React.ReactNode
	defaultOpen?: boolean
	children: React.ReactNode
}) {
	const [open, setOpen] = useState(defaultOpen)
	return (
		<div className={styles.card}>
			<button
				type="button"
				className={styles.cardHead}
				aria-expanded={open}
				onClick={() => setOpen(!open)}
			>
				{icon}
				<span className={styles.cardTitle}>{label}</span>
				{status && <span className={styles.caption}>{status}</span>}
				<ChevronDown
					aria-hidden="true"
					size={14}
					className={styles.chevron}
					data-open={open}
				/>
			</button>
			<Collapse open={open}>
				<div className={styles.cardBody}>{children}</div>
			</Collapse>
		</div>
	)
}

function ToolCard({
	part,
	activity,
}: {
	part: Extract<Part, { type: 'tool' }>
	activity: Activity
}) {
	const done = part.result !== undefined
	const status = done
		? t('完成')
		: activity === 'streaming'
			? t('运行中')
			: activity === 'stopped'
				? t('已停止')
				: t('未完成')
	return (
		<Disclosure
			label={part.name}
			status={status}
			icon={
				!done && activity === 'streaming' ? (
					<LoaderCircle aria-hidden="true" size={15} className={styles.spin} />
				) : (
					<Wrench aria-hidden="true" size={15} />
				)
			}
		>
			<span className={styles.caption}>{t('参数')}</span>
			<pre className={styles.code}>{pretty(part.input)}</pre>
			{done && (
				<>
					<span className={styles.caption}>{t('结果')}</span>
					<pre className={styles.code}>{pretty(part.result ?? '')}</pre>
				</>
			)}
		</Disclosure>
	)
}

const subtaskIcons = {
	running: (
		<LoaderCircle aria-hidden="true" size={15} className={styles.spin} />
	),
	done: <CircleCheck aria-hidden="true" size={15} />,
	failed: <CircleAlert aria-hidden="true" size={15} />,
	cancelled: <CircleDashed aria-hidden="true" size={15} />,
}
const subtaskLabels = {
	running: msg('进行中'),
	done: msg('完成'),
	failed: msg('失败'),
	cancelled: msg('已取消'),
}

export function ScrollField(props: ComponentProps<'textarea'>) {
	const field = useRef<HTMLTextAreaElement>(null)
	return (
		<div className={styles.fieldWrap}>
			<textarea ref={field} className={styles.field} {...props} />
			<OverlayScrollbar targetRef={field} />
		</div>
	)
}

function ProposalCard({
	proposal,
	savedRewrite,
	actions,
}: {
	proposal: Proposal
	savedRewrite?: RewriteProposal
	actions: ProposalActions
}) {
	const [current, setCurrent] = useState(proposal)
	const [stale, setStale] = useState(false)
	const [restriction, setRestriction] = useState('')
	const [rejecting, setRejecting] = useState(false)
	const [reason, setReason] = useState('')
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState('')
	const [rewrite, setRewrite] = useState(savedRewrite)
	const [selected, setSelected] = useState<string[]>(
		savedRewrite?.hunks.map((hunk) => hunk.id) ?? [],
	)
	const chapters = current.chapterIds.map(
		(chapterId) => actions.chapterTitles[chapterId] ?? chapterId,
	)
	const decide = async (
		decision: { kind: 'approve' } | { kind: 'reject'; reason?: string },
	) => {
		setBusy(true)
		setError('')
		try {
			const result = await actions.resolve(current, decision)
			setCurrent(result.proposal)
			if (result.status === 'resolved') {
				if (result.rewrite) {
					setRewrite(result.rewrite)
					setSelected(result.rewrite.hunks.map((hunk) => hunk.id))
				}
				if (
					decision.kind === 'approve' &&
					result.proposal.payload.kind === 'redrawImage'
				)
					window.dispatchEvent(
						new CustomEvent('novelive:asset-changed', {
							detail: {
								workId: result.proposal.workId,
								assetId: result.proposal.payload.assetId,
							},
						}),
					)
			}
			setStale(result.status === 'stale')
			setRestriction(result.status === 'restricted' ? result.reason : '')
			setRejecting(false)
		} catch {
			setError(t('没能提交，请重试'))
		} finally {
			setBusy(false)
		}
	}
	const { payload } = current
	return (
		<section className={styles.proposal} aria-label={t('确认卡')}>
			{rewrite && (
				<section className={styles.rewrite} aria-label={t('重写差异')}>
					{rewrite.hunks.map((hunk) => (
						<label key={hunk.id} className={styles.rewriteHunk}>
							<input
								type="checkbox"
								checked={selected.includes(hunk.id)}
								onChange={(event) =>
									setSelected((ids) =>
										event.target.checked
											? [...ids, hunk.id]
											: ids.filter((id) => id !== hunk.id),
									)
								}
							/>
							<span>{hunk.id}</span>
							<del>{hunk.before.join('\n')}</del>
							<ins>{hunk.after.join('\n')}</ins>
						</label>
					))}
					<button
						type="button"
						className={styles.button}
						disabled={busy || !selected.length}
						onClick={async () => {
							setBusy(true)
							try {
								await window.novelive.call('editor.applyRewrite', {
									workId: rewrite.workId,
									chapterId: rewrite.chapterId,
									sceneId: rewrite.sceneId,
									expectedRevision: rewrite.expectedRevision,
									proposalId: rewrite.proposalId,
									hunkIds: selected,
								}).promise
								setRewrite(undefined)
								window.dispatchEvent(
									new CustomEvent('novelive:chapter-changed', {
										detail: {
											workId: rewrite.workId,
											chapterId: rewrite.chapterId,
										},
									}),
								)
							} catch {
								setError(t('没能应用，请刷新后重试'))
							} finally {
								setBusy(false)
							}
						}}
					>
						{t('应用勾选差异')}
					</button>
				</section>
			)}
			<span className={styles.caption}>{t(proposalKinds[payload.kind])}</span>
			<p className={styles.proposalPrompt}>{current.prompt}</p>
			{payload.kind === 'requirements' && (
				<dl className={styles.diff}>
					<dt>{t('改前')}</dt>
					<dd>{payload.previous}</dd>
					<dt>{t('改后')}</dt>
					<dd>{payload.next}</dd>
				</dl>
			)}
			<p className={styles.impact}>
				{t('影响：')}
				{chapters.length ? chapters.join(t('、')) : t('不改动已生成的章节')}
			</p>
			{restriction && (
				<p className={styles.resolution} role="status">
					{restriction}
				</p>
			)}
			{stale ? (
				<p className={styles.resolution} role="status">
					{t('内容已经变了，这张卡已过期')}
				</p>
			) : current.status === 'approved' ? (
				<p className={styles.resolution} role="status">
					<Check aria-hidden="true" size={14} /> {t('已确认')}
				</p>
			) : current.status === 'rejected' ? (
				<p className={styles.resolution} role="status">
					<Ban aria-hidden="true" size={14} /> {t('已拒绝')}
					{current.feedback
						? t('：{{feedback}}', { feedback: current.feedback })
						: ''}
				</p>
			) : rejecting ? (
				<div className={styles.rejectBox}>
					<ScrollField
						aria-label={t('拒绝理由')}
						placeholder={t('理由（可不填），Agent 会据此调整')}
						rows={2}
						value={reason}
						onChange={(event) => setReason(event.target.value)}
					/>
					<div className={styles.actions}>
						<button
							type="button"
							className={styles.button}
							onClick={() => setRejecting(false)}
						>
							{t('取消')}
						</button>
						<button
							type="button"
							className={styles.danger}
							disabled={busy}
							onClick={() =>
								void decide({
									kind: 'reject',
									...(reason.trim() ? { reason: reason.trim() } : {}),
								})
							}
						>
							{t('确认拒绝')}
						</button>
					</div>
				</div>
			) : (
				<div className={styles.actions}>
					<button
						type="button"
						className={styles.button}
						disabled={busy}
						onClick={() => setRejecting(true)}
					>
						{t('拒绝')}
					</button>
					<button
						type="button"
						className={styles.primary}
						disabled={busy || Boolean(restriction)}
						onClick={() => void decide({ kind: 'approve' })}
					>
						{t('确认')}
					</button>
				</div>
			)}
			{error && (
				<p className={styles.error} role="alert">
					{error}
				</p>
			)}
		</section>
	)
}

export function MessageParts({
	parts,
	activity,
	actions,
	onPreview,
}: {
	parts: Part[]
	activity: Activity
	actions: ProposalActions
	onPreview: (attachment: Attachment) => void
}) {
	return parts.map((part, index) => {
		const key = `${part.type}-${index}`
		switch (part.type) {
			case 'text':
				return (
					<Streamdown
						key={key}
						className={styles.markdown}
						codeBlockMaxHeight={0}
						parseIncompleteMarkdown={activity === 'streaming'}
					>
						{part.text}
					</Streamdown>
				)
			case 'reasoning':
				return (
					<Disclosure
						key={key}
						label={t('思考过程')}
						icon={<CircleDashed aria-hidden="true" size={15} />}
						defaultOpen={activity === 'streaming'}
					>
						<p className={styles.reasoning}>{part.text}</p>
					</Disclosure>
				)
			case 'image':
				return (
					<button
						key={key}
						type="button"
						className={styles.thumb}
						aria-label={t('查看图片 {{name}}', { name: part.attachment.name })}
						onClick={() => onPreview(part.attachment)}
					>
						<img
							src={window.novelive.resourceUrl(part.attachment.cachePath)}
							alt={part.attachment.name}
						/>
					</button>
				)
			case 'tool':
				return <ToolCard key={part.id} part={part} activity={activity} />
			case 'subtask':
				return (
					<div key={part.id} className={styles.subtask}>
						{part.status === 'running' && activity !== 'streaming'
							? subtaskIcons.cancelled
							: subtaskIcons[part.status]}
						<span className={styles.cardTitle}>{part.label}</span>
						<span className={styles.caption}>
							{part.status === 'running' && activity === 'stopped'
								? t('已停止')
								: t(subtaskLabels[part.status])}
						</span>
					</div>
				)
			case 'proposal':
				return (
					<ProposalCard
						key={part.proposal.id}
						proposal={part.proposal}
						savedRewrite={part.rewrite}
						actions={actions}
					/>
				)
		}
		return null
	})
}
