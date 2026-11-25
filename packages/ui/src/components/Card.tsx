import {
	CircleAlert,
	CircleCheck,
	Clapperboard,
	Clock,
	type LucideIcon,
} from 'lucide-react'
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'
import { scoped } from '../i18n'
import styles from './Card.module.css'

const t = scoped('components')

export function Card({
	className,
	children,
	onClick,
	role,
	tabIndex,
	onKeyDown,
	...rest
}: HTMLAttributes<HTMLDivElement> & { children?: ReactNode }) {
	if (onClick === undefined) {
		const passthrough: HTMLAttributes<HTMLDivElement> = {
			role,
			tabIndex,
			onKeyDown,
		}
		return (
			<div
				{...rest}
				{...passthrough}
				className={['glass-panel', styles.card, className]
					.filter(Boolean)
					.join(' ')}
			>
				{children}
			</div>
		)
	}
	const handleKeyDown: HTMLAttributes<HTMLDivElement>['onKeyDown'] = (
		event,
	) => {
		if (
			(event.key === 'Enter' || event.key === ' ') &&
			event.target === event.currentTarget
		) {
			event.preventDefault()
			onClick(event as unknown as Parameters<NonNullable<typeof onClick>>[0])
		}
		onKeyDown?.(event)
	}
	const interaction: HTMLAttributes<HTMLDivElement> = {
		role: role ?? 'button',
		tabIndex: tabIndex ?? 0,
		onClick,
		onKeyDown: handleKeyDown,
	}
	return (
		<div
			{...rest}
			{...interaction}
			className={['glass-panel', styles.card, 'nl-card-interactive', className]
				.filter(Boolean)
				.join(' ')}
		>
			{children}
		</div>
	)
}

export type ChapterStatus = 'published' | 'producing' | 'waiting'

export interface StatusMetaItem {
	readonly label: string
	readonly icon: LucideIcon
	readonly color: string
	readonly bg: string
}

export const statusMeta: Record<ChapterStatus, StatusMetaItem> = {
	published: {
		get label() {
			return t('已发布')
		},
		icon: CircleCheck,
		color: 'var(--color-success)',
		bg: 'var(--color-success-container)',
	},
	producing: {
		get label() {
			return t('制作中')
		},
		icon: Clapperboard,
		color: 'var(--color-primary)',
		bg: 'var(--accent-wash)',
	},
	waiting: {
		get label() {
			return t('等待')
		},
		icon: Clock,
		color: 'var(--color-outline)',
		bg: 'var(--color-surface-container-high)',
	},
}

/** 「需要处理」标记：不是状态，可单独挂在已发布章上 */
export const attentionMeta: StatusMetaItem = {
	get label() {
		return t('需要处理')
	},
	icon: CircleAlert,
	color: 'var(--color-on-error-container)',
	bg: 'var(--color-error-container)',
}

export function StatusPill({
	status,
	label,
}: {
	status: ChapterStatus
	label?: string
}) {
	const meta = statusMeta[status]
	const Icon = meta.icon
	return (
		<span
			className={`label-caps label-caps-zh ${styles.pill}`}
			style={{ color: meta.color, background: meta.bg }}
		>
			<Icon size={14} strokeWidth={1.8} aria-hidden="true" />
			{label ?? meta.label}
		</span>
	)
}

/** 章节列表里的状态：默认态“已发布”只用一行安静的小字，其余状态用 StatusPill；
    attention 为真时在旁边加一枚「需要处理」标记（章仍保持原状态）。 */
export function ChapterStatusMark({
	status,
	attention,
}: {
	status: ChapterStatus
	attention?: boolean
}) {
	const AttentionIcon = attentionMeta.icon
	return (
		<span className={styles.statusMark}>
			{status !== 'published' ? (
				<StatusPill status={status} />
			) : (
				<span className={`label-caps label-caps-zh ${styles.publishedQuiet}`}>
					<CircleCheck size={13} strokeWidth={1.8} aria-hidden="true" />
					{t('已发布')}
				</span>
			)}
			{attention ? (
				<span
					className={`label-caps label-caps-zh ${styles.pill}`}
					style={{ color: attentionMeta.color, background: attentionMeta.bg }}
				>
					<AttentionIcon size={14} strokeWidth={1.8} aria-hidden="true" />
					{attentionMeta.label}
				</span>
			) : null}
		</span>
	)
}

export function ProgressBar({
	value,
	height = 6,
	active,
	label,
}: {
	value: number
	height?: number
	active?: boolean
	label?: string
}) {
	const percent = Math.round(Math.max(0, Math.min(1, value)) * 100)
	return (
		<div
			className={styles.track}
			style={{ height }}
			role="progressbar"
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={percent}
		>
			<div
				className={active ? `progress-sheen ${styles.fill}` : styles.fill}
				style={{ width: `${percent}%` }}
			/>
		</div>
	)
}

export function Chip({
	children,
	active,
	onClick,
	className,
	style,
}: {
	children: ReactNode
	active?: boolean
	onClick?: () => void
	className?: string
	style?: CSSProperties
}) {
	const classes = [
		styles.chip,
		active && styles.chipActive,
		onClick && styles.chipInteractive,
		className,
	]
		.filter(Boolean)
		.join(' ')
	if (onClick) {
		return (
			<button type="button" onClick={onClick} className={classes} style={style}>
				{children}
			</button>
		)
	}
	return (
		<span className={classes} style={style}>
			{children}
		</span>
	)
}

export function SectionLabel({ children }: { children: ReactNode }) {
	return (
		<div className={`label-caps label-caps-zh ${styles.section}`}>
			{children}
		</div>
	)
}
