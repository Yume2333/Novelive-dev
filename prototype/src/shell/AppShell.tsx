import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation, useMatch, useNavigate } from 'react-router-dom'
import { Button, Icon } from '../components/Button'
import { Drawer } from '../components/Extended'
import { Dropdown } from '../components/Modal'
import { StatusBeacon, usePresence } from '../components/Motion'
import { findSeries, findVolume, findWork, works } from '../mock/library'
import { globalStatusMeta, useProduction } from '../mock/production'
import type { Work } from '../mock/types'
import { ChatPanel } from '../pages/chat/ChatPanel'
import { useTheme, type ThemeMode } from './theme'

const SIDEBAR_WIDTH = 248
const LAST_WORK_KEY = 'novelive.lastWork'
const CHAT_WIDTH = 420

// ---- 外壳状态：Novelive Agent 面板 ----

interface ShellApi {
  chatOpen: boolean
  /** 打开 Agent 面板；页面可以顺手设置当前上下文（如“第 1 章 · 清晨的码头”） */
  openChat: () => void
  closeChat: () => void
  /** 当前页面告诉 Agent 面板“我在看什么”；离开页面时传 null */
  setChatContext: (label: string | null) => void
}

const ShellContext = createContext<ShellApi>({
  chatOpen: false,
  openChat: () => {},
  closeChat: () => {},
  setChatContext: () => {},
})

export const useShell = () => useContext(ShellContext)

// ---- 侧边栏条目 ----

function NavItem({ to, icon, label, end, badge, onClick, active }: {
  to?: string
  icon: string
  label: string
  end?: boolean
  badge?: ReactNode
  onClick?: () => void
  /** 非路由条目（如对话面板开关）的高亮 */
  active?: boolean
}) {
  const body = (isActive: boolean) => (
    <span
      className="nl-nav-item"
      data-active={isActive ? 'true' : 'false'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: '9px var(--space-3)',
        borderRadius: 'var(--radius-lg)',
        fontSize: 14,
        fontWeight: isActive ? 600 : 500,
        color: isActive ? 'var(--color-primary)' : 'var(--color-on-surface-variant)',
        background: isActive ? 'var(--white-90)' : 'transparent',
        boxShadow: isActive ? 'var(--shadow-glass)' : 'none',
      }}
    >
      <Icon name={icon} size={19} />
      <span style={{ flex: 1 }}>{label}</span>
      {badge}
    </span>
  )
  if (!to) {
    return (
      <button type="button" onClick={onClick} style={{ display: 'block', width: '100%', textAlign: 'left', padding: 0 }}>
        {body(!!active)}
      </button>
    )
  }
  return (
    <NavLink to={to} end={end} style={{ display: 'block' }}>
      {({ isActive }) => body(isActive)}
    </NavLink>
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="label-caps label-caps-zh" style={{ padding: '18px 12px 8px', color: 'var(--color-outline)', fontSize: 11 }}>
      {children}
    </div>
  )
}

/**
 * 侧边栏的作品分区：一直显示最近打开的作品，不用先回书库点进去。
 * 在作品页面里标题是“当前作品”，在书库、用量、设置里是“最近打开”。
 */
function WorkSection({ work, inside }: { work: Work; inside: boolean }) {
  const { chatOpen, openChat, closeChat } = useShell()
  const navigate = useNavigate()
  const base = `/work/${work.id}`
  const isProject = work.kind === 'project'
  const vol = findVolume(work.volumeId)
  return (
    <>
      <SectionTitle>{inside ? '当前作品' : '最近打开'}</SectionTitle>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '4px 4px 12px 12px' }}>
        <div style={{ width: 34, height: 46, borderRadius: 'var(--radius-sm)', background: work.coverGradient, flexShrink: 0, boxShadow: 'var(--shadow-glass)' }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{work.title}</div>
          <div style={{ fontSize: 12, color: 'var(--color-outline)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {findSeries(work.seriesId).title} · 第{vol.index}卷
          </div>
        </div>
        <Dropdown
          trigger={
            <span title="换一部作品" style={{ display: 'flex', padding: 6, borderRadius: 'var(--radius-full)', color: 'var(--color-outline)' }}>
              <Icon name="unfold_more" size={18} />
            </span>
          }
          items={works.map((w) => ({
            label: w.title,
            icon: w.id === work.id ? 'check' : w.kind === 'project' ? 'edit_note' : 'auto_stories',
            onClick: () => navigate(`/work/${w.id}`),
          }))}
        />
      </div>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <NavItem to={base} end icon="auto_stories" label="概览" />
        <NavItem to={`${base}/play`} icon="play_circle" label="游玩" />
        {isProject ? (
          <>
            <NavItem to={`${base}/production`} icon="conveyor_belt" label="制作" />
            <NavItem to={`${base}/edit`} icon="edit_note" label="编辑" />
            <NavItem to={`${base}/bible`} icon="menu_book" label="设定集" />
          </>
        ) : null}
      </nav>
      {isProject ? (
        <button
          type="button"
          onClick={chatOpen ? closeChat : openChat}
          className="glass-panel"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            margin: '14px 0 0',
            padding: '9px var(--space-3)',
            borderRadius: 'var(--radius-lg)',
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--color-primary)',
            background: chatOpen ? 'var(--white-90)' : undefined,
            transition: 'background var(--dur-fast) var(--ease-out)',
          }}
        >
          <Icon name="auto_awesome" size={18} />
          <span style={{ flex: 1, textAlign: 'left' }}>Novelive Agent</span>
          <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-outline)' }}>Ctrl/⌘+J</span>
        </button>
      ) : null}
    </>
  )
}

/** 侧边栏底部：全局制作状态，点开看队列 */
function GlobalStatus({ onOpen }: { onOpen: () => void }) {
  const { status, running, queue, waitingConfirm } = useProduction()
  const meta = globalStatusMeta[status]
  const head = queue[0]
  const producingChapter = head?.chapters.find((c) => c.status === 'producing')
  const detail =
    status === 'producing' && head
      ? producingChapter
        ? `${head.title} · 第 ${producingChapter.index} 章`
        : `${head.title} · 全书预览`
      : status === 'confirm'
        ? `${waitingConfirm.length} 部作品等你确认`
        : status === 'stopped'
          ? `${queue.length} 部作品在排队`
          : '没有排队的作品'
  const beaconTone = status === 'producing' ? 'active' : status === 'confirm' ? 'warning' : 'muted'
  return (
    <button
      type="button"
      onClick={onOpen}
      className="glass-panel"
      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px var(--space-3)', borderRadius: 'var(--radius-lg)', textAlign: 'left' }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, flexShrink: 0 }}>
        <StatusBeacon tone={beaconTone} active={running && status === 'producing'} size={8} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{meta.label}</span>
        <span style={{ display: 'block', fontSize: 11, color: 'var(--color-outline)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{detail}</span>
      </span>
      {status !== 'confirm' && waitingConfirm.length ? (
        <span title="等你确认" style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 'var(--radius-full)', background: 'var(--color-error-container)', color: 'var(--color-on-error-container)', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {waitingConfirm.length}
        </span>
      ) : null}
    </button>
  )
}

/** 队列抽屉：停止 / 继续、调整顺序、去处理确认点 */
function QueueDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { running, queue, waitingConfirm, stop, resume, move } = useProduction()
  const navigate = useNavigate()
  const [confirmStop, setConfirmStop] = useState(false)
  const go = (to: string) => {
    onClose()
    navigate(to)
  }
  return (
    <Drawer open={open} title="制作队列" onClose={onClose} width={400}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
        {!running ? (
          <Button variant="primary" icon="play_arrow" onClick={resume} style={{ width: '100%' }} disabled={!queue.length}>继续制作</Button>
        ) : confirmStop ? (
          <div className="glass-panel" style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <p style={{ fontSize: 13, lineHeight: 1.6 }}>正在进行的请求会中断，下次继续时重做被中断的部分。</p>
            <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
              <Button variant="ghost" size="sm" onClick={() => setConfirmStop(false)}>取消</Button>
              <Button
                variant="danger"
                size="sm"
                icon="stop"
                onClick={() => {
                  setConfirmStop(false)
                  stop()
                }}
              >
                立即停止
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="danger" icon="stop" onClick={() => setConfirmStop(true)} style={{ width: '100%' }}>立即停止</Button>
        )}

        <section>
          <div className="label-caps label-caps-zh" style={{ color: 'var(--color-outline)', marginBottom: 10 }}>排队中</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {queue.map((w, i) => (
              <div key={w.id} className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: '10px var(--space-3)', borderRadius: 'var(--radius-lg)' }}>
                <div style={{ width: 28, height: 38, borderRadius: 'var(--radius-sm)', background: w.coverGradient, flexShrink: 0 }} />
                <button type="button" onClick={() => go(`/work/${w.id}/production`)} style={{ flex: 1, minWidth: 0, textAlign: 'left', padding: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{w.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-outline)' }}>
                    {i === 0 && running ? '正在制作' : '排队'}
                    {w.phase === 'preview' && w.previewProgress ? ` · 全书预览 ${w.previewProgress.done}/${w.previewProgress.total} 章` : ''}
                  </div>
                </button>
                <button type="button" title="提前" disabled={i === 0} onClick={() => move(w.id, -1)} style={{ display: 'flex', padding: 'var(--space-1)', color: i === 0 ? 'var(--color-outline-variant)' : 'var(--color-on-surface-variant)' }}>
                  <Icon name="arrow_upward" size={18} />
                </button>
                <button type="button" title="延后" disabled={i === queue.length - 1} onClick={() => move(w.id, 1)} style={{ display: 'flex', padding: 'var(--space-1)', color: i === queue.length - 1 ? 'var(--color-outline-variant)' : 'var(--color-on-surface-variant)' }}>
                  <Icon name="arrow_downward" size={18} />
                </button>
              </div>
            ))}
          </div>
        </section>

        {waitingConfirm.length ? (
          <section>
            <div className="label-caps label-caps-zh" style={{ color: 'var(--color-outline)', marginBottom: 10 }}>等你确认</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {waitingConfirm.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => go(`/work/${w.id}/confirm/${w.phase === 'confirm-visual' ? 'visual' : 'first'}`)}
                  className="glass-panel"
                  style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: '10px var(--space-3)', borderRadius: 'var(--radius-lg)', textAlign: 'left' }}
                >
                  <div style={{ width: 28, height: 38, borderRadius: 'var(--radius-sm)', background: w.coverGradient, flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>
                    <span style={{ display: 'block', fontWeight: 600, fontSize: 14 }}>{w.title}</span>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--color-on-error-container)' }}>
                      {w.phase === 'confirm-visual' ? '确认角色设定和主视觉' : '第一章做好了，试玩后继续'}
                    </span>
                  </span>
                  <Icon name="chevron_right" size={18} style={{ color: 'var(--color-outline)' }} />
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </Drawer>
  )
}

function ThemeSwitch() {
  const { mode, setMode } = useTheme()
  const options: { value: ThemeMode; icon: string; title: string }[] = [
    { value: 'light', icon: 'light_mode', title: '亮色' },
    { value: 'dark', icon: 'dark_mode', title: '暗色' },
    { value: 'system', icon: 'contrast', title: '跟随系统' },
  ]
  return (
    <div style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 'var(--radius-full)', background: 'var(--white-40)', border: '1px solid var(--white-60)' }}>
      {options.map((o) => {
        const active = o.value === mode
        return (
          <button
            key={o.value}
            type="button"
            title={o.title}
            aria-label={o.title}
            onClick={() => setMode(o.value)}
            style={{
              flex: 1,
              display: 'flex',
              justifyContent: 'center',
              padding: 5,
              borderRadius: 'var(--radius-full)',
              background: active ? 'var(--white-90)' : 'transparent',
              color: active ? 'var(--color-primary)' : 'var(--color-outline)',
              transition: 'background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out)',
            }}
          >
            <Icon name={o.icon} size={16} />
          </button>
        )
      })}
    </div>
  )
}

/** 带侧边栏的页面外壳。播放器、引导页不用它。 */
export function AppShell() {
  const workMatch = useMatch('/work/:id/*')
  const routeWork = findWork(workMatch?.params.id)
  const [lastWorkId, setLastWorkId] = useState(() => localStorage.getItem(LAST_WORK_KEY) ?? 'wugang')
  useEffect(() => {
    if (!routeWork) return
    setLastWorkId(routeWork.id)
    localStorage.setItem(LAST_WORK_KEY, routeWork.id)
  }, [routeWork])
  const work = routeWork ?? findWork(lastWorkId)
  const [queueOpen, setQueueOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatFull, setChatFull] = useState(false)
  const [chatContext, setChatContext] = useState<string | null>(null)
  const showChat = chatOpen && work?.kind === 'project'
  const chatPresence = usePresence(showChat && !!work, 200)

  // 所有页面共用一个滚动容器，换页时回到顶部
  const { pathname } = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 })
  }, [pathname])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
        if (work?.kind !== 'project') return
        e.preventDefault()
        setChatOpen((v) => !v)
        return
      }
      if (e.key === 'Escape') {
        if (queueOpen || document.querySelector('[role="dialog"]')) return
        if (chatFull) {
          setChatFull(false)
        } else if (chatOpen) {
          setChatOpen(false)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [work?.kind, queueOpen, chatFull, chatOpen])
  const shell: ShellApi = {
    chatOpen: showChat,
    openChat: () => setChatOpen(true),
    closeChat: () => {
      setChatOpen(false)
      setChatFull(false)
    },
    setChatContext,
  }

  return (
    <ShellContext.Provider value={shell}>
      <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
        <aside
          className="glass-panel"
          style={{
            width: SIDEBAR_WIDTH,
            flexShrink: 0,
            margin: 'var(--space-3)',
            marginRight: 0,
            borderRadius: 'var(--radius-2xl)',
            display: 'flex',
            flexDirection: 'column',
            padding: '18px var(--space-3) 14px',
            overflow: 'auto',
          }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 12px 14px' }}>
            <img className="brand-mark-light" src="/icon/novelive-mark.svg" alt="" width={24} height={24} />
            <img className="brand-mark-dark" src="/icon/novelive-mark-dark.svg" alt="" width={24} height={24} />
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, letterSpacing: '0.12em' }}>NOVELIVE</span>
          </div>

          <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <NavItem to="/" end icon="local_library" label="书库" />
            <NavItem to="/usage" icon="monitoring" label="用量" />
            <NavItem to="/settings" icon="settings" label="设置" />
          </nav>

          {work ? <WorkSection work={work} inside={!!routeWork} /> : null}

          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <GlobalStatus onOpen={() => setQueueOpen(true)} />
            <ThemeSwitch />
          </div>
        </aside>

        {/* 主区域；Agent 面板盖在右侧，不挤压页面；全屏时盖住整个主区域 */}
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <main ref={mainRef} style={{ position: 'absolute', inset: 0, overflow: 'auto' }}>
            <Outlet />
          </main>

          {chatPresence.mounted && work ? (
            <aside
              className="glass-panel"
              style={{
                position: 'absolute',
                top: 'var(--space-3)',
                right: 'var(--space-3)',
                bottom: 'var(--space-3)',
                width: chatFull ? 'calc(100% - 24px)' : CHAT_WIDTH,
                maxWidth: 'calc(100% - 24px)',
                zIndex: 50,
                background: 'var(--veil-95)',
                borderRadius: 'var(--radius-2xl)',
                boxShadow: 'var(--shadow-pop)',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                transition: 'width var(--dur-slow) var(--ease-out)',
                animation:
                  chatPresence.state === 'enter'
                    ? 'drawer-in var(--dur-base) var(--ease-out) forwards'
                    : 'drawer-out var(--dur-base) var(--ease-out) forwards',
              }}
            >
              <ChatPanel
                work={work}
                context={chatContext}
                full={chatFull}
                onToggleFull={() => setChatFull((v) => !v)}
                onClose={shell.closeChat}
              />
            </aside>
          ) : null}
        </div>
      </div>
      <QueueDrawer open={queueOpen} onClose={() => setQueueOpen(false)} />
    </ShellContext.Provider>
  )
}
