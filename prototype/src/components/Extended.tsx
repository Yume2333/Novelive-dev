import { useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button, Icon } from './Button'
import { Modal } from './Modal'

/* 扩展控件库 — 完整产品开发用。全部遵守 DESIGN.md：tokens 变量、三种质感、克制动效 */

/** 页内横幅：info / warning / error / success（错误提示格式见 DESIGN.md §10） */
export function Banner({ kind = 'info', icon, children, action }: {
  kind?: 'info' | 'warning' | 'error' | 'success'
  icon?: string
  children: ReactNode
  action?: ReactNode
}) {
  const map = {
    info: { icon: 'info', bg: 'var(--accent-wash)', color: 'var(--color-on-surface-variant)' },
    warning: { icon: 'warning', bg: 'color-mix(in srgb, var(--color-error-container) 55%, transparent)', color: 'var(--color-on-error-container)' },
    error: { icon: 'error', bg: 'var(--color-error-container)', color: 'var(--color-on-error-container)' },
    success: { icon: 'check_circle', bg: 'var(--color-success-container)', color: 'var(--color-success)' },
  }[kind]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', borderRadius: 'var(--radius-lg)', background: map.bg, color: map.color, fontSize: 13 }}>
      <Icon name={icon ?? map.icon} size={17} />
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
      {action}
    </div>
  )
}

/** 小标签胶囊（capability、分类等） */
export function Chip({ children, active, onClick }: { children: ReactNode; active?: boolean; onClick?: () => void }) {
  return (
    <span
      onClick={onClick}
      className="label-caps label-caps-zh"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 10px',
        borderRadius: 'var(--radius-full)',
        background: active ? 'var(--color-primary)' : 'var(--color-tertiary-fixed)',
        color: active ? 'var(--color-on-primary)' : 'var(--color-on-secondary-container)',
        fontSize: 10,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.15s ease',
      }}
    >
      {children}
    </span>
  )
}

/** 悬浮提示（简短说明放这里，不放界面正文） */
export function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const ref = useRef<HTMLSpanElement>(null)
  return (
    <span
      ref={ref}
      style={{ display: 'inline-flex' }}
      onMouseEnter={() => {
        const r = ref.current?.getBoundingClientRect()
        if (r) setPos({ x: r.left + r.width / 2, y: r.top - 8 })
      }}
      onMouseLeave={() => setPos(null)}
    >
      {children}
      {pos
        ? createPortal(
            <span
              style={{
                position: 'fixed',
                left: pos.x,
                top: pos.y,
                transform: 'translate(-50%, -100%)',
                zIndex: 200,
                background: 'var(--color-primary)',
                color: 'var(--color-on-primary)',
                padding: '5px 10px',
                borderRadius: 'var(--radius-md)',
                fontSize: 12,
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
                animation: 'fade-up 0.15s ease',
              }}
            >
              {text}
            </span>,
            document.body,
          )
        : null}
    </span>
  )
}

/** 复选框 */
export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: () => void; label?: ReactNode }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
      <span
        onClick={onChange}
        style={{
          width: 18,
          height: 18,
          borderRadius: 'var(--radius-sm)',
          border: checked ? '1px solid var(--color-primary)' : '1px solid var(--color-outline-variant)',
          background: checked ? 'var(--color-primary)' : 'var(--white-60)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.15s ease',
          flexShrink: 0,
        }}
      >
        {checked ? <Icon name="check" size={13} style={{ color: 'var(--color-on-primary)' }} /> : null}
      </span>
      {label ? <span onClick={onChange}>{label}</span> : null}
    </label>
  )
}

/** 单选组（横向） */
export function RadioGroup({ value, onChange, options }: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <label key={o.value} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 13 }} onClick={() => onChange(o.value)}>
            <span
              style={{
                width: 17,
                height: 17,
                borderRadius: '50%',
                border: active ? '5px solid var(--color-primary)' : '1px solid var(--color-outline-variant)',
                background: 'var(--white-60)',
                transition: 'all 0.15s ease',
                boxSizing: 'border-box',
                flexShrink: 0,
              }}
            />
            {o.label}
          </label>
        )
      })}
    </div>
  )
}

/** 滑杆（速度/并发等连续值） */
export function Slider({ value, onChange, min = 0, max = 100, step = 1, suffix }: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1, accentColor: 'var(--color-primary)', height: 4 }}
      />
      <span className="label-caps" style={{ color: 'var(--color-primary)', minWidth: 40, textAlign: 'right' }}>
        {value}{suffix}
      </span>
    </div>
  )
}

/** 搜索输入框 */
export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <Icon name="search" size={16} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-outline)' }} />
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%',
          background: 'var(--white-60)',
          border: '1px solid var(--white-80)',
          borderRadius: 'var(--radius-md)',
          padding: '9px 12px 9px 34px',
          fontSize: 13,
          color: 'var(--color-on-surface)',
          outline: 'none',
        }}
      />
      {value ? (
        <button onClick={() => onChange('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', display: 'flex', color: 'var(--color-outline)' }}>
          <Icon name="close" size={14} />
        </button>
      ) : null}
    </div>
  )
}

/** 骨架屏（加载占位） */
export function Skeleton({ width = '100%', height = 14, radius = 'var(--radius-md)' }: {
  width?: number | string
  height?: number
  radius?: string
}) {
  return (
    <span
      style={{
        display: 'block',
        width,
        height,
        borderRadius: radius,
        background: 'linear-gradient(90deg, var(--color-surface-container) 25%, var(--color-surface-container-high) 50%, var(--color-surface-container) 75%)',
        backgroundSize: '200% 100%',
        animation: 'skeleton-wave 1.4s ease infinite',
      }}
    />
  )
}

/** 步骤指示器（向导类流程） */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {steps.map((s, i) => (
        <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '7px 14px',
              borderRadius: 'var(--radius-full)',
              background: i === current ? 'var(--color-primary)' : i < current ? 'var(--accent-wash)' : 'var(--white-50)',
              color: i === current ? 'var(--color-on-primary)' : i < current ? 'var(--color-primary)' : 'var(--color-outline)',
              border: '1px solid var(--white-60)',
            }}
          >
            {i < current ? <Icon name="check" size={14} /> : <span style={{ fontSize: 12, fontWeight: 700 }}>{i + 1}</span>}
            <span className="label-caps label-caps-zh">{s}</span>
          </div>
          {i < steps.length - 1 ? <div style={{ width: 24, height: 1, background: 'var(--color-outline-variant)' }} /> : null}
        </div>
      ))}
    </div>
  )
}

/** 侧滑抽屉（右侧，用于详情/次级配置） */
export function Drawer({ open, title, onClose, children, width = 380 }: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  width?: number
}) {
  if (!open) return null
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 100 }} onClick={onClose}>
      <div style={{ position: 'absolute', inset: 0, background: 'var(--scrim)', animation: 'fade-up 0.2s ease' }} />
      <div
        className="glass-panel"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          width,
          maxWidth: '90vw',
          background: 'var(--veil-95)',
          borderRadius: 'var(--radius-2xl) 0 0 var(--radius-2xl)',
          display: 'flex',
          flexDirection: 'column',
          animation: 'drawer-in 0.25s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px 10px' }}>
          <h4 className="headline" style={{ fontSize: 17 }}>{title}</h4>
          <button onClick={onClose} style={{ display: 'flex', padding: 6, borderRadius: 'var(--radius-full)', color: 'var(--color-on-surface-variant)' }}>
            <Icon name="close" size={19} />
          </button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '8px 20px 20px' }}>{children}</div>
      </div>
    </div>,
    document.body,
  )
}

/** 确认对话框（不可逆操作前必须使用） */
export function ConfirmDialog({ open, title, message, confirmLabel = '确认', danger, onConfirm, onCancel }: {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      width={420}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>取消</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      }
    >
      <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--color-on-surface-variant)' }}>{message}</p>
    </Modal>
  )
}

/** 分页（章节/列表较长时） */
export function Pagination({ page, total, onChange }: { page: number; total: number; onChange: (p: number) => void }) {
  const btn = (disabled: boolean): CSSProperties => ({
    display: 'flex',
    padding: 6,
    borderRadius: 'var(--radius-md)',
    color: disabled ? 'var(--color-outline-variant)' : 'var(--color-on-surface-variant)',
    cursor: disabled ? 'default' : 'pointer',
  })
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button style={btn(page <= 1)} disabled={page <= 1} onClick={() => onChange(page - 1)}>
        <Icon name="chevron_left" size={18} />
      </button>
      <span className="label-caps" style={{ color: 'var(--color-on-surface-variant)' }}>{page} / {total}</span>
      <button style={btn(page >= total)} disabled={page >= total} onClick={() => onChange(page + 1)}>
        <Icon name="chevron_right" size={18} />
      </button>
    </div>
  )
}
