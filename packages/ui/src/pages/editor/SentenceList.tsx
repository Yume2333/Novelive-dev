import type { WorkSettings } from '@novelive/format/model'
import {
	AlignLeft,
	Check,
	ChevronDown,
	Clock3,
	Gauge,
	Info,
	Languages,
	type LucideIcon,
	MessageSquare,
	MessageSquareText,
	MoreHorizontal,
	Sparkles,
	Subtitles,
	Trash2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button, IconButton } from '../../components/Button'
import { Chip, SectionLabel } from '../../components/Card'
import { Collapse } from '../../components/Collapse'
import { Dropdown } from '../../components/Dropdown'
import { Tooltip } from '../../components/Extended'
import { CompactSelect, Field, TextInput } from '../../components/Form'
import { EmptyState } from '../../components/Page'
import { OverlayScrollbar, ScrollArea } from '../../components/ScrollArea'
import { humanizeSlug } from '../../format/asset'
import { msg, scoped } from '../../i18n'
import {
	type AssetLabelInfo,
	expressionLabel,
	speakerDisplayName,
} from './display'
import { RichText } from './RichText'
import {
	type MarkSpan,
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

export const builtinMarks = [
	{ id: 'em', label: msg('强调') },
	{ id: 'b', label: msg('加粗') },
	{ id: 'dim', label: msg('弱化') },
	{ id: 'whisper', label: msg('小声') },
	{ id: 'shout', label: msg('大喊') },
	{ id: 'glitch', label: msg('扭曲') },
	{ id: 'hl', label: msg('高亮') },
] as const

export function markDisplayName(id: string): string {
	const found = builtinMarks.find((item) => item.id === id)
	if (found) return t(found.label)
	if (id === 'ruby') return t('注音')
	if (id === 'speed') return t('变速')
	if (id === 'wait') return t('停顿')
	return id
}

function ActiveSentenceCard({
	sentence,
	speakerName,
	lineDirty,
	dirty,
	pendingRefresh,
	busy,
	assetInfo,
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
	assetInfo: AssetLabelInfo
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
		const tag = '{wait 0.4}'
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
				{sentence.speaker && <Chip>{sentence.displayAs || speakerName}</Chip>}
			</div>

			{sentence.speaker && (
				<div
					className="editor-sentence-meta"
					data-two-col={expression ? 'true' : undefined}
				>
					{expression && (
						<Field label={t('表情')}>
							<CompactSelect
								aria-label={t('表情')}
								value={expression.current}
								disabled={busy || dirty}
								onChange={onChangeExpression}
								options={expression.choices.map((id) => ({
									value: id,
									label:
										expressionLabel(id, assetInfo) ||
										humanizeSlug(id.split('/').pop() ?? ''),
								}))}
							/>
						</Field>
					)}
					<Field label={t('显示名')}>
						<TextInput
							aria-label={t('显示名')}
							value={sentence.displayAs ?? ''}
							placeholder={speakerName}
							disabled={busy || lockedByOtherDirty}
							onChange={(value) =>
								onUpdateLine(sentence.lineNumber, { displayAs: value })
							}
						/>
					</Field>
				</div>
			)}

			<Field label={t('文本')}>
				<div className="editor-textarea-wrap nl-scroll-host">
					<textarea
						ref={textRef}
						className="nl-input editor-textarea nl-scroll-hidden"
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
			</Field>

			<div className="editor-field">
				<span className="editor-marks-head">
					<SectionLabel>{t('加标记')}</SectionLabel>
					<Tooltip
						text={t('先选中文字再点标记；也可以直接输入 {标记}…{/标记}')}
					>
						<Info
							aria-hidden="true"
							size={14}
							strokeWidth={1.8}
							className="editor-info-icon"
						/>
					</Tooltip>
				</span>
				<div className="editor-marks" role="toolbar" aria-label={t('文本效果')}>
					{builtinMarks.map((mark) => (
						// biome-ignore lint/a11y/noStaticElementInteractions: mousedown 只是为了阻止文本域选区丢失，不承担交互
						<span key={mark.id} onMouseDown={(event) => event.preventDefault()}>
							<Chip
								onClick={
									busy || lockedByOtherDirty
										? undefined
										: () => wrapOrInsert(`{${mark.id}}`, `{/${mark.id}}`)
								}
							>
								{t(mark.label)}
							</Chip>
						</span>
					))}
					{customNames.map((name) => (
						// biome-ignore lint/a11y/noStaticElementInteractions: mousedown 只是为了阻止文本域选区丢失，不承担交互
						<span key={name} onMouseDown={(event) => event.preventDefault()}>
							<Chip
								onClick={
									busy || lockedByOtherDirty
										? undefined
										: () => wrapOrInsert(`{${name}}`, `{/${name}}`)
								}
							>
								{name}
							</Chip>
						</span>
					))}
					{/* biome-ignore lint/a11y/noStaticElementInteractions: mousedown 只是为了阻止文本域选区丢失，不承担交互 */}
					<span onMouseDown={(event) => event.preventDefault()}>
						<Dropdown
							label={t('更多标记')}
							className="editor-more-marks-trigger nl-btn glass-panel"
							trigger={
								<span className="editor-more-marks-btn">
									<MoreHorizontal
										aria-hidden="true"
										size={14}
										strokeWidth={1.8}
									/>
									{t('更多标记')}
								</span>
							}
							items={[
								{
									label: t('注音'),
									icon: Languages,
									disabled: busy || lockedByOtherDirty,
									onSelect: () => wrapOrInsert(t('{ruby よみ}'), '{/ruby}'),
								},
								{
									label: t('变速 ×0.6'),
									icon: Gauge,
									disabled: busy || lockedByOtherDirty,
									onSelect: () => wrapOrInsert('{speed 0.6}', '{/speed}'),
								},
								{
									label: t('停顿 0.4 秒'),
									icon: Clock3,
									disabled: busy || lockedByOtherDirty,
									onSelect: insertWait,
								},
							]}
						/>
					</span>
				</div>
			</div>

			{markSpans.length > 0 && (
				<div className="editor-field">
					<SectionLabel>{t('这句里的标记')}</SectionLabel>
					<div className="editor-mark-spans">
						{markSpans.map((span, index) => {
							const open = activeMark === index
							const summary =
								span.mark === 'wait'
									? t('停顿 {{seconds}} 秒', {
											seconds: span.param ?? '0.4',
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
												<CompactSelect
													aria-label={t('选择标记')}
													value={span.mark}
													disabled={busy || lockedByOtherDirty}
													onChange={(nextMark) =>
														applySpanEdit(index, span, nextMark)
													}
													options={[
														...builtinMarks.map((item) => ({
															value: item.id,
															label: t(item.label),
														})),
														...customNames.map((name) => ({
															value: name,
															label: name,
														})),
													]}
												/>
											)}
											{span.mark !== 'wait' && (
												<TextInput
													aria-label={t('标记文字')}
													value={innerValue}
													disabled={busy || lockedByOtherDirty}
													onChange={(value) =>
														setMarkEdits((current) => ({
															...current,
															[index]: value,
														}))
													}
												/>
											)}
											{isParametric && (
												<TextInput
													aria-label={t('标记参数')}
													className="editor-mark-param"
													value={paramValue}
													disabled={busy || lockedByOtherDirty}
													onChange={(value) =>
														setParamEdits((current) => ({
															...current,
															[index]: value,
														}))
													}
												/>
											)}
											<Button
												size="sm"
												icon={Check}
												disabled={busy || lockedByOtherDirty || !spanDirty}
												onClick={() => applySpanEdit(index, span)}
											>
												{t('应用')}
											</Button>
											<Tooltip text={t('移除标记')}>
												<IconButton
													icon={Trash2}
													size={28}
													iconSize={14}
													label={t('移除标记')}
													disabled={busy || lockedByOtherDirty}
													onClick={() => {
														onUpdateLine(sentence.lineNumber, {
															text: removeMarkSpan(sentence.text, span),
														})
														clearMarkDrafts()
														setActiveMark(null)
													}}
												/>
											</Tooltip>
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
					<Button size="sm" variant="ghost" disabled={busy} onClick={onDiscard}>
						{t('放弃修改')}
					</Button>
					<Button
						size="sm"
						variant="primary"
						disabled={
							busy || !lineDirty || !sentence.text.trim() || !sentence.lineId
						}
						onClick={onSave}
					>
						{t('保存当前句')}
					</Button>
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
	playing = false,
	assetInfo,
	editedLineIds,
	speakerNames,
	customMarks,
	expression,
	onSelectLine,
	onUpdateLine,
	onChangeExpression,
	onSave,
	onDiscard,
	onUndo,
	onAskAgent,
}: {
	sentences: SentenceLine[]
	savedNvs: string
	activeLine: number
	dirty: boolean
	pendingRefresh: boolean
	busy: boolean
	playing?: boolean
	editedLineIds?: ReadonlySet<string>
	speakerNames: Record<string, string>
	customMarks: WorkSettings['customMarks']
	expression: { lineId: string; current: string; choices: string[] } | undefined
	assetInfo: AssetLabelInfo
	onSelectLine: (lineNumber: number) => void
	onUpdateLine: (
		lineNumber: number,
		patch: { text?: string; displayAs?: string },
	) => void
	onChangeExpression: (nextExpression: string) => void
	onSave: () => void
	onDiscard: () => void
	onUndo: () => void
	onAskAgent?: (sentence: SentenceLine) => void
}) {
	const savedLines = savedNvs.split(/\r\n?|\n/)
	const activeRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		void activeLine
		const card = activeRef.current
		// 只在自己的滚动视口内对齐：scrollIntoView 会连带滚动所有祖先
		// （包括外壳主滚动区），把页首的标记提议横幅顶出屏幕。
		const viewport = card?.closest('[data-scroll-viewport]')
		if (!card || !(viewport instanceof HTMLElement)) return
		const cardRect = card.getBoundingClientRect()
		const viewportRect = viewport.getBoundingClientRect()
		// 与 scrollIntoView({ block: 'nearest' }) 一致的最近边对齐：
		// 完全可见或完全盖住视口都不滚动；只滚动这一个视口，不向祖先传播。
		const above = viewportRect.top - cardRect.top
		const below = cardRect.bottom - viewportRect.bottom
		if (above <= 0 && below <= 0) return
		if (above > 0 && below > 0) return
		viewport.scrollTop +=
			above > 0 ? -Math.min(above, -below) : Math.min(below, -above)
	}, [activeLine])

	if (!sentences.length) {
		return (
			<EmptyState
				icon={MessageSquareText}
				text={t('这一场还没有可编辑的句子')}
			/>
		)
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
						? speakerDisplayName(speakerNames, sentence.speaker)
						: undefined
					const edited =
						lineDirty ||
						(sentence.lineId !== undefined &&
							editedLineIds?.has(sentence.lineId) === true)

					return (
						<div
							key={sentence.lineId ?? sentence.lineNumber}
							ref={active ? activeRef : undefined}
							className="editor-sentence-card hover-row"
							data-active={active || undefined}
							data-playing={playing && active ? 'true' : undefined}
						>
							<div className="editor-sentence-row">
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
												{sentence.displayAs &&
												sentence.displayAs !== speakerName
													? t('（{{name}}）', { name: speakerName })
													: ''}
											</span>
										)}
										<span
											className="editor-sentence-preview"
											data-expanded={active || undefined}
										>
											<RichText
												src={sentence.text}
												base="list"
												customMarks={customMarks}
											/>
										</span>
									</span>
									{edited && (
										<Tooltip text={t('这句改过了')}>
											<span className="editor-edited-dot" />
										</Tooltip>
									)}
									{lineDirty && <Chip>{t('未保存')}</Chip>}
								</button>
								{onAskAgent && (
									<span className="row-actions editor-sentence-row-actions">
										<Tooltip text={t('问 Agent（带着这句的上下文）')}>
											<IconButton
												icon={Sparkles}
												size={28}
												iconSize={14}
												label={t('问 Agent')}
												disabled={busy}
												onClick={() => onAskAgent(sentence)}
											/>
										</Tooltip>
									</span>
								)}
							</div>
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
										assetInfo={assetInfo}
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
