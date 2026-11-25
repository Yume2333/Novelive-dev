import { ImagePlus, Maximize2, Minimize2, Send, Square, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Chip } from '../../components/Card'
import { Tooltip } from '../../components/Extended'
import { OverlayScrollbar } from '../../components/ScrollArea'
import { scoped } from '../../i18n'
import styles from './AgentPanel.module.css'
import type { Attachment } from './session'

const t = scoped('agent')

const imageTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const inputMinHeight = 36
const inputMaxHeight = 168
type Pending = { attachment: Attachment; url: string }

export function Composer({
	streaming,
	sessionId,
	disabled,
	contextLabel,
	expanded,
	onExpandedChange,
	onDetachContext,
	onAttach,
	onSend,
	onStop,
	onPreview,
}: {
	streaming: boolean
	sessionId: string | null
	disabled: boolean
	contextLabel?: string | null
	expanded: boolean
	onExpandedChange(expanded: boolean): void
	onDetachContext?(): void
	onAttach(file: File): Promise<Attachment>
	onSend(text: string, attachmentIds: string[]): Promise<void>
	onStop(): void
	onPreview(src: string, name: string): void
}) {
	const [text, setText] = useState('')
	const [pending, setPending] = useState<Pending[]>([])
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState('')
	const input = useRef<HTMLTextAreaElement>(null)
	const picker = useRef<HTMLInputElement>(null)
	const kept = useRef(pending)
	kept.current = pending
	const owner = useRef(sessionId)

	useEffect(
		() => () => {
			for (const item of kept.current) URL.revokeObjectURL(item.url)
		},
		[],
	)
	useEffect(() => {
		if (owner.current && owner.current !== sessionId)
			setPending((list) => {
				for (const item of list) URL.revokeObjectURL(item.url)
				return []
			})
		owner.current = sessionId
	}, [sessionId])
	// biome-ignore lint/correctness/useExhaustiveDependencies: 文字变化时重新量高
	useLayoutEffect(() => {
		const element = input.current
		if (!element) return
		if (expanded) {
			element.style.height = '100%'
			return
		}
		element.style.height = `${inputMinHeight}px`
		element.style.height = `${Math.min(
			Math.max(element.scrollHeight, inputMinHeight),
			inputMaxHeight,
		)}px`
	}, [text, expanded])

	const attach = async (files: File[]) => {
		const images = files.filter((file) => imageTypes.includes(file.type))
		if (!images.length) return
		setError('')
		try {
			for (const file of images) {
				const attachment = await onAttach(file)
				setPending((list) => [
					...list,
					{ attachment, url: URL.createObjectURL(file) },
				])
			}
		} catch {
			setError(t('图片没能加进来'))
		}
	}
	const remove = (id: string) =>
		setPending((list) => {
			for (const item of list)
				if (item.attachment.id === id) URL.revokeObjectURL(item.url)
			return list.filter((item) => item.attachment.id !== id)
		})
	const send = async () => {
		const trimmed = text.trim()
		if (busy || streaming || (!trimmed && !pending.length)) return
		setBusy(true)
		setError('')
		try {
			await onSend(
				trimmed,
				pending.map((item) => item.attachment.id),
			)
			for (const item of pending) URL.revokeObjectURL(item.url)
			setPending([])
			setText('')
			onExpandedChange(false)
		} catch {
			setError(t('没能发出，请重试'))
		} finally {
			setBusy(false)
		}
	}

	const attachButton = (
		<Tooltip text={t('添加图片')}>
			<button
				type="button"
				className={styles.iconButton}
				aria-label={t('添加图片')}
				disabled={disabled}
				onClick={() => picker.current?.click()}
			>
				<ImagePlus aria-hidden="true" size={17} strokeWidth={1.8} />
			</button>
		</Tooltip>
	)
	const sendOrStop = streaming ? (
		<Tooltip text={t('停止')}>
			<button
				type="button"
				className={styles.iconButton}
				aria-label={t('停止')}
				onClick={onStop}
			>
				<Square aria-hidden="true" size={15} strokeWidth={1.8} />
			</button>
		</Tooltip>
	) : (
		<Tooltip text={t('发送')}>
			<button
				type="button"
				className={styles.send}
				aria-label={t('发送')}
				disabled={disabled || busy || (!text.trim() && pending.length === 0)}
				onClick={() => void send()}
			>
				<Send aria-hidden="true" size={17} strokeWidth={1.8} />
			</button>
		</Tooltip>
	)
	const textarea = (
		<div
			className={`nl-scroll-host ${styles.inputWrap}`}
			data-expanded={expanded}
		>
			<textarea
				ref={input}
				className={`nl-input nl-scroll-hidden ${styles.input}`}
				aria-label={t('给 Agent 发消息')}
				placeholder={t('说说想改什么，可以直接贴图')}
				rows={1}
				data-expanded={expanded}
				value={text}
				disabled={disabled}
				onChange={(event) => setText(event.target.value)}
				onPaste={(event) => {
					const files = [...event.clipboardData.files]
					if (files.some((file) => imageTypes.includes(file.type))) {
						event.preventDefault()
						void attach(files)
					}
				}}
				onKeyDown={(event) => {
					if (event.key === 'Escape' && expanded) {
						event.preventDefault()
						event.stopPropagation()
						onExpandedChange(false)
						return
					}
					if (
						event.key === 'Enter' &&
						!event.shiftKey &&
						!event.nativeEvent.isComposing
					) {
						event.preventDefault()
						void send()
					}
				}}
			/>
			<OverlayScrollbar
				targetRef={input}
				insetTop={32}
				insetBottom={6}
				insetRight={4}
			/>
			<div className={styles.expandWrap}>
				<Tooltip text={expanded ? t('收起输入框') : t('放大输入框')}>
					<button
						type="button"
						className={styles.expand}
						aria-label={expanded ? t('收起输入框') : t('放大输入框')}
						onClick={() => {
							onExpandedChange(!expanded)
							requestAnimationFrame(() => input.current?.focus())
						}}
					>
						{expanded ? (
							<Minimize2 aria-hidden="true" size={13} strokeWidth={1.8} />
						) : (
							<Maximize2 aria-hidden="true" size={13} strokeWidth={1.8} />
						)}
					</button>
				</Tooltip>
			</div>
		</div>
	)

	return (
		<div className={styles.composer} data-expanded={expanded}>
			{contextLabel && (
				<div className={styles.contextRow}>
					<Chip active>
						<span className={styles.contextChip}>
							{t('附带：{{context}}', { context: contextLabel })}
							{onDetachContext && (
								<button
									type="button"
									className={styles.contextDetach}
									aria-label={t('不附带')}
									title={t('不附带')}
									onClick={onDetachContext}
								>
									<X aria-hidden="true" size={11} strokeWidth={1.8} />
								</button>
							)}
						</span>
					</Chip>
				</div>
			)}
			{pending.length > 0 && (
				<ul className={styles.pending} aria-label={t('待发送的图片')}>
					{pending.map(({ attachment, url }) => (
						<li key={attachment.id} className="nl-img-thumb">
							<button
								type="button"
								className="nl-img-thumb-btn"
								aria-label={t('查看图片 {{name}}', { name: attachment.name })}
								title={t('查看图片 {{name}}', { name: attachment.name })}
								onClick={() => onPreview(url, attachment.name)}
							>
								<img
									src={url}
									alt={attachment.name}
									className={styles.pendingImage}
								/>
								<span className="nl-img-thumb-mask" aria-hidden="true">
									<Maximize2 size={14} strokeWidth={1.8} />
								</span>
							</button>
							<button
								type="button"
								className="nl-img-thumb-close"
								aria-label={t('移除 {{name}}', { name: attachment.name })}
								title={t('移除 {{name}}', { name: attachment.name })}
								onClick={() => remove(attachment.id)}
							>
								<X size={10} strokeWidth={1.8} />
							</button>
						</li>
					))}
				</ul>
			)}
			<input
				ref={picker}
				hidden
				type="file"
				accept={imageTypes.join(',')}
				multiple
				onChange={(event) => {
					void attach([...(event.target.files ?? [])])
					event.target.value = ''
				}}
			/>
			{expanded ? (
				<>
					{textarea}
					<div className={styles.composerToolbar}>
						{attachButton}
						{sendOrStop}
					</div>
				</>
			) : (
				<div className={styles.inputRow}>
					{attachButton}
					{textarea}
					{sendOrStop}
				</div>
			)}
			{error && (
				<p className={styles.error} role="alert">
					{error}
				</p>
			)}
		</div>
	)
}
