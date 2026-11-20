import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { Icon } from './Button'

interface ToastItem { id: number; text: string; icon?: string }

const ToastContext = createContext<(text: string, icon?: string) => void>(() => {})

export function useToast() {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const push = useCallback((text: string, icon?: string) => {
    const id = Date.now() + Math.random()
    setItems((prev) => [...prev, { id, text, icon }])
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 2600)
  }, [])

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        style={{
          position: 'fixed',
          top: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 200,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          pointerEvents: 'none',
        }}
      >
        {items.map((t) => (
          <div
            key={t.id}
            className="glass-panel"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 18px',
              borderRadius: 'var(--radius-full)',
              background: 'var(--veil-95)',
              fontSize: 13,
              fontWeight: 500,
              animation: 'fade-up 0.2s ease',
              boxShadow: '0 6px 20px rgba(0,0,0,0.1)',
            }}
          >
            {t.icon ? <Icon name={t.icon} size={16} /> : null}
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
