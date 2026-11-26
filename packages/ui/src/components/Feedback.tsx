import { ChevronDown, type LucideIcon } from 'lucide-react'
import type { AnchorHTMLAttributes, CSSProperties, ReactNode } from 'react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { HumanizedError } from '../format/errors'
import { scoped } from '../i18n'
import { Button, type ButtonVariant, buttonClasses, Spinner } from './Button'
import { Collapse } from './Collapse'
import { Banner } from './Extended'
import styles from './Feedback.module.css'
import { ScrollArea } from './ScrollArea'

const t = scoped('components')

/** 路由链接渲染成与 Button 完全一致的按钮（nl-btn 变体 + 尺寸类） */
export function ButtonLink({
	variant = 'secondary',
	size,
	icon: Icon,
	to,
	className,
	children,
	...rest
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'children'> & {
	variant?: ButtonVariant
	size?: 'sm'
	icon?: LucideIcon
	to: string
	children?: ReactNode
}) {
	const iconSize = size === 'sm' ? 13 : 16
	return (
		<Link {...rest} to={to} className={buttonClasses(variant, size, className)}>
			{Icon && <Icon size={iconSize} strokeWidth={1.8} aria-hidden="true" />}
			{children}
		</Link>
	)
}

/** 默认收起的「详细信息」折叠区：mono 正文，溢出时用 ScrollArea 而非原生滚动条 */
export function Details({
	summary,
	children,
	open,
	onToggle,
	maxHeight = 220,
	className,
}: {
	summary?: ReactNode
	children: ReactNode
	open?: boolean
	onToggle?: (open: boolean) => void
	maxHeight?: number
	className?: string
}) {
	const [innerOpen, setInnerOpen] = useState(false)
	const expanded = open ?? innerOpen
	const toggle = () => {
		const next = !expanded
		setInnerOpen(next)
		onToggle?.(next)
	}
	return (
		<div className={[styles.details, className].filter(Boolean).join(' ')}>
			<button
				type="button"
				className={styles.detailsToggle}
				aria-expanded={expanded}
				onClick={toggle}
			>
				<span>{summary ?? t('详细信息')}</span>
				<ChevronDown
					className="nl-chevron"
					data-open={expanded}
					size={14}
					strokeWidth={1.8}
					aria-hidden="true"
				/>
			</button>
			<Collapse open={expanded}>
				<ScrollArea className={styles.detailsScroll} style={{ maxHeight }}>
					<div className={styles.detailsBody}>{children}</div>
				</ScrollArea>
			</Collapse>
		</div>
	)
}

/** 统一错误展示：error Banner + 可选重试 + 原始 detail 收进折叠的「详细信息」 */
export function ErrorNotice({
	error,
	message,
	hint,
	detail,
	onRetry,
	retryLabel,
	className,
	style,
}: {
	error?: HumanizedError
	message?: string
	hint?: string
	detail?: string
	onRetry?: () => void
	retryLabel?: string
	className?: string
	style?: CSSProperties
}) {
	const text = error?.message ?? message ?? ''
	const hintText = error?.hint ?? hint
	const detailText = error?.detail ?? detail
	const showRetry = onRetry !== undefined
	return (
		<div
			role="alert"
			className={[styles.notice, className].filter(Boolean).join(' ')}
			style={style}
		>
			<Banner
				kind="error"
				action={
					showRetry ? (
						<Button size="sm" variant="ghost" onClick={onRetry}>
							{retryLabel ?? t('重试')}
						</Button>
					) : undefined
				}
			>
				<span className={styles.noticeText}>
					{text}
					{hintText ? (
						<span className={styles.noticeHint}>{hintText}</span>
					) : null}
				</span>
			</Banner>
			{detailText ? (
				<Details>
					<pre className={styles.noticeDetail}>{detailText}</pre>
				</Details>
			) : null}
		</div>
	)
}

/** 统一加载态：细线 Spinner + 文案 */
export function LoadingState({
	text,
	className,
	style,
}: {
	text?: string
	className?: string
	style?: CSSProperties
}) {
	return (
		<p
			role="status"
			className={[styles.loading, className].filter(Boolean).join(' ')}
			style={style}
		>
			<Spinner size={16} />
			<span>{text ?? t('正在加载')}</span>
		</p>
	)
}
