import '@fontsource/noto-serif-sc/chinese-simplified-500.css'
import '@fontsource/noto-serif-sc/chinese-simplified-600.css'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { EmptyState } from '../../components/Form'
import { useToast } from '../../components/Toast'
import { findWork } from '../../mock/library'
import { scriptForChapter, type Bg, type Expr, type Filter, type Particles, type PlayerLine, type Pos } from '../../mock/player'
import { Image as ImageIcon, Meh, Smile, Frown, Annoyed } from 'lucide-react'
import { PlayerIcon, type PlayerIconName } from './icons'
import './player.css'

/* ================= 舞台美术（游戏皮肤 / 舞台例外，可用字面量颜色） ================= */

const SERIF = "'Noto Serif SC','Source Han Serif SC','Songti SC','SimSun',serif"

interface CastMember { pos: Pos; expr: Expr }

interface StageState {
  bg: Bg
  cg: boolean
  cast: Partial<Record<'lin' | 'xiu', CastMember>>
  filter: Filter | null
  particles: Particles | null
  camera: 'shake' | 'zoom' | 'zoomOut' | null
  charPlaceholder: boolean
  bgPlaceholder: boolean
  cgPlaceholder: boolean
}

const initialStage: StageState = {
  bg: 'harborNight',
  cg: false,
  cast: {},
  filter: null,
  particles: null,
  camera: null,
  charPlaceholder: false,
  bgPlaceholder: false,
  cgPlaceholder: false,
}

const posX: Record<Pos, string> = { left: '24%', center: '50%', right: '76%' }
const actorColor: Record<'lin' | 'xiu', string> = { lin: '#8fb4d4', xiu: '#d4a98f' }
const actorName: Record<'lin' | 'xiu', string> = { lin: '凛', xiu: '神秘少女' }
const exprIcon: Record<Expr, typeof Smile> = { calm: Meh, smile: Smile, angry: Frown, surprised: Annoyed }

function applyFx(stage: StageState, line: PlayerLine | undefined): StageState {
  const fx = line?.fx
  if (!fx) return stage
  const next: StageState = { ...stage, cast: { ...stage.cast } }
  if (fx.bg !== undefined && fx.bg !== stage.bg) {
    next.bg = fx.bg
    next.cg = false
  }
  if (fx.cg !== undefined) next.cg = fx.cg
  if (fx.actorEnter) next.cast[fx.actorEnter.id] = { pos: fx.actorEnter.pos, expr: fx.actorEnter.expr ?? 'calm' }
  if (fx.actorLeave === 'all') next.cast = {}
  else if (fx.actorLeave) delete next.cast[fx.actorLeave]
  if (fx.expr && next.cast[fx.expr.id]) next.cast[fx.expr.id] = { ...next.cast[fx.expr.id]!, expr: fx.expr.expr }
  if (fx.camera) next.camera = fx.camera
  if (fx.filter !== undefined) next.filter = fx.filter
  if (fx.particles !== undefined) next.particles = fx.particles
  if (fx.placeholder === 'background') next.bgPlaceholder = true
  if (fx.placeholder === 'character') next.charPlaceholder = true
  if (fx.placeholder === 'clear-character') next.charPlaceholder = false
  if (fx.placeholder === 'cg') next.cgPlaceholder = true
  return next
}

function lineText(line: PlayerLine): string {
  if (line.caption) return line.caption.title
  return (line.segs ?? []).map((s) => (s.t === 'wait' ? '…' : s.v)).join('')
}

interface CharStep { text: string; ruby?: string; delay: number; mark?: string }

function buildSteps(line: PlayerLine | undefined, charDelay: number): CharStep[] {
  const steps: CharStep[] = []
  for (const seg of line?.segs ?? []) {
    if (seg.t === 'wait') steps.push({ text: '', delay: seg.sec * 1000 })
    else if (seg.t === 'speed') for (const ch of seg.v) steps.push({ text: ch, delay: charDelay / seg.factor })
    else for (const ch of seg.v) steps.push({ text: ch, delay: charDelay, ruby: seg.t === 'ruby' ? seg.ruby : undefined, mark: seg.t === 'mark' ? seg.k : undefined })
  }
  return steps
}

const markStyle = (k?: string): CSSProperties =>
  k === 'b' ? { fontWeight: 700 }
  : k === 'em' ? { color: 'var(--nl-accent-strong)', fontWeight: 600 }
  : k === 'dim' ? { opacity: 0.48 }
  : k === 'whisper' ? { opacity: 0.6, fontSize: '0.85em' }
  : k === 'shout' ? { fontWeight: 800, fontSize: '1.2em', letterSpacing: '0.06em' }
  : k === 'hl' ? { background: 'linear-gradient(transparent 62%, var(--nl-hl) 62%, var(--nl-hl) 92%, transparent 92%)', boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone', padding: '0 1px' }
  : {}

/* ================= 背景画（CSS 渐变占位） ================= */

const bgArt: Record<Bg, { base: string; deco: ReactNode }> = {
  harborNight: {
    base: 'linear-gradient(180deg, #0c131b 0%, #16212d 55%, #233749 100%)',
    deco: <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 90% 60% at 50% 70%, rgba(150,185,214,0.10), transparent 70%)' }} />,
  },
  harborDawn: {
    base: 'linear-gradient(180deg, #28364d 0%, #4d6280 48%, #93a0b2 80%, #3a4c60 100%)',
    deco: (
      <>
        <div style={{ position: 'absolute', top: '16%', left: '13%', width: 110, height: 110, borderRadius: '50%', background: 'radial-gradient(circle, rgba(238,242,246,0.6), transparent 70%)' }} />
      </>
    ),
  },
  lighthouse: {
    base: 'linear-gradient(180deg, #101a24 0%, #1b2a3a 50%, #324a60 100%)',
    deco: (
      <>
        <div style={{ position: 'absolute', top: '10%', right: '17%', width: 9, height: '40%', background: 'linear-gradient(180deg, rgba(238,242,246,0.7), rgba(150,185,214,0.12))', borderRadius: 4 }}>
          <div style={{ position: 'absolute', top: -7, left: -15, width: 39, height: 15, background: 'rgba(238,242,246,0.88)', borderRadius: 4, boxShadow: '0 0 36px 14px rgba(238,242,246,0.38)' }} />
        </div>
        <div style={{ position: 'absolute', top: '14%', right: '16%', width: '34%', height: 3, transform: 'rotate(-8deg)', transformOrigin: 'right center', background: 'linear-gradient(90deg, transparent, rgba(238,242,246,0.42))' }} />
      </>
    ),
  },
  letterCg: {
    base: 'radial-gradient(ellipse at 50% 42%, #2a3a4c 0%, #16202c 62%, #0c1219 100%)',
    deco: (
      <>
        <div style={{ position: 'absolute', top: '28%', left: '50%', transform: 'translateX(-50%) rotate(-6deg)', width: '22%', height: '32%', background: 'linear-gradient(160deg, #d8cfba, #b3a78d)', borderRadius: 3, boxShadow: '0 20px 48px rgba(0,0,0,0.55)' }}>
          <div style={{ position: 'absolute', top: '42%', left: '50%', transform: 'translate(-50%,-50%)', width: 40, height: 40, borderRadius: '50%', background: 'radial-gradient(circle at 38% 32%, #a85a44, #7c3a28 68%)', boxShadow: '0 3px 10px rgba(0,0,0,0.45), inset 0 1px 2px rgba(255,220,200,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 26, height: 26, borderRadius: '50%', border: '1.5px solid rgba(238,215,200,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 9, height: 9, transform: 'rotate(45deg)', background: 'rgba(238,215,200,0.75)', borderRadius: 1.5 }} />
            </div>
          </div>
        </div>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 50% 45%, transparent 40%, rgba(8,13,18,0.82) 100%)' }} />
      </>
    ),
  },
}

function PlaceholderArt({ kind }: { kind: 'character' | 'background' | 'cg' }) {
  const label = { character: '角色占位图', background: '背景占位图', cg: 'CG 占位图' }[kind]
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        background: 'repeating-linear-gradient(45deg, rgba(150,185,214,0.05) 0 14px, rgba(150,185,214,0.11) 14px 28px)',
        color: 'rgba(238,242,246,0.4)',
      }}
    >
      <ImageIcon size={32} strokeWidth={1.2} />
      <span style={{ fontSize: 11, letterSpacing: '0.16em', fontFamily: SERIF }}>{label}</span>
    </div>
  )
}

function ActorSilhouette({ id, member, dimmed }: { id: 'lin' | 'xiu'; member: CastMember; dimmed: boolean }) {
  const color = actorColor[id]
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 0,
        left: posX[member.pos],
        transform: 'translateX(-50%)',
        width: 'min(21%, 300px)',
        height: '78%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-end',
        opacity: dimmed ? 0.32 : 1,
        filter: dimmed ? 'brightness(0.72)' : 'none',
        transition: 'left 0.7s ease, opacity 0.5s ease, filter 0.5s ease',
        animation: 'nl-screen-in 0.55s ease',
      }}
    >
      <div
        style={{
          width: '70%',
          height: '100%',
          background: `linear-gradient(180deg, ${color}5c, ${color}12)`,
          border: `1px solid ${color}70`,
          borderRadius: '48% 48% 6% 6% / 24% 24% 4% 4%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: '13%',
          gap: 9,
        }}
      >
        <div style={{ width: '44%', aspectRatio: '1', borderRadius: '50%', background: `${color}42`, border: `1px solid ${color}85`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {(() => { const F = exprIcon[member.expr]; return <F size={30} strokeWidth={1.4} style={{ color: '#eef2f6cc' }} /> })()}
        </div>
        <span style={{ color: '#eef2f670', fontSize: 10.5, letterSpacing: '0.14em', fontFamily: SERIF }}>{actorName[id]}</span>
      </div>
    </div>
  )
}

function FogLayer() {
  const bank = (top: string, h: string, cls: string, o: number) => (
    <div
      className={cls}
      style={{
        position: 'absolute',
        top,
        left: '-12%',
        right: '-12%',
        height: h,
        background: `radial-gradient(ellipse at 30% 50%, rgba(205,220,232,${o}) 0%, transparent 55%), radial-gradient(ellipse at 70% 50%, rgba(205,220,232,${o * 0.8}) 0%, transparent 55%)`,
      }}
    />
  )
  return (
    <>
      {bank('36%', '30%', 'nl-fog-a', 0.17)}
      {bank('56%', '36%', 'nl-fog-b', 0.23)}
    </>
  )
}

function SnowLayer() {
  const flakes = Array.from({ length: 44 }, (_, i) => ({
    left: `${(i * 37) % 100}%`,
    top: `${(i * 53) % 90}%`,
    size: 2 + ((i * 7) % 4),
    delay: `${(i % 9) * 0.9}s`,
    dur: 6 + (i % 5),
    o: 0.35 + ((i * 13) % 50) / 100,
  }))
  return (
    <div style={{ position: 'absolute', inset: '-6% 0 0 0' }}>
      {flakes.map((f, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: f.left,
            top: f.top,
            width: f.size,
            height: f.size,
            borderRadius: '50%',
            background: `rgba(238,242,246,${f.o})`,
            animation: `nl-snowfall ${f.dur}s linear ${f.delay} infinite alternate`,
          }}
        />
      ))}
    </div>
  )
}

/* ================= 存档数据 ================= */

interface SaveSlot { chapterIdx: number; title: string; line: number; at: string; bg: Bg }

type Screen = 'none' | 'menu' | 'save' | 'load' | 'backlog' | 'chapters' | 'settings'
type Mode = 'story' | 'waitEnd' | 'nextReady' | 'finale'

/* 已读句集合：主线进度之前的内容都视为已读（跳过已读用它判断） */
function seedRead(work: { id: string; chapters: { id: string; index: number }[]; reading: { chapter: number; progress: number } | null } | undefined, readThrough: number): Set<string> {
  const s = new Set<string>()
  if (!work) return s
  for (const c of work.chapters) {
    if (c.index >= readThrough) break
    const n = scriptForChapter(work.id, c.id)?.lines.length ?? 0
    for (let i = 0; i < n; i++) s.add(`${c.id}:${i}`)
  }
  const cur = work.chapters.find((c) => c.index === readThrough)
  if (cur) {
    const n = Math.floor((scriptForChapter(work.id, cur.id)?.lines.length ?? 0) * (work.reading?.progress ?? 0))
    for (let i = 0; i < n; i++) s.add(`${cur.id}:${i}`)
  }
  return s
}

const NOISE = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")`

export function PlayerPage() {
  const { id } = useParams()
  const work = findWork(id)
  const navigate = useNavigate()
  const toast = useToast()

  const playable = useMemo(() => (work ? work.chapters.filter((c) => c.status === 'published' || c.status === 'attention') : []), [work])
  const readThrough = work?.reading?.chapter ?? 0

  const initialChapter = useMemo(() => {
    if (!playable.length) return null
    const inProgress = playable.find((c) => c.index === readThrough)
    if (inProgress) return inProgress
    const prior = playable.filter((c) => c.index < readThrough)
    return prior[prior.length - 1] ?? playable[0]!
  }, [playable, readThrough])

  const [chapter, setChapter] = useState(initialChapter)
  const [lineIdx, setLineIdx] = useState(() => {
    if (!work || !initialChapter) return 0
    const total = scriptForChapter(work.id, initialChapter.id)?.lines.length ?? 1
    return Math.min(Math.floor(total * (work.reading?.progress ?? 0)), total - 1)
  })
  const [shown, setShown] = useState(0)
  const [mode, setMode] = useState<Mode>('story')
  const [screen, setScreen] = useState<Screen>('none')
  const [auto, setAuto] = useState(false)
  const [skip, setSkip] = useState(false)
  const [skipReadOnly, setSkipReadOnly] = useState(true)
  const [uiHidden, setUiHidden] = useState(false)
  const [revisit, setRevisit] = useState(false)
  const [charDelay, setCharDelay] = useState(26)
  const [autoDelay, setAutoDelay] = useState(1100)
  const [fontSize, setFontSize] = useState(22)
  const [boxOpacity, setBoxOpacity] = useState(0.78)
  const [searchParams] = useSearchParams()
  const boxParam = searchParams.get('box')
  const debug = searchParams.get('debug') === '1'
  const [boxStyle, setBoxStyle] = useState<'b' | 'c'>(boxParam === 'c' ? 'c' : 'b')
  useEffect(() => {
    if (boxParam === 'b' || boxParam === 'c') setBoxStyle(boxParam)
  }, [boxParam])
  const [savePage, setSavePage] = useState(0)
  const [quickSave, setQuickSave] = useState<SaveSlot | null>(null)
  const [slots, setSlots] = useState<(SaveSlot | null)[]>(() => {
    const arr: (SaveSlot | null)[] = Array(35).fill(null)
    arr[0] = { chapterIdx: 3, title: '灯塔看守人', line: 6, at: '11/19 22:41', bg: 'lighthouse' }
    arr[1] = { chapterIdx: 1, title: '码头的雾', line: 4, at: '11/18 21:07', bg: 'harborDawn' }
    return arr
  })
  const [stage, setStage] = useState<StageState>(initialStage)
  const [shakeKey, setShakeKey] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [simBusy, setSimBusy] = useState(false)
  const [confirmExit, setConfirmExit] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [entered, setEntered] = useState(false)
  const [showSafeZone, setShowSafeZone] = useState(false)


  const [readSet, setReadSet] = useState<Set<string>>(() => seedRead(work, readThrough))

  /* 换作品时整体重置（同一路由参数变化不会触发重挂载） */
  const workId = work?.id
  const prevWorkId = useRef(workId)
  if (prevWorkId.current !== workId) {
    prevWorkId.current = workId
    setChapter(initialChapter)
    setLineIdx(() => {
      if (!work || !initialChapter) return 0
      const total = scriptForChapter(work.id, initialChapter.id)?.lines.length ?? 1
      return Math.min(Math.floor(total * (work.reading?.progress ?? 0)), total - 1)
    })
    setShown(0)
    setMode('story')
    setScreen('none')
    setAuto(false)
    setSkip(false)
    setUiHidden(false)
    setRevisit(false)
    setStage(initialStage)
    setRevealed(false)
    setEntered(false)
    setReadSet(seedRead(work, readThrough))
  }
  const script = useMemo(() => (work && chapter ? scriptForChapter(work.id, chapter.id) : undefined), [work, chapter])
  const lines = script?.lines ?? []
  const line = lines[lineIdx]
  const isCaption = line?.kind === 'caption'
  const waitsClick = isCaption ? line.captionWait === true : line !== undefined
  const steps = useMemo(() => buildSteps(line, charDelay), [line, charDelay])
  const lineDone = isCaption || shown >= steps.length
  const next = script?.next
  const accent = work?.accent ?? '#7f9bb8'

  /* 打字机 */
  useEffect(() => {
    if (!line || isCaption || shown >= steps.length || screen !== 'none' || uiHidden) return
    const t = window.setTimeout(() => setShown((v) => v + 1), steps[shown]!.delay)
    return () => window.clearTimeout(t)
  }, [line, isCaption, shown, steps, screen, uiHidden])

  /* 行切换时应用演出 */
  useEffect(() => {
    setStage((s) => applyFx(s, line))
    if (line?.fx?.camera === 'shake') setShakeKey((k) => k + 1)
  }, [line])

  /* 进场黑幕 */
  useEffect(() => {
    const t = window.setTimeout(() => setEntered(true), 1250)
    return () => window.clearTimeout(t)
  }, [])

  const goTo = useCallback((idx: number) => {
    setLineIdx(idx)
    setShown(0)
    setMode('story')
  }, [])

  const advance = useCallback(() => {
    if (screen !== 'none' || uiHidden || !line || mode !== 'story' || !waitsClick) return
    if (!lineDone) {
      setShown(steps.length)
      return
    }
    setReadSet((s) => new Set(s).add(`${chapter?.id}:${lineIdx}`))
    if (line.charId === 'xiu' && line.name === '凛') setRevealed(true)
    if (lineIdx < lines.length - 1) {
      goTo(lineIdx + 1)
      return
    }
    if (!revisit && work?.kind === 'project' && next) {
      setMode('waitEnd')
      window.setTimeout(() => toast('正在制作的章节有新进展', 'notifications'), 2200)
    } else {
      setMode('finale')
    }
  }, [screen, uiHidden, line, mode, waitsClick, lineDone, steps.length, chapter, lineIdx, lines.length, revisit, work, next, goTo, toast])

  const advanceRef = useRef(advance)
  advanceRef.current = advance

  /* 自动 / 跳过 */
  useEffect(() => {
    if (mode !== 'story' || screen !== 'none' || uiHidden || !lineDone || !line || !entered) return
    if (skip) {
      if (skipReadOnly && !readSet.has(`${chapter?.id}:${lineIdx}`)) {
        setSkip(false)
        return
      }
      const t = window.setTimeout(() => advanceRef.current(), 60)
      return () => window.clearTimeout(t)
    }
    if (auto) {
      const t = window.setTimeout(() => advanceRef.current(), autoDelay)
      return () => window.clearTimeout(t)
    }
  })

  const enterChapter = (cIdx: number, atLine = 0) => {
    const target = playable.find((c) => c.index === cIdx)
    if (!target || !work) return
    setChapter(target)
    setLineIdx(Math.min(atLine, (scriptForChapter(work.id, target.id)?.lines.length ?? 1) - 1))
    setShown(0)
    setMode('story')
    setStage(initialStage)
    setRevealed(false)
    setScreen('none')
    setRevisit(target.index <= readThrough)
  }

  const rollback = useCallback(() => {
    if (mode === 'nextReady') return
    if (mode !== 'story') setMode('story')
    if (lineIdx > 0) {
      goTo(lineIdx - 1)
      return
    }
    if (!chapter || !work) return
    const prev = playable.filter((c) => c.index < chapter.index).sort((a, b) => b.index - a.index)[0]
    if (!prev) return
    const prevLines = scriptForChapter(work.id, prev.id)?.lines ?? []
    if (!prevLines.length) return
    setChapter(prev)
    setLineIdx(prevLines.length - 1)
    setShown(0)
    setRevisit(prev.index <= readThrough)
  }, [mode, lineIdx, chapter, work, playable, readThrough, goTo])

  const saveTo = (slotIdx: number | 'quick') => {
    const slot: SaveSlot = { chapterIdx: chapter?.index ?? 0, title: chapter?.title ?? '', line: lineIdx, at: new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }), bg: stage.cg ? 'letterCg' : stage.bg }
    if (slotIdx === 'quick') setQuickSave(slot)
    else setSlots((s) => s.map((v, i) => (i === slotIdx ? slot : v)))
    toast('已保存', 'save')
  }

  const loadFrom = (s: SaveSlot) => {
    setScreen('none')
    enterChapter(s.chapterIdx, s.line)
  }

  const simulateDone = () => {
    setSimBusy(true)
    window.setTimeout(() => {
      setSimBusy(false)
      setMode('nextReady')
    }, 1400)
  }

  /* Esc / 右键打开系统菜单；PageUp 回滚一句、PageDown 开记录（galgame 惯例） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setConfirmExit(false)
        setScreen((s) => (s === 'none' ? 'menu' : 'none'))
      } else if (e.key === 'PageUp') {
        e.preventDefault()
        rollback()
      } else if (e.key === 'PageDown') {
        e.preventDefault()
        setScreen((s) => (s === 'backlog' ? 'none' : 'backlog'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rollback])

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen()
      setIsFullscreen(false)
    } else {
      document.documentElement.requestFullscreen?.()
      setIsFullscreen(true)
    }
  }

  /* ---- 未找到作品 / 无可玩章节 ---- */
  if (!work) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--color-background)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <EmptyState icon="search_off" title="没有找到这部作品" desc="它可能不在书库里了。" actions={<button onClick={() => navigate('/')}>回到书库</button>} />
      </div>
    )
  }
  if (!chapter || !script || !lines.length) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--color-background)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <EmptyState icon="movie_off" title="还没有可玩的章节" desc={work.kind === 'imported' ? '这部作品包里没有可玩章节。' : '等第一章做完并发布后，就能在这里试玩。'} actions={<button onClick={() => navigate(`/work/${work.id}`)}>回到作品页</button>} />
      </div>
    )
  }

  /* ---- 皮肤变量（由作品主色推导） ---- */
  const skin: CSSProperties & Record<string, string> = {
    '--nl-accent': accent,
    '--nl-accent-strong': `color-mix(in srgb, ${accent} 78%, #eef2f6)`,
    '--nl-text': '#e9edf2',
    '--nl-text-dim': 'rgba(233,237,242,0.55)',
    '--nl-hover': `color-mix(in srgb, ${accent} 16%, transparent)`,
    '--nl-hl': `color-mix(in srgb, ${accent} 34%, transparent)`,
  }

  const camCls = stage.camera === 'shake' ? 'nl-camera-shake' : stage.camera === 'zoom' ? 'nl-camera-zoom' : ''
  const camStyle: CSSProperties =
    stage.camera === 'zoomOut' ? { transform: 'scale(1)', transition: 'transform 1.2s ease' } : stage.camera === 'zoom' ? {} : { transform: 'scale(1.04)' }
  const filterCss = stage.filter === 'sepia' ? 'sepia(0.62) saturate(0.85)' : stage.filter === 'gray' ? 'grayscale(0.85)' : stage.filter === 'night' ? 'brightness(0.72) saturate(0.8)' : 'none'
  const speaker = !isCaption ? (line.charId === 'xiu' && line.name === '神秘少女' && revealed ? '凛' : line.name) : undefined
  const talkingId = line && (line.kind === 'talk' || line.kind === 'inner') ? line.charId : undefined
  const pageSlots = savePage === 0 ? [quickSave, ...slots.slice(0, 5)] : slots.slice(savePage * 6 - 1, savePage * 6 + 5)

  const qbtn = (icon: PlayerIconName, label: string, onClick: () => void, on = false) => (
    <button
      key={label}
      className={`nl-qbtn${on ? ' nl-qbtn-on' : ''}`}
      data-tip={label}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      <PlayerIcon name={icon} size={18} />
    </button>
  )

  const glassPanel = (radius = 16): CSSProperties => ({
    background: `linear-gradient(170deg, color-mix(in srgb, rgba(20,27,36,${boxOpacity}) 86%, ${accent}) 0%, rgba(10,14,19,${Math.min(boxOpacity + 0.12, 0.97)}) 100%), ${NOISE}`,
    backdropFilter: 'blur(14px) saturate(1.3)',
    WebkitBackdropFilter: 'blur(14px) saturate(1.3)',
    border: `1px solid ${accent}38`,
    borderRadius: radius,
    boxShadow: `inset 0 1px 0 rgba(238,242,246,0.09), inset 0 0 0 1px rgba(8,11,15,0.35), 0 14px 44px rgba(0,0,0,0.55), 0 0 32px ${accent}22`,
  })

  /* 句子内容 + 快捷菜单（三种文本框样式共用） */
  const textBody = (
    <>
      {steps.slice(0, shown).map((s, i) =>
        s.text === '' ? null : s.ruby ? (
          <ruby key={i} style={{ rubyPosition: 'over' }}>
            {s.text}
            <rt style={{ fontSize: '0.55em', color: boxStyle === 'c' ? accent : 'var(--nl-accent-strong)', fontStyle: 'normal' }}>{s.ruby}</rt>
          </ruby>
        ) : (
          <span key={i} className={s.mark === 'glitch' ? 'nl-glitch' : undefined} style={markStyle(s.mark)}>
            {s.text}
          </span>
        ),
      )}
      {lineDone ? (
        <span className="nl-next-glyph" style={{ marginLeft: 10, verticalAlign: '-2px', color: accent }}>
          <PlayerIcon name="next" size={12} />
        </span>
      ) : null}
    </>
  )

  const quickMenu = (
    <>
      {qbtn('quicksave', '快存', () => saveTo('quick'))}
      {qbtn('quickload', '快读', () => quickSave && loadFrom(quickSave))}
      {qbtn('save', '存档', () => { setSavePage(0); setScreen('save') })}
      {qbtn('load', '读档', () => { setSavePage(0); setScreen('load') })}
      <span className="nl-qsep" />
      {qbtn('auto', '自动', () => { setAuto((v) => !v); if (!auto) setSkip(false) }, auto)}
      {qbtn('skip', '跳过', () => {
        setSkip((v) => !v)
        if (!skip) setAuto(false)
      }, skip)}
      <span className="nl-qsep" />
      {qbtn('rollback', '回滚', rollback)}
      {qbtn('log', '记录', () => setScreen('backlog'))}
      {qbtn('chapters', '章节', () => setScreen('chapters'))}
      {qbtn('settings', '设置', () => setScreen('settings'))}
      <span className="nl-qsep" />
      {qbtn('hide', '隐藏', () => setUiHidden(true))}
      {qbtn('menu', '菜单', () => { setConfirmExit(false); setScreen('menu') })}
    </>
  )

  const screenTitle = (t: string, icon: PlayerIconName) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 22 }}>
      <PlayerIcon name={icon} size={22} style={{ color: accent, transform: 'translateY(2px)' }} />
      <span style={{ fontFamily: SERIF, fontSize: 26, fontWeight: 600, color: 'var(--nl-text)', letterSpacing: '0.24em' }}>{t}</span>
      <span className="nl-orn-rule" />
    </div>
  )

  const screenShell = (content: ReactNode) => (
    <div
      className="nl-screen-in"
      onClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      style={{ position: 'absolute', inset: 0, zIndex: 50, background: 'rgba(8,11,15,0.88)', backdropFilter: 'blur(16px) saturate(1.2)', display: 'flex', flexDirection: 'column', padding: '48px 8% 42px' }}
    >
      {content}
      <button className="nl-qbtn" style={{ position: 'absolute', top: 48, right: '8%', minWidth: 40 }} onClick={() => setScreen('none')}>
        <PlayerIcon name="close" size={18} />
      </button>
    </div>
  )

  const slotCard = (s: SaveSlot | null, i: number, saveMode: boolean, isQuick = false) => (
    <button
      key={i}
      onClick={() => (saveMode ? (isQuick ? saveTo('quick') : saveTo(savePage === 0 ? i - 1 : savePage * 6 - 1 + i)) : s ? loadFrom(s) : undefined)}
      style={{
        border: `1px solid ${s ? `${accent}55` : 'rgba(233,237,242,0.14)'}`,
        borderRadius: 14,
        overflow: 'hidden',
        background: 'rgba(233,237,242,0.04)',
        textAlign: 'left',
        cursor: 'pointer',
        transition: 'border-color 0.15s ease',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}
    >
      <div style={{ aspectRatio: '16 / 9', position: 'relative', background: s ? bgArt[s.bg].base : 'repeating-linear-gradient(45deg, rgba(233,237,242,0.04) 0 10px, rgba(233,237,242,0.08) 10px 20px)', flexShrink: 0 }}>
        {s ? <div style={{ position: 'absolute', inset: 0 }}>{bgArt[s.bg].deco}</div> : <PlayerIcon name="save" size={24} style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', color: 'rgba(233,237,242,0.18)' }} />}
        {isQuick ? (
          <span style={{ position: 'absolute', top: 8, left: 8, display: 'inline-flex', alignItems: 'center', gap: 4, background: accent, color: '#0d1116', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', borderRadius: 5, padding: '3px 8px' }}>
            <PlayerIcon name="quicksave" size={12} />快速
          </span>
        ) : null}
      </div>
      <div style={{ padding: '9px 12px 10px' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--nl-text)', fontFamily: SERIF }}>{s ? s.title : '空'}</div>
        <div style={{ fontSize: 11, color: 'var(--nl-text-dim)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {s ? `第 ${s.line + 1} 句 · ${lineText((work ? scriptForChapter(work.id, `c${s.chapterIdx}`)?.lines : undefined)?.[s.line] ?? { kind: 'narration', segs: [] })} · ${s.at}` : '—'}
        </div>
      </div>
    </button>
  )

  const sysMenuItem = (icon: PlayerIconName, label: string, fn: () => void) => (
    <button key={label} className="nl-menu-item" onClick={(e) => { e.stopPropagation(); fn() }}>
      <PlayerIcon name={icon} size={18} />
      {label}
    </button>
  )

  const chapterThumb = (status: string, i: number) => {
    const bgs: Bg[] = ['harborNight', 'harborDawn', 'lighthouse', 'letterCg']
    const bg = bgs[i % bgs.length]!
    return (
      <div style={{ width: 128, height: 72, borderRadius: 9, overflow: 'hidden', position: 'relative', flexShrink: 0, background: bgArt[bg].base, border: `1px solid ${accent}30`, opacity: status === 'published' || status === 'attention' ? 1 : 0.35 }}>
        <div style={{ position: 'absolute', inset: 0 }}>{bgArt[bg].deco}</div>
      </div>
    )
  }

  return (
    <div
      style={skin}
      onClick={() => {
        if (uiHidden) {
          setUiHidden(false)
          return
        }
        advance()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        setConfirmExit(false)
        setScreen((s) => (s === 'none' ? 'menu' : 'none'))
      }}
      onWheel={(e) => {
        if (screen !== 'none' || uiHidden) return
        // 滚轮向上回滚一句（galgame 惯例），向下推进；记录走按钮 / PageDown
        if (e.deltaY < 0) rollback()
        else if (e.deltaY > 0) advance()
      }}
    >
      {/* ======== 舞台 ======== */}
      <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', cursor: 'pointer', userSelect: 'none' }}>
        {/* 舞台：16:9 构图铺满视口（cover），无黑边 */}
        <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: 'max(100vw, 177.78vh)', height: 'max(100vh, 56.25vw)', overflow: 'hidden' }}>
          <div key={shakeKey} className={camCls} style={{ position: 'absolute', inset: 0, transition: 'transform 0.5s ease', ...camStyle }}>
              <div style={{ position: 'absolute', inset: 0, background: stage.cg ? bgArt.letterCg.base : bgArt[stage.bg].base, transition: 'background 0.7s ease', filter: filterCss }}>
                {stage.cg ? bgArt.letterCg.deco : bgArt[stage.bg].deco}
              </div>
              {stage.bgPlaceholder && !stage.cg ? <PlaceholderArt kind="background" /> : null}
              {stage.cgPlaceholder && stage.cg ? <PlaceholderArt kind="cg" /> : null}
              {!stage.cg
                ? (Object.keys(stage.cast) as ('lin' | 'xiu')[]).map((cid) =>
                    stage.charPlaceholder ? (
                      <div key={cid} style={{ position: 'absolute', bottom: 0, left: posX[stage.cast[cid]!.pos], transform: 'translateX(-50%)', width: 'min(21%,300px)', height: '78%' }}>
                        <PlaceholderArt kind="character" />
                      </div>
                    ) : (
                      <ActorSilhouette key={cid} id={cid} member={stage.cast[cid]!} dimmed={talkingId !== undefined && talkingId !== cid} />
                    ),
                  )
                : null}
              <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
                {stage.particles === 'fog' ? <FogLayer /> : null}
                {stage.particles === 'snow' ? <SnowLayer /> : null}
              </div>
              {isCaption ? (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, background: 'rgba(8,11,15,0.3)' }}>
                  <div className="nl-caption-title" style={{ color: '#eef2f6', fontSize: 38, letterSpacing: '0.22em', fontWeight: 600, fontFamily: SERIF, textShadow: '0 2px 20px rgba(0,0,0,0.6)' }}>
                    {line.caption!.title}
                  </div>
                  {line.caption!.sub ? <div style={{ color: 'rgba(238,242,246,0.55)', fontSize: 14, letterSpacing: '0.34em', fontFamily: SERIF }}>{line.caption!.sub}</div> : null}
                  <div style={{ width: 88, height: 1, marginTop: 10, background: `linear-gradient(90deg, transparent, ${accent}88, transparent)` }} />
                  {waitsClick ? <span className="nl-next-glyph" style={{ marginTop: 24, color: accent }}><PlayerIcon name="next" size={13} /></span> : null}
                </div>
              ) : null}
          </div>
          {/* 4:3 安全区（?debug=1 后在设置里打开）：主体落在这个虚线框内，横屏裁切不掉 */}
          {showSafeZone ? (
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: '75%', height: '100%', border: '2px dashed rgba(238,242,246,0.6)', borderRadius: 4, pointerEvents: 'none', zIndex: 35 }}>
              <span style={{ position: 'absolute', top: 6, left: '50%', transform: 'translateX(-50%)', fontSize: 11, letterSpacing: '0.2em', color: 'rgba(238,242,246,0.75)', fontFamily: SERIF, background: 'rgba(8,11,15,0.5)', padding: '2px 10px', borderRadius: 999 }}>4:3 安全区</span>
            </div>
          ) : null}
        </div>

        {/* 进场黑幕 */}
        {!entered ? <div className="nl-enter-veil" style={{ position: 'absolute', inset: 0, background: '#05080c', zIndex: 80, pointerEvents: 'none' }} /> : null}

        {/* 自动 / 跳过指示 */}
        {!uiHidden && (auto || skip) && screen === 'none' ? (
          <div style={{ position: 'absolute', top: 20, right: 24, zIndex: 40, display: 'flex', alignItems: 'center', gap: 8, color: accent, fontSize: 11, letterSpacing: '0.2em', fontFamily: SERIF }}>
            <PlayerIcon name={skip ? 'skip' : 'auto'} size={15} />
            {skip ? '跳过中' : '自动'}
          </div>
        ) : null}

        {/* 重看徽标 */}
        {!uiHidden && revisit && screen === 'none' ? (
          <div style={{ position: 'absolute', top: 20, left: 24, zIndex: 40, color: 'rgba(238,242,246,0.65)', fontSize: 11, letterSpacing: '0.22em', fontFamily: SERIF, border: `1px solid ${accent}44`, borderRadius: 999, padding: '4px 13px', background: 'rgba(8,11,15,0.4)', backdropFilter: 'blur(6px)' }}>
            重看
          </div>
        ) : null}

        {/* ======== 文本框（两种样式：b 柔边通栏 / c 浅色纸笺） ======== */}
        {!uiHidden && mode === 'story' && !isCaption ? (
          boxStyle === 'b' ? (
            /* ---- B 柔边通栏：底部渐变带，无硬边 ---- */
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '34%', zIndex: 40 }} onClick={(e) => e.stopPropagation()}>
              <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg, transparent 0%, color-mix(in srgb, rgba(10,14,19,0.82) 82%, ${accent}) 68%, rgba(7,10,14,0.94) 100%)`, pointerEvents: 'none' }} />
              <div style={{ position: 'absolute', top: '15%', left: '9%', right: '9%', height: 1, background: `linear-gradient(90deg, transparent, ${accent}66 30%, ${accent}66 70%, transparent)`, pointerEvents: 'none' }} />
              <div onClick={advance} style={{ position: 'absolute', left: '8%', right: '8%', top: '25%', bottom: 14, cursor: 'pointer', fontFamily: SERIF }}>
                {speaker ? (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 9 }}>
                    <span style={{ fontSize: fontSize + 6, fontWeight: 600, color: line.kind === 'inner' ? 'var(--nl-accent-strong)' : 'var(--nl-text)', letterSpacing: '0.18em', textShadow: '0 1px 6px rgba(0,0,0,0.6)' }}>
                      {speaker}
                    </span>
                    {line.kind === 'inner' ? <span style={{ fontSize: 12, color: 'var(--nl-text-dim)', letterSpacing: '0.12em' }}>（心声）</span> : null}
                    <div style={{ width: 48, height: 2, background: `linear-gradient(90deg, ${accent}, transparent)`, borderRadius: 1 }} />
                  </div>
                ) : null}
                <div
                  style={{
                    fontWeight: 500,
                    color: line.kind === 'inner' ? 'rgba(205,216,229,0.88)' : 'var(--nl-text)',
                    fontSize,
                    lineHeight: 1.92,
                    letterSpacing: '0.02em',
                    textShadow: '0 1px 4px rgba(0,0,0,0.65)',
                  }}
                >
                  {textBody}
                </div>
              </div>
              <div style={{ position: 'absolute', right: '5%', bottom: 14, display: 'flex', alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                {quickMenu}
              </div>
            </div>
          ) : boxStyle === 'c' ? (
            /* ---- C 浅色纸笺：暖白透明纸面板 ---- */
            <div className="nl-light" style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: '3%', width: 'min(88%, 1060px)', zIndex: 40 }} onClick={(e) => e.stopPropagation()}>
              <div
                onClick={advance}
                style={{
                  position: 'relative',
                  background: `linear-gradient(172deg, rgba(246,242,235,0.94) 0%, rgba(238,232,222,${Math.min(boxOpacity + 0.14, 0.98)}) 100%), ${NOISE}`,
                  backdropFilter: 'blur(12px) saturate(1.1)',
                  WebkitBackdropFilter: 'blur(12px) saturate(1.1)',
                  borderRadius: 18,
                  border: `1px solid color-mix(in srgb, ${accent} 32%, rgba(255,255,255,0.55))`,
                  boxShadow: `inset 0 1px 0 rgba(255,255,255,0.8), 0 16px 40px rgba(0,0,0,0.42), 0 0 28px ${accent}18`,
                  padding: '28px 44px 46px 48px',
                  minHeight: 124,
                  cursor: 'pointer',
                }}
              >
                {speaker ? (
                  <div
                    style={{
                      position: 'absolute',
                      top: -19,
                      left: 26,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 9,
                      background: line.kind === 'inner' ? 'rgba(246,242,235,0.98)' : `linear-gradient(135deg, ${accent}, color-mix(in srgb, ${accent} 68%, #453a2e))`,
                      border: `1.5px solid ${line.kind === 'inner' ? accent : 'rgba(255,255,255,0.35)'}`,
                      borderRadius: 10,
                      padding: '7px 22px 6px',
                      color: line.kind === 'inner' ? accent : '#fffdf8',
                      fontWeight: 600,
                      fontSize: 15,
                      fontFamily: SERIF,
                      letterSpacing: '0.18em',
                      boxShadow: '0 5px 16px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.25)',
                    }}
                  >
                    {speaker}
                    {line.kind === 'inner' ? <span style={{ fontSize: 11, opacity: 0.8 }}>（心声）</span> : null}
                  </div>
                ) : null}
                <div
                  style={{
                    fontFamily: SERIF,
                    fontWeight: 500,
                    color: line.kind === 'inner' ? 'rgba(96,88,78,0.95)' : '#3a352e',
                    fontSize,
                    lineHeight: 1.9,
                    letterSpacing: '0.02em',
                    position: 'relative',
                  }}
                >
                  {textBody}
                </div>
                <div style={{ position: 'absolute', right: 20, bottom: 11, display: 'flex', alignItems: 'center', color: '#6b655c' }} onClick={(e) => e.stopPropagation()}>
                  {quickMenu}
                </div>
              </div>
            </div>
          ) : null
        ) : null}

        {uiHidden ? (
          <div style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 40, color: `${accent}55` }}>
            <PlayerIcon name="next" size={10} />
          </div>
        ) : null}

        {/* ======== 章末：下一章制作中 ======== */}
        {!uiHidden && mode === 'waitEnd' && next ? (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'absolute', inset: 0, zIndex: 45, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
          <div
            className="nl-rise"
            style={{ width: 'min(88%, 500px)', ...glassPanel(18), padding: '30px 34px' }}
          >
            <div style={{ fontFamily: SERIF, fontSize: 12, letterSpacing: '0.32em', color: 'var(--nl-accent-strong)', marginBottom: 14 }}>本章结束</div>
            <div style={{ fontFamily: SERIF, fontSize: 20, color: 'var(--nl-text)', marginBottom: 16, letterSpacing: '0.05em' }}>
              下一章「{next.title}」{next.status === 'producing' ? '制作中' : next.status === 'attention' ? '需要处理' : '等待'}
            </div>
            {next.status === 'producing' ? (
              <div style={{ fontFamily: SERIF, fontSize: 13.5, color: 'var(--nl-text-dim)', lineHeight: 1.9 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <PlayerIcon name="auto" size={15} style={{ color: accent }} />
                  {next.step}
                </div>
                <div style={{ marginTop: 6 }}>做完会自动载入开头</div>
              </div>
            ) : next.status === 'attention' ? (
              <div style={{ fontFamily: SERIF, fontSize: 13.5, color: 'var(--nl-text-dim)', lineHeight: 1.9 }}>图片没画出来，会用占位图发布，做完后自动载入。</div>
            ) : (
              <div style={{ fontFamily: SERIF, fontSize: 13.5, color: 'var(--nl-text-dim)', lineHeight: 1.9 }}>还在排队等待，做完后会自动载入开头。</div>
            )}
            {next.status === 'producing' ? (
              <button
                className="nl-btn nl-btn-quiet"
                style={{ marginTop: 18 }}
                onClick={simulateDone}
                disabled={simBusy}
              >
                <PlayerIcon name="next" size={13} />
                {simBusy ? '载入中……' : '模拟做完'}
              </button>
            ) : null}
          </div>
          </div>
        ) : null}

        {/* 下一章就绪 */}
        {!uiHidden && mode === 'nextReady' && next ? (
          <div
            style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, zIndex: 45, background: 'rgba(5,8,12,0.62)' }}
            onClick={(e) => {
              e.stopPropagation()
              setMode('finale')
            }}
          >
            <div style={{ fontFamily: SERIF, fontSize: 28, color: 'var(--nl-text)', letterSpacing: '0.08em' }}>「{next.title}」</div>
            <div style={{ fontFamily: SERIF, fontSize: 13, color: 'var(--nl-text-dim)', letterSpacing: '0.2em' }}>已载入开头</div>
            <span className="nl-next-glyph" style={{ color: accent, marginTop: 12 }}><PlayerIcon name="next" size={16} /></span>
          </div>
        ) : null}

        {/* 结束 */}
        {!uiHidden && mode === 'finale' ? (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'absolute', inset: 0, zIndex: 45, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
          <div
            className="nl-rise"
            style={{ width: 'min(88%, 440px)', ...glassPanel(18), padding: '30px 32px', textAlign: 'center' }}
          >
            <PlayerIcon name="chapters" size={28} style={{ color: accent, margin: '0 auto' }} />
            <div style={{ fontFamily: SERIF, fontSize: 19, color: 'var(--nl-text)', marginTop: 14, letterSpacing: '0.1em' }}>
              {revisit ? '重看结束' : '已读到最新进度'}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 24 }}>
              <button
                className="nl-btn"
                onClick={() => navigate(`/work/${work.id}`)}
              >
                <PlayerIcon name="exit" size={15} />
                返回作品页
              </button>
              <button
                className="nl-btn nl-btn-quiet"
                onClick={() => {
                  setLineIdx(0)
                  setShown(0)
                  setMode('story')
                  setStage(initialStage)
                  setRevealed(false)
                }}
              >
                <PlayerIcon name="rollback" size={15} />
                重新播放
              </button>
            </div>
          </div>
          </div>
        ) : null}
      </div>

      {/* ======== 系统菜单（Esc / 右键） ======== */}
      {screen === 'menu' ? (
        <div
          className="nl-screen-in"
          onClick={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
          style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(5,8,12,0.7)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          {confirmExit ? (
            <div className="nl-rise" style={{ width: 340, ...glassPanel(16), padding: '26px 28px 22px' }}>
              <div style={{ fontFamily: SERIF, fontSize: 16, color: 'var(--nl-text)', letterSpacing: '0.08em' }}>返回作品页？</div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 24 }}>
                <button className="nl-btn nl-btn-quiet" onClick={() => setConfirmExit(false)}>
                  继续玩
                </button>
                <button className="nl-btn nl-btn-solid" onClick={() => navigate(`/work/${work.id}`)}>
                  返回
                </button>
              </div>
            </div>
          ) : (
            <div style={{ width: 340, ...glassPanel(18), padding: '14px 10px', position: 'relative' }}>
              <div style={{ padding: '6px 16px 12px', fontFamily: SERIF, fontSize: 12, letterSpacing: '0.3em', color: 'var(--nl-text-dim)' }}>{work.title}</div>
              {sysMenuItem('play', '返回游戏', () => setScreen('none'))}
              {sysMenuItem('save', '存档', () => { setSavePage(0); setScreen('save') })}
              {sysMenuItem('load', '读档', () => { setSavePage(0); setScreen('load') })}
              {sysMenuItem('log', '记录', () => setScreen('backlog'))}
              {sysMenuItem('chapters', '章节', () => setScreen('chapters'))}
              {sysMenuItem('settings', '设置', () => setScreen('settings'))}
              {work.kind === 'project'
                ? sysMenuItem('edit', '在编辑器中打开这里', () => navigate(`/work/${work.id}/edit?chapter=${chapter.index}&line=${lineIdx + 1}`))
                : null}
              <div style={{ height: 1, background: `linear-gradient(90deg, transparent, ${accent}40, transparent)`, margin: '8px 14px' }} />
              {sysMenuItem('exit', '返回作品页', () => setConfirmExit(true))}
            </div>
          )}
        </div>
      ) : null}

      {/* ======== 存档 / 读档 ======== */}
      {screen === 'save' || screen === 'load'
        ? screenShell(
            <>
              {screenTitle(screen === 'save' ? '存档' : '读档', screen === 'save' ? 'save' : 'load')}
              <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(2, 1fr)', gap: 18 }}>
                {pageSlots.map((s, i) => slotCard(s, i, screen === 'save', savePage === 0 && i === 0))}
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center', marginTop: 24 }}>
                <button className="nl-qbtn" style={{ width: 'auto', padding: '4px 8px' }} onClick={() => setSavePage((p) => Math.max(0, p - 1))}>
                  <PlayerIcon name="pageLeft" size={15} />
                </button>
                {Array.from({ length: 6 }, (_, p) => (
                  <button key={p} className={`nl-btn${p === savePage ? '' : ' nl-btn-quiet'}`} style={{ padding: '5px 13px', fontSize: 13, borderColor: p === savePage ? accent : undefined, color: p === savePage ? 'var(--nl-accent-strong)' : undefined }} onClick={() => setSavePage(p)}>
                    {p + 1}
                  </button>
                ))}
                <button className="nl-qbtn" style={{ width: 'auto', padding: '4px 8px' }} onClick={() => setSavePage((p) => Math.min(5, p + 1))}>
                  <PlayerIcon name="pageRight" size={15} />
                </button>
              </div>
            </>,
          )
        : null}

      {/* ======== 记录 ======== */}
      {screen === 'backlog'
        ? screenShell(
            <>
              {screenTitle('记录', 'log')}
              <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {/* 跨章记录：每章只列出已读的句，点一句跳回那一章那一句 */}
                {playable.map((c) => {
                  const sc = scriptForChapter(work.id, c.id)
                  if (!sc) return null
                  const readLines = sc.lines
                    .map((l, i) => ({ l, i }))
                    .filter(({ i }) => readSet.has(`${c.id}:${i}`) || (c.id === chapter.id && i <= lineIdx))
                  if (!readLines.length) return null
                  return (
                    <div key={c.id}>
                      <div style={{ fontFamily: SERIF, fontSize: 11, letterSpacing: '0.24em', color: 'var(--nl-text-dim)', padding: '16px 10px 8px', borderTop: c.id === playable[0]?.id ? 'none' : `1px solid ${accent}22` }}>
                        第 {c.index} 章 · {c.title}
                      </div>
                      {readLines.map(({ l, i }) => (
                        <button key={i} className="nl-row" onClick={() => { setScreen('none'); if (c.id === chapter.id) goTo(i); else enterChapter(c.index, i) }}>
                          {l.kind === 'caption' ? (
                            <span style={{ fontFamily: SERIF, fontSize: 12, color: 'var(--nl-text-dim)', letterSpacing: '0.18em' }}>字幕 · {l.caption!.title}</span>
                          ) : (
                            <div>
                              {(l.charId === 'xiu' && l.name === '神秘少女' && revealed ? '凛' : l.name) ? (
                                <div style={{ fontFamily: SERIF, fontSize: 12, fontWeight: 700, color: 'var(--nl-accent-strong)', marginBottom: 3, letterSpacing: '0.1em' }}>
                                  {l.charId === 'xiu' && l.name === '神秘少女' && revealed ? '凛' : l.name}
                                  {l.kind === 'inner' ? '（心声）' : ''}
                                </div>
                              ) : null}
                              <div style={{ fontFamily: SERIF, fontSize: 14, color: 'var(--nl-text)', lineHeight: 1.8 }}>{lineText(l)}</div>
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  )
                })}
              </div>
            </>,
          )
        : null}

      {/* ======== 章节 ======== */}
      {screen === 'chapters'
        ? screenShell(
            <>
              {screenTitle('章节', 'chapters')}
              <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {work.chapters.map((c) => {
                  const isPlayable = c.status === 'published' || c.status === 'attention'
                  const isRead = c.index <= readThrough
                  return (
                    <button key={c.id} className="nl-row" disabled={!isPlayable} onClick={() => isPlayable && enterChapter(c.index)} style={{ opacity: isPlayable ? 1 : 0.4, alignItems: 'center' }}>
                      {chapterThumb(c.status, c.index)}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontFamily: SERIF, fontSize: 15, color: 'var(--nl-text)', letterSpacing: '0.05em' }}>
                          第 {c.index} 章 · {c.title}
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                          <span style={{ fontSize: 11, color: 'var(--nl-text-dim)', letterSpacing: '0.14em' }}>{c.status === 'published' ? '已发布' : c.status === 'attention' ? '需要处理' : c.status === 'producing' ? '制作中' : '等待'}</span>
                          {isRead && isPlayable ? <span style={{ fontSize: 11, color: 'var(--nl-accent-strong)', letterSpacing: '0.14em' }}>已读</span> : null}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </>,
          )
        : null}

      {/* ======== 设置 ======== */}
      {screen === 'settings'
        ? screenShell(
            <>
              {screenTitle('设置', 'settings')}
              <div style={{ maxWidth: 540, display: 'flex', flexDirection: 'column', gap: 30 }}>
                {([
                  ['文字速度', 60 - charDelay, 5, 55, (v: number) => setCharDelay(60 - v)],
                  ['自动播放速度', autoDelay, 400, 3000, setAutoDelay],
                  ['字号', fontSize, 15, 30, setFontSize],
                  ['对话框不透明度', Math.round(boxOpacity * 100), 40, 100, (v: number) => setBoxOpacity(v / 100)],
                ] as [string, number, number, number, (v: number) => void][]).map(([label, val, min, max, fn]) => (
                  <div key={label}>
                    <div style={{ marginBottom: 12 }}>
                      <span style={{ fontFamily: SERIF, fontSize: 14.5, color: 'var(--nl-text)', letterSpacing: '0.12em' }}>{label}</span>
                    </div>
                    <input className="nl-range" type="range" min={min} max={max} value={val} onChange={(e) => fn(Number(e.target.value))} />
                  </div>
                ))}
                {([
                  ['只跳过已读', skipReadOnly, () => setSkipReadOnly((v) => !v)] as const,
                  ['全屏', isFullscreen, toggleFullscreen] as const,
                  // 开发调试项：只有 ?debug=1 才显示
                  ...(debug ? [['显示 4:3 安全区', showSafeZone, () => setShowSafeZone((v) => !v)] as const] : []),
                ]).map(([label, on, fn]) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontFamily: SERIF, fontSize: 14.5, color: 'var(--nl-text)', letterSpacing: '0.12em' }}>{label}</span>
                    <button
                      onClick={fn}
                      style={{ width: 48, height: 25, borderRadius: 999, background: on ? accent : 'rgba(233,237,242,0.14)', position: 'relative', transition: 'background 0.2s ease', cursor: 'pointer', boxShadow: on ? `0 0 12px ${accent}55` : 'none' }}
                    >
                      <span style={{ position: 'absolute', top: 3.5, left: on ? 26 : 3.5, width: 18, height: 18, borderRadius: '50%', background: '#eef2f6', transition: 'left 0.2s ease' }} />
                    </button>
                  </div>
                ))}
                <div>
                  <div style={{ marginBottom: 12 }}>
                    <span style={{ fontFamily: SERIF, fontSize: 14.5, color: 'var(--nl-text)', letterSpacing: '0.12em' }}>对话框样式</span>
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    {([['b', '柔边通栏'], ['c', '浅色纸笺']] as const).map(([k, label]) => (
                      <button
                        key={k}
                        onClick={() => setBoxStyle(k)}
                        className={`nl-btn${boxStyle === k ? '' : ' nl-btn-quiet'}`}
                        style={{ borderColor: boxStyle === k ? accent : undefined, color: boxStyle === k ? 'var(--nl-accent-strong)' : undefined }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </>,
          )
        : null}
    </div>
  )
}
