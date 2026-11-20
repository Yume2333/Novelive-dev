import type { ReactNode } from 'react'

/** 侧边栏右侧的页面框架：标题区 + 内容。所有带侧边栏的页面都用它，保证边距和标题一致。 */
export function Page({
  title,
  eyebrow,
  subtitle,
  actions,
  width = 960,
  children,
}: {
  title: ReactNode
  /** 标题上方的小字，如“雾海纪行 · 第一卷” */
  eyebrow?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  /** 内容最大宽度：表单和设置 760，列表 960（默认），工作台传 'full' 占满 */
  width?: number | 'full'
  children: ReactNode
}) {
  return (
    <div style={{ maxWidth: width === 'full' ? 'none' : width + 96, margin: '0 auto', padding: 'var(--space-7) var(--space-7) var(--space-8)' }}>
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 'var(--space-5)', marginBottom: 'var(--space-7)' }}>
        <div style={{ minWidth: 0, flex: '1 1 320px' }}>
          {eyebrow ? (
            <div className="label-caps label-caps-zh" style={{ color: 'var(--color-outline)', marginBottom: 10 }}>{eyebrow}</div>
          ) : null}
          <h1 className="display" style={{ fontSize: 32 }}>{title}</h1>
          {subtitle ? <p style={{ marginTop: 'var(--space-3)', color: 'var(--color-on-surface-variant)', fontSize: 14, lineHeight: 1.6 }}>{subtitle}</p> : null}
        </div>
        {actions ? <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-3)' }}>{actions}</div> : null}
      </header>
      {children}
    </div>
  )
}
