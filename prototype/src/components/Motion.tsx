import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'

/** 进出场状态控制：打开时立刻挂载，关闭时先切换到 exit，等退场动画完成后卸载 */
export function usePresence(open: boolean, exitMs = 180): { mounted: boolean; state: 'enter' | 'exit' } {
  const [mounted, setMounted] = useState(open)
  const [state, setState] = useState<'enter' | 'exit'>(open ? 'enter' : 'exit')

  if (open) {
    if (!mounted) setMounted(true)
    if (state !== 'enter') setState('enter')
  } else if (mounted && state !== 'exit') {
    setState('exit')
  }

  useEffect(() => {
    if (open || !mounted) return
    const timer = window.setTimeout(() => setMounted(false), exitMs)
    return () => window.clearTimeout(timer)
  }, [open, mounted, exitMs])

  return { mounted, state }
}

/** 纸墨风平滑折叠容器（基于 grid-template-rows 0fr → 1fr） */
export function Collapse({
  open,
  children,
  style,
}: {
  open: boolean
  children: ReactNode
  style?: CSSProperties
}) {
  return (
    <div className="nl-collapse" data-open={open ? 'true' : 'false'} aria-hidden={!open} style={style}>
      <div>{children}</div>
    </div>
  )
}

const beaconToneMap: Record<'active' | 'warning' | 'success' | 'muted', string> = {
  active: 'var(--color-primary)',
  warning: 'var(--color-error)',
  success: 'var(--color-success)',
  muted: 'var(--color-outline)',
}

/** 安静的呼吸信标：替代持续旋转的加载图标 */
export function StatusBeacon({
  tone = 'active',
  active = true,
  size = 8,
}: {
  tone?: 'active' | 'warning' | 'success' | 'muted'
  active?: boolean
  size?: number
}) {
  const color = beaconToneMap[tone]
  return (
    <span
      aria-hidden="true"
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        flexShrink: 0,
      }}
    >
      {active ? (
        <span
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 'var(--radius-full)',
            background: color,
            animation: 'beacon-ring var(--dur-breath) var(--ease-out) infinite',
          }}
        />
      ) : null}
      <span
        style={{
          position: 'relative',
          width: size,
          height: size,
          borderRadius: 'var(--radius-full)',
          background: color,
        }}
      />
    </span>
  )
}

/** 极细墨流导轨：用于运行中的工具卡片或制作主卡 */
export function FlowRail({
  active = true,
  height = 2,
  style,
}: {
  active?: boolean
  height?: number
  style?: CSSProperties
}) {
  if (!active) {
    return (
      <div
        aria-hidden="true"
        style={{
          width: '100%',
          height,
          borderRadius: 'var(--radius-full)',
          background: 'var(--accent-wash)',
          ...style,
        }}
      />
    )
  }
  return <div aria-hidden="true" className="flow-rail" style={{ width: '100%', height, ...style }} />
}

/** 墨点呼吸：Agent 首字输出前的等待指示 */
export function InkDots({ size = 5 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: Math.max(3, Math.round(size * 0.7)),
      }}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: size,
            height: size,
            borderRadius: 'var(--radius-full)',
            background: 'var(--color-on-surface-variant)',
            animation: `ink-dot 1.4s var(--ease-in-out) ${i * 180}ms infinite`,
          }}
        />
      ))}
    </span>
  )
}
