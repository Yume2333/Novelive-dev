import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Button'

interface ToastItem { id: number; text: string; icon?: string; exiting?: boolean }

const ToastContext = createContext<(text: string, icon?: string) => void>(() => {})

export function useToast() {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const timersRef = useRef<Map<number, number>>(new Map())

  const dismiss = useCallback((id: number) => {
    const existing = timersRef.current.get(id)
    if (existing !== undefined) {
      window.clearTimeout(existing)
      timersRef.current.delete(id)
    }
    setItems((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)))
    const removeTimer = window.setTimeout(() => {
      timersRef.current.delete(id)
      setItems((prev) => prev.filter((t) => t.id !== id))
    }, 200)
    timersRef.current.set(id, removeTimer)
  }, [])

  const push = useCallback((text: string, icon?: string) => {
    const id = Date.now() + Math.random()
    setItems((prev) => [...prev, { id, text, icon }])
    const autoTimer = window.setTimeout(() => dismiss(id), 2400)
    timersRef.current.set(id, autoTimer)
  }, [dismiss])

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer))
      timers.clear()
    }
  }, [])

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        role="status"
        aria-live="polite"
        style={{
          position: 'fixed',
          top: 'var(--space-5)',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 200,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 'var(--space-2)',
          pointerEvents: 'none',
        }}
      >
        {items.map((t) => (
          <button
            key={t.id}
            type="button"
            className="glass-panel"
            onClick={() => dismiss(t.id)}
            title="点击关闭"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              padding: '10px 16px',
              borderRadius: 'var(--radius-lg)',
              background: 'var(--veil-95)',
              fontSize: 13,
              fontWeight: 500,
              pointerEvents: 'auto',
              animation: t.exiting
                ? 'fade-down-out var(--dur-base) var(--ease-out) forwards'
                : 'fade-up var(--dur-base) var(--ease-out)',
              boxShadow: 'var(--shadow-pop)',
            }}
          >
            {t.icon ? <Icon name={t.icon} size={16} /> : null}
            {t.text}
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
