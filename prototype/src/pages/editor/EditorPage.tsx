import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Button, Icon } from '../../components/Button'
import { Banner, Checkbox, Chip, Drawer, RadioGroup, Tooltip } from '../../components/Extended'
import { CompactSelect, EmptyState, Field, SectionLabel, TextInput, textareaStyle } from '../../components/Form'
import { Dropdown, Modal } from '../../components/Modal'
import { Page } from '../../components/Page'
import { useToast } from '../../components/Toast'
import {
  builtinMarks,
  customMarkSeeds,
  editorScenes,
  fallbackScenes,
  findCharacter,
  lineKindMeta,
  markLabel,
  parseRich,
  scanMarks,
  workCast,
  type CustomMark,
  type EditorCharacter,
  type EditorScene,
  type SceneLine,
} from '../../mock/editor'
import { findSeries, findWork } from '../../mock/library'
import type { Chapter } from '../../mock/types'
import { useShell } from '../../shell/AppShell'

// ---- 类型 ----

/** 一句台词被编辑过的字段；缺省回退到剧本原文 */
interface DraftLine {
  text?: string
  expression?: string
  displayAs?: string
}

interface HistoryEntry {
  id: string
  time: string
  desc: string
  /** 这次修改动到的句子，prev 为修改前的草稿（undefined = 原本是剧本原文） */
  changes: { lineId: string; prev?: DraftLine }[]
}

const panelStyle = {
  background: 'var(--panel-75)',
  border: '1px solid var(--white-80)',
  borderRadius: 'var(--radius-lg)',
} as const

// 舞台上压字的深色底：tokens 里没有，用 --stage-text 调出来（舞台例外之外的 UI 色走 tokens）
const STAGE_DIM = 'color-mix(in srgb, var(--stage-text) 10%, rgba(0,0,0,0.6))'

const dimBtn = {
  display: 'flex',
  padding: 6,
  borderRadius: 'var(--radius-full)',
  background: STAGE_DIM,
  color: 'var(--stage-accent)',
} as const

// ---- 行内标签的富文本渲染（舞台 / 列表两个色调） ----

function segStyle(mark: string, base: 'stage' | 'list', customs: CustomMark[]): CSSProperties | undefined {
  const accent = base === 'stage' ? 'var(--stage-accent)' : 'var(--color-primary)'
  switch (mark) {
    case 'em':
      return { color: accent, fontWeight: 600 }
    case 'b':
      return { fontWeight: 800 }
    case 'dim':
      return { opacity: 0.55 }
    case 'whisper':
      return { opacity: 0.72, fontSize: '0.88em' }
    case 'shout':
      return { fontWeight: 800, fontSize: '1.2em', letterSpacing: '0.04em' }
    case 'glitch':
      return {
        display: 'inline-block',
        transform: 'skewX(-6deg)',
        textShadow: '1px 0 color-mix(in srgb, var(--color-error) 80%, transparent), -1px 0 color-mix(in srgb, var(--stage-accent) 80%, transparent)',
      }
    case 'hl':
      return {
        background: base === 'stage' ? 'color-mix(in srgb, var(--stage-accent) 28%, transparent)' : 'var(--color-tertiary-fixed)',
        padding: '0 3px',
        borderRadius: 'var(--radius-sm)',
      }
    default: {
      const custom = customs.find((m) => m.id === mark && m.state === 'confirmed')
      if (custom) {
        // 自定义标记样式由作品定义，这里给「信件」一类标记统一的信纸感
        return {
          background: base === 'stage' ? 'color-mix(in srgb, var(--stage-text) 14%, transparent)' : 'var(--color-secondary-container)',
          borderBottom: `1px dashed ${accent}`,
          padding: '0 4px',
          borderRadius: 'var(--radius-sm)',
        }
      }
      return { textDecoration: 'underline dotted', textUnderlineOffset: 3 }
    }
  }
}

function RichText({ src, base, customs }: { src: string; base: 'stage' | 'list'; customs: CustomMark[] }) {
  const iconColor = base === 'stage' ? 'var(--stage-accent)' : 'var(--color-outline)'
  return (
    <>
      {parseRich(src).map((s, i) => {
        if (s.kind === 'text') return <span key={i}>{s.text}</span>
        if (s.kind === 'mark') {
          const custom = customs.find((m) => m.id === s.mark)
          return (
            <span key={i} style={segStyle(s.mark, base, customs)} title={custom ? `「${custom.name}」标记` : undefined}>
              {s.text.includes('{') ? <RichText src={s.text} base={base} customs={customs} /> : s.text}
            </span>
          )
        }
        if (s.kind === 'ruby')
          return (
            <ruby key={i}>
              {s.text}
              <rt style={{ fontSize: '0.55em', color: iconColor, letterSpacing: '0.05em' }}>{s.reading}</rt>
            </ruby>
          )
        if (s.kind === 'wait')
          return (
            <Tooltip key={i} text={`停顿 ${s.seconds} 秒`}>
              <Icon name="more_vert" size={13} style={{ color: iconColor, verticalAlign: '-2px', margin: '0 1px' }} />
            </Tooltip>
          )
        return (
          <Tooltip key={i} text={`变速 ×${s.factor}`}>
            <span style={{ borderBottom: `1px dotted ${iconColor}` }}>
              <Icon name="speed" size={12} style={{ color: iconColor, verticalAlign: '-2px', marginRight: 1 }} />
              {s.text}
            </span>
          </Tooltip>
        )
      })}
    </>
  )
}

/** 剧本字符串按可见字数截断，标记结构保持完整（预览打字机用）。 */
function truncateRich(src: string, n: number): string {
  let out = ''
  let i = 0
  let left = n
  const stack: string[] = []
  while (i < src.length && left > 0) {
    if (src[i] === '{') {
      const j = src.indexOf('}', i)
      if (j === -1) break
      const tag = src.slice(i + 1, j)
      if (tag.startsWith('/')) stack.pop()
      else if (!tag.startsWith('wait')) stack.push(tag.split(' ')[0])
      out += src.slice(i, j + 1)
      i = j + 1
    } else {
      out += src[i]
      left -= 1
      i += 1
    }
  }
  for (let k = stack.length - 1; k >= 0; k--) out += `{/${stack[k]}}`
  return out
}

// ---- 舞台上的角色剪影 ----

function CastSilhouette({ name, expr, position, speaking, tint, onClick }: {
  name: string
  expr: string
  position: 'left' | 'center' | 'right'
  speaking: boolean
  tint: number
  onClick: () => void
}) {
  // 角色 tint 走 token：主色 / 第三色 / 作品主色各借一点
  const tints = ['var(--stage-accent)', 'var(--color-success)', 'var(--color-on-secondary-container)']
  const c = tints[tint % tints.length]
  const left = position === 'left' ? '27%' : position === 'right' ? '73%' : '50%'
  return (
    <button
      onClick={onClick}
      title={`${name} · ${expr}`}
      style={{
        position: 'absolute',
        bottom: 0,
        left,
        transform: 'translateX(-50%)',
        width: '19%',
        height: '72%',
        padding: 0,
        background: speaking
          ? `linear-gradient(180deg, color-mix(in srgb, ${c} 55%, transparent), color-mix(in srgb, ${c} 12%, transparent))`
          : `linear-gradient(180deg, color-mix(in srgb, ${c} 22%, transparent), color-mix(in srgb, ${c} 5%, transparent))`,
        borderRadius: '48% 48% 0 0 / 26% 26% 0 0',
        border: `1px solid color-mix(in srgb, ${c} ${speaking ? 70 : 28}%, transparent)`,
        filter: speaking ? 'none' : 'brightness(0.72)',
        transition: 'all 0.3s ease',
        cursor: 'pointer',
      }}
    >
      <Icon name="person" size={30} style={{ position: 'absolute', top: '9%', left: '50%', transform: 'translateX(-50%)', color: 'color-mix(in srgb, var(--stage-text) 50%, transparent)' }} />
      <span
        className="label-caps label-caps-zh"
        style={{
          position: 'absolute',
          top: -28,
          left: '50%',
          transform: 'translateX(-50%)',
          background: STAGE_DIM,
          color: c,
          padding: '3px 10px',
          borderRadius: 'var(--radius-full)',
          whiteSpace: 'nowrap',
          opacity: speaking ? 1 : 0,
          transition: 'opacity 0.25s ease',
        }}
      >
        {name} · {expr}
      </span>
    </button>
  )
}

// ---- 原文对照（默认收起的侧栏面板内容） ----

function SourcePanel({ scene, line, onJump, onAsk }: {
  scene: EditorScene
  line: SceneLine
  onJump: (lineId: string) => void
  onAsk: (paraId: string) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {scene.sourceParagraphs.map((p) => {
        const linked = p.lines.includes(line.id) || p.id === line.sourcePara
        return (
          <div
            key={p.id}
            className="hover-row"
            style={{
              padding: '10px 12px',
              borderRadius: 'var(--radius-md)',
              background: linked ? 'var(--color-secondary-container)' : 'var(--white-50)',
              border: linked ? '1px solid color-mix(in srgb, var(--color-on-secondary-container) 40%, transparent)' : '1px solid transparent',
              transition: 'all 0.15s ease',
            }}
          >
            <button
              onClick={() => onJump(p.lines[0])}
              title="跳到对应句子"
              style={{ display: 'block', width: '100%', textAlign: 'left', fontSize: 12.5, lineHeight: 1.7, color: 'var(--color-on-surface)', padding: 0 }}
            >
              {p.text}
            </button>
            <div className="row-actions" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
              <button
                onClick={() => onAsk(p.id)}
                className="label-caps label-caps-zh"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--color-on-surface-variant)', padding: '3px 8px', borderRadius: 'var(--radius-full)', background: 'var(--white-60)' }}
              >
                <Icon name="auto_fix_high" size={12} /> 让 Agent 按这段修改
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---- 主页面 ----

export function EditorPage() {
  const { id } = useParams()
  const work = findWork(id)
  const toast = useToast()
  const shell = useShell()
  const [searchParams] = useSearchParams()

  const editable = useMemo(() => (work?.chapters ?? []).filter((c) => c.status === 'published'), [work])
  const castChars = useMemo<EditorCharacter[]>(
    () => (work ? (workCast[work.id] ?? ['lin', 'xi']).map((cid) => findCharacter(cid)!) : []),
    [work],
  )

  const [chapterId, setChapterId] = useState('')
  const chapter = editable.find((c) => c.id === chapterId) ?? editable[0]
  const scenes = useMemo(
    () => (work && chapter ? editorScenes[work.id]?.[chapter.id] ?? fallbackScenes(chapter, castChars) : []),
    [work, chapter, castChars],
  )

  const [sceneId, setSceneId] = useState('')
  const scene = scenes.find((s) => s.id === sceneId) ?? scenes[0]

  const [lineId, setLineId] = useState('')
  const line: SceneLine | undefined = scene?.lines.find((l) => l.id === lineId) ?? scene?.lines[0]

  const [drafts, setDrafts] = useState<Record<string, DraftLine>>({})
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [histOpen, setHistOpen] = useState(false)

  const [textDraft, setTextDraft] = useState('')
  const textRef = useRef<HTMLTextAreaElement>(null)
  const [activeMark, setActiveMark] = useState<number | null>(null)
  const [markEdits, setMarkEdits] = useState<Record<number, string>>({})

  const [marks, setMarks] = useState<CustomMark[]>(customMarkSeeds)

  const [rewriteOpen, setRewriteOpen] = useState(false)
  const [rewriteInstr, setRewriteInstr] = useState('')
  const [rewriteGen, setRewriteGen] = useState(false)
  const [rewritePick, setRewritePick] = useState<Record<string, boolean>>({})

  const [regenPick, setRegenPick] = useState<'bg' | 'portrait' | null>(null)
  const [bgOverride, setBgOverride] = useState<Record<string, string>>({})
  const [portraitPick, setPortraitPick] = useState<Record<string, number>>({})

  const [ruleOpen, setRuleOpen] = useState(false)
  const [ruleScope, setRuleScope] = useState<'chapter' | 'work'>('chapter')
  const [ruleText, setRuleText] = useState('')
  const [rules, setRules] = useState<{ scope: string; text: string }[]>([])

  const [srcEdit, setSrcEdit] = useState<string | null>(null)
  const [srcInstr, setSrcInstr] = useState('')

  const [srcOpen, setSrcOpen] = useState(false)

  // 主区宽度决定编排：够宽时舞台与句子列表并排（对照栏替换句子列），
  // 窄了（比如对话栏打开）回到上下堆叠。用容器自身宽度而不是视口媒体查询。
  const mainRef = useRef<HTMLDivElement>(null)
  const [mainW, setMainW] = useState(0)
  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    const ro = new ResizeObserver((es) => setMainW(es[0].contentRect.width))
    ro.observe(el)
    setMainW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // ---- 派生 ----

  const lineKind = line ? lineKindMeta[line.kind] : lineKindMeta.narration
  const speaker = line?.speaker ? findCharacter(line.speaker) : undefined
  const slot = speaker ? scene?.cast.find((s) => s.char === speaker.id) : undefined
  const curText = line ? (drafts[line.id]?.text ?? line.text) : ''
  const curExpr = line ? (drafts[line.id]?.expression ?? line.expression ?? slot?.expression ?? '') : ''
  const curName = line ? (drafts[line.id]?.displayAs ?? line.displayAs ?? '') : ''
  const exprLabel = speaker?.expressions.find((e) => e.id === curExpr)?.label ?? curExpr
  const outfitLabel = slot ? speaker?.outfits.find((o) => o.id === slot.outfit)?.label : undefined
  const markSpans = useMemo(() => scanMarks(curText), [curText])
  const confirmedMarks = marks.filter((m) => m.state === 'confirmed')
  const proposedMarks = marks.filter((m) => m.state === 'proposed')
  const rewriteDiffs = useMemo(
    () =>
      scene
        ? scene.lines
            .map((l) => ({ line: l, next: scene.rewrite[l.id] }))
            .filter((d): d is { line: SceneLine; next: string } => !!d.next && d.next !== (drafts[d.line.id]?.text ?? d.line.text))
        : [],
    [scene, drafts],
  )

  // 撤销 / 应用重写后，编辑框同步已提交的文本（正在输入时不动）
  useEffect(() => {
    if (line && document.activeElement !== textRef.current) setTextDraft(drafts[line.id]?.text ?? line.text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line, drafts])

  // ---- 操作 ----

  const commit = (updates: Record<string, DraftLine>, desc: string) => {
    const changes = Object.keys(updates).map((lid) => ({ lineId: lid, prev: drafts[lid] }))
    setHistory((h) => [{ id: `h${Date.now()}-${h.length}`, time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }), desc, changes }, ...h])
    setDrafts((prev) => {
      const next = { ...prev }
      for (const [lid, d] of Object.entries(updates)) next[lid] = d
      return next
    })
  }

  const revertEntry = (entryId: string) => {
    const e = history.find((x) => x.id === entryId)
    if (!e) return
    setDrafts((prev) => {
      const next = { ...prev }
      for (const c of e.changes) {
        if (c.prev === undefined) delete next[c.lineId]
        else next[c.lineId] = c.prev
      }
      return next
    })
    setHistory((h) => h.filter((x) => x.id !== entryId))
  }

  const selectLine = (l: SceneLine) => {
    setLineId(l.id)
    setTextDraft(drafts[l.id]?.text ?? l.text)
    setActiveMark(null)
    setMarkEdits({})
  }

  const selectScene = (sceneNextId: string) => {
    const s = scenes.find((x) => x.id === sceneNextId)
    if (!s) return
    setSceneId(s.id)
    selectLine(s.lines[0])
  }

  const selectChapter = (c: Chapter) => {
    setChapterId(c.id)
    const list = work ? editorScenes[work.id]?.[c.id] ?? fallbackScenes(c, castChars) : []
    setSceneId(list[0]?.id ?? '')
    if (list[0]) {
      const l = list[0].lines[0]
      setLineId(l.id)
      setTextDraft(drafts[l.id]?.text ?? l.text)
      setActiveMark(null)
      setMarkEdits({})
    }
  }

  // ---- 预览：在当前舞台上从选中句开始播 ----
  const [playing, setPlaying] = useState(false)
  const [paused, setPaused] = useState(false)
  const [typedLen, setTypedLen] = useState(0)
  const playTimer = useRef<number | null>(null)
  const clearTimer = () => {
    if (playTimer.current !== null) {
      window.clearTimeout(playTimer.current)
      playTimer.current = null
    }
  }

  const stopPlay = () => {
    clearTimer()
    setPlaying(false)
    setPaused(false)
    setTypedLen(0)
  }

  // 打字机 → 停顿 → 下一句；暂停时停在原地，改文本立即反映（curText 是派生值）
  useEffect(() => {
    if (!playing || paused || !line) return
    const plain = parseRich(curText)
      .map((s) => ('text' in s ? s.text : ''))
      .join('')
    if (typedLen < plain.length) {
      playTimer.current = window.setTimeout(() => setTypedLen((n) => n + 1), 26)
      return clearTimer
    }
    playTimer.current = window.setTimeout(() => {
      const i = scene.lines.findIndex((l) => l.id === line.id)
      if (i >= scene.lines.length - 1) {
        stopPlay()
        return
      }
      setTypedLen(0)
      selectLine(scene.lines[i + 1])
    }, 900 + plain.length * 12)
    return clearTimer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, paused, line?.id, typedLen, curText])

  const startPlay = () => {
    setTypedLen(0)
    setPaused(false)
    setPlaying(true)
  }

  // Esc 停止预览
  useEffect(() => {
    if (!playing) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stopPlay()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing])

  // 卸载时停掉计时器并清掉 Agent 上下文
  useEffect(
    () => () => {
      clearTimer()
      shell.setChatContext(null)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // ---- 把当前位置告诉 Agent 面板 ----
  useEffect(() => {
    if (!chapter || !scene || !line) return
    const idx = scene.lines.findIndex((l) => l.id === line.id) + 1
    shell.setChatContext(`第 ${chapter.index} 章 · ${scene.title} · 第 ${idx} 句`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter?.id, scene?.id, line?.id])

  // ---- 深链 ?chapter=1&line=3：选中对应章 / 含该句的场景 / 该句 ----
  const deepApplied = useRef(false)
  useEffect(() => {
    if (deepApplied.current || !work || !editable.length) return
    const chIdx = Number(searchParams.get('chapter'))
    const lineIdx = Number(searchParams.get('line'))
    if (!chIdx) return
    deepApplied.current = true
    const ch = editable.find((c) => c.index === chIdx)
    if (!ch) return
    const sceneList = editorScenes[work.id]?.[ch.id] ?? fallbackScenes(ch, castChars)
    // 按句子的全局序号（跨场景累加）找目标场景和句
    let remain = lineIdx || 1
    let targetScene = sceneList[0]
    let targetLine = sceneList[0]?.lines[0]
    for (const s of sceneList) {
      if (remain <= s.lines.length) {
        targetScene = s
        targetLine = s.lines[remain - 1]
        break
      }
      remain -= s.lines.length
    }
    if (!targetScene || !targetLine) return
    setChapterId(ch.id)
    setSceneId(targetScene.id)
    setLineId(targetLine.id)
    setTextDraft(drafts[targetLine.id]?.text ?? targetLine.text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work, editable, searchParams])

  const commitText = (next: string) => {
    if (!line || next === curText) return
    commit({ [line.id]: { ...drafts[line.id], text: next } }, `修改${lineKind.label}文本`)
  }

  const commitExpr = (v: string) => {
    if (!line || v === curExpr) return
    const from = speaker?.expressions.find((e) => e.id === curExpr)?.label ?? curExpr
    const to = speaker?.expressions.find((e) => e.id === v)?.label ?? v
    commit({ [line.id]: { ...drafts[line.id], expression: v } }, `${speaker?.name}表情：${from} → ${to}`)
  }

  const commitName = (v: string) => {
    if (!line) return
    const val = v.trim()
    if (val === curName) return
    commit({ [line.id]: { ...drafts[line.id], displayAs: val || undefined } }, val ? `显示名改为「${val}」` : '恢复角色本名')
  }

  // 文本标记：选区包裹 / 插入 / 改写已有片段
  const wrapSelection = (open: string, close: string, desc: string) => {
    const el = textRef.current
    const s = el?.selectionStart ?? textDraft.length
    const e = el?.selectionEnd ?? textDraft.length
    const sel = textDraft.slice(s, e)
    if (!sel) {
      toast('先在文本里选中要加标记的文字', 'select')
      return
    }
    const next = textDraft.slice(0, s) + open + sel + close + textDraft.slice(e)
    setTextDraft(next)
    commit({ [line!.id]: { ...drafts[line!.id], text: next } }, desc)
  }

  const insertAtCursor = (tag: string, desc: string) => {
    const el = textRef.current
    const at = el?.selectionEnd ?? textDraft.length
    const next = textDraft.slice(0, at) + tag + textDraft.slice(at)
    setTextDraft(next)
    commit({ [line!.id]: { ...drafts[line!.id], text: next } }, desc)
  }

  const rewriteSpan = (idx: number, mark: string, param: string | undefined, inner: string, desc: string) => {
    const span = markSpans[idx]
    if (!span || !line) return
    const tag = mark === 'wait' ? `{wait ${param ?? '0.4'}}` : `{${mark}${param ? ` ${param}` : ''}}${inner}{/${mark}}`
    const next = curText.slice(0, span.start) + tag + curText.slice(span.end)
    setTextDraft(next)
    commit({ [line.id]: { ...drafts[line.id], text: next } }, desc)
  }

  const removeSpan = (idx: number) => {
    const span = markSpans[idx]
    if (!span || !line) return
    const next = curText.slice(0, span.start) + span.inner + curText.slice(span.end)
    setTextDraft(next)
    commit({ [line.id]: { ...drafts[line.id], text: next } }, `移除「${markLabel(span.mark, marks)}」标记`)
    setActiveMark(null)
  }

  const applyDiffs = () => {
    const picked = rewriteDiffs.filter((d) => rewritePick[d.line.id])
    if (!picked.length) {
      setRewriteOpen(false)
      return
    }
    const updates: Record<string, DraftLine> = {}
    for (const d of picked) updates[d.line.id] = { ...drafts[d.line.id], text: d.next }
    commit(updates, `应用 Agent 重写（${picked.length} 句）`)
    if (picked.some((d) => d.line.id === line?.id)) setTextDraft(updates[line!.id].text ?? '')
    setRewriteOpen(false)
    setRewriteGen(false)
    toast(`已应用 ${picked.length} 句重写`, 'check')
  }

  const regenOnce = (target: 'bg' | 'portrait') => {
    if (!scene) return
    if (target === 'bg') {
      setBgOverride((o) => ({ ...o, [scene.id]: scene.background.variants[0] }))
      toast(`已重新生成并替换背景「${scene.background.name}」`, 'image')
    } else if (speaker) {
      setPortraitPick((p) => ({ ...p, [speaker.id]: 1 }))
      toast(`已重新生成「${speaker.name} · ${exprLabel}」立绘`, 'person')
    }
  }

  const saveRule = () => {
    if (!ruleText.trim()) {
      toast('先写一句规则', 'edit')
      return
    }
    setRules((r) => [...r, { scope: ruleScope === 'chapter' ? '本章' : '本作品', text: ruleText.trim() }])
    setRuleOpen(false)
    toast(`已存为${ruleScope === 'chapter' ? '本章' : '本作品'}规则`, 'bookmark_added')
  }

  // ---- 早退 ----

  if (!work)
    return (
      <Page title="编辑器">
        <EmptyState icon="error" title="没有找到这部作品" desc="从书库或作品详情页进入编辑器。" />
      </Page>
    )
  if (work.kind !== 'project')
    return (
      <Page title="编辑器" eyebrow={findSeries(work.seriesId).title} subtitle={work.title}>
        <EmptyState icon="lock" title="导入的作品包是只读的" desc="「导入为工程」后才能编辑。" />
      </Page>
    )

  if (!editable.length || !chapter || !scene || !line)
    return (
      <Page title="编辑器" eyebrow={findSeries(work.seriesId).title} subtitle={work.title}>
        <EmptyState icon="edit_off" title="还没有可编辑的章节" desc="第一章通过确认点后即可编辑。" />
      </Page>
    )

  const isSpeakerLine = line.kind === 'dialogue' || line.kind === 'inner'

  // 主区编排：宽 ≥ 两列（舞台剩余 + 右栏 452 + 间隔）；1440 无对话时主区约 1096
  const twoCol = mainW >= 1060
  // 右栏给原文对照还是句子列表；对照在更宽时（≥ 三列）做第三窄栏
  const threeCol = mainW >= 1400
  // 堆叠布局下舞台限高：首屏（900px 视高）里露出前 3 行句子
  const stageCap = 'max(440px, calc((100vh - 620px) * 16 / 9))'

  return (
    <Page
      title="编辑器"
      eyebrow={`${findSeries(work.seriesId).title} · ${work.title}`}
      subtitle={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <CompactSelect
            value={chapter.id}
            onChange={(v) => {
              const c = editable.find((x) => x.id === v)
              if (c) selectChapter(c)
            }}
            options={editable.map((c) => ({ value: c.id, label: `第 ${c.index} 章 ${c.title}` }))}
          />
          <Icon name="chevron_right" size={14} style={{ color: 'var(--color-outline)' }} />
          <CompactSelect value={scene.id} onChange={selectScene} options={scenes.map((s) => ({ value: s.id, label: s.title }))} />
          <Tooltip text="只列已发布的章节">
            <Icon name="info" size={15} style={{ color: 'var(--color-outline)', verticalAlign: '-3px' }} />
          </Tooltip>
        </span>
      }
      actions={
        <>
          <Tooltip text="打开 / 收起原文对照">
            <Button icon="menu_book" onClick={() => setSrcOpen((v) => !v)} title="原文对照" />
          </Tooltip>
          <Tooltip text={playing ? '停止预览' : '预览：从当前句开始在舞台上播放'}>
            <Button icon={playing ? 'stop' : 'play_arrow'} onClick={() => (playing ? stopPlay() : startPlay())} title="预览" />
          </Tooltip>
          <Tooltip text={history.length ? `撤销：${history[0].desc}` : '没有可撤销的修改'}>
            <Button icon="undo" disabled={!history.length} onClick={() => history[0] && revertEntry(history[0].id)} title="撤销" />
          </Tooltip>
          <Dropdown
            trigger={<Button icon="more_horiz" title="更多" />}
            items={[
              { label: `修改历史${history.length ? `（${history.length}）` : ''}`, icon: 'history', onClick: () => setHistOpen(true) },
              { label: '存为规则', icon: 'bookmark_add', onClick: () => { setRuleText(''); setRuleOpen(true) } },
            ]}
          />
          <Button variant="primary" icon="auto_fix_high" onClick={() => { setRewriteGen(false); setRewriteOpen(true) }}>
            让 Agent 重写本场景
          </Button>
        </>
      }
      width="full"
    >
      {/* Agent 提议的新标记：合成一条可关掉的横幅 */}
      {proposedMarks.length ? (
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <Banner
            kind="warning"
            icon="auto_awesome"
            action={
              <span style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    setMarks((ms) => ms.map((x) => (x.state === 'proposed' ? { ...x, state: 'confirmed' } : x)))
                    toast(`已确认 ${proposedMarks.length} 个新标记`, 'check')
                  }}
                >
                  确认
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setMarks((ms) => ms.filter((x) => x.state !== 'proposed'))
                    toast('这次不用这些标记', 'close')
                  }}
                >
                  不用
                </Button>
              </span>
            }
          >
            Agent 提议 {proposedMarks.length} 个新标记：{proposedMarks.map((m) => `「${m.name}」${m.desc}`).join('、')}
          </Banner>
        </div>
      ) : null}

      <div ref={mainRef} style={{ display: 'flex', flexDirection: twoCol ? 'row' : 'column', gap: 'var(--space-6)', alignItems: twoCol ? 'flex-start' : 'stretch' }}>
        {/* ---- 舞台列：宽屏时吸顶；窄屏限高让前几行句子露出 ---- */}
        <div style={twoCol ? { flex: 1, minWidth: 0, position: 'sticky', top: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' } : { width: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', alignItems: 'center' }}>
          {/* 舞台预览 */}
          <div style={{ ...panelStyle, background: 'var(--stage-frame, #0a0e13)', padding: 12, width: '100%', ...(twoCol ? {} : { maxWidth: stageCap }), boxSizing: 'border-box' }}>
            <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', inset: 0, background: bgOverride[scene.id] ?? scene.background.gradient }} />
              <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 50% 92%, rgba(143,180,212,0.16), transparent 62%)' }} />
              <div style={{ position: 'absolute', bottom: '22%', left: '5%', right: '5%', height: 1.5, background: 'rgba(143,180,212,0.2)' }} />

              {scene.cast.map((slot_) => {
                const ch = findCharacter(slot_.char)
                if (!ch) return null
                const speaking = isSpeakerLine && line.speaker === slot_.char
                const expr = speaking ? exprLabel : ch.expressions.find((e) => e.id === slot_.expression)?.label ?? slot_.expression
                const shown = speaking ? curName || ch.name : ch.name
                return (
                  <CastSilhouette
                    key={slot_.char}
                    name={shown}
                    expr={expr}
                    position={slot_.position}
                    speaking={speaking}
                    tint={portraitPick[ch.id] ?? 0}
                    onClick={() => {
                      const l = scene.lines.find((x) => x.speaker === slot_.char)
                      if (l) selectLine(l)
                      else toast(`${ch.name}在这一场没有台词`, 'person')
                    }}
                  />
                )
              })}

              {/* 场景名 / 句子位置 */}
              <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', gap: 6 }}>
                <span className="label-caps label-caps-zh" style={{ background: STAGE_DIM, color: 'var(--stage-accent)', padding: '4px 10px', borderRadius: 'var(--radius-md)' }}>
                  {scene.title}
                </span>
              </div>
              <div style={{ position: 'absolute', top: 10, right: 10 }}>
                <span className="label-caps" style={{ background: STAGE_DIM, color: 'var(--stage-accent)', padding: '4px 10px', borderRadius: 'var(--radius-md)', fontSize: 10 }}>
                  {scene.lines.findIndex((l) => l.id === line.id) + 1} / {scene.lines.length}
                </span>
              </div>

              {/* 字幕或文本框 */}
              {line.kind === 'caption' ? (
                <div style={{ position: 'absolute', top: '38%', left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
                  <span style={{ background: 'color-mix(in srgb, var(--stage-text) 10%, var(--stage-scrim, rgba(10, 14, 19, 0.72)))', border: '1px solid var(--stage-border)', color: 'var(--stage-text)', padding: '8px 22px', borderRadius: 'var(--radius-md)', fontSize: 16, letterSpacing: '0.2em', fontFamily: 'var(--font-display)' }}>
                    <RichText src={playing ? truncateRich(curText, typedLen) : curText} base="stage" customs={marks} />
                    {playing ? <span style={{ display: 'inline-block', width: 2, height: '1em', background: 'var(--stage-accent)', verticalAlign: '-2px', marginLeft: 1, animation: 'soft-pulse 1s infinite alternate' }} /> : null}
                  </span>
                </div>
              ) : (
                <div style={{ position: 'absolute', left: '3.5%', right: '3.5%', bottom: '4%' }}>
                  {isSpeakerLine ? (
                    <div
                      style={{
                        display: 'inline-block',
                        background: 'var(--stage-panel)',
                        border: '1px solid var(--stage-border)',
                        borderBottom: 'none',
                        borderRadius: '8px 8px 0 0',
                        padding: '4px 16px',
                        color: 'var(--stage-accent)',
                        fontWeight: 700,
                        fontSize: 13,
                        fontFamily: 'var(--font-display)',
                        letterSpacing: '0.1em',
                      }}
                    >
                      {curName || speaker?.name}
                      {line.kind === 'inner' ? <span style={{ fontWeight: 400, opacity: 0.75 }}> · 内心</span> : null}
                    </div>
                  ) : null}
                  <div
                    style={{
                      background: 'var(--stage-panel)',
                      border: `1px ${line.kind === 'inner' ? 'dashed' : 'solid'} var(--stage-border)`,
                      borderRadius: isSpeakerLine ? '0 8px 8px 8px' : 'var(--radius-md)',
                      padding: '12px 18px 14px',
                      color: 'var(--stage-text)',
                      fontSize: 14,
                      lineHeight: 1.8,
                      minHeight: 56,
                      backdropFilter: 'blur(6px)',
                      fontStyle: line.kind === 'narration' ? 'italic' : 'normal',
                    }}
                  >
                    <RichText src={playing ? truncateRich(curText, typedLen) : curText} base="stage" customs={marks} />
                    {playing ? <span style={{ display: 'inline-block', width: 2, height: '1em', background: 'var(--stage-accent)', verticalAlign: '-2px', marginLeft: 1, animation: 'soft-pulse 1s infinite alternate' }} /> : null}
                  </div>
                </div>
              )}

              {/* 播放中的浮动控制 */}
              {playing ? (
                <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 8, zIndex: 5 }}>
                  <button onClick={() => setPaused((v) => !v)} title={paused ? '继续' : '暂停'} style={{ ...dimBtn, display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 'var(--radius-full)' }}>
                    <Icon name={paused ? 'play_arrow' : 'pause'} size={15} />
                    <span className="label-caps label-caps-zh" style={{ fontSize: 10 }}>{paused ? '继续' : '暂停'}</span>
                  </button>
                  <button onClick={stopPlay} title="停止（Esc）" style={{ ...dimBtn, display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 'var(--radius-full)' }}>
                    <Icon name="stop" size={15} />
                    <span className="label-caps label-caps-zh" style={{ fontSize: 10 }}>停止</span>
                  </button>
                </div>
              ) : null}

              {/* 上 / 下一句 */}
              <div style={{ position: 'absolute', top: '44%', left: 8 }}>
                <button
                  onClick={() => {
                    const i = scene.lines.findIndex((l) => l.id === line.id)
                    if (i > 0) selectLine(scene.lines[i - 1])
                  }}
                  disabled={scene.lines.findIndex((l) => l.id === line.id) <= 0}
                  style={{ ...dimBtn, opacity: scene.lines.findIndex((l) => l.id === line.id) <= 0 ? 0.3 : 1 }}
                >
                  <Icon name="chevron_left" size={18} />
                </button>
              </div>
              <div style={{ position: 'absolute', top: '44%', right: 8 }}>
                <button
                  onClick={() => {
                    const i = scene.lines.findIndex((l) => l.id === line.id)
                    if (i < scene.lines.length - 1) selectLine(scene.lines[i + 1])
                  }}
                  disabled={scene.lines.findIndex((l) => l.id === line.id) >= scene.lines.length - 1}
                  style={{ ...dimBtn, opacity: scene.lines.findIndex((l) => l.id === line.id) >= scene.lines.length - 1 ? 0.3 : 1 }}
                >
                  <Icon name="chevron_right" size={18} />
                </button>
              </div>
            </div>
            {/* 这一场的画面：背景 / 当前说话人立绘 */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', padding: 'var(--space-3) var(--space-2) var(--space-1)' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 12, color: 'color-mix(in srgb, var(--stage-text) 72%, transparent)', flex: '1 1 220px', minWidth: 0 }}>
                <Icon name="wallpaper" size={15} style={{ flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>背景 · {scene.background.name}</span>
                <Dropdown
                  trigger={<Button size="sm" variant="ghost" icon="refresh" style={{ color: 'var(--stage-text)' }}>重新生成</Button>}
                  items={[
                    { label: '出一张，直接替换', icon: 'image', onClick: () => regenOnce('bg') },
                    { label: '多出几张再挑', icon: 'photo_library', onClick: () => setRegenPick('bg') },
                  ]}
                />
              </span>
              {isSpeakerLine && speaker ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 12, color: 'color-mix(in srgb, var(--stage-text) 72%, transparent)', flex: '1 1 220px', minWidth: 0 }}>
                  <Icon name="person" size={15} style={{ flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>立绘 · {speaker.name} / {outfitLabel} / {exprLabel}</span>
                  <Dropdown
                    trigger={<Button size="sm" variant="ghost" icon="refresh" style={{ color: 'var(--stage-text)' }}>重新生成</Button>}
                    items={[
                      { label: '出一张，直接替换', icon: 'image', onClick: () => regenOnce('portrait') },
                      { label: '多出几张再挑', icon: 'photo_library', onClick: () => setRegenPick('portrait') },
                    ]}
                  />
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {/* ---- 右栏：句子列表（选中句就地展开编辑）；窄屏占满，宽屏固定宽、独立滚动 ---- */}
        <div style={twoCol ? { width: 452, flexShrink: 0, maxHeight: 'calc(100vh - 80px)', overflowY: 'auto', position: 'sticky', top: 'var(--space-5)' } : { width: '100%' }}>
          {twoCol && srcOpen && !threeCol ? (
            <div style={{ ...panelStyle, padding: 'var(--space-4)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
                <SectionLabel>原文对照</SectionLabel>
                <button onClick={() => setSrcOpen(false)} title="收起" style={{ display: 'flex', padding: 4, borderRadius: 'var(--radius-full)', color: 'var(--color-on-surface-variant)' }}>
                  <Icon name="close" size={16} />
                </button>
              </div>
              <SourcePanel
                scene={scene}
                line={line}
                onJump={(lid) => {
                  const target = scene.lines.find((l) => l.id === lid)
                  if (target) selectLine(target)
                }}
                onAsk={(pid) => { setSrcEdit(pid); setSrcInstr('') }}
              />
            </div>
          ) : null}
          {twoCol && srcOpen && !threeCol ? null : (
          <div style={{ ...panelStyle, padding: 'var(--space-3) var(--space-3) var(--space-2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-2)', padding: '0 2px' }}>
              <SectionLabel>这一场的句子</SectionLabel>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {scene.lines.map((l) => {
                const active = l.id === line.id
                const edited = drafts[l.id] !== undefined
                const sp = l.speaker ? findCharacter(l.speaker) : undefined
                const t = drafts[l.id]?.text ?? l.text
                return (
                  <div
                    key={l.id}
                    ref={active ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                    className="hover-row"
                    style={{
                      borderRadius: 'var(--radius-md)',
                      background: active ? 'var(--accent-wash)' : 'transparent',
                      border: active ? '1px solid var(--accent-border-30)' : '1px solid transparent',
                      boxShadow: playing && active ? '0 0 0 2px var(--accent-border-30)' : 'none',
                    }}
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => selectLine(l)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          selectLine(l)
                        }
                      }}
                      style={{
                        display: 'flex',
                        gap: 'var(--space-3)',
                        width: '100%',
                        textAlign: 'left',
                        padding: '10px 12px',
                        minHeight: 52,
                        alignItems: 'flex-start',
                        cursor: 'pointer',
                      }}
                    >
                      <span className="label-caps label-caps-zh" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 3, flexShrink: 0, color: active ? 'var(--color-primary)' : 'var(--color-on-surface-variant)', fontSize: 10, minWidth: 62 }}>
                        <Icon name={lineKindMeta[l.kind].icon} size={13} />
                        {lineKindMeta[l.kind].label}
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        {sp ? (
                          <span style={{ display: 'block', fontSize: 11, color: 'var(--color-outline)', marginBottom: 2 }}>
                            {(drafts[l.id]?.displayAs ?? l.displayAs) || sp.name}
                            {(drafts[l.id]?.displayAs ?? l.displayAs) ? `（${sp.name}）` : ''}
                          </span>
                        ) : null}
                        <span style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--color-on-surface)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: active ? undefined : 2, WebkitBoxOrient: 'vertical' }}>
                          <RichText src={t} base="list" customs={marks} />
                        </span>
                      </span>
                      {edited ? (
                        <Tooltip text="这句改过了">
                          <Icon name="fiber_manual_record" size={8} style={{ color: 'var(--color-primary)', marginTop: 6, flexShrink: 0 }} />
                        </Tooltip>
                      ) : null}
                      <span className="row-actions" style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, marginTop: 2 }}>
                        <Tooltip text="问 Agent（带着这句的上下文）">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              selectLine(l)
                              shell.setChatContext(`第 ${chapter.index} 章 · ${scene.title} · 第 ${scene.lines.findIndex((x) => x.id === l.id) + 1} 句`)
                              shell.openChat()
                            }}
                            style={{ display: 'inline-flex', padding: 5, borderRadius: 'var(--radius-full)', color: 'var(--color-on-surface-variant)' }}
                          >
                            <Icon name="auto_awesome" size={14} />
                          </button>
                        </Tooltip>
                      </span>
                    </div>
                    {/* 选中句就地展开编辑 */}
                    {active ? (
                      <div style={{ padding: '0 var(--space-3) var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <Chip active>{lineKind.label}</Chip>
              {speaker ? <Chip>{curName || speaker.name}</Chip> : null}
              {line.sourcePara ? <Chip>有原文对照</Chip> : null}
            </div>

            {isSpeakerLine && speaker ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="表情">
                  <CompactSelect value={curExpr} onChange={commitExpr} options={speaker.expressions.map((e) => ({ value: e.id, label: e.label }))} />
                </Field>
                <Field label="显示名">
                  <input
                    key={`${line.id}-${curName}`}
                    defaultValue={curName}
                    placeholder={speaker.name}
                    onBlur={(e) => commitName(e.target.value)}
                    style={{
                      background: 'var(--white-60)',
                      border: '1px solid var(--white-80)',
                      borderRadius: 'var(--radius-md)',
                      padding: '7px 10px',
                      fontSize: 13,
                      color: 'var(--color-on-surface)',
                      outline: 'none',
                      width: '100%',
                    }}
                  />
                </Field>
              </div>
            ) : null}

            <Field label="文本">
              <textarea
                ref={textRef}
                rows={3}
                value={textDraft}
                onChange={(e) => setTextDraft(e.target.value)}
                onBlur={() => commitText(textDraft)}
                style={textareaStyle}
              />
            </Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'calc(-1 * var(--space-2))' }}>
              <Button size="sm" variant="secondary" onClick={() => commitText(textDraft)} disabled={textDraft === curText}>
                应用文本
              </Button>
            </div>

            {/* 标记工具条：带参数的收进「更多标记」 */}
            <div>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <SectionLabel>加标记</SectionLabel>
                <Tooltip text="先选中文字再点标记；也可以直接输入 {标记}…{/标记}">
                  <Icon name="info" size={14} style={{ color: 'var(--color-outline)', verticalAlign: '-2px' }} />
                </Tooltip>
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center' }}>
                {builtinMarks.map((m) => (
                  <Chip key={m.id} onClick={() => wrapSelection(`{${m.id}}`, `{/${m.id}}`, `加「${m.label}」标记`)}>
                    {m.label}
                  </Chip>
                ))}
                {confirmedMarks.map((m) => (
                  <Tooltip key={m.id} text={m.desc}>
                    <Chip onClick={() => wrapSelection(`{${m.id}}`, `{/${m.id}}`, `加「${m.name}」标记`)}>
                      {m.name}
                    </Chip>
                  </Tooltip>
                ))}
                <Dropdown
                  trigger={<Button size="sm" icon="more_horiz">更多标记</Button>}
                  items={[
                    { label: '注音', icon: 'record_voice_over', onClick: () => wrapSelection('{ruby 读音}', '{/ruby}', '加注音') },
                    { label: '变速 ×0.6', icon: 'speed', onClick: () => wrapSelection('{speed 0.6}', '{/speed}', '加变速') },
                    { label: '停顿 0.4 秒', icon: 'more_vert', onClick: () => insertAtCursor('{wait 0.4}', '插入停顿') },
                  ]}
                />
              </div>
            </div>

            {/* 已有标记 */}
            {markSpans.length ? (
              <div>
                <SectionLabel>这句里的标记</SectionLabel>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {markSpans.map((sp, i) => {
                    const active = activeMark === i
                    return (
                      <div
                        key={`${sp.start}-${sp.mark}`}
                        style={{
                          padding: '7px 10px',
                          borderRadius: 'var(--radius-md)',
                          background: active ? 'var(--accent-wash)' : 'var(--white-50)',
                          border: active ? '1px solid var(--accent-border-30)' : '1px solid var(--white-60)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                        }}
                      >
                        <button onClick={() => setActiveMark(active ? null : i)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 0, textAlign: 'left' }}>
                          <Chip active={active}>{markLabel(sp.mark, marks)}</Chip>
                          <span style={{ flex: 1, fontSize: 12, color: 'var(--color-on-surface-variant)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {sp.mark === 'wait' ? `停 ${sp.param ?? '0.4'} 秒` : sp.mark === 'ruby' ? `${sp.inner} · ${sp.param}` : sp.mark === 'speed' ? `${sp.inner} · ×${sp.param}` : sp.inner}
                          </span>
                          <Icon name={active ? 'expand_less' : 'expand_more'} size={15} style={{ color: 'var(--color-outline)' }} />
                        </button>
                        {active ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            {sp.mark === 'wait' || sp.mark === 'ruby' || sp.mark === 'speed' ? (
                              <Chip>{markLabel(sp.mark, marks)}</Chip>
                            ) : (
                              <CompactSelect
                                value={sp.mark}
                                onChange={(v) => rewriteSpan(i, v, sp.param, sp.inner, `标记改为「${markLabel(v, marks)}」`)}
                                options={[...builtinMarks.map((m) => ({ value: m.id, label: m.label })), ...confirmedMarks.map((m) => ({ value: m.id, label: m.name }))]}
                              />
                            )}
                            {sp.mark !== 'wait' ? (
                              <TextInput value={markEdits[i] ?? sp.inner} onChange={(v) => setMarkEdits((e) => ({ ...e, [i]: v }))} placeholder="标记包住的文字" />
                            ) : null}
                            {sp.mark === 'wait' || sp.mark === 'ruby' || sp.mark === 'speed' ? (
                              <input
                                key={`${sp.start}-p`}
                                defaultValue={sp.param ?? ''}
                                placeholder={sp.mark === 'ruby' ? '读音' : sp.mark === 'speed' ? '倍率' : '秒数'}
                                onBlur={(e) => rewriteSpan(i, sp.mark, e.target.value.trim() || sp.param, markEdits[i] ?? sp.inner, '改标记参数')}
                                style={{
                                  width: 72,
                                  background: 'var(--white-60)',
                                  border: '1px solid var(--white-80)',
                                  borderRadius: 'var(--radius-md)',
                                  padding: '7px 10px',
                                  fontSize: 13,
                                  color: 'var(--color-on-surface)',
                                  outline: 'none',
                                }}
                              />
                            ) : null}
                            <Button
                              size="sm"
                              icon="check"
                              onClick={() => rewriteSpan(i, sp.mark, sp.param, markEdits[i] ?? sp.inner, '改标记文字')}
                              disabled={sp.mark === 'wait' || (markEdits[i] ?? sp.inner) === sp.inner}
                            >
                              应用
                            </Button>
                            <Button size="sm" variant="ghost" icon="delete" onClick={() => removeSpan(i)}>
                              移除
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : null}


                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
          )}
          {srcOpen && !twoCol ? (
            <div style={{ ...panelStyle, padding: 'var(--space-4)', marginTop: 'var(--space-6)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
                <SectionLabel>原文对照</SectionLabel>
                <button onClick={() => setSrcOpen(false)} title="收起" style={{ display: 'flex', padding: 4, borderRadius: 'var(--radius-full)', color: 'var(--color-on-surface-variant)' }}>
                  <Icon name="close" size={16} />
                </button>
              </div>
              <p style={{ fontSize: 11, color: 'var(--color-outline)', marginTop: '-4px', marginBottom: 'var(--space-3)' }}>原文 {scene.sourceRange}</p>
              <SourcePanel
                scene={scene}
                line={line}
                onJump={(lid) => {
                  const target = scene.lines.find((l) => l.id === lid)
                  if (target) selectLine(target)
                }}
                onAsk={(pid) => { setSrcEdit(pid); setSrcInstr('') }}
              />
            </div>
          ) : null}
        </div>

        {srcOpen && twoCol && threeCol ? (
          <aside style={{ width: 320, flexShrink: 0, position: 'sticky', top: 'var(--space-5)', ...panelStyle, padding: 'var(--space-4)', maxHeight: 'calc(100vh - 80px)', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
              <SectionLabel>原文对照</SectionLabel>
              <button onClick={() => setSrcOpen(false)} title="收起" style={{ display: 'flex', padding: 4, borderRadius: 'var(--radius-full)', color: 'var(--color-on-surface-variant)' }}>
                <Icon name="close" size={16} />
              </button>
            </div>
            <p style={{ fontSize: 11, color: 'var(--color-outline)', marginTop: '-4px', marginBottom: 'var(--space-3)' }}>原文 {scene.sourceRange}</p>
            <SourcePanel
              scene={scene}
              line={line}
              onJump={(lid) => {
                const target = scene.lines.find((l) => l.id === lid)
                if (target) selectLine(target)
              }}
              onAsk={(pid) => { setSrcEdit(pid); setSrcInstr('') }}
            />
          </aside>
        ) : null}
      </div>

      {/* ---- 修改历史抽屉 ---- */}
      <Drawer open={histOpen} title="修改历史" onClose={() => setHistOpen(false)} width={380}>
        {history.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {history.map((h) => (
              <div key={h.id} className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 'var(--radius-lg)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{h.desc}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-outline)', marginTop: 2 }}>
                    {h.time} · 改了 {h.changes.length} 句
                  </div>
                </div>
                <Button size="sm" variant="ghost" icon="undo" onClick={() => revertEntry(h.id)}>
                  撤销
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon="history" title="还没有修改" desc="每步修改都可撤销。" />
        )}
      </Drawer>

      {/* ---- Agent 重写本场景 ---- */}
      <Modal
        open={rewriteOpen}
        title="让 Agent 重写本场景"
        onClose={() => setRewriteOpen(false)}
        width={640}
        footer={
          rewriteGen ? (
            <>
              <Button variant="ghost" onClick={() => setRewriteOpen(false)}>取消</Button>
              <Button variant="primary" icon="check" onClick={applyDiffs} disabled={!rewriteDiffs.some((d) => rewritePick[d.line.id])}>
                应用所选（{rewriteDiffs.filter((d) => rewritePick[d.line.id]).length}）
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setRewriteOpen(false)}>取消</Button>
              <Button
                variant="primary"
                icon="auto_fix_high"
                onClick={() => {
                  setRewriteGen(true)
                  setRewritePick(Object.fromEntries(rewriteDiffs.map((d) => [d.line.id, true])))
                }}
              >
                生成重写预览
              </Button>
            </>
          )
        }
      >
        {!rewriteGen ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <TextInput value={rewriteInstr} onChange={setRewriteInstr} placeholder="例如：旁白再短一点，凛的语气更硬一些" />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={{ fontSize: 12, color: 'var(--color-outline)' }}>{rewriteInstr.trim() ? `要求：${rewriteInstr.trim()}` : '按默认方向重写'}</p>
            {rewriteDiffs.map((d) => (
              <div key={d.line.id} className="glass-panel" style={{ display: 'flex', gap: 10, padding: '10px 12px', borderRadius: 'var(--radius-lg)', alignItems: 'flex-start' }}>
                <Checkbox checked={!!rewritePick[d.line.id]} onChange={() => setRewritePick((p) => ({ ...p, [d.line.id]: !p[d.line.id] }))} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="label-caps label-caps-zh" style={{ fontSize: 10, color: 'var(--color-outline)', marginBottom: 4 }}>
                    {lineKindMeta[d.line.kind].label}
                    {d.line.speaker ? ` · ${findCharacter(d.line.speaker)?.name ?? ''}` : ''}
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--color-outline)', textDecoration: 'line-through', textDecorationColor: 'var(--color-outline-variant)', lineHeight: 1.6 }}>
                    <RichText src={drafts[d.line.id]?.text ?? d.line.text} base="list" customs={marks} />
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--color-on-surface)', lineHeight: 1.6, marginTop: 3 }}>
                    <RichText src={d.next} base="list" customs={marks} />
                  </div>
                </div>
              </div>
            ))}
            {!rewriteDiffs.length ? <p style={{ fontSize: 13, color: 'var(--color-outline)' }}>这一场没有要改的句子。</p> : null}
          </div>
        )}
      </Modal>

      {/* ---- 多出几张再挑 ---- */}
      <Modal open={regenPick !== null} title={regenPick === 'portrait' ? `立绘 · ${speaker?.name ?? ''} / ${outfitLabel ?? ''} / ${exprLabel}` : `背景 · ${scene.background.name}`} onClose={() => setRegenPick(null)} width={560}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {(regenPick === 'portrait'
            ? ['var(--stage-accent)', 'var(--color-success)', 'var(--color-on-secondary-container)'].map((c, i) => ({ g: `linear-gradient(180deg, color-mix(in srgb, ${c} 50%, transparent), color-mix(in srgb, ${c} 12%, transparent))`, i }))
            : scene.background.variants.map((g, i) => ({ g, i }))
          ).map((v) => (
            <button
              key={v.i}
              onClick={() => {
                if (regenPick === 'bg') setBgOverride((o) => ({ ...o, [scene.id]: v.g }))
                else if (speaker) setPortraitPick((p) => ({ ...p, [speaker.id]: v.i }))
                setRegenPick(null)
                toast('已换上选中的版本', 'image')
              }}
              style={{ padding: 0, borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--white-80)', aspectRatio: '16/10', position: 'relative', background: regenPick === 'portrait' ? scene.background.gradient : v.g }}
            >
              {regenPick === 'portrait' ? (
                <span style={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '40%', height: '78%', background: v.g, borderRadius: '48% 48% 0 0 / 26% 26% 0 0' }} />
              ) : null}
              <span className="label-caps" style={{ position: 'absolute', top: 6, left: 6, background: STAGE_DIM, color: 'var(--stage-accent)', padding: '2px 8px', borderRadius: 'var(--radius-sm)', fontSize: 10 }}>
                候选 {v.i + 1}
              </span>
            </button>
          ))}
        </div>
      </Modal>

      {/* ---- 存为规则 ---- */}
      <Modal
        open={ruleOpen}
        title="存为规则"
        onClose={() => setRuleOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRuleOpen(false)}>取消</Button>
            <Button variant="primary" icon="bookmark_added" onClick={saveRule}>保存规则</Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="作用域">
            <RadioGroup
              value={ruleScope}
              onChange={(v) => setRuleScope(v as 'chapter' | 'work')}
              options={[
                { value: 'chapter', label: `本章（第 ${chapter.index} 章）` },
                { value: 'work', label: '本作品' },
              ]}
            />
          </Field>
          <Field label="规则内容">
            <textarea rows={3} value={ruleText} onChange={(e) => setRuleText(e.target.value)} style={textareaStyle} placeholder="例：这一幕之后，凛不再主动提起灯塔" />
          </Field>
          <Banner kind="info">新规则只影响还没开始的任务；已经做完或在做的章节不受影响。</Banner>
          {rules.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <SectionLabel>已存规则</SectionLabel>
              {rules.map((r, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--color-on-surface-variant)' }}>
                  <Chip>{r.scope}</Chip>
                  <span>{r.text}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </Modal>

      {/* ---- 按这段原文修改 ---- */}
      <Modal
        open={srcEdit !== null}
        title="让 Agent 按这段原文修改"
        onClose={() => setSrcEdit(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSrcEdit(null)}>取消</Button>
            <Button
              variant="primary"
              icon="auto_fix_high"
              onClick={() => {
                setSrcEdit(null)
                toast('已按这段原文生成修改，并进重写预览确认', 'auto_fix_high')
                setRewriteGen(true)
                setRewritePick(Object.fromEntries(rewriteDiffs.map((d) => [d.line.id, true])))
                setRewriteOpen(true)
              }}
            >
              生成修改
            </Button>
          </>
        }
      >
        {srcEdit ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ padding: '10px 12px', borderRadius: 'var(--radius-md)', background: 'var(--color-secondary-container)', fontSize: 13, lineHeight: 1.7 }}>
              {scene.sourceParagraphs.find((p) => p.id === srcEdit)?.text}
            </div>
            <TextInput value={srcInstr} onChange={setSrcInstr} placeholder="补充要求（可选）：比如更贴近原文、只改对白" />
          </div>
        ) : null}
      </Modal>
    </Page>
  )
}
