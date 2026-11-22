import type { CSSProperties, ReactNode } from 'react'
import type { ChapterStatus } from '../mock/types'
import { Icon } from './Button'
import { StatusBeacon } from './Motion'

export function Card({ children, style, onClick }: { children: ReactNode; style?: CSSProperties; onClick?: () => void }) {
  return (
    <div
      className={onClick ? 'glass-panel nl-card-interactive' : 'glass-panel'}
      style={{ borderRadius: 'var(--radius-2xl)', overflow: 'hidden', ...style }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
    >
      {children}
    </div>
  )
}

export const statusMeta: Record<ChapterStatus, { label: string; icon: string; color: string; bg: string }> = {
  published: { label: '已发布', icon: 'check_circle', color: 'var(--color-success)', bg: 'var(--color-success-container)' },
  producing: { label: '制作中', icon: 'sync', color: 'var(--color-primary)', bg: 'var(--accent-wash)' },
  waiting: { label: '等待', icon: 'schedule', color: 'var(--color-outline)', bg: 'var(--color-surface-container-high)' },
}

/** 「需要处理」标记：不是状态，可单独挂在已发布章上 */
export const attentionMeta = { label: '需要处理', icon: 'error', color: 'var(--color-on-error-container)', bg: 'var(--color-error-container)' }

export function StatusPill({ status, spin }: { status: ChapterStatus; spin?: boolean }) {
  const m = statusMeta[status]
  return (
    <span
      className="label-caps label-caps-zh"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 10px',
        borderRadius: 'var(--radius-md)',
        color: m.color,
        background: m.bg,
        whiteSpace: 'nowrap',
      }}
    >
      {status === 'producing' ? (
        <StatusBeacon tone="active" active={!!spin} size={7} />
      ) : (
        <Icon name={m.icon} size={14} />
      )}
      {m.label}
    </span>
  )
}

/** 章节列表里的状态：默认态“已发布”只用一行安静的小字，其余状态用 StatusPill；
    attention 为真时在旁边加一枚「需要处理」标记（章仍保持原状态）。 */
export function ChapterStatusMark({ status, spin, attention }: { status: ChapterStatus; spin?: boolean; attention?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {status !== 'published' ? (
        <StatusPill status={status} spin={spin} />
      ) : (
        <span className="label-caps label-caps-zh" style={{ fontSize: 10, color: 'var(--color-outline)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <Icon name="check_circle" size={13} />
          已发布
        </span>
      )}
      {attention ? (
        <span
          className="label-caps label-caps-zh"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 'var(--radius-md)', color: attentionMeta.color, background: attentionMeta.bg, whiteSpace: 'nowrap' }}
        >
          <Icon name={attentionMeta.icon} size={14} />
          {attentionMeta.label}
        </span>
      ) : null}
    </span>
  )
}

export function ProgressBar({ value, height = 8, active }: { value: number; height?: number; active?: boolean }) {
  const clamped = Math.max(0, Math.min(1, value))
  return (
    <div
      style={{
        height,
        width: '100%',
        background: 'var(--color-surface-container-high)',
        borderRadius: 'var(--radius-full)',
        overflow: 'hidden',
        boxShadow: 'var(--shadow-inset)',
      }}
    >
      <div
        className={active ? 'progress-sheen' : undefined}
        style={{
          height: '100%',
          width: `${Math.round(clamped * 100)}%`,
          background: 'var(--color-primary)',
          borderRadius: 'var(--radius-full)',
          transition: 'width var(--dur-slow) var(--ease-out)',
        }}
      />
    </div>
  )
}
