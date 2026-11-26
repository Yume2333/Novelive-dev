import type { CommandOutput, RewriteProposal } from '@novelive/creator/contract'
import {
	ArchiveRestore,
	Ban,
	BookOpen,
	Brain,
	Check,
	ChevronDown,
	CircleAlert,
	CircleCheck,
	CircleDashed,
	FilePenLine,
	GitBranch,
	Image as ImageIcon,
	Languages,
	Maximize2,
	RefreshCw,
	RotateCcw,
	SlidersHorizontal,
} from 'lucide-react'
import { type ComponentProps, useEffect, useRef, useState } from 'react'
import { Streamdown } from 'streamdown'
import { Button, Spinner } from '../../components/Button'
import { Chip } from '../../components/Card'
import { Collapse } from '../../components/Collapse'
import { Checkbox, ConfirmDialog } from '../../components/Extended'
import { OverlayScrollbar } from '../../components/ScrollArea'
import { msg, scoped } from '../../i18n'
import styles from './MessageView.module.css'
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

const proposalIcons = {
	bible: BookOpen,
	glossary: Languages,
	requirements: SlidersHorizontal,
	rewriteScene: FilePenLine,
	redrawImage: ImageIcon,
	redoChapter: RotateCcw,
	resynthesizeVolume: RefreshCw,
} as const

/* 工具 id → 人话标题；未登记的工具按原始 id 显示，展开详情里仍能见到原始 id */
const toolNames: Record<string, string> = {
	read_chapter_preview: msg('查看章节预览'),
	read_bible: msg('读取设定集'),
	read_glossary: msg('读取术语表'),
	read_scene: msg('查看场景'),
	read_source_range: msg('查看原文'),
	list_assets: msg('列出素材'),
	read_chapter_manifest: msg('查看章节清单'),
	read_task_result: msg('查看任务结果'),
	propose_bible_change: msg('提议修改设定集'),
	propose_glossary_change: msg('提议修改术语表'),
	propose_adaptation_notes: msg('提议修改改编要求'),
	propose_rewrite_scene: msg('提议重写场景'),
	propose_redraw_image: msg('提议重画图片'),
	propose_redo_chapter: msg('提议重做章节'),
	propose_resynthesize_volume: msg('提议重新综合'),
	spawn_agent: msg('派出子任务'),
}

function pretty(value: string) {
	try {
		return JSON.stringify(JSON.parse(value), null, 2)
	} catch {
		return value
	}
}

function parseJson(value: string | undefined): unknown {
	if (!value) return undefined
	try {
		return JSON.parse(value)
	} catch {
		return undefined
	}
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

function summarize(value: unknown): string {
	if (typeof value === 'string') return value
	if (typeof value === 'number' || typeof value === 'boolean')
		return String(value)
	if (value === null || value === undefined) return ''
	try {
		return JSON.stringify(value)
	} catch {
		return String(value)
	}
}

function readString(record: Record<string, unknown>, key: string): string {
	const value = record[key]
	return typeof value === 'string' ? value : ''
}

function ChevronIcon({ open, size = 14 }: { open: boolean; size?: number }) {
	return (
		<span className={`nl-chevron ${styles.chevron}`} data-open={open}>
			<ChevronDown aria-hidden="true" size={size} strokeWidth={1.8} />
		</span>
	)
}

/* ---- 思考块：实时计时 + 扫光，点开看推理正文 ---- */
function ThinkingBlock({
	text,
	active,
	defaultOpen,
}: {
	text: string
	active: boolean
	defaultOpen: boolean
}) {
	const [open, setOpen] = useState(defaultOpen)
	const [elapsed, setElapsed] = useState(0)
	// biome-ignore lint/correctness/useExhaustiveDependencies: elapsed 只在激活起点续算，不进依赖
	useEffect(() => {
		if (!active) return
		const startedAt = Date.now() - elapsed * 1000
		const timer = window.setInterval(() => {
			setElapsed((Date.now() - startedAt) / 1000)
		}, 100)
		return () => window.clearInterval(timer)
	}, [active])
	const label = active
		? t('思考过程 · {{seconds}}s', { seconds: elapsed.toFixed(1) })
		: elapsed > 0
			? t('思考过程 · {{seconds}} 秒', {
					seconds: Math.max(1, Math.round(elapsed)),
				})
			: t('思考过程')
	return (
		<div>
			<button
				type="button"
				className={styles.thinkingHead}
				aria-expanded={open}
				onClick={() => setOpen((value) => !value)}
			>
				<Brain
					aria-hidden="true"
					size={13}
					strokeWidth={1.8}
					className={styles.thinkingIcon}
					data-active={active}
				/>
				<span className={active ? 'ink-shimmer' : undefined}>{label}</span>
				<ChevronIcon open={open} size={13} />
			</button>
			<Collapse open={open}>
				<div className={styles.thinkingBody}>{text}</div>
			</Collapse>
		</div>
	)
}

/* ---- 工具卡：标题行常显，展开看参数、结果、检查、缩略图与原始数据 ---- */
type ToolCheck = { label: string; pass: boolean; note: string }

function readChecks(result: Record<string, unknown> | undefined): ToolCheck[] {
	if (!result || !Array.isArray(result.checks)) return []
	return result.checks.filter(isPlainObject).map((item) => ({
		label: summarize(item.label),
		pass: Boolean(item.pass),
		note: summarize(item.note),
	}))
}

function readImageRef(result: Record<string, unknown> | undefined): string {
	if (!result) return ''
	for (const key of ['imageThumb', 'cachePath', 'imagePath', 'imageUrl']) {
		const value = result[key]
		if (typeof value === 'string' && value) return value
	}
	return ''
}

function ToolCard({
	part,
	activity,
}: {
	part: Extract<Part, { type: 'tool' }>
	activity: Activity
}) {
	const [open, setOpen] = useState(false)
	const [rawOpen, setRawOpen] = useState(true)
	const done = part.result !== undefined
	const result = parseJson(part.result)
	const resultObject = isPlainObject(result) ? result : undefined
	const errorValue = resultObject?.error
	const failed = errorValue !== undefined
	const running = !done && activity === 'streaming'
	const status = done
		? failed
			? t('失败')
			: t('完成')
		: running
			? t('运行中')
			: activity === 'stopped'
				? t('已停止')
				: t('未完成')

	const input = parseJson(part.input)
	const inputEntries = isPlainObject(input) ? Object.entries(input) : []
	const checks = readChecks(resultObject)
	const errorText =
		errorValue === undefined
			? ''
			: isPlainObject(errorValue)
				? JSON.stringify(errorValue, null, 2)
				: summarize(errorValue)
	const imageRef = readImageRef(resultObject)
	const restEntries = resultObject
		? Object.entries(resultObject).filter(
				([key]) =>
					![
						'checks',
						'error',
						'imageUrl',
						'cachePath',
						'imagePath',
						'imageThumb',
					].includes(key),
			)
		: []
	const scalarResult =
		done && resultObject === undefined && !errorText ? (part.result ?? '') : ''
	const displayName =
		part.name in toolNames ? t(toolNames[part.name]) : part.name
	const hasDetail = Boolean(part.input || part.result)

	return (
		<div className={`glass-panel ${styles.glassCard}`}>
			<button
				type="button"
				className={styles.cardHead}
				aria-expanded={open}
				data-static={!hasDetail}
				onClick={() => hasDetail && setOpen((value) => !value)}
			>
				<span
					className={styles.statusIcon}
					data-tone={
						failed || (!done && !running)
							? 'error'
							: done
								? 'success'
								: undefined
					}
				>
					{running ? (
						<Spinner size={14} />
					) : done && !failed ? (
						<CircleCheck aria-hidden="true" size={15} strokeWidth={1.8} />
					) : (
						<CircleAlert aria-hidden="true" size={15} strokeWidth={1.8} />
					)}
				</span>
				<span className={styles.cardTitle}>{displayName}</span>
				<span
					className={`label-caps label-caps-zh ${styles.statusLabel}${running ? ' ink-shimmer' : ''}`}
					data-tone={failed ? 'error' : undefined}
				>
					{status}
				</span>
				{hasDetail ? <ChevronIcon open={open} size={14} /> : null}
			</button>
			<Collapse open={open && hasDetail}>
				<div className={styles.toolBody}>
					{displayName !== part.name && (
						<span className={styles.toolId}>{part.name}</span>
					)}
					{inputEntries.length > 0 && (
						<div>
							{inputEntries.map(([key, value]) => (
								<div key={key} className={styles.kvRow}>
									<span className={styles.kvLabel}>{key}</span>
									<span className={styles.kvValue}>{summarize(value)}</span>
								</div>
							))}
						</div>
					)}
					{errorText && (
						<div className={styles.errorCallout} role="alert">
							<CircleAlert aria-hidden="true" size={13} strokeWidth={1.8} />
							<span className={styles.errorText}>{errorText}</span>
						</div>
					)}
					{imageRef && (
						<div className={styles.imagePreview}>
							<ImageIcon aria-hidden="true" size={20} strokeWidth={1.8} />
						</div>
					)}
					{checks.length > 0 && (
						<div>
							{checks.map((check) => (
								<div key={check.label} className={styles.checkRow}>
									{check.pass ? (
										<CircleCheck
											aria-hidden="true"
											size={13}
											strokeWidth={1.8}
											className={styles.checkIcon}
										/>
									) : (
										<CircleAlert
											aria-hidden="true"
											size={13}
											strokeWidth={1.8}
											className={styles.checkIcon}
											data-pass="false"
										/>
									)}
									<span className={styles.kvValue}>{check.label}</span>
									{check.note && (
										<span className={styles.checkNote} data-pass={check.pass}>
											{check.note}
										</span>
									)}
								</div>
							))}
						</div>
					)}
					{restEntries.length > 0 && (
						<div>
							{restEntries.map(([key, value]) => (
								<div key={key} className={styles.kvRow}>
									<span className={styles.kvLabel}>{key}</span>
									<span className={styles.kvValue}>{summarize(value)}</span>
								</div>
							))}
						</div>
					)}
					{!restEntries.length &&
						!errorText &&
						!checks.length &&
						scalarResult && <p className={styles.resultText}>{scalarResult}</p>}
					<button
						type="button"
						className={styles.rawToggle}
						aria-expanded={rawOpen}
						onClick={() => setRawOpen((value) => !value)}
					>
						{t('原始数据')}
						<ChevronIcon open={rawOpen} size={12} />
					</button>
					<Collapse open={rawOpen}>
						<pre className={styles.code}>
							{done
								? `${t('参数')}\n${pretty(part.input)}\n${t('结果')}\n${pretty(part.result ?? '')}`
								: pretty(part.input)}
						</pre>
					</Collapse>
				</div>
			</Collapse>
		</div>
	)
}

/* ---- 子任务卡：可展开，嵌套显示子正文（只嵌一层） ---- */
const subtaskLabels = {
	running: msg('进行中'),
	done: msg('完成'),
	failed: msg('失败'),
	cancelled: msg('已取消'),
}

type SubtaskPart = Extract<Part, { type: 'subtask' }>
const partTypes = ['text', 'reasoning', 'image', 'tool', 'subtask', 'proposal']
function readNestedParts(part: SubtaskPart): Part[] {
	if (!('parts' in part) || !Array.isArray(part.parts)) return []
	// 后端契约暂未包含子任务嵌套部件，这里做前向兼容的轻量形状校验
	return part.parts.filter(
		(item): item is Part =>
			isPlainObject(item) &&
			typeof item.type === 'string' &&
			partTypes.includes(item.type),
	)
}

function SubtaskFlatRow({
	part,
	activity,
}: {
	part: Extract<Part, { type: 'subtask' }>
	activity: Activity
}) {
	const running = part.status === 'running' && activity === 'streaming'
	const failed = part.status === 'failed'
	const label =
		part.status === 'running' && activity === 'stopped'
			? t('已停止')
			: part.status === 'running' && activity !== 'streaming'
				? t('已取消')
				: t(subtaskLabels[part.status])
	return (
		<div className={`glass-panel ${styles.glassCard}`}>
			<div className={styles.cardHead} data-static="true">
				<span
					className={styles.statusIcon}
					data-tone={
						failed
							? 'error'
							: part.status === 'done'
								? 'success'
								: part.status === 'cancelled'
									? 'muted'
									: undefined
					}
				>
					{running ? (
						<Spinner size={14} />
					) : part.status === 'done' ? (
						<CircleCheck aria-hidden="true" size={15} strokeWidth={1.8} />
					) : part.status === 'cancelled' ? (
						<CircleDashed aria-hidden="true" size={15} strokeWidth={1.8} />
					) : (
						<CircleAlert aria-hidden="true" size={15} strokeWidth={1.8} />
					)}
				</span>
				<span className={styles.cardTitle}>{part.label}</span>
				<span
					className={`label-caps label-caps-zh ${styles.statusLabel}${running ? ' ink-shimmer' : ''}`}
					data-tone={failed ? 'error' : undefined}
				>
					{label}
				</span>
			</div>
		</div>
	)
}

function SubtaskCard({
	part,
	activity,
	actions,
	onPreview,
}: {
	part: Extract<Part, { type: 'subtask' }>
	activity: Activity
	actions: ProposalActions
	onPreview: (attachment: Attachment) => void
}) {
	const [open, setOpen] = useState(false)
	const running = part.status === 'running' && activity === 'streaming'
	const failed = part.status === 'failed'
	const nestedParts = readNestedParts(part)
	const label =
		part.status === 'running' && activity === 'stopped'
			? t('已停止')
			: part.status === 'running' && activity !== 'streaming'
				? t('已取消')
				: t(subtaskLabels[part.status])
	return (
		<div className={`glass-panel ${styles.glassCard}`}>
			<button
				type="button"
				className={styles.cardHead}
				aria-expanded={open}
				onClick={() => setOpen((value) => !value)}
			>
				<GitBranch
					aria-hidden="true"
					size={15}
					strokeWidth={1.8}
					className={styles.branchIcon}
				/>
				{running ? (
					<span className={styles.statusIcon}>
						<Spinner size={14} />
					</span>
				) : null}
				<span className={styles.cardTitle}>{part.label}</span>
				<Chip>{t('子任务')}</Chip>
				<span
					className={`label-caps label-caps-zh ${styles.statusLabel}${running ? ' ink-shimmer' : ''}`}
					data-tone={failed ? 'error' : undefined}
				>
					{label}
				</span>
				<ChevronIcon open={open} size={14} />
			</button>
			<Collapse open={open}>
				<div className={styles.subtaskBody}>
					{nestedParts.length ? (
						<MessageParts
							parts={nestedParts}
							activity={activity}
							actions={actions}
							onPreview={onPreview}
							nested
						/>
					) : (
						<div className={styles.subtaskDetail}>
							{part.status === 'done' ? (
								<CircleCheck
									aria-hidden="true"
									size={13}
									strokeWidth={1.8}
									className={styles.checkIcon}
								/>
							) : part.status === 'failed' ? (
								<CircleAlert
									aria-hidden="true"
									size={13}
									strokeWidth={1.8}
									className={styles.checkIcon}
									data-pass="false"
								/>
							) : (
								<CircleDashed aria-hidden="true" size={13} strokeWidth={1.8} />
							)}
							<span>{label}</span>
						</div>
					)}
				</div>
			</Collapse>
		</div>
	)
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

/* ---- 确认卡 ---- */
function patchSummary(proposal: Proposal): { lines: string[]; note: string } {
	const { payload } = proposal
	if (payload.kind === 'bible') {
		const counts = { add: 0, update: 0, delete: 0 }
		const names: string[] = []
		for (const change of payload.changes) {
			if (
				change.op === 'add' ||
				change.op === 'update' ||
				change.op === 'delete'
			)
				counts[change.op] += 1
			if ('entry' in change && isPlainObject(change.entry)) {
				const name = readString(change.entry, 'name')
				if (name) names.push(name)
			}
		}
		const lines: string[] = []
		if (counts.add) lines.push(t('新增 {{count}} 条', { count: counts.add }))
		if (counts.update)
			lines.push(t('更新 {{count}} 条', { count: counts.update }))
		if (counts.delete)
			lines.push(t('删除 {{count}} 条', { count: counts.delete }))
		return { lines, note: names.slice(0, 3).join(t('、')) }
	}
	if (payload.kind === 'glossary') {
		const names = payload.changes
			.map((entry) =>
				'original' in entry && typeof entry.original === 'string'
					? entry.original
					: '',
			)
			.filter(Boolean)
			.slice(0, 4)
		const lines = payload.changes.length
			? [t('调整 {{count}} 条术语', { count: payload.changes.length })]
			: []
		return { lines, note: names.join(t('、')) }
	}
	return { lines: [], note: '' }
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
	const [confirming, setConfirming] = useState(false)
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
	const destructive =
		payload.kind === 'resynthesizeVolume' ||
		payload.kind === 'redrawImage' ||
		(payload.kind === 'redoChapter' && current.chapterIds.length > 1)
	const approve = () => {
		if (destructive) setConfirming(true)
		else void decide({ kind: 'approve' })
	}
	const summary = patchSummary(current)
	const KindIcon = proposalIcons[payload.kind]
	return (
		<section
			className={`glass-panel ${styles.proposal}`}
			aria-label={t('确认卡')}
			data-resolved={current.status === 'rejected' ? 'rejected' : undefined}
		>
			{rewrite && (
				<section className={styles.rewrite} aria-label={t('重写差异')}>
					{rewrite.hunks.map((hunk) => (
						<div key={hunk.id} className={styles.rewriteHunk}>
							<Checkbox
								checked={selected.includes(hunk.id)}
								onChange={(checked) =>
									setSelected((ids) =>
										checked
											? [...ids, hunk.id]
											: ids.filter((id) => id !== hunk.id),
									)
								}
								label={<span className={styles.rewriteHunkId}>{hunk.id}</span>}
							/>
							<del>{hunk.before.join('\n')}</del>
							<ins>{hunk.after.join('\n')}</ins>
						</div>
					))}
					<div className={styles.actions}>
						<Button
							size="sm"
							variant="primary"
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
						</Button>
					</div>
				</section>
			)}
			<div className={styles.proposalHead}>
				<KindIcon
					aria-hidden="true"
					size={15}
					strokeWidth={1.8}
					className={styles.proposalKindIcon}
				/>
				<span className={styles.proposalTitle}>{current.prompt}</span>
				<Chip>{t(proposalKinds[payload.kind])}</Chip>
				{current.status === 'approved' ? (
					<Chip active>{t('已确认')}</Chip>
				) : current.status === 'rejected' ? (
					<Chip>{t('已拒绝')}</Chip>
				) : null}
			</div>
			{payload.kind === 'requirements' && (
				<div className={styles.diffLines}>
					{payload.previous ? (
						<span className={styles.diffBefore}>{payload.previous}</span>
					) : null}
					{payload.next ? (
						<span className={styles.diffAfter}>{payload.next}</span>
					) : null}
				</div>
			)}
			{(payload.kind === 'bible' || payload.kind === 'glossary') &&
			summary.lines.length ? (
				<div className={styles.diffLines}>
					{summary.lines.map((line) => (
						<span key={line} className={styles.diffAfter}>
							{line}
						</span>
					))}
					{summary.note ? (
						<span className={styles.diffNote}>{summary.note}</span>
					) : null}
				</div>
			) : null}
			{payload.kind === 'redrawImage' && (
				<div className={styles.diffLines}>
					<span className={styles.diffAfter}>
						{t('图片 {{assetId}}', { assetId: payload.assetId })}
					</span>
					{payload.instruction ? (
						<span className={styles.diffNote}>{payload.instruction}</span>
					) : null}
				</div>
			)}
			{payload.kind === 'rewriteScene' && payload.request.instruction ? (
				<div className={styles.diffLines}>
					<span className={styles.diffNote}>{payload.request.instruction}</span>
				</div>
			) : null}
			<p className={styles.impact}>
				{t('影响：')}
				{chapters.length ? chapters.join(t('、')) : t('不改动已生成的章节')}
			</p>
			{restriction && (
				<p className={styles.resolution} data-tone="error" role="status">
					{restriction}
				</p>
			)}
			{stale ? (
				<p className={styles.resolution} role="status">
					{t('内容已经变了，这张卡已过期')}
				</p>
			) : current.status === 'approved' ? (
				<p className={styles.resolution} role="status">
					<Check aria-hidden="true" size={14} strokeWidth={1.8} /> {t('已确认')}
				</p>
			) : current.status === 'rejected' ? (
				<p className={styles.resolution} role="status">
					<Ban aria-hidden="true" size={14} strokeWidth={1.8} /> {t('已拒绝')}
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
						<Button
							size="sm"
							variant="ghost"
							onClick={() => setRejecting(false)}
						>
							{t('取消')}
						</Button>
						<Button
							size="sm"
							variant="danger"
							disabled={busy}
							onClick={() =>
								void decide({
									kind: 'reject',
									...(reason.trim() ? { reason: reason.trim() } : {}),
								})
							}
						>
							{t('确认拒绝')}
						</Button>
					</div>
				</div>
			) : (
				<div className={styles.actions}>
					<Button
						size="sm"
						variant="ghost"
						disabled={busy}
						onClick={() => setRejecting(true)}
					>
						{t('拒绝')}
					</Button>
					<Button
						size="sm"
						variant="primary"
						disabled={busy || Boolean(restriction)}
						onClick={approve}
					>
						{t('确认')}
					</Button>
				</div>
			)}
			{error && (
				<p className={styles.error} role="alert">
					{error}
				</p>
			)}
			<ConfirmDialog
				open={confirming}
				title={t(proposalKinds[payload.kind])}
				message={
					payload.kind === 'redrawImage'
						? t('会重新画这张图，现有的画面会被替换。')
						: payload.kind === 'resynthesizeVolume'
							? t('会重新综合这一卷，已有的综合结果会被覆盖。')
							: t('会重做 {{count}} 章已生成的内容。', {
									count: current.chapterIds.length,
								})
				}
				confirmLabel={t('确认')}
				cancelLabel={t('取消')}
				danger
				busy={busy}
				onConfirm={() => {
					setConfirming(false)
					void decide({ kind: 'approve' })
				}}
				onCancel={() => setConfirming(false)}
			/>
		</section>
	)
}

/* ---- 流式占位气泡 ---- */
export function StreamingPlaceholder() {
	return (
		<div className={styles.streamBubble}>
			<span className={`ink-shimmer ${styles.streamBubbleText}`}>
				{t('正在组织回复')}
			</span>
			<span className="typing-caret" />
		</div>
	)
}

/* ---- 摘要分隔条 ---- */
export function SummaryDivider({
	kind,
	summary,
}: {
	kind: 'compaction' | 'branch_summary'
	summary: string
}) {
	const [open, setOpen] = useState(false)
	return (
		<div className={styles.summaryDivider}>
			<button
				type="button"
				className={styles.summaryToggle}
				aria-expanded={open}
				onClick={() => setOpen((value) => !value)}
			>
				<span className={styles.summaryRule} aria-hidden="true" />
				<span className={styles.summaryLabel}>
					<ArchiveRestore aria-hidden="true" size={12} strokeWidth={1.8} />
					{kind === 'compaction'
						? t('较早的内容已压缩成摘要')
						: t('另一条分支的摘要')}
					<ChevronIcon open={open} size={13} />
				</span>
				<span className={styles.summaryRule} aria-hidden="true" />
			</button>
			<Collapse open={open}>
				<div className={styles.summaryBox}>{summary}</div>
			</Collapse>
		</div>
	)
}

/* ---- 消息部件渲染 ---- */
export function MessageParts({
	parts,
	activity,
	actions,
	onPreview,
	nested,
	mine,
}: {
	parts: Part[]
	activity: Activity
	actions: ProposalActions
	onPreview: (attachment: Attachment) => void
	nested?: boolean
	mine?: boolean
}) {
	const streaming = activity === 'streaming'
	const hasActiveStep =
		streaming &&
		parts.some(
			(part) =>
				(part.type === 'tool' && part.result === undefined) ||
				(part.type === 'subtask' && part.status === 'running'),
		)
	// 流式期间仍在进行的思考：最后一段 reasoning，且其后没有实质内容（允许结尾的空文本占位）
	const lastReasoningIndex = parts.findLastIndex(
		(part) => part.type === 'reasoning',
	)
	const lastActiveReasoning =
		streaming &&
		lastReasoningIndex >= 0 &&
		parts
			.slice(lastReasoningIndex + 1)
			.every((after) => after.type === 'text' && after.text === '')
			? lastReasoningIndex
			: -1
	const lastIndex = parts.length - 1
	const lastNonEmptyTextIndex = parts.findLastIndex(
		(part) => part.type === 'text' && part.text !== '',
	)
	const body = parts.map((part, index) => {
		const key = `${part.type}-${index}`
		switch (part.type) {
			case 'text': {
				if (streaming && index === lastIndex && part.text === '') {
					if (hasActiveStep) return null
					return <StreamingPlaceholder key={key} />
				}
				const caret = streaming && index === lastNonEmptyTextIndex
				const bubble = nested || mine ? undefined : styles.textBubble
				return (
					<div key={key} className={bubble}>
						<Streamdown
							className={styles.markdown}
							codeBlockMaxHeight={0}
							parseIncompleteMarkdown={streaming}
						>
							{part.text}
						</Streamdown>
						{caret ? (
							<span className="typing-caret" aria-hidden="true" />
						) : null}
					</div>
				)
			}
			case 'reasoning':
				return (
					<ThinkingBlock
						key={key}
						text={part.text}
						active={streaming && index === lastActiveReasoning}
						defaultOpen={streaming && index === lastActiveReasoning}
					/>
				)
			case 'image':
				return (
					<span key={key} className="nl-img-thumb">
						<button
							type="button"
							className={`nl-img-thumb-btn ${styles.thumb}`}
							aria-label={t('查看图片 {{name}}', {
								name: part.attachment.name,
							})}
							title={part.attachment.name}
							onClick={() => onPreview(part.attachment)}
						>
							<img
								src={window.novelive.resourceUrl(part.attachment.cachePath)}
								alt={part.attachment.name}
							/>
							<span className="nl-img-thumb-mask" aria-hidden="true">
								<Maximize2 size={16} strokeWidth={1.8} />
							</span>
						</button>
					</span>
				)
			case 'tool':
				return <ToolCard key={part.id} part={part} activity={activity} />
			case 'subtask':
				return nested ? (
					<SubtaskFlatRow key={part.id} part={part} activity={activity} />
				) : (
					<SubtaskCard
						key={part.id}
						part={part}
						activity={activity}
						actions={actions}
						onPreview={onPreview}
					/>
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
	if (nested) return body
	return <div className={styles.parts}>{body}</div>
}
