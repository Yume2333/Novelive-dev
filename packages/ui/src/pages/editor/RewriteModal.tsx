import type { RewriteProposal } from '@novelive/creator/contract'
import type { WorkSettings } from '@novelive/format/model'
import { Check, WandSparkles } from 'lucide-react'
import { Button, Spinner } from '../../components/Button'
import { Chip } from '../../components/Card'
import { Checkbox, Skeleton } from '../../components/Extended'
import { TextInput } from '../../components/Form'
import { Modal } from '../../components/Modal'
import { msg, scoped } from '../../i18n'
import { RichText } from './RichText'
import { parseSentenceLines } from './sentence-lines'

const t = scoped('editor')

const hunkKindLabel: Record<string, string> = {
	dialogue: msg('对白'),
	inner: msg('内心独白'),
	narration: msg('旁白'),
	caption: msg('字幕'),
}

export interface RewriteModalProps {
	open: boolean
	instruction: string
	sourceParagraph?: { id: string; text: string }
	proposal: RewriteProposal | undefined
	selected: readonly string[]
	loading: boolean
	error: string
	dirty: boolean
	busy: boolean
	speakerNames: Readonly<Record<string, string>>
	customMarks: WorkSettings['customMarks']
	onInstructionChange(value: string): void
	onToggleHunk(hunkId: string, checked: boolean): void
	onGenerate(): void
	onApply(): void
	onClose(): void
}

function HunkText({
	lines,
	customMarks,
}: {
	lines: string[]
	customMarks: WorkSettings['customMarks']
}) {
	return (
		<>
			{lines.map((rawLine, index) => {
				const parsed = parseSentenceLines(rawLine)[0]
				const occurrences = lines
					.slice(0, index)
					.filter((l) => l === rawLine).length
				const key = occurrences > 0 ? `${rawLine}#${occurrences}` : rawLine
				return (
					<span key={key} className="editor-hunk-line">
						{parsed ? (
							<RichText
								src={parsed.text}
								base="list"
								customMarks={customMarks}
							/>
						) : (
							<code className="editor-hunk-directive">{rawLine}</code>
						)}
					</span>
				)
			})}
		</>
	)
}

export function RewriteModal({
	open,
	instruction,
	sourceParagraph,
	proposal,
	selected,
	loading,
	error,
	dirty,
	busy,
	speakerNames,
	customMarks,
	onInstructionChange,
	onToggleHunk,
	onGenerate,
	onApply,
	onClose,
}: RewriteModalProps) {
	return (
		<Modal
			open={open}
			title={t('让 Agent 重写本场景')}
			onClose={onClose}
			width={640}
			closeDisabled={busy}
		>
			{error ? (
				<div className="editor-alert" role="alert">
					{error}
				</div>
			) : null}
			{sourceParagraph ? (
				<div className="editor-source-excerpt">{sourceParagraph.text}</div>
			) : null}
			{!proposal ? (
				<form
					className="editor-rewrite-form"
					onSubmit={(event) => {
						event.preventDefault()
						onGenerate()
					}}
				>
					<TextInput
						aria-label={t('重写要求')}
						value={instruction}
						onChange={onInstructionChange}
						placeholder={t('例如：节奏更快，保留所有演出指令')}
						disabled={busy || loading}
					/>
					{loading ? (
						<div className="editor-rewrite-loading">
							<div className="editor-rewrite-loading-status">
								<Spinner size={14} />
								<span className="ink-shimmer">
									{t('正在按指令重写本场景…')}
								</span>
							</div>
							<Skeleton width="88%" height={14} />
							<Skeleton width="72%" height={14} />
							<Skeleton width="94%" height={14} />
						</div>
					) : null}
					<div className="editor-rewrite-actions">
						<Button variant="ghost" onClick={onClose}>
							{t('取消重写')}
						</Button>
						<Button
							type="submit"
							variant="primary"
							icon={WandSparkles}
							loading={loading}
							disabled={!instruction.trim() || dirty || busy}
						>
							{t('重写场景')}
						</Button>
					</div>
				</form>
			) : null}
			{proposal ? (
				<section className="editor-diffs" aria-label={t('重写差异')}>
					<div className="editor-diffs-head">
						<span className="editor-diffs-summary">
							{t('共 {{count}} 处改动', {
								count: proposal.hunks.length,
							})}
						</span>
						{instruction.trim() ? (
							<Chip active>{t('已应用自定义指令')}</Chip>
						) : null}
					</div>
					{proposal.hunks.map((hunk) => {
						const beforeLines = parseSentenceLines(hunk.before.join('\n'))
						const firstLine =
							beforeLines[0] ?? parseSentenceLines(hunk.after.join('\n'))[0]
						const kindText = firstLine
							? t(hunkKindLabel[firstLine.kind] ?? firstLine.kind)
							: ''
						const speaker = firstLine?.speaker
							? (speakerNames[firstLine.speaker] ?? firstLine.speaker)
							: ''
						return (
							<div key={hunk.id} className="glass-panel editor-hunk-card">
								<Checkbox
									checked={selected.includes(hunk.id)}
									disabled={busy}
									onChange={(checked) => onToggleHunk(hunk.id, checked)}
									className="editor-hunk-check"
									label={
										<span className="editor-hunk-body">
											<span className="label-caps label-caps-zh editor-hunk-head">
												{kindText}
												{speaker ? ` ${speaker}` : ''}
												{` · ${hunk.id}`}
											</span>
											{hunk.before.length ? (
												<span className="editor-hunk-old">
													<HunkText
														lines={hunk.before}
														customMarks={customMarks}
													/>
												</span>
											) : null}
											{hunk.after.length ? (
												<span className="editor-hunk-new">
													<HunkText
														lines={hunk.after}
														customMarks={customMarks}
													/>
												</span>
											) : null}
										</span>
									}
								/>
							</div>
						)
					})}
					<div className="editor-diffs-foot">
						<Button variant="ghost" onClick={onClose}>
							{t('取消重写')}
						</Button>
						<Button
							variant="primary"
							icon={Check}
							disabled={!selected.length || dirty || busy}
							loading={busy}
							onClick={onApply}
						>
							{t('应用勾选差异（{{count}}）', { count: selected.length })}
						</Button>
					</div>
				</section>
			) : null}
		</Modal>
	)
}

export interface SourceRewriteModalProps {
	paragraph: { id: string; text: string } | null
	instruction: string
	busy: boolean
	onInstructionChange(v: string): void
	onClose(): void
	onConfirm(): void
}

export function SourceRewriteModal({
	paragraph,
	instruction,
	busy,
	onInstructionChange,
	onClose,
	onConfirm,
}: SourceRewriteModalProps) {
	return (
		<Modal
			open={paragraph !== null}
			title={t('让 Agent 按这段原文修改')}
			onClose={onClose}
			footer={
				<>
					<Button variant="ghost" onClick={onClose}>
						{t('取消')}
					</Button>
					<Button
						variant="primary"
						icon={WandSparkles}
						disabled={busy}
						onClick={onConfirm}
					>
						{t('生成修改')}
					</Button>
				</>
			}
		>
			{paragraph ? (
				<div className="editor-source-rewrite-body">
					<div className="editor-source-excerpt">{paragraph.text}</div>
					<TextInput
						aria-label={t('补充要求')}
						value={instruction}
						onChange={onInstructionChange}
						placeholder={t('补充要求（可选）：比如更贴近原文、只改对白')}
					/>
				</div>
			) : null}
		</Modal>
	)
}
