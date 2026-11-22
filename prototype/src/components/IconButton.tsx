import type { CSSProperties } from 'react'
import { Icon } from './Button'

/** 圆形图标按钮：只有图标，悬停经 title 提示名称（图标统一 strokeWidth 1.8） */
export function IconButton({ name, icon, size = 34, iconSize = 17, onClick, disabled, style }: {
  /** 按钮名称：悬停提示和无障碍标签 */
  name: string
  icon: string
  size?: number
  iconSize?: number
  onClick?: () => void
  disabled?: boolean
  style?: CSSProperties
}) {
  return (
    <button
      type="button"
      className="nl-icon-btn"
      title={name}
      aria-label={name}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 'var(--radius-full)',
        color: 'var(--color-on-surface-variant)',
        ...style,
      }}
    >
      <Icon name={icon} size={iconSize} />
    </button>
  )
}
