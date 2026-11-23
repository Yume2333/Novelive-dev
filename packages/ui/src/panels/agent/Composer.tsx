import {
	ArrowUp,
	ImagePlus,
	Maximize2,
	Minimize2,
	Square,
	X,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { OverlayScrollbar } from '../../components/ScrollArea'
import { scoped } from '../../i18n'
import styles from './AgentPanel.module.css'
import type { Attachment } from './session'

const t = scoped('agent')

const imageTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
type Pending = { attachment: Attachment; url: string }

export function Composer({
	streaming,
	sessionId,
	disabled,
	onAttach,
	onSend,
	onStop,
	onPreview,
}: {
	streaming: boolean
	sessionId: string | null
	disabled: boolean
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
	const [expanded, setExpanded] = useState(false)
	const [capped, setCapped] = useState(false)
	const [panelHeight, setPanelHeight] = useState(0)
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
	useEffect(() => {
		const panel = input.current?.closest('aside')
		if (!expanded || !panel) return
		const observer = new ResizeObserver(() =>
			setPanelHeight(panel.clientHeight),
		)
		observer.observe(panel)
		return () => observer.disconnect()
	}, [expanded])
	// biome-ignore lint/correctness/useExhaustiveDependencies: 文字变化时重新量高
	useLayoutEffect(() => {
		const element = input.current
		if (!element) return
		element.style.height = 'auto'
		setCapped(element.scrollHeight >= 168)
		element.style.height = expanded
			? `${Math.round(panelHeight / 2)}px`
			: `${Math.min(element.scrollHeight, 168)}px`
	}, [text, expanded, panelHeight])

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
			setExpanded(false)
		} catch {
			setError(t('没能发出，请重试'))
		} finally {
			setBusy(false)
		}
	}

	return (
		<div className={styles.composer}>
			{pending.length > 0 && (
				<ul className={styles.pending} aria-label={t('待发送的图片')}>
					{pending.map(({ attachment, url }) => (
						<li key={attachment.id} className={styles.pendingItem}>
							<button
								type="button"
								className={styles.thumb}
								aria-label={t('查看图片 {{name}}', { name: attachment.name })}
								onClick={() => onPreview(url, attachment.name)}
							>
								<img src={url} alt={attachment.name} />
							</button>
							<button
								type="button"
								className={styles.remove}
								aria-label={t('移除 {{name}}', { name: attachment.name })}
								onClick={() => remove(attachment.id)}
							>
								<X aria-hidden="true" size={12} />
							</button>
						</li>
					))}
				</ul>
			)}
			<div className={styles.inputRow}>
				<button
					type="button"
					className={styles.iconButton}
					aria-label={t('添加图片')}
					title={t('添加图片')}
					disabled={disabled}
					onClick={() => picker.current?.click()}
				>
					<ImagePlus aria-hidden="true" size={17} />
				</button>
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
				<div className={styles.inputWrap}>
					<textarea
						ref={input}
						className={styles.input}
						aria-label={t('给 Agent 发消息')}
						placeholder={t('说说想改什么，可以直接贴图')}
						rows={1}
						data-expanded={expanded}
						data-capped={capped || expanded}
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
					<OverlayScrollbar targetRef={input} />
					{(capped || expanded) && (
						<button
							type="button"
							className={`${styles.iconButton} ${styles.expand}`}
							aria-label={expanded ? t('收起输入框') : t('放大输入框')}
							title={expanded ? t('收起') : t('放大')}
							onClick={() => setExpanded(!expanded)}
						>
							{expanded ? (
								<Minimize2 aria-hidden="true" size={14} />
							) : (
								<Maximize2 aria-hidden="true" size={14} />
							)}
						</button>
					)}
				</div>
				{streaming ? (
					<button
						type="button"
						className={styles.iconButton}
						aria-label={t('停止')}
						title={t('停止')}
						onClick={onStop}
					>
						<Square aria-hidden="true" size={15} />
					</button>
				) : (
					<button
						type="button"
						className={styles.send}
						aria-label={t('发送')}
						title={t('发送（Enter）')}
						disabled={
							disabled || busy || (!text.trim() && pending.length === 0)
						}
						onClick={() => void send()}
					>
						<ArrowUp aria-hidden="true" size={17} />
					</button>
				)}
			</div>
			{error && (
				<p className={styles.error} role="alert">
					{error}
				</p>
			)}
		</div>
	)
}
