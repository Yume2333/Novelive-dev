import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Icon, Spinner } from '../../components/Button'
import { Chip } from '../../components/Extended'
import { inputStyle } from '../../components/Form'
import { Collapse } from '../../components/Motion'
import {
  confirmKindMeta,
  type ChatNode,
  type ConfirmItem,
  type MessagePart,
  type SubtaskPart,
  type ToolPart,
  type ToolStatus,
} from '../../mock/chat'

// 消息渲染组件：对话面板和运行记录抽屉共用。
// 确认卡的状态与操作由外层通过 ConfirmCtx 传入。

export type CardStatus = 'pending' | 'confirmed' | 'rejected'

export interface ConfirmCtx {
  statusOf: (itemId: string) => CardStatus
  /** 拒绝理由：itemId → 一句话 */
  reasonOf?: (itemId: string) => string
  onConfirm: (item: ConfirmItem) => void
  onReject: (item: ConfirmItem, reason: string) => void
  onReset: (item: ConfirmItem) => void
}

const toolStatusMeta: Record<ToolStatus, { label: string; icon: string }> = {
  running: { label: '运行中', icon: 'progress_activity' },
  done: { label: '完成', icon: 'check_circle' },
  failed: { label: '失败', icon: 'error' },
}

function ChevronIcon({ open, size = 14 }: { open: boolean; size?: number }) {
  return (
    <span
      className="nl-chevron"
      data-open={open ? 'true' : 'false'}
      style={{ display: 'inline-flex', color: 'var(--color-outline)', flexShrink: 0 }}
    >
      <Icon name="expand_more" size={size} />
    </span>
  )
}

/** 工具调用卡片：标题行一直显示，点开看参数、结果、检查和缩略图 */
function ToolCard({ t, defaultOpen }: { t: ToolPart; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  const meta = toolStatusMeta[t.status]
  const hasDetail = !!(t.args?.length || t.result || t.checks?.length || t.imageThumb)
  return (
    <div className="glass-panel" style={{ borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
      <button
        onClick={() => hasDetail && setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: '8px 12px',
          textAlign: 'left',
          cursor: hasDetail ? 'pointer' : 'default',
        }}
      >
        {t.status === 'running' ? (
          <span style={{ width: 15, height: 15, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'var(--color-primary)' }}>
            <Spinner size={14} />
          </span>
        ) : (
          <Icon
            name={meta.icon}
            size={15}
            style={{
              flexShrink: 0,
              color: t.status === 'failed' ? 'var(--color-error)' : 'var(--color-success)',
              transition: 'color var(--dur-base) var(--ease-out)',
            }}
          />
        )}
        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: 'var(--color-on-surface)' }}>{t.title}</span>
        <span
          className={`label-caps label-caps-zh${t.status === 'running' ? ' ink-shimmer' : ''}`}
          style={{
            fontSize: 10,
            color: t.status === 'failed' ? 'var(--color-error)' : t.status === 'running' ? undefined : 'var(--color-outline)',
            flexShrink: 0,
          }}
        >
          {meta.label}
        </span>
        {hasDetail ? <ChevronIcon open={open} size={14} /> : null}
      </button>
      <Collapse open={open && hasDetail}>
        {hasDetail ? (
          <div style={{ padding: '0 12px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {t.args?.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {t.args.map((a) => (
                  <div key={a.label} style={{ display: 'flex', gap: 8, fontSize: 12, lineHeight: 1.6 }}>
                    <span style={{ color: 'var(--color-outline)', flexShrink: 0 }}>{a.label}</span>
                    <span style={{ color: 'var(--color-on-surface-variant)' }}>{a.value}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {t.imageThumb ? (
              <div
                style={{
                  width: 168,
                  aspectRatio: '16 / 9',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--color-surface-container-high)',
                  border: '1px solid var(--divider)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--color-outline)',
                }}
              >
                <Icon name={t.status === 'failed' ? 'broken_image' : 'image'} size={20} />
              </div>
            ) : null}
            {t.checks?.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {t.checks.map((c) => (
                  <div key={c.label} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, lineHeight: 1.6 }}>
                    <Icon
                      name={c.pass ? 'check_circle' : 'error'}
                      size={13}
                      style={{ color: c.pass ? 'var(--color-success)' : 'var(--color-error)', flexShrink: 0, marginTop: 2 }}
                    />
                    <span style={{ color: 'var(--color-on-surface-variant)', flexShrink: 0 }}>{c.label}</span>
                    <span style={{ color: c.pass ? 'var(--color-on-surface-variant)' : 'var(--color-on-error-container)' }}>{c.note}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {t.result ? <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--color-on-surface-variant)' }}>{t.result}</div> : null}
          </div>
        ) : null}
      </Collapse>
    </div>
  )
}

/** 子任务：子 Agent 的一段工作，展开后嵌套显示它自己的正文和工具卡（只嵌一层） */
function SubtaskCard({ s }: { s: SubtaskPart }) {
  const [open, setOpen] = useState(false)
  const meta = toolStatusMeta[s.status]
  return (
    <div className="glass-panel" style={{ borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
      <button onClick={() => setOpen((v) => !v)} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', textAlign: 'left' }}>
        <Icon name="account_tree" size={15} style={{ flexShrink: 0, color: 'var(--color-primary)' }} />
        {s.status === 'running' ? (
          <span style={{ display: 'inline-flex', color: 'var(--color-primary)', flexShrink: 0 }}>
            <Spinner size={14} />
          </span>
        ) : null}
        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: 'var(--color-on-surface)' }}>{s.title}</span>
        <Chip>子任务</Chip>
        <span
          className={`label-caps label-caps-zh${s.status === 'running' ? ' ink-shimmer' : ''}`}
          style={{
            fontSize: 10,
            color: s.status === 'failed' ? 'var(--color-error)' : s.status === 'running' ? undefined : 'var(--color-outline)',
            flexShrink: 0,
          }}
        >
          {meta.label}
        </span>
        <ChevronIcon open={open} size={14} />
      </button>
      <Collapse open={open}>
        <div style={{ padding: '2px 12px 10px 20px', borderLeft: '2px solid var(--divider)', marginLeft: 18, marginBottom: 8 }}>
          <MessageParts parts={s.parts} nested />
        </div>
      </Collapse>
    </div>
  )
}

/** 思考：默认收起，标题显示耗时或实时思考 */
function ThinkingBlock({ seconds, text, active }: { seconds: number; text: string; active?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--color-outline)', padding: '2px 0' }}
      >
        <Icon
          name="psychology"
          size={13}
          style={{
            color: active ? 'var(--color-primary)' : undefined,
            borderRadius: 'var(--radius-full)',
            animation: active ? 'soft-pulse var(--dur-breath) var(--ease-in-out) infinite alternate' : undefined,
          }}
        />
        <span className={active ? 'ink-shimmer' : undefined}>
          {active ? `正在思考 · ${seconds.toFixed(1)}s` : `思考了 ${Math.max(1, Math.round(seconds))} 秒`}
        </span>
        <ChevronIcon open={open} size={13} />
      </button>
      <Collapse open={open}>
        <div style={{ marginTop: 4, fontSize: 12, lineHeight: 1.65, color: 'var(--color-outline)', borderLeft: '2px solid var(--divider)', paddingLeft: 10 }}>
          {text}
        </div>
      </Collapse>
    </div>
  )
}

/** 确认卡里的一条：修改类显示改前/改后，工作流类写清做什么、影响哪些章节；
    拒绝时先问一句理由再置为已拒绝。 */
function ConfirmCard({ item, ctx }: { item: ConfirmItem; ctx?: ConfirmCtx }) {
  const meta = confirmKindMeta[item.kind]
  const status = ctx?.statusOf(item.id) ?? 'pending'
  const reason = ctx?.reasonOf?.(item.id)
  const [rejecting, setRejecting] = useState(false)
  const [reasonText, setReasonText] = useState('')
  const reasonInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (rejecting && status === 'pending') {
      const id = window.setTimeout(() => reasonInputRef.current?.focus(), 40)
      return () => window.clearTimeout(id)
    }
  }, [rejecting, status])

  const doReject = () => {
    ctx?.onReject(item, reasonText.trim())
    setRejecting(false)
    setReasonText('')
  }
  return (
    <div
      className="glass-panel"
      style={{
        padding: 'var(--space-3)',
        borderRadius: 'var(--radius-lg)',
        opacity: status === 'rejected' ? 0.55 : 1,
        transition: 'opacity var(--dur-base) var(--ease-out)',
        animation: 'fade-up var(--dur-base) var(--ease-out)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name={meta.icon} size={15} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 13 }}>{item.title}</span>
        <Chip>{meta.label}</Chip>
        {status === 'confirmed' ? <Chip active>已确认</Chip> : null}
        {status === 'rejected' ? <Chip>已拒绝</Chip> : null}
      </div>
      {item.before || item.after ? (
        <div style={{ marginTop: 7, fontSize: 12, lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {item.before ? (
            <span style={{ color: 'var(--color-outline)', textDecoration: 'line-through', textDecorationColor: 'var(--color-outline-variant)' }}>{item.before}</span>
          ) : null}
          {item.after ? <span style={{ color: 'var(--color-on-surface)' }}>{item.after}</span> : null}
        </div>
      ) : null}
      {item.note ? <div style={{ marginTop: 5, fontSize: 11.5, color: 'var(--color-on-surface-variant)', lineHeight: 1.55 }}>{item.note}</div> : null}
      {item.affectedChapters.length ? (
        <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--color-outline)', display: 'flex', gap: 5, alignItems: 'baseline' }}>
          <span style={{ flexShrink: 0 }}>影响</span>
          <span>{item.affectedChapters.join('、')}</span>
        </div>
      ) : null}
      {status === 'rejected' && reason ? (
        <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--color-on-surface-variant)', lineHeight: 1.55 }}>拒绝理由：{reason}</div>
      ) : null}
      {ctx ? (
        status === 'pending' ? (
          <>
            <Collapse open={rejecting && status === 'pending'}>
              <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)', alignItems: 'center' }}>
                <input
                  ref={reasonInputRef}
                  className="nl-input"
                  value={reasonText}
                  onChange={(e) => setReasonText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') doReject()
                    if (e.key === 'Escape') { setRejecting(false); setReasonText('') }
                  }}
                  placeholder="拒绝理由（可留空），Agent 会照着调整"
                  style={{
                    ...inputStyle,
                    width: 'auto',
                    flex: 1,
                    minWidth: 0,
                    padding: '7px 10px',
                    fontSize: 12.5,
                    outline: 'none',
                    boxShadow: 'none',
                  }}
                />
                <Button size="sm" variant="danger" onClick={doReject}>拒绝</Button>
                <Button size="sm" variant="ghost" onClick={() => { setRejecting(false); setReasonText('') }}>取消</Button>
              </div>
            </Collapse>
            {!rejecting ? (
              <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)', justifyContent: 'flex-end' }}>
                <Button size="sm" variant="primary" onClick={() => ctx.onConfirm(item)}>确认</Button>
                <Button size="sm" variant="ghost" onClick={() => setRejecting(true)}>拒绝</Button>
              </div>
            ) : null}
          </>
        ) : (
          <div style={{ display: 'flex', marginTop: 7 }}>
            <button
              onClick={() => ctx.onReset(item)}
              className="label-caps label-caps-zh"
              style={{ fontSize: 10, color: 'var(--color-outline)', display: 'inline-flex', alignItems: 'center', gap: 3 }}
            >
              <Icon name="undo" size={11} /> 改主意
            </button>
          </div>
        )
      ) : null}
    </div>
  )
}

/**
 * 按顺序渲染一条消息的各个部分。
 * 对话面板传 ConfirmCtx 让卡片可确认/拒绝；运行记录不传，卡片只读。
 */
export function MessageParts({ parts, ctx, nested, streaming }: {
  parts: MessagePart[]
  ctx?: ConfirmCtx
  nested?: boolean
  streaming?: boolean
}) {
  const hasActiveStep = parts.some(
    (x) => (x.kind === 'thinking' && x.active) || (x.kind === 'tool' && x.status === 'running') || (x.kind === 'subtask' && x.status === 'running'),
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {parts.map((p, i) => {
        const isLast = i === parts.length - 1
        switch (p.kind) {
          case 'thinking':
            return <ThinkingBlock key={i} seconds={p.seconds} text={p.text} active={p.active} />
          case 'tool':
            return <ToolCard key={p.id} t={p} />
          case 'subtask':
            // 只嵌一层：子任务里再出现子任务时按工具卡样式平铺
            return nested ? <ToolCard key={p.id} t={{ kind: 'tool', id: p.id, title: p.title, status: p.status }} /> : <SubtaskCard key={p.id} s={p} />
          case 'confirm':
            return (
              <div key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', width: '100%' }}>
                {p.items.map((item) => (
                  <ConfirmCard key={item.id} item={item} ctx={ctx} />
                ))}
              </div>
            )
          case 'image':
            return (
              <img
                key={p.id}
                src={p.src}
                alt={p.name}
                title={p.name}
                style={{ maxWidth: 220, maxHeight: 160, borderRadius: 'var(--radius-md)', border: '1px solid var(--white-60)', display: 'block' }}
              />
            )
          default: {
            const isStreamingText = !!(streaming && isLast)
            if (isStreamingText && p.text === '') {
              if (hasActiveStep) return null
              return (
                <div
                  key={i}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 2,
                    padding: '9px 13px',
                    borderRadius: 'var(--radius-lg) var(--radius-lg) var(--radius-lg) var(--radius-sm)',
                    background: 'var(--white-60)',
                    border: '1px solid var(--white-80)',
                    width: 'fit-content',
                    animation: 'fade-up var(--dur-base) var(--ease-out)',
                  }}
                >
                  <span className="ink-shimmer" style={{ fontSize: 12.5 }}>正在组织回复</span>
                  <span className="typing-caret" />
                </div>
              )
            }
            return nested || ctx === undefined ? (
              <div key={i} style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--color-on-surface)' }}>
                {p.text}
                {isStreamingText ? <span className="typing-caret" /> : null}
              </div>
            ) : (
              <div
                key={i}
                style={{
                  maxWidth: '92%',
                  padding: '9px 13px',
                  borderRadius: 'var(--radius-lg) var(--radius-lg) var(--radius-lg) var(--radius-sm)',
                  background: 'var(--white-60)',
                  border: '1px solid var(--white-80)',
                  fontSize: 13,
                  lineHeight: 1.65,
                  color: 'var(--color-on-surface)',
                }}
              >
                {p.text}
                {isStreamingText ? <span className="typing-caret" /> : null}
              </div>
            )
          }
        }
      })}
    </div>
  )
}

/**
 * 对话面板里的消息行：用户消息右侧气泡（可编辑、可切分支），
 * Agent 消息左侧按部分排。controls 放分支切换、编辑按钮这类行尾控件。
 */
export function MessageRow({ node, ctx, controls, streaming }: {
  node: ChatNode
  ctx?: ConfirmCtx
  controls?: ReactNode
  streaming?: boolean
}) {
  const mine = node.role === 'user'
  const text = node.parts.filter((p): p is Extract<MessagePart, { kind: 'text' }> => p.kind === 'text')
  const images = node.parts.filter((p): p is Extract<MessagePart, { kind: 'image' }> => p.kind === 'image')
  if (mine) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 4,
          animation: 'fade-up var(--dur-base) var(--ease-out)',
        }}
      >
        {images.length ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {images.map((p) => (
              <img
                key={p.id}
                src={p.src}
                alt={p.name}
                title={p.name}
                style={{ maxWidth: 160, maxHeight: 110, borderRadius: 'var(--radius-md)', border: '1px solid var(--white-60)', display: 'block' }}
              />
            ))}
          </div>
        ) : null}
        <div
          style={{
            maxWidth: '88%',
            padding: '9px 13px',
            borderRadius: 'var(--radius-lg) var(--radius-lg) var(--radius-sm) var(--radius-lg)',
            background: 'var(--color-primary)',
            border: '1px solid var(--color-primary-container)',
            color: 'var(--color-on-primary)',
            fontSize: 13,
            lineHeight: 1.65,
          }}
        >
          {text.map((p) => p.text).join('\n')}
        </div>
        {controls}
      </div>
    )
  }
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        alignItems: 'flex-start',
        animation: 'fade-up var(--dur-base) var(--ease-out)',
      }}
    >
      <MessageParts parts={node.parts} ctx={ctx} streaming={streaming} />
      {streaming && node.parts.length === 0 ? (
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 2,
            padding: '9px 13px',
            borderRadius: 'var(--radius-lg) var(--radius-lg) var(--radius-lg) var(--radius-sm)',
            background: 'var(--white-60)',
            border: '1px solid var(--white-80)',
            width: 'fit-content',
          }}
        >
          <span className="ink-shimmer" style={{ fontSize: 12.5 }}>正在组织回复</span>
          <span className="typing-caret" />
        </div>
      ) : null}
      {controls}
    </div>
  )
}
