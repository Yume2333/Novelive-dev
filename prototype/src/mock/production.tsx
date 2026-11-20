import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { works } from './library'
import type { GlobalStatus, Work } from './types'

// 全局制作状态：同一时间只有一部作品在制作，其余排队；停在确认点的作品不在队列里。

interface ProductionApi {
  status: GlobalStatus
  running: boolean
  /** 排队顺序，第一个就是正在制作的作品 */
  queue: Work[]
  /** 停在确认点、等创作者处理的作品 */
  waitingConfirm: Work[]
  stop: () => void
  resume: () => void
  move: (workId: string, delta: -1 | 1) => void
}

const ProductionContext = createContext<ProductionApi | null>(null)

export function ProductionProvider({ children }: { children: ReactNode }) {
  const [running, setRunning] = useState(true)
  const [queueIds, setQueueIds] = useState(['wugang', 'chaoxi'])

  const api = useMemo<ProductionApi>(() => {
    const queue = queueIds.map((id) => works.find((w) => w.id === id)!)
    const waitingConfirm = works.filter((w) => w.phase === 'confirm-visual' || w.phase === 'confirm-first')
    const status: GlobalStatus = running && queue.length ? 'producing' : waitingConfirm.length ? 'confirm' : queue.length ? 'stopped' : 'idle'
    return {
      status,
      running,
      queue,
      waitingConfirm,
      stop: () => setRunning(false),
      resume: () => setRunning(true),
      move: (workId, delta) =>
        setQueueIds((ids) => {
          const i = ids.indexOf(workId)
          const j = i + delta
          if (i < 0 || j < 0 || j >= ids.length) return ids
          const next = [...ids]
          ;[next[i], next[j]] = [next[j], next[i]]
          return next
        }),
    }
  }, [running, queueIds])

  return <ProductionContext.Provider value={api}>{children}</ProductionContext.Provider>
}

export function useProduction() {
  const api = useContext(ProductionContext)
  if (!api) throw new Error('useProduction 需要放在 ProductionProvider 里')
  return api
}

export const globalStatusMeta: Record<GlobalStatus, { label: string; icon: string }> = {
  idle: { label: '空闲', icon: 'bedtime' },
  producing: { label: '制作中', icon: 'autorenew' },
  stopped: { label: '已停止', icon: 'stop_circle' },
  confirm: { label: '待确认', icon: 'pending_actions' },
}
