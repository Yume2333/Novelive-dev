import type { CSSProperties, ReactNode } from 'react'
import { Icon } from './Button'

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="label-caps label-caps-zh" style={{ color: 'var(--color-on-surface-variant)' }}>{label}</span>
      {children}
      {hint ? <span style={{ fontSize: 12, color: 'var(--color-outline)' }}>{hint}</span> : null}
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
  outline: 'none',
  boxShadow: 'var(--shadow-glass)',
}

export function TextInput({
  value,
  onChange,
  placeholder,
  readOnly,
  disabled,
  type = 'text',
}: {
  value: string
  onChange?: (v: string) => void
  placeholder?: string
  readOnly?: boolean
  disabled?: boolean
  type?: 'text' | 'password'
}) {
  return (
    <input
      type={type}
      style={disabled ? { ...inputStyle, opacity: 0.6, cursor: 'not-allowed' } : inputStyle}
      value={value}
      placeholder={placeholder}
      readOnly={readOnly}
      disabled={disabled}
      onChange={(e) => onChange?.(e.target.value)}
    />
  )
}

export function Select({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select style={{ ...inputStyle, appearance: 'none' }} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

/** 三档选择卡（改编强度 / 演出密度） */
export function TierPicker({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string; desc: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${options.length}, 1fr)`, gap: 12 }}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            style={{
              textAlign: 'left',
              padding: '14px 16px',
              borderRadius: 'var(--radius-lg)',
              border: active ? '1px solid var(--color-primary)' : '1px solid var(--white-80)',
              background: active ? 'var(--accent-wash)' : 'var(--white-50)',
              transition: 'all 0.2s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              {active ? <Icon name="check_circle" size={16} style={{ color: 'var(--color-primary)' }} /> : null}
              <span style={{ fontWeight: 700, fontSize: 14 }}>{o.label}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-on-surface-variant)', lineHeight: 1.5 }}>{o.desc}</div>
          </button>
        )
      })}
    </div>
  )
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: string; label: string; icon?: string }[]
  active: string
  onChange: (k: string) => void
}) {
  return (
    <div
      style={{
        display: 'inline-flex',
        gap: 4,
        background: 'var(--white-40)',
        border: '1px solid var(--white-60)',
        padding: 4,
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-glass)',
      }}
    >
      {tabs.map((t) => {
        const isActive = t.key === active
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className="label-caps label-caps-zh"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              borderRadius: 'var(--radius-md)',
              background: isActive ? 'var(--white-90)' : 'transparent',
              boxShadow: isActive ? 'var(--shadow-chip)' : 'none',
              color: isActive ? 'var(--color-primary)' : 'var(--color-on-surface-variant)',
              transition: 'all 0.15s ease',
            }}
          >
            {t.icon ? <Icon name={t.icon} size={15} /> : null}
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

/** 开关（设置 / Provider 通用） */
export function Toggle({ on, onChange, title }: { on: boolean; onChange: () => void; title?: string }) {
  return (
    <button
      onClick={onChange}
      title={title}
      style={{
        width: 40,
        height: 23,
        borderRadius: 'var(--radius-full)',
        position: 'relative',
        transition: 'background 0.2s ease',
        background: on ? 'var(--color-primary)' : 'var(--color-surface-container-highest)',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 3,
          left: on ? 20 : 3,
          width: 17,
          height: 17,
          borderRadius: '50%',
          background: 'var(--color-surface-container-lowest)',
          transition: 'left 0.2s ease',
          boxShadow: 'var(--shadow-raised)',
        }}
      />
    </button>
  )
}

/** 紧凑下拉（设置行右侧控件） */
export function CompactSelect({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  disabled?: boolean
}) {
  return (
    <select
      style={{
        background: 'var(--white-60)',
        border: '1px solid var(--white-80)',
        borderRadius: 'var(--radius-md)',
        padding: '7px 10px',
        fontSize: 13,
        color: 'var(--color-on-surface)',
        outline: 'none',
        ...(disabled ? { opacity: 0.6, cursor: 'not-allowed' } : null),
      }}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

/** 小节标签（面板内分组标题） */
export function SectionLabel({ children }: { children: string }) {
  return (
    <div className="label-caps label-caps-zh" style={{ color: 'var(--color-on-surface-variant)', marginBottom: 8 }}>
      {children}
    </div>
  )
}

/** 多行文本输入的统一样式 */
export const textareaStyle: CSSProperties = {
  width: '100%',
  border: '1px solid var(--white-80)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--white-60)',
  padding: 10,
  fontSize: 13,
  lineHeight: 1.6,
  resize: 'vertical',
  outline: 'none',
  color: 'var(--color-on-surface)',
}

export function EmptyState({
  icon,
  title,
  desc,
  actions,
}: {
  icon: string
  title: string
  desc: string
  actions?: ReactNode
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '72px 24px',
        textAlign: 'center',
        gap: 8,
      }}
    >
      <div
        className="neu-button"
        style={{
          width: 64,
          height: 64,
          borderRadius: 'var(--radius-full)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-on-surface-variant)',
          marginBottom: 12,
        }}
      >
        <Icon name={icon} size={28} />
      </div>
      <h4 className="headline" style={{ fontSize: 20 }}>{title}</h4>
      <p style={{ color: 'var(--color-on-surface-variant)', maxWidth: 420, lineHeight: 1.6 }}>{desc}</p>
      {actions ? <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>{actions}</div> : null}
    </div>
  )
}
