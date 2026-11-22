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
