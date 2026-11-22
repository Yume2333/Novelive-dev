import { useEffect, useRef, useState } from 'react'
import { Button, Icon } from '../../components/Button'
import { Chip, ConfirmDialog, Tooltip } from '../../components/Extended'
import { useToast } from '../../components/Toast'
import {
  agentReplySteps,
  chatSessionSeeds,
  newNodeId,
  sessionTitleFrom,
  type ChatNode,
  type ChatSession,
  type ConfirmItem,
  type TextPart,
  type ToolPart,
} from '../../mock/chat'
import type { Work } from '../../mock/types'
import { MessageRow, type CardStatus, type ConfirmCtx } from './MessageView'

// ---- 面板状态：每部作品一组会话，各自带分支选择和确认状态 ----

interface SessionUi {
  session: ChatSession
  /** 分支选择：parentId（根为 'root'）→ 选中的子消息 id */
  sel: Record<string, string>
  /** 确认卡里每条的确认状态：itemId → 状态 */
  cards: Record<string, CardStatus>
  /** 拒绝理由：itemId → 一句话 */
  reasons: Record<string, string>
}

interface WorkChat {
  sessions: ChatSession[]
  activeId: string
  ui: Record<string, SessionUi>
}

const chatStore = new Map<string, WorkChat>()

function sessionUi(session: ChatSession): SessionUi {
  return { session, sel: {}, cards: {}, reasons: {} }
}

function loadWorkChat(workId: string): WorkChat {
  let wc = chatStore.get(workId)
  if (!wc) {
    const sessions = chatSessionSeeds[workId] ?? [{ id: `${workId}-s1`, title: '改编讨论', updatedLabel: '今天', nodes: [] }]
    wc = { sessions, activeId: sessions[0].id, ui: Object.fromEntries(sessions.map((s) => [s.id, sessionUi(s)])) }
    chatStore.set(workId, wc)
  }
  return wc
}

/** 从根到叶走当前分支：每层先看 sel 里的选择，不在候选里就取最后一条 */
function branchPath(nodes: ChatNode[], sel: Record<string, string>): ChatNode[] {
  const kids = new Map<string, ChatNode[]>()
  for (const n of nodes) {
    const k = n.parentId ?? 'root'
    kids.set(k, [...(kids.get(k) ?? []), n])
  }
  const path: ChatNode[] = []
  let parent = 'root'
  for (;;) {
    const list = kids.get(parent)
    if (!list?.length) break
    const picked = list.find((n) => n.id === sel[parent]) ?? list[list.length - 1]
    path.push(picked)
    parent = picked.id
  }
  return path
}

function siblingsOf(nodes: ChatNode[], node: ChatNode) {
  return nodes.filter((n) => n.parentId === node.parentId)
}

/** 分支切换行：同 parent 有多条时显示 ‹ 2/3 › */
function BranchNav({ nodes, node, onPick }: {
  nodes: ChatNode[]
  node: ChatNode
  onPick: (parentKey: string, id: string) => void
}) {
  const sibs = siblingsOf(nodes, node)
  if (sibs.length < 2) return null
  const key = node.parentId ?? 'root'
  const idx = sibs.findIndex((s) => s.id === node.id)
  const go = (d: number) => onPick(key, sibs[(idx + d + sibs.length) % sibs.length].id)
  const btn = { display: 'inline-flex', padding: 2, borderRadius: 'var(--radius-full)', color: 'var(--color-outline)' } as const
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 11, color: 'var(--color-outline)' }}>
      <button onClick={() => go(-1)} title="上一个分支" style={btn}><Icon name="chevron_left" size={13} /></button>
      {idx + 1}/{sibs.length}
      <button onClick={() => go(1)} title="下一个分支" style={btn}><Icon name="chevron_right" size={13} /></button>
    </span>
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
  const [, setTick] = useState(0)
  const rerender = () => setTick((t) => t + 1)

  const wc = loadWorkChat(work.id)
  const session = wc.sessions.find((s) => s.id === wc.activeId) ?? wc.sessions[0]
  const ui = wc.ui[session.id] ?? (wc.ui[session.id] = sessionUi(session))
  const path = branchPath(session.nodes, ui.sel)

  const [input, setInput] = useState('')
  // 待发送的贴图：缩略图 chips，随下一条消息发出
  const [pendingImages, setPendingImages] = useState<{ id: string; src: string; name: string }[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const [ctxOverride, setCtxOverride] = useState<string | null | undefined>(undefined)
  const attached = ctxOverride === undefined ? context : ctxOverride
  useEffect(() => setCtxOverride(undefined), [context])

  // 会话列表、改名、删除
  const [listOpen, setListOpen] = useState(false)
  const [renaming, setRenaming] = useState<{ id: string; text: string } | null>(null)
  const [deleting, setDeleting] = useState<ChatSession | null>(null)

  // 编辑用户消息后重发 → 产生新分支
  const [editing, setEditing] = useState<{ node: ChatNode; text: string } | null>(null)

  // 运行：演示用的「正在回复」状态，停止后工具卡记为失败
  const [running, setRunning] = useState<string | null>(null)
  const timers = useRef<number[]>([])

  // 工作流类确认卡确认前的二次弹窗
  const [confirmItem, setConfirmItem] = useState<ConfirmItem | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [path.length, running, session.id])

  const clearTimers = () => {
    for (const t of timers.current) window.clearTimeout(t)
    timers.current = []
  }
  useEffect(() => clearTimers, [])

  const later = (ms: number, f: () => void) => {
    timers.current.push(window.setTimeout(f, ms))
  }

  // ---- 会话操作 ----

  const switchSession = (id: string) => {
    stop()
    wc.activeId = id
    setRenaming(null)
    rerender()
  }

  const newSession = () => {
    const s: ChatSession = { id: newNodeId(), title: '新会话', updatedLabel: '刚刚', nodes: [] }
    wc.sessions.unshift(s)
    wc.ui[s.id] = sessionUi(s)
    switchSession(s.id)
  }

  const deleteSession = (s: ChatSession) => {
    wc.sessions = wc.sessions.filter((x) => x.id !== s.id)
    delete wc.ui[s.id]
    if (!wc.sessions.length) {
      const fresh: ChatSession = { id: newNodeId(), title: '新会话', updatedLabel: '刚刚', nodes: [] }
      wc.sessions.push(fresh)
      wc.ui[fresh.id] = sessionUi(fresh)
    }
    if (wc.activeId === s.id) wc.activeId = wc.sessions[0].id
    setDeleting(null)
    rerender()
  }

  const renameSession = () => {
    if (!renaming) return
    const s = wc.sessions.find((x) => x.id === renaming.id)
    const t = renaming.text.trim()
    if (s && t) s.title = t
    setRenaming(null)
    rerender()
  }

  // ---- 消息操作 ----

  const appendNode = (parentId: string | null, role: ChatNode['role'], parts: ChatNode['parts']): ChatNode => {
    const node: ChatNode = { id: newNodeId(), parentId, role, parts }
    session.nodes.push(node)
    ui.sel[parentId ?? 'root'] = node.id
    return node
  }

  const patchNode = (id: string, f: (n: ChatNode) => void) => {
    const n = session.nodes.find((x) => x.id === id)
    if (n) f(n)
    rerender()
  }

  /** 演示回复：思考 → 工具卡（运行中→完成）→ 正文逐字出现 → 确认卡 */
  const runReply = (userNode: ChatNode) => {
    const steps = agentReplySteps(work.title, attached)
    const reply = appendNode(userNode.id, 'agent', [steps.thinking, steps.tool, { kind: 'text', text: '' }])
    setRunning(reply.id)
    later(700, () => {
      patchNode(reply.id, (n) => {
        const t = n.parts.find((p): p is ToolPart => p.kind === 'tool')
        if (t) t.status = 'done'
      })
      let i = 0
      const tick = () => {
        i += 2
        const text = steps.fullText.slice(0, i)
        patchNode(reply.id, (n) => {
          const last = n.parts[n.parts.length - 1]
          if (last.kind === 'text') last.text = text
        })
        if (i < steps.fullText.length) {
          timers.current.push(window.setTimeout(tick, 36))
        } else {
          later(250, () => {
            patchNode(reply.id, (n) => n.parts.push(steps.confirm))
            setRunning(null)
          })
        }
      }
      tick()
    })
  }

  const send = (text: string, parentId: string | null, images: { id: string; src: string; name: string }[] = []) => {
    const mine = appendNode(parentId, 'user', [
      ...images.map((img) => ({ kind: 'image' as const, id: img.id, src: img.src, name: img.name })),
      { kind: 'text' as const, text },
    ])
    // 第一条消息自动生成会话标题
    if (session.title === '新会话') session.title = sessionTitleFrom(text)
    setCtxOverride(null)
    rerender()
    runReply(mine)
  }

  const addImages = (files: Iterable<File>) => {
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue
      const reader = new FileReader()
      reader.onload = () => setPendingImages((list) => [...list, { id: newNodeId(), src: String(reader.result), name: f.name || '贴图' }])
      reader.readAsDataURL(f)
    }
  }

  const onSend = () => {
    const text = input.trim()
    if ((!text && !pendingImages.length) || running) return
    setInput('')
    const imgs = pendingImages
    setPendingImages([])
    const body = `${attached ? `【${attached}】` : ''}${text || '（看图）'}`
    send(body, path.length ? path[path.length - 1].id : null, imgs)
  }

  const resendEdit = () => {
    if (!editing) return
    const text = editing.text.trim()
    if (!text) return
    setEditing(null)
    send(text, editing.node.parentId)
  }

  const stop = () => {
    clearTimers()
    if (running) {
      patchNode(running, (n) => {
        for (const p of n.parts) if (p.kind === 'tool' && p.status === 'running') {
          p.status = 'failed'
          p.result = '已停止。'
        }
      })
    }
    setRunning(null)
  }

  // ---- 确认卡 ----

  const statusOf = (itemId: string): CardStatus => ui.cards[itemId] ?? 'pending'

  const applyStatus = (item: ConfirmItem, s: 'confirmed' | 'rejected') => {
    ui.cards[item.id] = s
    rerender()
    if (s === 'confirmed') {
      const isWorkflow = item.kind === 'redo-chapter' || item.kind === 'rewrite-scene' || item.kind === 'redraw-image' || item.kind === 'recompose-volume'
      toast(isWorkflow ? '已加入制作队列' : '已生效', isWorkflow ? 'queue' : 'check')
    }
  }

  const confirmCtx: ConfirmCtx = {
    statusOf,
    reasonOf: (itemId) => ui.reasons[itemId] ?? '',
    onConfirm: (item) => {
      if (item.confirmHint) setConfirmItem(item)
      else applyStatus(item, 'confirmed')
    },
    onReject: (item, reason) => {
      ui.reasons[item.id] = reason
      applyStatus(item, 'rejected')
    },
    onReset: (item) => {
      ui.cards[item.id] = 'pending'
      rerender()
    },
  }

  const pick = (parentKey: string, id: string) => {
    ui.sel[parentKey] = id
    rerender()
  }

  // ---- 渲染 ----

  const summaryBar = session.compressedSummary ? <SummaryDivider text={session.compressedSummary} /> : null

  const messageFlow = (
    <div
      ref={scrollRef}
      style={{
        flex: 1,
        overflow: 'auto',
        padding: 'var(--space-5) var(--space-4) var(--space-3)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-4)',
        maskImage: 'linear-gradient(180deg, transparent, black 20px)',
        WebkitMaskImage: 'linear-gradient(180deg, transparent, black 20px)',
      }}
    >
      {summaryBar}
      {path.map((n) => {
        if (editing?.node.id === n.id) {
          return (
            <div key={n.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
              <textarea
                autoFocus
                rows={2}
                value={editing.text}
                onChange={(e) => setEditing({ node: n, text: e.target.value })}
                style={{
                  width: '88%',
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
              <div style={{ display: 'flex', gap: 8 }}>
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>取消</Button>
                <Button size="sm" variant="primary" icon="call_split" onClick={resendEdit} disabled={!editing.text.trim()}>重新发送</Button>
              </div>
            </div>
          )
        }
        const nav = <BranchNav nodes={session.nodes} node={n} onPick={pick} />
        return (
          <MessageRow
            key={n.id}
            node={n}
            ctx={confirmCtx}
            streaming={running === n.id}
            controls={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {nav}
                {n.role === 'user' ? (
                  <button
                    onClick={() => {
                      const text = n.parts.filter((p): p is TextPart => p.kind === 'text').map((p) => p.text).join('\n')
                      setEditing({ node: n, text })
                    }}
                    title="编辑后重新发送，会开一条新分支"
                    style={{ display: 'inline-flex', padding: 2, borderRadius: 'var(--radius-full)', color: 'var(--color-outline)' }}
                  >
                    <Icon name="edit" size={12} />
                  </button>
                ) : null}
              </span>
            }
          />
        )
      })}
      {!path.length ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-outline)', fontSize: 12.5 }}>
          新会话，说点什么开始。
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
      {pendingImages.length ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
          {pendingImages.map((img) => (
            <span key={img.id} style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
              <img src={img.src} alt={img.name} title={img.name} style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 'var(--radius-md)', border: '1px solid var(--white-60)', display: 'block' }} />
              <button
                onClick={() => setPendingImages((list) => list.filter((x) => x.id !== img.id))}
                title="移除"
                style={{ position: 'absolute', top: -6, right: -6, width: 16, height: 16, borderRadius: 'var(--radius-full)', background: 'var(--color-surface-container-highest)', color: 'var(--color-on-surface-variant)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--divider)', padding: 0 }}
              >
                <Icon name="close" size={10} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files) addImages(e.target.files)
          e.target.value = ''
        }}
      />
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end' }}>
        <Tooltip text="贴图给 Agent 看">
          <Button variant="ghost" icon="image" onClick={() => fileRef.current?.click()} style={{ padding: '9px 10px' }} />
        </Tooltip>
        <textarea
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              onSend()
            }
          }}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData?.files ?? [])
            if (files.some((f) => f.type.startsWith('image/'))) {
              e.preventDefault()
              addImages(files)
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
        {running ? (
          <Tooltip text="停止">
            <Button variant="danger" icon="stop_circle" onClick={stop} style={{ padding: '9px 14px' }} />
          </Tooltip>
        ) : (
          <Tooltip text="发送">
            <Button variant="primary" icon="send" onClick={onSend} disabled={!input.trim() && !pendingImages.length} style={{ padding: '9px 14px' }} />
          </Tooltip>
        )}
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* 头部：会话切换 */}
      <div style={{ borderBottom: '1px solid var(--divider)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-4) var(--space-4) var(--space-3)' }}>
          <span
            className="glass-panel"
            style={{ width: 34, height: 34, borderRadius: 'var(--radius-full)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-primary)', flexShrink: 0 }}
          >
            <Icon name="auto_awesome" size={17} />
          </span>
          {renaming && renaming.id === session.id ? (
            <input
              autoFocus
              value={renaming.text}
              onChange={(e) => setRenaming({ id: renaming.id, text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') renameSession()
                if (e.key === 'Escape') setRenaming(null)
              }}
              onBlur={renameSession}
              style={{
                flex: 1,
                minWidth: 0,
                fontWeight: 700,
                fontSize: 14,
                fontFamily: 'var(--font-display)',
                letterSpacing: '0.04em',
                border: '1px solid var(--white-80)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--white-60)',
                padding: '4px 8px',
                outline: 'none',
                color: 'var(--color-on-surface)',
              }}
            />
          ) : (
            <button
              onClick={() => setListOpen((v) => !v)}
              title="切换会话"
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                textAlign: 'left',
                fontWeight: 700,
                fontSize: 14,
                fontFamily: 'var(--font-display)',
                letterSpacing: '0.04em',
              }}
            >
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.title}</span>
              <Icon name={listOpen ? 'expand_less' : 'expand_more'} size={16} style={{ color: 'var(--color-outline)', flexShrink: 0 }} />
            </button>
          )}
          <button onClick={() => { setRenaming({ id: session.id, text: session.title }) }} title="改名" style={{ display: 'flex', padding: 6, borderRadius: 'var(--radius-full)', color: 'var(--color-on-surface-variant)' }}>
            <Icon name="edit" size={15} />
          </button>
          <button onClick={onToggleFull} title={full ? '退出全屏' : '全屏'} style={{ display: 'flex', padding: 6, borderRadius: 'var(--radius-full)', color: 'var(--color-on-surface-variant)' }}>
            <Icon name={full ? 'close_fullscreen' : 'open_in_full'} size={17} />
          </button>
          <button onClick={onClose} title="关闭" style={{ display: 'flex', padding: 6, borderRadius: 'var(--radius-full)', color: 'var(--color-on-surface-variant)' }}>
            <Icon name="close" size={18} />
          </button>
        </div>

        {/* 会话列表：可展开，能改名、删除、新建 */}
        {listOpen ? (
          <div style={{ padding: '0 var(--space-3) var(--space-3)', display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 240, overflow: 'auto' }}>
            {wc.sessions.map((s) => (
              <div
                key={s.id}
                className="hover-row"
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
                onClick={() => { switchSession(s.id); setListOpen(false) }}
              >
                <Icon name="chat_bubble" size={14} style={{ color: s.id === session.id ? 'var(--color-primary)' : 'var(--color-outline)', flexShrink: 0 }} />
                {renaming && renaming.id === s.id ? (
                  <input
                    autoFocus
                    value={renaming.text}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRenaming({ id: s.id, text: e.target.value })}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if (e.key === 'Enter') renameSession()
                      if (e.key === 'Escape') setRenaming(null)
                    }}
                    onBlur={renameSession}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 13,
                      border: '1px solid var(--white-80)',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--white-60)',
                      padding: '2px 6px',
                      outline: 'none',
                      color: 'var(--color-on-surface)',
                    }}
                  />
                ) : (
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: s.id === session.id ? 600 : 400 }}>
                    {s.title}
                  </span>
                )}
                <span style={{ fontSize: 11, color: 'var(--color-outline)', flexShrink: 0 }}>{s.updatedLabel}</span>
                <span className="row-actions" style={{ display: 'inline-flex', gap: 2 }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); setRenaming({ id: s.id, text: s.title }) }}
                    title="改名"
                    style={{ display: 'inline-flex', padding: 3, borderRadius: 'var(--radius-full)', color: 'var(--color-outline)' }}
                  >
                    <Icon name="edit" size={13} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeleting(s) }}
                    title="删除会话"
                    style={{ display: 'inline-flex', padding: 3, borderRadius: 'var(--radius-full)', color: 'var(--color-outline)' }}
                  >
                    <Icon name="delete" size={13} />
                  </button>
                </span>
              </div>
            ))}
            <button
              onClick={() => { newSession(); setListOpen(false) }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 'var(--radius-md)', fontSize: 13, color: 'var(--color-primary)', textAlign: 'left', fontWeight: 600 }}
            >
              <Icon name="add" size={14} />
              新会话
            </button>
          </div>
        ) : null}
      </div>

      {messageFlow}
      {inputBar}

      <ConfirmDialog
        open={!!deleting}
        title="删除会话"
        message={deleting ? `删除「${deleting.title}」后，这个会话里的消息记录都找不回来了。` : ''}
        confirmLabel="删除"
        danger
        onConfirm={() => deleting && deleteSession(deleting)}
        onCancel={() => setDeleting(null)}
      />
      <ConfirmDialog
        open={!!confirmItem}
        title={confirmItem?.title ?? ''}
        message={confirmItem?.confirmHint ?? ''}
        confirmLabel="确认"
        onConfirm={() => {
          if (confirmItem) applyStatus(confirmItem, 'confirmed')
          setConfirmItem(null)
        }}
        onCancel={() => setConfirmItem(null)}
      />
    </div>
  )
}

/** 长会话开头的分隔条：展开看被压缩掉的摘要 */
function SummaryDivider({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--color-outline)', fontSize: 11.5 }}
      >
        <span style={{ flex: 1, height: 1, background: 'var(--divider)' }} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          <Icon name="unarchive" size={12} />
          更早的内容已压缩成摘要
          <Icon name={open ? 'expand_less' : 'expand_more'} size={13} />
        </span>
        <span style={{ flex: 1, height: 1, background: 'var(--divider)' }} />
      </button>
      {open ? (
        <div style={{ fontSize: 12, lineHeight: 1.65, color: 'var(--color-on-surface-variant)', background: 'var(--white-45)', border: '1px solid var(--white-80)', borderRadius: 'var(--radius-md)', padding: '8px 12px' }}>
          {text}
        </div>
      ) : null}
    </div>
  )
}
