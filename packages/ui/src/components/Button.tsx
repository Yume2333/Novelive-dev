import { LoaderCircle, type LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styles from './Button.module.css'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const variantClass: Record<ButtonVariant, string> = {
	primary: `nl-btn nl-btn-primary ${styles.primary}`,
	secondary: `nl-btn glass-panel ${styles.secondary}`,
	ghost: `nl-btn nl-btn-ghost ${styles.ghost}`,
	danger: `nl-btn nl-btn-danger ${styles.danger}`,
}

/** 按钮外观类链：Button 与 ButtonLink 共用同一份实现，保证视觉完全一致 */
export function buttonClasses(
	variant: ButtonVariant = 'secondary',
	size?: 'sm',
	className?: string,
): string {
	return [
		styles.button,
		size === 'sm' && styles.sm,
		variantClass[variant],
		className,
	]
		.filter(Boolean)
		.join(' ')
}

export function Spinner({
	size = 16,
	className,
}: {
	size?: number
	className?: string
}) {
	return (
		<LoaderCircle
			className={[styles.spin, className].filter(Boolean).join(' ')}
			size={size}
			strokeWidth={1.8}
			aria-hidden="true"
		/>
	)
}

export function Button({
	variant = 'secondary',
	size,
	icon: Icon,
	loading,
	disabled,
	type = 'button',
	className,
	children,
	...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
	variant?: ButtonVariant
	size?: 'sm'
	icon?: LucideIcon
	loading?: boolean
	children?: ReactNode
}) {
	const iconSize = size === 'sm' ? 13 : 16
	return (
		<button
			{...rest}
			type={type}
			disabled={disabled || loading}
			className={buttonClasses(variant, size, className)}
		>
			{loading ? (
				<Spinner size={iconSize} />
			) : (
				Icon && <Icon size={iconSize} strokeWidth={1.8} aria-hidden="true" />
			)}
			{children}
		</button>
	)
}

export function IconButton({
	icon: Icon,
	label,
	size = 34,
	iconSize,
	className,
	...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
	icon: LucideIcon
	label: string
	size?: number
	iconSize?: number
}) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			{...rest}
			className={['nl-icon-btn', styles.icon, className]
				.filter(Boolean)
				.join(' ')}
			style={{ width: size, height: size, ...rest.style }}
		>
			<Icon
				size={iconSize ?? Math.round(size * 0.5)}
				strokeWidth={1.8}
				aria-hidden="true"
			/>
		</button>
	)
}
