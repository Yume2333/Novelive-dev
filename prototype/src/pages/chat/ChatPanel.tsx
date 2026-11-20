import { useEffect, useRef, useState } from 'react'
import { Button, Icon } from '../../components/Button'
import { Chip, Tooltip } from '../../components/Extended'
import { useToast } from '../../components/Toast'
import { agentReply, changeKindMeta, chatSeeds, type ChatChange, type ChatItem } from '../../mock/chat'
import type { Work } from '../../mock/types'

// 每部作品的对话与「每条提案里各变更卡片的确认状态」。提案整体挂在消息上，
// 确认状态单独存，便于「全部确认」和逐条处理。
type ProposalState = Record<string, Record<string, 'pending' | 'confirmed' | 'rejected'>>
type CardStatus = 'pending' | 'confirmed' | 'rejected'

const historyStore = new Map<string, ChatItem[]>()

function ChangeCard({ c, status, onConfirm, onReject, onReset }: {
  c: ChatChange
  status: CardStatus
  onConfirm: () => void
  onReject: () => void
  onReset: () => void
}) {
  const meta = changeKindMeta[c.kind]
  return (
    <div
      className="glass-panel"
      style={{
        padding: 'var(--space-3)',
        borderRadius: 'var(--radius-lg)',
        opacity: status === 'rejected' ? 0.55 : 1,
        transition: 'opacity 0.2s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name={meta.icon} size={15} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
        <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{c.title}</span>
        {status === 'confirmed' ? <Chip>已生效</Chip> : null}
        {status === 'rejected' ? <Chip>不用</Chip> : null}
      </div>
      {c.before || c.after ? (
        <div style={{ marginTop: 7, fontSize: 12, lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {c.before ? <span style={{ color: 'var(--color-outline)', textDecoration: 'line-through', textDecorationColor: 'var(--color-outline-variant)' }}>{c.before}</span> : null}
          {c.after ? <span style={{ color: 'var(--color-on-surface)' }}>{c.after}</span> : null}
        </div>
      ) : null}
      {c.note ? <div style={{ marginTop: 5, fontSize: 11.5, color: 'var(--color-on-surface-variant)', lineHeight: 1.55 }}>{c.note}</div> : null}
      {status === 'pending' ? (
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)', justifyContent: 'flex-end' }}>
          <Button size="sm" variant="primary" onClick={onConfirm}>确认</Button>
          <Button size="sm" variant="ghost" onClick={onReject}>不用</Button>
        </div>
      ) : (
        <div style={{ display: 'flex', marginTop: 7 }}>
          <button onClick={onReset} className="label-caps label-caps-zh" style={{ fontSize: 10, color: 'var(--color-outline)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <Icon name="undo" size={11} /> 改主意
          </button>
        </div>
      )}
    </div>
  )
}

export function ChatPanel({ work, context, full, onToggleFull, onClose }: {
  work: Work
  context: string | null
  full: boolean
  onToggleFull: () => void
  onClose: () => void
}) {
  const toast = useToast()
  const [items, setItems] = useState<ChatItem[]>(() => {
    if (!historyStore.has(work.id)) historyStore.set(work.id, chatSeeds[work.id] ?? chatSeeds.wugang)
    return historyStore.get(work.id)!
  })
  const [states, setStates] = useState<ProposalState>({})
  const [input, setInput] = useState('')
  // 页面带来的上下文，随下一条消息一起发；发完或手动点掉就没有了
  const [ctxOverride, setCtxOverride] = useState<string | null | undefined>(undefined)
  const attached = ctxOverride === undefined ? context : ctxOverride
  useEffect(() => setCtxOverride(undefined), [context])

  // 切换作品时载入该作品的记录；关掉面板后记录仍留在工程里
  useEffect(() => {
    if (!historyStore.has(work.id)) historyStore.set(work.id, chatSeeds[work.id] ?? chatSeeds.wugang)
    setItems(historyStore.get(work.id)!)
    setStates({})
  }, [work.id])

  useEffect(() => {
    historyStore.set(work.id, items)
  }, [work.id, items])

  const [typing, setTyping] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [items, typing])

  const statusOf = (msgId: string, changeId: string): CardStatus => states[msgId]?.[changeId] ?? 'pending'

  const setStatus = (msgId: string, changeId: string, s: 'confirmed' | 'rejected') => {
    setStates((prev) => ({ ...prev, [msgId]: { ...prev[msgId], [changeId]: s } }))
    if (s === 'confirmed') {
      const msg = items.find((m) => m.id === msgId)
      const ch = msg?.kind === 'proposal' ? msg.changes.find((c) => c.id === changeId) : undefined
      if (ch?.kind === 'redo') toast('已加入制作队列', 'queue')
      else toast('已生效', 'check')
    }
  }

  const confirmAll = (msg: Extract<ChatItem, { kind: 'proposal' }>) => {
    const redoCount = msg.changes.filter((c) => c.kind === 'redo' && statusOf(msg.id, c.id) === 'pending').length
    setStates((prev) => ({
      ...prev,
      [msg.id]: Object.fromEntries([
        ...Object.entries(prev[msg.id] ?? {}).filter(([, s]) => s === 'rejected'),
        ...msg.changes.filter((c) => statusOf(msg.id, c.id) !== 'rejected').map((c) => [c.id, 'confirmed' as const]),
      ]),
    }))
    toast(redoCount ? `全部确认，${redoCount} 个重做章节已加入制作队列` : '全部确认，已生效', 'check')
  }

  const confirmAllPending = () => {
    for (const m of items) if (m.kind === 'proposal') confirmAll(m)
  }

  const send = () => {
    const text = input.trim()
    if (!text || typing) return
    setInput('')
    setTyping(true)
    const ctx = attached
    setCtxOverride(null)
    const mine: ChatItem = { id: `u${Date.now()}`, role: 'user', kind: 'text', text: ctx ? `【${ctx}】${text}` : text }
    setItems((prev) => [...prev, mine])
    window.setTimeout(() => {
      setItems((prev) => [...prev, agentReply(work.title, ctx)])
      setTyping(false)
    }, 900)
  }

  const pendingCards: { msg: Extract<ChatItem, { kind: 'proposal' }>; c: ChatChange }[] = []
  for (const m of items) {
    if (m.kind !== 'proposal') continue
    for (const c of m.changes) if (statusOf(m.id, c.id) === 'pending') pendingCards.push({ msg: m, c })
  }

  const messageFlow = (
    <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: 'var(--space-5) var(--space-4) var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', maskImage: 'linear-gradient(180deg, transparent, black 20px)', WebkitMaskImage: 'linear-gradient(180deg, transparent, black 20px)' }}>
      {items.map((m) => {
        if (m.kind === 'text') {
          const mine = m.role === 'user'
          return (
            <div key={m.id} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
              <div
                style={{
                  maxWidth: '88%',
                  padding: '9px 13px',
                  borderRadius: mine ? 'var(--radius-lg) var(--radius-lg) var(--radius-sm) var(--radius-lg)' : 'var(--radius-lg) var(--radius-lg) var(--radius-lg) var(--radius-sm)',
                  background: mine ? 'var(--color-primary)' : 'var(--white-60)',
                  border: mine ? '1px solid var(--color-primary-container)' : '1px solid var(--white-80)',
                  color: mine ? 'var(--color-on-primary)' : 'var(--color-on-surface)',
                  fontSize: 13,
                  lineHeight: 1.65,
                }}
              >
                {m.text}
              </div>
            </div>
          )
        }
        const pendingInMsg = m.changes.filter((c) => statusOf(m.id, c.id) === 'pending')
        return (
          <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', alignItems: 'flex-start' }}>
            <div
              style={{
                maxWidth: '92%',
                padding: '9px 13px',
                borderRadius: 'var(--radius-lg) var(--radius-lg) var(--radius-lg) var(--radius-sm)',
                background: 'var(--white-60)',
                border: '1px solid var(--white-80)',
                fontSize: 13,
                lineHeight: 1.65,
              }}
            >
              {m.summary}
            </div>
            {full
              ? m.changes.map((c) => {
                  const st = statusOf(m.id, c.id)
                  return (
                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, paddingLeft: 4 }}>
                      <Icon name={changeKindMeta[c.kind].icon} size={14} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
                      <span style={{ flex: 1, color: 'var(--color-on-surface-variant)' }}>{c.title}</span>
                      <span className="label-caps label-caps-zh" style={{ fontSize: 10, color: st === 'pending' ? 'var(--color-outline)' : st === 'confirmed' ? 'var(--color-primary)' : 'var(--color-outline-variant)' }}>
                        {st === 'pending' ? '待确认' : st === 'confirmed' ? '已确认' : '不用'}
                      </span>
                    </div>
                  )
                })
              : m.changes.map((c) => (
                  <div key={c.id} style={{ width: '100%' }}>
                    <ChangeCard
                      c={c}
                      status={statusOf(m.id, c.id)}
                      onConfirm={() => setStatus(m.id, c.id, 'confirmed')}
                      onReject={() => setStatus(m.id, c.id, 'rejected')}
                      onReset={() => setStates((prev) => ({ ...prev, [m.id]: { ...prev[m.id], [c.id]: 'pending' } }))}
                    />
                  </div>
                ))}
            {!full && pendingInMsg.length > 1 ? (
              <Button size="sm" variant="neu" icon="done_all" onClick={() => confirmAll(m)}>
                全部确认（{pendingInMsg.length}）
              </Button>
            ) : null}
          </div>
        )
      })}
      {typing ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-outline)', fontSize: 12 }}>
          <Icon name="progress_activity" size={15} style={{ animation: 'spin 1.2s linear infinite' }} />
          Novelive Agent 正在整理修改…
        </div>
      ) : null}
    </div>
  )

  const inputBar = (
    <div style={{ padding: 'var(--space-3) var(--space-3) var(--space-4)', borderTop: '1px solid var(--divider)', flexShrink: 0 }}>
      {attached ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
          <Chip active>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              附带：{attached}
              <button onClick={() => setCtxOverride(null)} title="不附带" style={{ display: 'inline-flex', padding: 0, color: 'inherit', opacity: 0.8 }}>
                <Icon name="close" size={11} />
              </button>
            </span>
          </Chip>
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end' }}>
        <textarea
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
          placeholder="和 Agent 聊聊设定、改编要求，或让它重做某章…"
          style={{
            flex: 1,
            border: '1px solid var(--white-80)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--white-60)',
            padding: '9px 12px',
            fontSize: 13,
            lineHeight: 1.55,
            resize: 'none',
            outline: 'none',
            color: 'var(--color-on-surface)',
          }}
        />
        <Tooltip text="发送">
          <Button variant="primary" icon="send" onClick={send} disabled={!input.trim() || typing} style={{ padding: '9px 14px' }} />
        </Tooltip>
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* 头部 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-4) var(--space-4) var(--space-3)', borderBottom: '1px solid var(--divider)', flexShrink: 0 }}>
        <span
          className="neu-button"
          style={{ width: 34, height: 34, borderRadius: 'var(--radius-full)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-primary)', flexShrink: 0 }}
        >
          <Icon name="auto_awesome" size={17} />
        </span>
        <div style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 14, fontFamily: 'var(--font-display)', letterSpacing: '0.04em' }}>Novelive Agent</div>
        <button onClick={onToggleFull} title={full ? '退出全屏' : '全屏'} style={{ display: 'flex', padding: 6, borderRadius: 'var(--radius-full)', color: 'var(--color-on-surface-variant)' }}>
          <Icon name={full ? 'close_fullscreen' : 'open_in_full'} size={17} />
        </button>
        <button onClick={onClose} title="关闭" style={{ display: 'flex', padding: 6, borderRadius: 'var(--radius-full)', color: 'var(--color-on-surface-variant)' }}>
          <Icon name="close" size={18} />
        </button>
      </div>

      {full ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 'var(--space-6)', padding: 'var(--space-5)', overflow: 'hidden' }}>
          {/* 对话列：居中限宽 */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'center', overflow: 'hidden' }}>
            <div style={{ width: '100%', maxWidth: 760, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              {messageFlow}
              {inputBar}
            </div>
          </div>
          {/* 待确认列 */}
          <div style={{ width: 340, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0, borderLeft: '1px solid var(--divider)', paddingLeft: 'var(--space-5)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)', flexShrink: 0 }}>
              <span className="label-caps label-caps-zh" style={{ color: 'var(--color-on-surface-variant)' }}>待确认{pendingCards.length ? `（${pendingCards.length}）` : ''}</span>
              {pendingCards.length > 1 ? (
                <Button size="sm" variant="neu" icon="done_all" onClick={confirmAllPending}>全部确认</Button>
              ) : null}
            </div>
            <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {pendingCards.length ? (
                pendingCards.map(({ msg, c }) => (
                  <ChangeCard
                    key={`${msg.id}-${c.id}`}
                    c={c}
                    status="pending"
                    onConfirm={() => setStatus(msg.id, c.id, 'confirmed')}
                    onReject={() => setStatus(msg.id, c.id, 'rejected')}
                    onReset={() => {}}
                  />
                ))
              ) : (
                <span style={{ fontSize: 12, color: 'var(--color-outline)' }}>没有待确认的修改</span>
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
          {messageFlow}
          {inputBar}
        </>
      )}
    </div>
  )
}
