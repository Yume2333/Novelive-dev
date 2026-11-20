import type { CSSProperties, ReactNode } from 'react'
import type { ChapterStatus } from '../mock/types'
import { Icon } from './Button'

export function Card({ children, style, onClick }: { children: ReactNode; style?: CSSProperties; onClick?: () => void }) {
  return (
    <div
      className="glass-panel"
      style={{ borderRadius: 'var(--radius-2xl)', overflow: 'hidden', ...style }}
      onClick={onClick}
    >
      {children}
    </div>
  )
}

export const statusMeta: Record<ChapterStatus, { label: string; icon: string; color: string; bg: string }> = {
  published: { label: '已发布', icon: 'check_circle', color: 'var(--color-success)', bg: 'var(--color-success-container)' },
  producing: { label: '制作中', icon: 'sync', color: 'var(--color-primary)', bg: 'var(--accent-wash)' },
  waiting: { label: '等待', icon: 'schedule', color: 'var(--color-outline)', bg: 'var(--color-surface-container-high)' },
  attention: { label: '需要处理', icon: 'error', color: 'var(--color-on-error-container)', bg: 'var(--color-error-container)' },
}

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
      <Icon
        name={m.icon}
        size={14}
        style={spin && status === 'producing' ? { animation: 'spin 4s linear infinite' } : undefined}
      />
      {m.label}
    </span>
  )
}

/** 章节列表里的状态：默认态“已发布”只用一行安静的小字，其余状态用 StatusPill */
export function ChapterStatusMark({ status, spin }: { status: ChapterStatus; spin?: boolean }) {
  if (status !== 'published') return <StatusPill status={status} spin={spin} />
  return (
    <span className="label-caps label-caps-zh" style={{ fontSize: 10, color: 'var(--color-outline)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <Icon name="check_circle" size={13} />
      已发布
    </span>
  )
}

export function ProgressBar({ value, height = 8 }: { value: number; height?: number }) {
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
        style={{
          height: '100%',
          width: `${Math.round(value * 100)}%`,
          background: 'var(--color-primary)',
          borderRadius: 'var(--radius-full)',
          transition: 'width 0.4s ease',
        }}
      />
    </div>
  )
}
