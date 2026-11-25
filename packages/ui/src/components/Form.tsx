import { ChevronDown, CircleCheck } from 'lucide-react'
import type {
	CSSProperties,
	InputHTMLAttributes,
	ReactNode,
	SelectHTMLAttributes,
	TextareaHTMLAttributes,
} from 'react'
import { SectionLabel } from './Card'
import styles from './Form.module.css'
import { Tabs, tabPanel } from './Tabs'

export { SectionLabel, Tabs, tabPanel }

export function Field({
	label,
	children,
	hint,
	htmlFor,
	className,
}: {
	label: string
	children: ReactNode
	hint?: string
	htmlFor?: string
	className?: string
}) {
	return (
		<label
			htmlFor={htmlFor}
			className={[styles.field, className].filter(Boolean).join(' ')}
		>
			<span className={`label-caps label-caps-zh ${styles.fieldLabel}`}>
				{label}
			</span>
			{children}
			{hint ? <span className={styles.hint}>{hint}</span> : null}
		</label>
	)
}

export const inputStyle: CSSProperties = {
	width: '100%',
	background: 'var(--white-60)',
	border: '1px solid var(--white-80)',
	borderRadius: 'var(--radius-md)',
	padding: '10px 14px',
	fontSize: 14,
	color: 'var(--color-on-surface)',
	boxShadow: 'var(--shadow-glass)',
}

export const textareaStyle: CSSProperties = {
	width: '100%',
	border: '1px solid var(--white-80)',
	borderRadius: 'var(--radius-md)',
	background: 'var(--white-60)',
	padding: 10,
	fontSize: 13,
	lineHeight: 1.6,
	resize: 'vertical',
	color: 'var(--color-on-surface)',
	boxShadow: 'var(--shadow-glass)',
}

export function TextInput({
	value,
	onChange,
	type = 'text',
	className,
	style,
	disabled,
	...rest
}: Omit<
	InputHTMLAttributes<HTMLInputElement>,
	'value' | 'onChange' | 'type'
> & {
	value: string
	onChange?: (v: string) => void
	type?: 'text' | 'password' | 'search' | 'url' | 'email' | 'number' | 'date'
}) {
	return (
		<input
			{...rest}
			className={['nl-input', styles.input, className]
				.filter(Boolean)
				.join(' ')}
			type={type}
			style={{ ...inputStyle, ...style }}
			value={value}
			disabled={disabled}
			onChange={(event) => onChange?.(event.target.value)}
		/>
	)
}

export function Textarea({
	value,
	onChange,
	className,
	style,
	...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
	value: string
	onChange?: (v: string) => void
}) {
	return (
		<textarea
			{...rest}
			className={['nl-input', styles.input, className]
				.filter(Boolean)
				.join(' ')}
			style={{ ...textareaStyle, ...style }}
			value={value}
			onChange={(event) => onChange?.(event.target.value)}
		/>
	)
}

type SelectOption<T extends string> = {
	value: T
	label: string
	disabled?: boolean
}

function SelectChevron({ size }: { size: number }) {
	return (
		<ChevronDown
			className={styles.chevron}
			size={size}
			strokeWidth={1.8}
			aria-hidden="true"
		/>
	)
}

export function Select<T extends string = string>({
	value,
	onChange,
	options,
	disabled,
	className,
	style,
	...rest
}: Omit<
	SelectHTMLAttributes<HTMLSelectElement>,
	'value' | 'onChange' | 'style' | 'className'
> & {
	value: T
	onChange: (v: T) => void
	options: SelectOption<T>[]
	className?: string
	style?: CSSProperties
}) {
	return (
		<span
			className={[styles.selectShell, className].filter(Boolean).join(' ')}
			style={style}
		>
			<select
				{...rest}
				className={`nl-input ${styles.input} ${styles.select}`}
				value={value}
				disabled={disabled}
				onChange={(event) => onChange(event.target.value as T)}
			>
				{options.map((option) => (
					<option
						key={option.value}
						value={option.value}
						disabled={option.disabled}
					>
						{option.label}
					</option>
				))}
			</select>
			<SelectChevron size={15} />
		</span>
	)
}

/** 紧凑下拉（设置行右侧控件） */
export function CompactSelect<T extends string = string>({
	value,
	onChange,
	options,
	disabled,
	className,
	style,
	...rest
}: Omit<
	SelectHTMLAttributes<HTMLSelectElement>,
	'value' | 'onChange' | 'style' | 'className'
> & {
	value: T
	onChange: (v: T) => void
	options: SelectOption<T>[]
	className?: string
	style?: CSSProperties
}) {
	return (
		<span
			className={[styles.compactSelectShell, className]
				.filter(Boolean)
				.join(' ')}
			style={style}
		>
			<select
				{...rest}
				className={`nl-input ${styles.input} ${styles.compactSelect}`}
				value={value}
				disabled={disabled}
				onChange={(event) => onChange(event.target.value as T)}
			>
				{options.map((option) => (
					<option
						key={option.value}
						value={option.value}
						disabled={option.disabled}
					>
						{option.label}
					</option>
				))}
			</select>
			<SelectChevron size={13} />
		</span>
	)
}

/** 三档选择卡（改编强度 / 演出密度） */
export function TierPicker<T extends string = string>({
	options,
	value,
	onChange,
}: {
	options: { value: T; label: string; desc: string }[]
	value: T
	onChange: (v: T) => void
}) {
	return (
		<div
			className={styles.tierGrid}
			style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
		>
			{options.map((option) => {
				const active = option.value === value
				return (
					<button
						key={option.value}
						type="button"
						aria-pressed={active}
						onClick={() => onChange(option.value)}
						className={`${styles.tier} ${active ? styles.tierActive : ''}`}
					>
						<span className={styles.tierHead}>
							{active ? (
								<CircleCheck
									size={16}
									strokeWidth={1.8}
									aria-hidden="true"
									className={styles.tierCheck}
								/>
							) : null}
							<span className={styles.tierLabel}>{option.label}</span>
						</span>
						<span className={styles.tierDesc}>{option.desc}</span>
					</button>
				)
			})}
		</div>
	)
}

/** 开关（设置 / Provider 通用） */
export function Toggle({
	on,
	onChange,
	disabled,
	title,
	'aria-label': ariaLabel,
}: {
	on: boolean
	onChange: (next: boolean) => void
	disabled?: boolean
	title?: string
	'aria-label'?: string
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={on}
			aria-label={ariaLabel}
			disabled={disabled}
			onClick={() => onChange(!on)}
			title={title}
			className={`${styles.toggle} ${on ? styles.toggleOn : ''}`}
		>
			<span className={`${styles.knob} ${on ? styles.knobOn : ''}`} />
		</button>
	)
}
