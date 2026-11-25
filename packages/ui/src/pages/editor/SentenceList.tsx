import type { WorkSettings } from '@novelive/format/model'
import {
	AlignLeft,
	ChevronDown,
	Clock3,
	Gauge,
	type LucideIcon,
	MessageSquare,
	Sparkles,
	Subtitles,
	Trash2,
} from 'lucide-react'
import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { Chip } from '../../components/Card'
import { Collapse } from '../../components/Collapse'
import { OverlayScrollbar, ScrollArea } from '../../components/ScrollArea'
import { msg, scoped } from '../../i18n'
import {
	type MarkSpan,
	parseRich,
	removeMarkSpan,
	rewriteMarkSpan,
	type SentenceKind,
	type SentenceLine,
	scanMarks,
} from './sentence-lines'

const t = scoped('editor')

const kindMeta: Record<SentenceKind, { label: string; icon: LucideIcon }> = {
	dialogue: { label: msg('对白'), icon: MessageSquare },
	inner: { label: msg('内心独白'), icon: Sparkles },
	narration: { label: msg('旁白'), icon: AlignLeft },
	caption: { label: msg('字幕'), icon: Subtitles },
}

const builtinMarks = [
	{ id: 'em', label: msg('强调') },
	{ id: 'b', label: msg('加粗') },
	{ id: 'dim', label: msg('弱化') },
	{ id: 'whisper', label: msg('小声') },
	{ id: 'shout', label: msg('大喊') },
	{ id: 'glitch', label: msg('扭曲') },
	{ id: 'hl', label: msg('高亮') },
] as const

function markDisplayName(id: string): string {
	const found = builtinMarks.find((item) => item.id === id)
	if (found) return t(found.label)
	if (id === 'ruby') return t('注音')
	if (id === 'speed') return t('变速')
	if (id === 'wait') return t('停顿')
	return id
}

function segmentStyle(
	mark: string,
	customMarks: WorkSettings['customMarks'],
): CSSProperties {
	switch (mark) {
		case 'em':
			return { color: 'var(--color-primary)', fontWeight: 600 }
		case 'b':
			return { fontWeight: 800 }
		case 'dim':
			return { opacity: 0.55 }
		case 'whisper':
			return { opacity: 0.72, fontSize: '0.88em' }
		case 'shout':
			return { fontWeight: 800, fontSize: '1.15em', letterSpacing: '0.04em' }
		case 'glitch':
			return {
				display: 'inline-block',
				transform: 'skewX(-6deg)',
				textShadow:
					'1px 0 color-mix(in srgb, var(--color-error) 80%, transparent), -1px 0 color-mix(in srgb, var(--color-primary) 80%, transparent)',
			}
		case 'hl':
			return {
				background: 'var(--color-tertiary-fixed)',
				padding: '0 var(--space-1)',
				borderRadius: 'var(--radius-sm)',
			}
		default:
			if (Object.hasOwn(customMarks, mark))
				return {
					background: 'var(--color-secondary-container)',
					borderBottom: '1px dashed var(--color-primary)',
					padding: '0 var(--space-1)',
					borderRadius: 'var(--radius-sm)',
				}
			return {
				textDecoration: 'underline dotted',
				textUnderlineOffset: '3px',
			}
	}
}

function RichText({
	src,
	customMarks,
}: {
	src: string
	customMarks: WorkSettings['customMarks']
}) {
	return (
		<>
			{parseRich(src).map((seg, index) => {
				const key = `${seg.kind}-${index}`
				if (seg.kind === 'text') return <span key={key}>{seg.text}</span>
				if (seg.kind === 'mark')
					return (
						<span key={key} style={segmentStyle(seg.mark, customMarks)}>
							{seg.text.includes('{') ? (
								<RichText src={seg.text} customMarks={customMarks} />
							) : (
								seg.text
							)}
						</span>
					)
				if (seg.kind === 'ruby')
					return (
						<ruby className="editor-rich-ruby" key={key}>
							{seg.text}
							<rt>{seg.reading}</rt>
						</ruby>
					)
				if (seg.kind === 'wait')
					return (
						<span
							className="editor-rich-tag"
							key={key}
							title={t('停顿 {{seconds}} 秒', { seconds: seg.seconds })}
						>
							<Clock3 aria-hidden="true" size={12} strokeWidth={1.8} />
							{seg.seconds}s
						</span>
					)
				return (
					<span
						className="editor-rich-speed"
						key={key}
						title={t('变速 ×{{factor}}', { factor: seg.factor })}
					>
						<Gauge aria-hidden="true" size={12} strokeWidth={1.8} />
						{seg.text}
					</span>
				)
			})}
		</>
	)
}

function ActiveSentenceCard({
	sentence,
	speakerName,
	lineDirty,
	dirty,
	pendingRefresh,
	busy,
	expression,
	customMarks,
	onUpdateLine,
	onChangeExpression,
	onSave,
	onDiscard,
	onUndo,
}: {
	sentence: SentenceLine
	speakerName: string | undefined
	lineDirty: boolean
	dirty: boolean
	pendingRefresh: boolean
	busy: boolean
	expression: { lineId: string; current: string; choices: string[] } | undefined
	customMarks: WorkSettings['customMarks']
	onUpdateLine: (
		lineNumber: number,
		patch: { text?: string; displayAs?: string },
	) => void
	onChangeExpression: (nextExpression: string) => void
	onSave: () => void
	onDiscard: () => void
	onUndo: () => void
}) {
	const textRef = useRef<HTMLTextAreaElement>(null)
	const [activeMark, setActiveMark] = useState<number | null>(null)
	const [markEdits, setMarkEdits] = useState<Record<number, string>>({})
	const [paramEdits, setParamEdits] = useState<Record<number, string>>({})
	const markSpans = scanMarks(sentence.text)
	const customNames = Object.keys(customMarks)
	const lockedByOtherDirty = dirty && !lineDirty

	// State resets naturally when active sentence changes via key={sentence.lineId ?? sentence.lineNumber}.

	// markEdits/paramEdits are keyed by index into markSpans; any text change
	// can shift span indices, so drop stale drafts whenever text is rewritten.
	function clearMarkDrafts() {
		setMarkEdits({})
		setParamEdits({})
	}
	function wrapOrInsert(before: string, after: string) {
		if (busy || lockedByOtherDirty) return
		const el = textRef.current
		const start = el?.selectionStart ?? sentence.text.length
		const end = el?.selectionEnd ?? sentence.text.length
		const selected = sentence.text.slice(start, end)
		const nextText =
			sentence.text.slice(0, start) +
			before +
			selected +
			after +
			sentence.text.slice(end)
		onUpdateLine(sentence.lineNumber, { text: nextText })
		clearMarkDrafts()
		requestAnimationFrame(() => {
			if (!textRef.current) return
			textRef.current.focus()
			const caretStart = start + before.length
			const caretEnd = caretStart + selected.length
			textRef.current.setSelectionRange(caretStart, caretEnd)
		})
	}

	function insertWait() {
		if (busy || lockedByOtherDirty) return
		const tag = '{wait 0.5}'
		const el = textRef.current
		const at = el?.selectionEnd ?? sentence.text.length
		const nextText = sentence.text.slice(0, at) + tag + sentence.text.slice(at)
		onUpdateLine(sentence.lineNumber, { text: nextText })
		clearMarkDrafts()
		requestAnimationFrame(() => {
			if (!textRef.current) return
			textRef.current.focus()
			textRef.current.setSelectionRange(at + tag.length, at + tag.length)
		})
	}

	function applySpanEdit(index: number, span: MarkSpan, nextMark?: string) {
		const targetMark = nextMark ?? span.mark
		const nextInner = markEdits[index] ?? span.inner
		const nextParam = paramEdits[index] ?? span.param
		const nextText = rewriteMarkSpan(
			sentence.text,
			span,
			targetMark,
			nextParam,
			nextInner,
		)
		onUpdateLine(sentence.lineNumber, { text: nextText })
		clearMarkDrafts()
	}

	return (
		<div className="editor-sentence-body">
			<div className="editor-sentence-chips">
				<Chip active>{t(kindMeta[sentence.kind].label)}</Chip>
				{sentence.speaker && (
					<Chip>{sentence.displayAs || speakerName || sentence.speaker}</Chip>
				)}
				{!sentence.click && <Chip>{t('连播')}</Chip>}
			</div>

			{sentence.speaker && (
				<div
					className="editor-sentence-meta"
					data-two-col={expression ? 'true' : undefined}
				>
					{expression && (
						<label className="editor-field">
							<span className="editor-label">{t('表情')}</span>
							<select
								className="editor-compact-select"
								aria-label={t('表情')}
								value={expression.current}
								disabled={busy || dirty}
								title={dirty ? t('先保存或放弃当前修改') : undefined}
								onChange={(event) => onChangeExpression(event.target.value)}
							>
								{expression.choices.map((id) => (
									<option key={id} value={id}>
										{id.split('/').pop() ?? id}
									</option>
								))}
							</select>
						</label>
					)}
					<label className="editor-field">
						<span className="editor-label">{t('显示名')}</span>
						<input
							type="text"
							className="editor-input"
							aria-label={t('显示名')}
							value={sentence.displayAs ?? ''}
							placeholder={speakerName ?? sentence.speaker}
							disabled={busy || lockedByOtherDirty}
							onChange={(event) =>
								onUpdateLine(sentence.lineNumber, {
									displayAs: event.target.value,
								})
							}
						/>
					</label>
				</div>
			)}

			<label className="editor-field">
				<span className="editor-label">{t('文本')}</span>
				<div className="editor-textarea-wrap">
					<textarea
						ref={textRef}
						className="editor-textarea nl-scroll-hidden"
						aria-label={t('文本')}
						rows={3}
						value={sentence.text}
						disabled={busy || lockedByOtherDirty}
						onChange={(event) => {
							clearMarkDrafts()
							onUpdateLine(sentence.lineNumber, { text: event.target.value })
						}}
						onKeyDown={(event) => {
							if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
								event.preventDefault()
								if (lineDirty && sentence.text.trim() && sentence.lineId)
									onSave()
							} else if (
								(event.metaKey || event.ctrlKey) &&
								event.key.toLowerCase() === 'z' &&
								!event.shiftKey &&
								!dirty
							) {
								event.preventDefault()
								onUndo()
							}
						}}
					/>
					<OverlayScrollbar targetRef={textRef} />
				</div>
			</label>

			<div className="editor-field">
				<span className="editor-label">{t('加标记')}</span>
				<div className="editor-marks" role="toolbar" aria-label={t('文本效果')}>
					{builtinMarks.map((mark) => (
						<button
							type="button"
							key={mark.id}
							className="editor-chip-button"
							disabled={busy || lockedByOtherDirty}
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => wrapOrInsert(`{${mark.id}}`, `{/${mark.id}}`)}
						>
							{t(mark.label)}
						</button>
					))}
					{customNames.map((name) => (
						<button
							type="button"
							key={name}
							className="editor-chip-button"
							disabled={busy || lockedByOtherDirty}
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => wrapOrInsert(`{${name}}`, `{/${name}}`)}
						>
							{name}
						</button>
					))}
					<button
						type="button"
						className="editor-chip-button"
						disabled={busy || lockedByOtherDirty}
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => wrapOrInsert(t('{ruby よみ}'), '{/ruby}')}
					>
						{t('注音')}
					</button>
					<button
						type="button"
						className="editor-chip-button"
						disabled={busy || lockedByOtherDirty}
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => wrapOrInsert('{speed 0.5}', '{/speed}')}
					>
						{t('变速')}
					</button>
					<button
						type="button"
						className="editor-chip-button"
						disabled={busy || lockedByOtherDirty}
						onMouseDown={(event) => event.preventDefault()}
						onClick={insertWait}
					>
						{t('停顿')}
					</button>
				</div>
			</div>

			{markSpans.length > 0 && (
				<div className="editor-field">
					<span className="editor-label">{t('这句里的标记')}</span>
					<div className="editor-mark-spans">
						{markSpans.map((span, index) => {
							const open = activeMark === index
							const summary =
								span.mark === 'wait'
									? t('停顿 {{seconds}} 秒', {
											seconds: span.param ?? '0.5',
										})
									: span.mark === 'ruby'
										? `${span.inner} · ${span.param ?? ''}`
										: span.mark === 'speed'
											? `${span.inner} · ×${span.param ?? '1'}`
											: span.inner
							const isParametric =
								span.mark === 'wait' ||
								span.mark === 'ruby' ||
								span.mark === 'speed'
							const innerValue = markEdits[index] ?? span.inner
							const paramValue = paramEdits[index] ?? span.param ?? ''
							const spanDirty =
								innerValue !== span.inner || paramValue !== (span.param ?? '')
							return (
								<div
									key={`${span.start}-${span.mark}`}
									className="editor-mark-span"
									data-open={open || undefined}
								>
									<button
										type="button"
										className="editor-mark-span-toggle"
										aria-expanded={open}
										onClick={() => setActiveMark(open ? null : index)}
									>
										<Chip active={open}>{markDisplayName(span.mark)}</Chip>
										<span className="editor-mark-span-summary">{summary}</span>
										<ChevronDown
											aria-hidden="true"
											size={14}
											strokeWidth={1.8}
											className="nl-chevron"
											data-open={open ? 'true' : 'false'}
										/>
									</button>
									<Collapse open={open}>
										<div className="editor-mark-span-editor">
											{isParametric ? (
												<Chip>{markDisplayName(span.mark)}</Chip>
											) : (
												<select
													className="editor-mark-select"
													aria-label={t('选择标记')}
													value={span.mark}
													disabled={busy || lockedByOtherDirty}
													onChange={(event) =>
														applySpanEdit(index, span, event.target.value)
													}
												>
													{builtinMarks.map((item) => (
														<option key={item.id} value={item.id}>
															{t(item.label)}
														</option>
													))}
													{customNames.map((name) => (
														<option key={name} value={name}>
															{name}
														</option>
													))}
												</select>
											)}
											{span.mark !== 'wait' && (
												<input
													type="text"
													className="editor-input"
													aria-label={t('标记文字')}
													value={innerValue}
													disabled={busy || lockedByOtherDirty}
													onChange={(event) =>
														setMarkEdits((current) => ({
															...current,
															[index]: event.target.value,
														}))
													}
												/>
											)}
											{isParametric && (
												<input
													type="text"
													className="editor-input editor-mark-param"
													aria-label={t('标记参数')}
													value={paramValue}
													disabled={busy || lockedByOtherDirty}
													onChange={(event) =>
														setParamEdits((current) => ({
															...current,
															[index]: event.target.value,
														}))
													}
												/>
											)}
											<button
												type="button"
												className="editor-chip-button"
												disabled={busy || lockedByOtherDirty || !spanDirty}
												onClick={() => applySpanEdit(index, span)}
											>
												{t('应用')}
											</button>
											<button
												type="button"
												className="editor-icon-button editor-icon-button-small"
												aria-label={t('移除标记')}
												title={t('移除标记')}
												disabled={busy || lockedByOtherDirty}
												onClick={() => {
													onUpdateLine(sentence.lineNumber, {
														text: removeMarkSpan(sentence.text, span),
													})
													clearMarkDrafts()
													setActiveMark(null)
												}}
											>
												<Trash2
													aria-hidden="true"
													size={14}
													strokeWidth={1.8}
												/>
											</button>
										</div>
									</Collapse>
								</div>
							)
						})}
					</div>
				</div>
			)}

			{(lineDirty || pendingRefresh) && (
				<div className="editor-sentence-actions">
					<button
						type="button"
						className="editor-button editor-button-ghost"
						disabled={busy}
						onClick={onDiscard}
					>
						{t('放弃修改')}
					</button>
					<button
						type="button"
						className="editor-button editor-button-primary"
						disabled={
							busy || !lineDirty || !sentence.text.trim() || !sentence.lineId
						}
						onClick={onSave}
					>
						{t('保存当前句')}
					</button>
				</div>
			)}
		</div>
	)
}

export function SentenceList({
	sentences,
	savedNvs,
	activeLine,
	dirty,
	pendingRefresh,
	busy,
	speakerNames,
	customMarks,
	expression,
	onSelectLine,
	onUpdateLine,
	onChangeExpression,
	onSave,
	onDiscard,
	onUndo,
}: {
	sentences: SentenceLine[]
	savedNvs: string
	activeLine: number
	dirty: boolean
	pendingRefresh: boolean
	busy: boolean
	speakerNames: Record<string, string>
	customMarks: WorkSettings['customMarks']
	expression: { lineId: string; current: string; choices: string[] } | undefined
	onSelectLine: (lineNumber: number) => void
	onUpdateLine: (
		lineNumber: number,
		patch: { text?: string; displayAs?: string },
	) => void
	onChangeExpression: (nextExpression: string) => void
	onSave: () => void
	onDiscard: () => void
	onUndo: () => void
}) {
	const savedLines = savedNvs.split(/\r\n?|\n/)
	const activeRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		void activeLine
		activeRef.current?.scrollIntoView({ block: 'nearest' })
	}, [activeLine])

	if (!sentences.length) {
		return <p className="editor-empty">{t('这一场还没有可编辑的句子')}</p>
	}

	return (
		<ScrollArea className="editor-sentences-scroll">
			<div className="editor-sentence-list">
				{sentences.map((sentence) => {
					const active = sentence.lineNumber === activeLine
					const lineDirty =
						sentence.raw !== (savedLines[sentence.lineNumber - 1] ?? '')
					const meta = kindMeta[sentence.kind]
					const KindIcon = meta.icon
					const speakerName = sentence.speaker
						? (speakerNames[sentence.speaker] ?? sentence.speaker)
						: undefined

					return (
						<div
							key={sentence.lineId ?? sentence.lineNumber}
							ref={active ? activeRef : undefined}
							className="editor-sentence-card hover-row"
							data-active={active || undefined}
						>
							<button
								type="button"
								className="editor-sentence-trigger"
								aria-expanded={active}
								onClick={() => onSelectLine(sentence.lineNumber)}
							>
								<span
									className="editor-sentence-kind label-caps label-caps-zh"
									data-active={active || undefined}
								>
									<KindIcon aria-hidden="true" size={13} strokeWidth={1.8} />
									{t(meta.label)}
								</span>
								<span className="editor-sentence-summary">
									{sentence.speaker && (
										<span className="editor-sentence-speaker">
											{sentence.displayAs || speakerName}
											{sentence.displayAs && sentence.displayAs !== speakerName
												? t('（{{name}}）', { name: speakerName })
												: ''}
										</span>
									)}
									<span
										className="editor-sentence-preview"
										data-expanded={active || undefined}
									>
										<RichText src={sentence.text} customMarks={customMarks} />
									</span>
								</span>
								{lineDirty && (
									<span className="editor-chip">{t('未保存')}</span>
								)}
							</button>
							<Collapse open={active}>
								{active && (
									<ActiveSentenceCard
										key={sentence.lineId ?? sentence.lineNumber}
										sentence={sentence}
										speakerName={speakerName}
										lineDirty={lineDirty}
										dirty={dirty}
										pendingRefresh={pendingRefresh}
										busy={busy}
										expression={expression}
										customMarks={customMarks}
										onUpdateLine={onUpdateLine}
										onChangeExpression={onChangeExpression}
										onSave={onSave}
										onDiscard={onDiscard}
										onUndo={onUndo}
									/>
								)}
							</Collapse>
						</div>
					)
				})}
			</div>
		</ScrollArea>
	)
}
