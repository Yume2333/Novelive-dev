import { type CSSProperties, type ReactNode } from 'react'
import { lucideMap } from './lucideMap'

export function Icon({ name, size = 18, style }: { name: string; size?: number; style?: CSSProperties }) {
  const Lucide = lucideMap[name]
  if (!Lucide) throw new Error(`缺少图标：${name}`)
  return (
    <span style={{ display: 'inline-flex', flexShrink: 0, lineHeight: 1, ...style }}>
      <Lucide size={size * 0.92} strokeWidth={1.8} />
    </span>
  )
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export function Button({
  variant = 'secondary',
  size,
  icon,
  children,
  onClick,
  disabled,
  loading,
  type = 'button',
  style,
  title,
}: {
  variant?: ButtonVariant
  /** sm：行内迷你按钮 */
  size?: 'sm'
  icon?: string
  children?: ReactNode
  onClick?: () => void
  disabled?: boolean
  loading?: boolean
  type?: 'button' | 'submit' | 'reset'
  style?: CSSProperties
  title?: string
}) {
  const isDisabled = disabled || loading
  const base: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: size === 'sm' ? 5 : 8,
    padding: size === 'sm' ? '5px 10px' : '10px 20px',
    borderRadius: 'var(--radius-md)',
    fontSize: size === 'sm' ? 11 : 12,
    fontWeight: 600,
    letterSpacing: '0.08em',
    opacity: isDisabled ? 0.5 : 1,
    cursor: isDisabled ? 'not-allowed' : 'pointer',
  }
  const variantClass: Record<ButtonVariant, string> = {
    primary: 'nl-btn nl-btn-primary',
    secondary: 'nl-btn glass-panel',
    ghost: 'nl-btn nl-btn-ghost',
    danger: 'nl-btn nl-btn-danger',
  }
  const variants: Record<ButtonVariant, CSSProperties> = {
    primary: {
      background: 'var(--color-primary)',
      color: 'var(--color-on-primary)',
      border: '1px solid var(--color-primary-container)',
      boxShadow: 'var(--shadow-raised)',
    },
    secondary: { color: 'var(--color-primary)' },
    ghost: {
      color: 'var(--color-on-surface-variant)',
      border: '1px solid transparent',
    },
    danger: {
      background: 'var(--color-error-container)',
      color: 'var(--color-on-error-container)',
      border: '1px solid color-mix(in srgb, var(--color-on-error-container) 20%, transparent)',
    },
  }
  const iconSize = size === 'sm' ? 14 : 18
  return (
    <button
      type={type}
      className={variantClass[variant]}
      style={{ ...base, ...variants[variant], ...style }}
      onClick={onClick}
      disabled={isDisabled}
      title={title}
    >
      {loading ? <Spinner size={iconSize} /> : icon ? <Icon name={icon} size={iconSize} /> : null}
      {children}
    </button>
  )
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span style={{ display: 'inline-flex', animation: 'spin 1.2s linear infinite' }}>
      <Icon name="progress_activity" size={size} />
    </span>
  )
}
