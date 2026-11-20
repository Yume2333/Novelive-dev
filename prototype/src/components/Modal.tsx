import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Button'
import { IconButton } from './IconButton'

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  width = 520,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
}) {
  if (!open) return null
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'var(--scrim)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        className="glass-panel"
        style={{
          width,
          maxWidth: '100%',
          maxHeight: '85vh',
          overflow: 'auto',
          borderRadius: 'var(--radius-2xl)',
          background: 'var(--veil-95)',
          animation: 'fade-up 0.2s ease',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '20px 24px 12px',
          }}
        >
          <h4 className="headline" style={{ fontSize: 18 }}>{title}</h4>
          <IconButton name="关闭" icon="close" onClick={onClose} />
        </div>
        <div style={{ padding: '8px 24px 20px' }}>{children}</div>
        {footer ? (
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 12,
              padding: '14px 24px',
              borderTop: '1px solid var(--white-60)',
            }}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function Dropdown({
  trigger,
  items,
}: {
  trigger: ReactNode
  items: { label: string; icon?: string; onClick: () => void; danger?: boolean }[]
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 })
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (ref.current && !ref.current.contains(t) && menuRef.current && !menuRef.current.contains(t)) setOpen(false)
    }
    const onScroll = () => setOpen(false)
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!open && ref.current) {
      const r = ref.current.getBoundingClientRect()
      setPos({ top: r.bottom + 6, right: window.innerWidth - r.right })
    }
    setOpen((v) => !v)
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <div onClick={toggle}>{trigger}</div>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              className="glass-panel"
              style={{
                position: 'fixed',
                top: pos.top,
                right: pos.right,
                zIndex: 150,
                minWidth: 180,
                borderRadius: 'var(--radius-lg)',
                background: 'var(--veil-95)',
                padding: 6,
                animation: 'fade-up 0.15s ease',
              }}
            >
              {items.map((it) => (
                <button
                  key={it.label}
                  onClick={(e) => { e.stopPropagation(); setOpen(false); it.onClick() }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 'var(--radius-md)',
                    fontSize: 13,
                    textAlign: 'left',
                    color: it.danger ? 'var(--color-on-error-container)' : 'var(--color-on-surface)',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--white-70)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  {it.icon ? <Icon name={it.icon} size={16} /> : null}
                  {it.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
