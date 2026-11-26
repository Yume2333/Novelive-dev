import {
	Check,
	ChevronLeft,
	ChevronRight,
	CircleAlert,
	CircleCheck,
	Info,
	type LucideIcon,
	Search,
	TriangleAlert,
	X,
} from 'lucide-react'
import {
	type CSSProperties,
	type HTMLAttributes,
	type ReactNode,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from 'react'
import { createPortal } from 'react-dom'
import { scoped } from '../i18n'
import { Button, IconButton } from './Button'
import styles from './Extended.module.css'
import { Modal } from './Modal'
import { usePresence } from './Motion'
import { ScrollArea } from './ScrollArea'

const t = scoped('components')

/* 扩展控件库 — 完整产品开发用。全部遵守 DESIGN.md：tokens 变量、三种质感、克制动效 */

/** 页内横幅：info / warning / error / success */
export function Banner({
	kind = 'info',
	icon,
	children,
	action,
	className,
	style,
}: {
	kind?: 'info' | 'warning' | 'error' | 'success'
	icon?: LucideIcon
	children: ReactNode
	action?: ReactNode
	className?: string
	style?: CSSProperties
}) {
	const kindClass = {
		info: styles.bannerInfo,
		warning: styles.bannerWarning,
		error: styles.bannerError,
		success: styles.bannerSuccess,
	}[kind]
	const Icon =
		icon ??
		{
			info: Info,
			warning: TriangleAlert,
			error: CircleAlert,
			success: CircleCheck,
		}[kind]
	return (
		<div
			className={[styles.banner, kindClass, className]
				.filter(Boolean)
				.join(' ')}
			style={style}
		>
			<Icon size={17} strokeWidth={1.8} aria-hidden="true" />
			<span className={styles.bannerBody}>{children}</span>
			{action}
		</div>
	)
}

/** 小标签胶囊：与 Card 共用同一份可点击 Chip 实现 */
export { Chip } from './Card'

/** 悬浮提示（简短说明放这里，不放界面正文）。
    外层定位壳只负责 fixed 定位与 translate，内层 span 负责 fade-up 入场动画，二者严格分离。 */
export function Tooltip({
	text,
	children,
}: {
	text: string
	children: ReactNode
}) {
	const id = useId()
	const [pos, setPos] = useState<{
		x: number
		y: number
		below: boolean
	} | null>(null)
	const ref = useRef<HTMLSpanElement>(null)
	const tipRef = useRef<HTMLSpanElement>(null)

	const show = () => {
		const rect = ref.current?.getBoundingClientRect()
		if (!rect) return
		const below = rect.top < 44
		setPos({
			x: rect.left + rect.width / 2,
			y: below ? rect.bottom + 8 : rect.top - 8,
			below,
		})
	}

	useEffect(() => {
		if (!pos) return
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setPos(null)
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [pos])

	useLayoutEffect(() => {
		if (!pos || !tipRef.current || text.length === 0) return
		const half = tipRef.current.offsetWidth / 2
		const minX = 12 + half
		const maxX = window.innerWidth - 12 - half
		const clamped =
			minX > maxX
				? window.innerWidth / 2
				: Math.max(minX, Math.min(maxX, pos.x))
		tipRef.current.style.left = `${clamped}px`
	}, [pos, text])

	const triggerProps: HTMLAttributes<HTMLSpanElement> = {
		onMouseEnter: show,
		onMouseLeave: () => setPos(null),
		onFocus: show,
		onBlur: () => setPos(null),
	}

	return (
		<span
			ref={ref}
			style={{ display: 'inline-flex' }}
			aria-describedby={pos ? id : undefined}
			{...triggerProps}
		>
			{children}
			{pos
				? createPortal(
						<span
							ref={tipRef}
							role="tooltip"
							id={id}
							className={styles.tipShell}
							data-below={pos.below}
							style={{ left: pos.x, top: pos.y }}
						>
							<span className={styles.tipBubble}>{text}</span>
						</span>,
						document.body,
					)
				: null}
		</span>
	)
}

/** 复选框 */
export function Checkbox({
	checked,
	onChange,
	label,
	disabled,
	className,
}: {
	checked: boolean
	onChange: (checked: boolean) => void
	label?: ReactNode
	disabled?: boolean
	className?: string
}) {
	return (
		<label
			className={[
				styles.checkLabel,
				disabled && styles.checkLabelDisabled,
				className,
			]
				.filter(Boolean)
				.join(' ')}
		>
			<input
				type="checkbox"
				className={`nl-check-input ${styles.checkInput}`}
				checked={checked}
				disabled={disabled}
				onChange={(event) => onChange(event.target.checked)}
			/>
			<span
				className={`nl-check-box ${styles.checkBox} ${checked ? styles.checkBoxActive : ''}`}
			>
				{checked ? (
					<Check size={13} strokeWidth={1.8} aria-hidden="true" />
				) : null}
			</span>
			{label ? <span>{label}</span> : null}
		</label>
	)
}

/** 单选组（横向） */
export function RadioGroup<T extends string = string>({
	value,
	onChange,
	options,
	name,
	disabled,
	className,
}: {
	value: T
	onChange: (value: T) => void
	options: { value: T; label: ReactNode }[]
	name?: string
	disabled?: boolean
	className?: string
}) {
	const fallbackName = useId()
	return (
		<div
			role="radiogroup"
			className={[styles.radioGroup, className].filter(Boolean).join(' ')}
		>
			{options.map((option) => {
				const active = option.value === value
				return (
					<label
						key={option.value}
						className={[
							styles.checkLabel,
							disabled && styles.checkLabelDisabled,
						]
							.filter(Boolean)
							.join(' ')}
					>
						<input
							type="radio"
							className={`nl-check-input ${styles.checkInput}`}
							name={name ?? fallbackName}
							checked={active}
							disabled={disabled}
							onChange={() => onChange(option.value)}
						/>
						<span
							className={`nl-check-box ${styles.radioBox} ${active ? styles.radioBoxActive : ''}`}
						/>
						{option.label}
					</label>
				)
			})}
		</div>
	)
}

/** 滑杆（速度/并发等连续值） */
export function Slider({
	value,
	onChange,
	min = 0,
	max = 100,
	step = 1,
	suffix,
	disabled,
	'aria-label': ariaLabel,
	className,
}: {
	value: number
	onChange: (value: number) => void
	min?: number
	max?: number
	step?: number
	suffix?: string
	disabled?: boolean
	'aria-label'?: string
	className?: string
}) {
	return (
		<div className={[styles.slider, className].filter(Boolean).join(' ')}>
			<input
				type="range"
				className={styles.sliderInput}
				min={min}
				max={max}
				step={step}
				value={value}
				disabled={disabled}
				aria-label={ariaLabel}
				onChange={(event) => onChange(Number(event.target.value))}
			/>
			<span className={`label-caps ${styles.sliderReadout}`}>
				{value}
				{suffix}
			</span>
		</div>
	)
}

/** 搜索输入框 */
export function SearchInput({
	value,
	onChange,
	placeholder,
	disabled,
	'aria-label': ariaLabel,
	className,
}: {
	value: string
	onChange: (value: string) => void
	placeholder?: string
	disabled?: boolean
	'aria-label'?: string
	className?: string
}) {
	return (
		<div className={[styles.search, className].filter(Boolean).join(' ')}>
			<span className={styles.searchIcon}>
				<Search size={16} strokeWidth={1.8} aria-hidden="true" />
			</span>
			<input
				className={`nl-input ${styles.searchInput}`}
				value={value}
				placeholder={placeholder}
				disabled={disabled}
				aria-label={ariaLabel}
				onChange={(event) => onChange(event.target.value)}
			/>
			{value ? (
				<span className={styles.searchClear}>
					<IconButton
						icon={X}
						label={t('清除')}
						size={22}
						iconSize={14}
						onClick={() => onChange('')}
					/>
				</span>
			) : null}
		</div>
	)
}

/** 骨架屏（加载占位） */
export function Skeleton({
	width = '100%',
	height = 14,
	radius = 'var(--radius-md)',
	className,
	style,
}: {
	width?: number | string
	height?: number | string
	radius?: string
	className?: string
	style?: CSSProperties
}) {
	return (
		<span
			className={[styles.skeleton, className].filter(Boolean).join(' ')}
			style={{ width, height, borderRadius: radius, ...style }}
		/>
	)
}

/** 步骤指示器（向导类流程） */
export function Stepper({
	steps,
	current,
	className,
}: {
	steps: string[]
	current: number
	className?: string
}) {
	return (
		<div className={[styles.stepper, className].filter(Boolean).join(' ')}>
			{steps.map((step, index) => (
				<div key={step} className={styles.stepperItem}>
					<div
						className={[
							styles.step,
							index === current
								? styles.stepCurrent
								: index < current
									? styles.stepPassed
									: styles.stepFuture,
						].join(' ')}
					>
						{index < current ? (
							<Check size={14} strokeWidth={1.8} aria-hidden="true" />
						) : (
							<span className={styles.stepIndex}>{index + 1}</span>
						)}
						<span className="label-caps label-caps-zh">{step}</span>
					</div>
					{index < steps.length - 1 ? (
						<div
							className={`${styles.connector} ${index < current ? styles.connectorPassed : ''}`}
						/>
					) : null}
				</div>
			))}
		</div>
	)
}

/** 侧滑抽屉（右侧，用于详情/次级配置） */
export function Drawer({
	open,
	title,
	onClose,
	children,
	width = 380,
}: {
	open: boolean
	title: string
	onClose: () => void
	children: ReactNode
	width?: number
}) {
	const { mounted, state } = usePresence(open, 200)
	const headingId = useId()

	useEffect(() => {
		if (!open) return
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.stopPropagation()
				onClose()
			}
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [open, onClose])

	if (!mounted) return null
	return createPortal(
		<div className={styles.drawerRoot}>
			<button
				type="button"
				tabIndex={-1}
				aria-hidden="true"
				className={`${styles.drawerScrim} ${state === 'enter' ? styles.drawerScrimEnter : styles.drawerScrimExit}`}
				onClick={onClose}
			/>
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby={headingId}
				className={`glass-panel ${styles.drawer} ${state === 'enter' ? styles.drawerEnter : styles.drawerExit}`}
				style={{ width }}
			>
				<div className={styles.drawerHeader}>
					<h2 id={headingId} className={`headline ${styles.drawerTitle}`}>
						{title}
					</h2>
					<IconButton icon={X} label={t('关闭')} onClick={onClose} />
				</div>
				<ScrollArea
					style={{ flex: 1 }}
					viewportStyle={{ padding: '8px 20px 20px' }}
				>
					{children}
				</ScrollArea>
			</div>
		</div>,
		document.body,
	)
}

/** 确认对话框（不可逆操作前必须使用） */
export function ConfirmDialog({
	open,
	title,
	message,
	confirmLabel,
	cancelLabel,
	danger,
	busy,
	onConfirm,
	onCancel,
}: {
	open: boolean
	title: string
	message: ReactNode
	confirmLabel?: string
	cancelLabel?: string
	danger?: boolean
	busy?: boolean
	onConfirm: () => void
	onCancel: () => void
}) {
	return (
		<Modal
			open={open}
			title={title}
			onClose={onCancel}
			width={420}
			closeDisabled={busy}
			footer={
				<>
					<Button variant="ghost" disabled={busy} onClick={onCancel}>
						{cancelLabel ?? t('取消')}
					</Button>
					<Button
						variant={danger ? 'danger' : 'primary'}
						loading={busy}
						onClick={onConfirm}
					>
						{confirmLabel ?? t('确认')}
					</Button>
				</>
			}
		>
			<p className={styles.confirmMessage}>{message}</p>
		</Modal>
	)
}

/** 分页（章节/列表较长时） */
export function Pagination({
	page,
	total,
	onChange,
	className,
}: {
	page: number
	total: number
	onChange: (page: number) => void
	className?: string
}) {
	return (
		<div className={[styles.pagination, className].filter(Boolean).join(' ')}>
			<button
				type="button"
				className={styles.pageButton}
				aria-label={t('上一页')}
				disabled={page <= 1}
				onClick={() => onChange(page - 1)}
			>
				<ChevronLeft size={18} strokeWidth={1.8} aria-hidden="true" />
			</button>
			<span className={`label-caps ${styles.pageReadout}`}>
				{page} / {total}
			</span>
			<button
				type="button"
				className={styles.pageButton}
				aria-label={t('下一页')}
				disabled={page >= total}
				onClick={() => onChange(page + 1)}
			>
				<ChevronRight size={18} strokeWidth={1.8} aria-hidden="true" />
			</button>
		</div>
	)
}
