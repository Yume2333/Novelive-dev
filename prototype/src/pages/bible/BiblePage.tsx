import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button, Icon } from '../../components/Button'
import { Card } from '../../components/Card'
import { Chip, Drawer, Slider, Tooltip } from '../../components/Extended'
import { EmptyState, SectionLabel, TextInput } from '../../components/Form'
import { Page } from '../../components/Page'
import { useToast } from '../../components/Toast'
import { getBible, defaultAvatar, type BibleCharacter, type BibleData, type BibleLocation, type Change, type Layer } from '../../mock/bible'
import { findSeries, findVolume, findWork } from '../../mock/library'
import { useShell } from '../../shell/AppShell'
import './bible.css'

// ---- 通用小组件 ----

/** 来源层级标记：系列 / 卷 / 作品（整条覆盖上级同 ID 条目） */
function LayerChip({ layer }: { layer: Layer }) {
  return (
    <Tooltip text="下级同 ID 条目整条覆盖">
      <Chip>{layer}</Chip>
    </Tooltip>
  )
}

function StatusChip({ status }: { status: '已确认' | '候选' }) {
  return <Chip active={status === '已确认'}>{status}</Chip>
}

/** 点击后变成输入框的行内字段（原型：本地编辑即可） */
function Editable({ text, multiline }: { text: string; multiline?: boolean }) {
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(text)
  if (editing) {
    return multiline ? (
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { setEditing(false); toast('已保存修改（演示）', 'check') }}
        style={{
          width: '100%', minHeight: 72, font: 'inherit', fontSize: 13, lineHeight: 1.6,
          padding: '8px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-primary)',
          background: 'var(--white-70)', color: 'var(--color-on-surface)', outline: 'none', resize: 'vertical',
        }}
      />
    ) : (
      <TextInput value={draft} onChange={setDraft} />
    )
  }
  return (
    <span
      onClick={() => { setDraft(text); setEditing(true) }}
      title="点击修改"
      style={{ cursor: 'text', borderBottom: '1px dashed var(--color-outline-variant)', paddingBottom: 1 }}
    >
      {text}
    </span>
  )
}

/** 设定变化列表；从第 3 条起折叠，点「展开」看全部 */
function ChangeList({ changes, n }: { changes: Change[]; n: number }) {
  const [open, setOpen] = useState(false)
  if (!changes.length) return null
  const shown = open ? changes : changes.slice(0, 2)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {shown.map((c, i) => (
        <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 12.5 }}>
          <Chip active={c.from <= n}>第 {c.from} 章起</Chip>
          <span style={{ color: 'var(--color-on-surface-variant)' }}>
            {c.field}：{c.from <= n ? <>{c.fromText} → <b style={{ color: 'var(--color-on-surface)' }}>{c.to}</b></> : c.to}
          </span>
        </div>
      ))}
      {changes.length > 2 ? (
        <button
          onClick={() => setOpen(!open)}
          style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--color-outline)' }}
        >
          <Icon name={open ? 'expand_less' : 'expand_more'} size={15} />
          {open ? '收起' : `还有 ${changes.length - 2} 条变化`}
        </button>
      ) : null}
    </div>
  )
}

// ---- 角色 ----

function CharacterAvatar({ c, size = 44 }: { c: BibleCharacter; size?: number }) {
  const [a, b] = c.avatar ?? defaultAvatar
  return (
    <div
      style={{
        width: size, height: size, borderRadius: 'var(--radius-lg)', flexShrink: 0,
        background: `linear-gradient(160deg, ${a}, ${b})`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--color-on-primary)', boxShadow: 'var(--shadow-glass)',
      }}
    >
      <Icon name={c.reusable ? 'person' : 'person_off'} size={size * 0.55} />
    </div>
  )
}

/** 造型 + 表情网格；截至第 n 章之后才开的造型只提示不展开 */
function OutfitExpressions({ c, n }: { c: BibleCharacter; n: number }) {
  const toast = useToast()
  const current = c.outfits.filter((o) => o.fromChapter <= n)
  const future = c.outfits.filter((o) => o.fromChapter > n)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      {current.map((o) => (
        <div key={o.id}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>{o.name}</span>
            <Chip>第 {o.fromChapter} 章起</Chip>
            {o.dueToChange ? (
              <Tooltip text="外貌变化开的新造型；旧造型的图在之前的章节照用，不算过期">
                <Chip>外貌变化</Chip>
              </Tooltip>
            ) : null}
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-on-surface-variant)', marginBottom: 10, lineHeight: 1.6 }}>{o.desc}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {o.expressions.map((e) => (
              <Tooltip key={e.id} text={e.drawn ? `${o.name} · ${e.name}` : `${e.name} · 还没画`}>
                <div
                  style={{
                    width: 52, height: 64, borderRadius: 'var(--radius-md)', overflow: 'hidden',
                    border: e.drawn ? '1px solid var(--white-80)' : '1px dashed var(--color-outline-variant)',
                    background: e.drawn ? 'var(--color-surface-container-high)' : 'transparent',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
                  }}
                >
                  <Icon name={e.drawn ? 'face' : 'draw'} size={19} style={{ color: 'var(--color-outline)' }} />
                  <span style={{ fontSize: 10, color: e.drawn ? 'var(--color-on-surface-variant)' : 'var(--color-outline)' }}>
                    {e.drawn ? e.name : '还没画'}
                  </span>
                </div>
              </Tooltip>
            ))}
            <Tooltip text="用到新表情时自动登记">
              <button
                onClick={() => toast('模型用到新表情时会自动登记（演示）', 'add')}
                style={{
                  width: 52, height: 64, borderRadius: 'var(--radius-md)',
                  border: '1px dashed var(--color-outline-variant)', background: 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-outline)', cursor: 'pointer',
                }}
              >
                <Icon name="add" size={18} />
              </button>
            </Tooltip>
          </div>
        </div>
      ))}
      {future.map((o) => (
        <div key={o.id} style={{ fontSize: 12, color: 'var(--color-outline)' }}>
          <Icon name="lock" size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
          第 {o.fromChapter} 章起有新造型「{o.name}」（截至第 {n} 章不展示）
        </div>
      ))}
    </div>
  )
}

/** 选中角色的详情：分组字段 + 造型表情 + 变化 */
function CharacterDetail({ c, n }: { c: BibleCharacter; n: number }) {
  const beforeFirst = c.firstChapter > n
  const applied = c.changes.filter((ch) => ch.from <= n)
  const appearance = applied.filter((ch) => ch.field === '外貌').map((ch) => ch.to).pop() ?? c.appearance
  const fields: [string, string][] = [
    ['原文名字', c.sourceName],
    ['别名', c.aliases],
    ['身份', c.identity],
    ['性格', c.personality],
    ['说话方式', c.speech],
    ['外貌', appearance],
    ['参考图', c.reference],
  ]
  return (
    <Card style={{ padding: 'var(--space-5)', opacity: beforeFirst ? 0.6 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 'var(--space-5)' }}>
        <CharacterAvatar c={c} size={52} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="headline" style={{ fontSize: 19 }}>{c.name}</span>
            <StatusChip status={c.status} />
            <LayerChip layer={c.layer} />
            <Chip>{c.reusable ? '可复用' : '一次性'}</Chip>
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-outline)', marginTop: 5 }}>
            首次出场：第 {c.firstChapter} 章 · 提取自第 {c.extractedFrom} 章
            {beforeFirst ? ` · 截至第 ${n} 章还未出场` : ''}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-4) var(--space-5)', marginBottom: 'var(--space-6)' }}>
        {fields.map(([label, value]) => (
          <div key={label} style={value.length > 60 ? { gridColumn: '1 / -1' } : undefined}>
            <div className="label-caps label-caps-zh" style={{ color: 'var(--color-outline)', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 13, lineHeight: 1.7 }}><Editable text={value} multiline={value.length > 40} /></div>
          </div>
        ))}
        <div>
          <div className="label-caps label-caps-zh" style={{ color: 'var(--color-outline)', marginBottom: 4 }}>称呼</div>
          <div style={{ fontSize: 13, lineHeight: 1.8 }}>
            {c.addressBy.map((a, i) => (
              <div key={i}>{a.who} 叫他/她「<Editable text={a.call} />」</div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 'var(--space-6)' }}>
        <SectionLabel>造型与表情</SectionLabel>
        <OutfitExpressions c={c} n={n} />
      </div>

      {c.changes.length ? (
        <div>
          <SectionLabel>变化</SectionLabel>
          <ChangeList changes={c.changes} n={n} />
        </div>
      ) : null}
    </Card>
  )
}

/** 角色部分：左列表 + 右侧选中详情 */
function CharactersPart({ data, n }: { data: BibleData; n: number }) {
  const [sel, setSel] = useState<string | null>(null)
  const shell = useShell()
  const current = data.characters.find((c) => c.id === sel) ?? data.characters[0]
  // 告诉 Agent 面板正在看谁；离开分区/页面时清掉
  useEffect(() => {
    if (current) shell.setChatContext(`设定集 · 角色 · ${current.name}`)
    return () => shell.setChatContext(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id])
  if (!data.characters.length) {
    return (
      <Card><EmptyState icon="group" title="还没有角色" desc="综合提取的角色会列在这里。" /></Card>
    )
  }
  return (
    <div className="bible-chars" style={{ display: 'grid', gap: 'var(--space-5)', alignItems: 'start' }}>
      <div className="bible-chars-side" style={{ position: 'sticky', top: 'var(--space-5)' }}>
      <Card style={{ padding: 'var(--space-2)' }}>
        {data.characters.map((c) => {
          const active = c.id === current.id
          return (
            <button
              key={c.id}
              onClick={() => setSel(c.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                minHeight: 52, padding: '6px 10px', borderRadius: 'var(--radius-lg)',
                background: active ? 'var(--accent-wash)' : 'transparent',
                transition: 'background 0.15s ease',
              }}
            >
              <CharacterAvatar c={c} size={32} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 600, fontSize: 13, color: active ? 'var(--color-primary)' : 'var(--color-on-surface)' }}>{c.name}</span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--color-outline)', marginTop: 1 }}>第 {c.firstChapter} 章出场</span>
              </span>
              {c.status === '候选' ? <Chip>候选</Chip> : null}
            </button>
          )
        })}
      </Card>
      </div>
      <CharacterDetail c={current} n={n} />
    </div>
  )
}

// ---- 角色关系 / 地点 ----

function RelationCard({ r, n }: { r: BibleData['relations'][number]; n: number }) {
  const applied = r.changes.filter((c) => c.from <= n)
  const desc = applied.length ? applied[applied.length - 1].to : r.desc
  return (
    <Card style={{ padding: 'var(--space-4) var(--space-5)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ fontWeight: 700 }}>{r.a}</span>
        <Icon name="partner_exchange" size={16} style={{ color: 'var(--color-outline)' }} />
        <span style={{ fontWeight: 700 }}>{r.b}</span>
        <StatusChip status={r.status} />
        <LayerChip layer={r.layer} />
      </div>
      <div style={{ fontSize: 13, marginBottom: r.changes.length ? 10 : 0, lineHeight: 1.6 }}><Editable text={desc} /></div>
      <ChangeList changes={r.changes} n={n} />
    </Card>
  )
}

function LocationCard({ l, n }: { l: BibleLocation; n: number }) {
  const applied = l.changes.filter((c) => c.from <= n)
  const desc = applied.length ? applied[applied.length - 1].to : l.desc
  return (
    <Card style={{ padding: 'var(--space-5)', opacity: l.firstChapter > n ? 0.6 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <Icon name="landscape" size={18} style={{ color: 'var(--color-primary)' }} />
        <span style={{ fontWeight: 700, fontSize: 15 }}>{l.name}</span>
        <StatusChip status={l.status} />
        <LayerChip layer={l.layer} />
        <span style={{ fontSize: 11, color: 'var(--color-outline)', marginLeft: 'auto' }}>首次出现：第 {l.firstChapter} 章</span>
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 12 }}><Editable text={desc} multiline /></div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: l.changes.length ? 12 : 0 }}>
        {l.variants.map((v) => (
          <Tooltip key={v.id} text={v.desc}>
            <Chip>{v.name}</Chip>
          </Tooltip>
        ))}
      </div>
      <ChangeList changes={l.changes} n={n} />
    </Card>
  )
}

// ---- 候选与冲突（收进抽屉，对比在里面） ----

function CandidatesDrawer({
  data,
  open,
  onClose,
  onResolve,
}: {
  data: BibleData
  open: boolean
  onClose: () => void
  onResolve: (id: string, adopt: boolean) => void
}) {
  return (
    <Drawer open={open} title="候选与冲突" onClose={onClose} width={460}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
        {data.adopted.length ? (
          <div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {data.adopted.map((a) => (
                <Chip key={a.id}>{a.kind} · {a.name} · 第 {a.fromChapter} 章 · 已用于制作</Chip>
              ))}
            </div>
          </div>
        ) : null}
        {data.conflicts.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div style={{ fontSize: 12, color: 'var(--color-outline)', lineHeight: 1.6, marginBottom: 'var(--space-3)' }}>
              制作继续用已确认的版本：
            </div>
            {data.conflicts.map((c) => (
              <div
                key={c.id}
                style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)', background: 'var(--accent-wash)' }}
              >
                <div style={{ marginBottom: 'var(--space-3)' }}>
                  <div className="label-caps label-caps-zh" style={{ color: 'var(--color-success)', marginBottom: 5 }}>
                    已确认 · {c.target} · {c.field}
                  </div>
                  <div style={{ fontSize: 12.5, lineHeight: 1.7 }}>{c.confirmed}</div>
                </div>
                <div style={{ marginBottom: 'var(--space-4)' }}>
                  <div className="label-caps label-caps-zh" style={{ color: 'var(--color-on-error-container)', marginBottom: 5 }}>
                    候选 · 第 {c.fromChapter} 章提取
                  </div>
                  <div style={{ fontSize: 12.5, lineHeight: 1.7 }}>{c.candidate}</div>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <Button size="sm" variant="primary" onClick={() => onResolve(c.id, true)}>采用候选</Button>
                  <Button size="sm" onClick={() => onResolve(c.id, false)}>保留现有</Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: 'var(--color-success)' }}>
            <Icon name="check_circle" size={14} style={{ verticalAlign: -2, marginRight: 4 }} />
            没有待处理的冲突。
          </div>
        )}
      </div>
    </Drawer>
  )
}

// ---- 全书预览 ----

function PreviewPanel({ data, n }: { data: BibleData; n: number }) {
  const shown = data.preview.filter((p) => p.chapter <= n)
  if (!shown.length) {
    return (
      <Card>
        <EmptyState
          icon="travel_explore"
          title="还没有预览结果"
          desc="全书预览完成后按章节列出。"
        />
      </Card>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {shown.map((p) => (
        <Card key={p.chapter} style={{ padding: 'var(--space-4) var(--space-5)' }}>
          <div className="label-caps" style={{ color: 'var(--color-outline)', marginBottom: 8 }}>第 {p.chapter} 章</div>
          <p style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 10 }}>{p.summary}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {p.characters.map((c) => <Chip key={c} active>{c}</Chip>)}
            {p.locations.map((l) => <Chip key={l}>{l}</Chip>)}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--color-on-surface-variant)' }}>
            {p.timeline ? (
              <span><Icon name="schedule" size={13} style={{ verticalAlign: -2, marginRight: 4 }} />{p.timeline}</span>
            ) : null}
            {p.foreshadowing ? (
              <span><Icon name="mystery" size={13} style={{ verticalAlign: -2, marginRight: 4 }} />{p.foreshadowing}</span>
            ) : null}
          </div>
        </Card>
      ))}
    </div>
  )
}

// ---- 主页面 ----

type PartKey = 'characters' | 'relations' | 'locations' | 'skeleton' | 'timeline' | 'foreshadowing' | 'style' | 'glossary' | 'preview'

const partDefs: { key: PartKey; label: string; icon: string }[] = [
  { key: 'characters', label: '角色', icon: 'group' },
  { key: 'relations', label: '角色关系', icon: 'partner_exchange' },
  { key: 'locations', label: '地点', icon: 'landscape' },
  { key: 'skeleton', label: '剧情骨架', icon: 'account_tree' },
  { key: 'timeline', label: '时间线', icon: 'schedule' },
  { key: 'foreshadowing', label: '伏笔', icon: 'mystery' },
  { key: 'style', label: '风格', icon: 'palette' },
  { key: 'glossary', label: '术语表', icon: 'translate' },
  { key: 'preview', label: '全书预览', icon: 'travel_explore' },
]

/** 有「候选/冲突」候选数据的分区（其余分区不挂计数） */
const candidateParts: PartKey[] = ['characters', 'relations', 'locations', 'skeleton', 'timeline', 'foreshadowing']

export function BiblePage() {
  const { id } = useParams()
  const work = findWork(id)
  const toast = useToast()
  const [part, setPart] = useState<PartKey>('characters')
  const [n, setN] = useState(work ? work.chapters.length : 1)
  const [resolvedIds, setResolvedIds] = useState<string[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)

  if (!work) {
    return (
      <Page title="设定集">
        <EmptyState icon="menu_book" title="找不到这部作品" desc="它可能已不在工程里。" />
      </Page>
    )
  }

  const data = getBible(work)
  const conflicts = data.conflicts.filter((c) => !resolvedIds.includes(c.id))
  const total = work.chapters.length

  const resolveConflict = (cid: string, adopt: boolean) => {
    const c = data.conflicts.find((x) => x.id === cid)
    setResolvedIds((ids) => [...ids, cid])
    toast(adopt ? `已采用「${c?.target ?? ''}」的候选写法（演示）` : `已保留「${c?.target ?? ''}」的现有设定`, 'check')
  }

  const counts: Record<PartKey, number> = {
    characters: data.characters.length,
    relations: data.relations.length,
    locations: data.locations.length,
    skeleton: 1,
    timeline: data.timeline.filter((t) => t.chapter <= n).length,
    foreshadowing: data.foreshadowing.filter((f) => f.planted <= n).length,
    style: 2,
    glossary: data.glossary.length,
    preview: data.preview.filter((p) => p.chapter <= n).length,
  }

  const showCandidateChip = candidateParts.includes(part) && (data.adopted.length > 0 || conflicts.length > 0)

  return (
    <Page
      width={1200}
      title="设定集"
      eyebrow={`${findSeries(work.seriesId).title} · ${findVolume(work.volumeId).title}`}
      actions={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: 240 }}>
          <Tooltip text="模型写第 N 章时只拿到截至第 N 章的设定">
            <Icon name="help" size={16} style={{ color: 'var(--color-outline)', flexShrink: 0 }} />
          </Tooltip>
          <span className="label-caps label-caps-zh" style={{ color: 'var(--color-outline)', whiteSpace: 'nowrap' }}>截至第</span>
          <Slider value={n} onChange={setN} min={1} max={total} suffix=" 章" />
        </div>
      }
    >
      <div className="bible-root">
      <div className="bible-layout" style={{ display: 'grid', gap: 'var(--space-5)', alignItems: 'start' }}>
        {/* 左：分区导航（带条数） */}
        <nav style={{ position: 'sticky', top: 'var(--space-5)' }}>
          {partDefs.map((p) => {
            const active = p.key === part
            return (
              <button
                key={p.key}
                title={p.label}
                className="bible-nav-item"
                onClick={() => setPart(p.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                  minHeight: 44, padding: '8px 12px', borderRadius: 'var(--radius-lg)',
                  background: active ? 'var(--accent-wash)' : 'transparent',
                  color: active ? 'var(--color-primary)' : 'var(--color-on-surface-variant)',
                  transition: 'background 0.15s ease',
                }}
              >
                <Icon name={p.icon} size={17} />
                <span className="bible-nav-text" style={{ flex: 1, fontSize: 13.5, fontWeight: active ? 700 : 500 }}>{p.label}</span>
                <span className="bible-nav-text" style={{ fontSize: 11, color: 'var(--color-outline)' }}>{counts[p.key]}</span>
              </button>
            )
          })}
        </nav>

        {/* 右：当前分区内容 */}
        <div style={{ minWidth: 0 }}>
          {showCandidateChip ? (
            <div style={{ marginBottom: 'var(--space-5)' }}>
              <Chip onClick={() => setDrawerOpen(true)}>
                候选与冲突 · {conflicts.length ? `${conflicts.length} 项待处理` : '全部已用于制作'}
                <Icon name="chevron_right" size={13} style={{ marginLeft: 2 }} />
              </Chip>
            </div>
          ) : null}

          {part === 'characters' ? <CharactersPart data={data} n={n} /> : null}

          {part === 'relations' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {data.relations.length ? data.relations.map((r) => <RelationCard key={r.id} r={r} n={n} />) : (
                <Card><EmptyState icon="partner_exchange" title="还没有关系记录" desc="综合提取的角色关系会列在这里。" /></Card>
              )}
            </div>
          ) : null}

          {part === 'locations' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {data.locations.length ? data.locations.map((l) => <LocationCard key={l.id} l={l} n={n} />) : (
                <Card><EmptyState icon="landscape" title="还没有地点" desc="综合提取的地点会列在这里。" /></Card>
              )}
            </div>
          ) : null}

          {part === 'skeleton' ? (
            <Card style={{ padding: 'var(--space-5)' }}>
              <SectionLabel>本卷主线概要</SectionLabel>
              <p style={{ fontSize: 14, lineHeight: 1.9 }}><Editable text={data.skeleton} multiline /></p>
            </Card>
          ) : null}

          {part === 'timeline' ? (
            <Card style={{ padding: 'var(--space-2) var(--space-5)' }}>
              {data.timeline.some((t) => t.chapter <= n) ? (
                <div>
                  {data.timeline.filter((t) => t.chapter <= n).map((t) => (
                    <div key={t.id} style={{ display: 'flex', gap: 14, minHeight: 52, borderBottom: '1px solid var(--divider)', alignItems: 'center' }}>
                      <span className="label-caps" style={{ color: 'var(--color-outline)', minWidth: 88 }}>{t.storyTime}</span>
                      <span style={{ flex: 1, fontSize: 13.5 }}>{t.event}</span>
                      <Chip>第 {t.chapter} 章</Chip>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState icon="schedule" title="这之前没有事件" desc={`截至第 ${n} 章还没有时间线索引。`} />
              )}
            </Card>
          ) : null}

          {part === 'foreshadowing' ? (
            <Card style={{ padding: 'var(--space-2) var(--space-5)' }}>
              {data.foreshadowing.some((f) => f.planted <= n) ? (
                <div>
                  {data.foreshadowing.filter((f) => f.planted <= n).map((f) => {
                    const closed = f.payoff !== undefined && f.payoff <= n
                    return (
                      <div key={f.id} style={{ display: 'flex', gap: 12, alignItems: 'center', minHeight: 52, borderBottom: '1px solid var(--divider)' }}>
                        <Icon name={closed ? 'check_circle' : 'mystery'} size={16} style={{ color: closed ? 'var(--color-success)' : 'var(--color-outline)' }} />
                        <span style={{ flex: 1, fontSize: 13.5 }}>{f.text}</span>
                        <span style={{ fontSize: 12, color: 'var(--color-outline)', whiteSpace: 'nowrap' }}>
                          埋于第 {f.planted} 章{f.payoff !== undefined ? ` · ${closed ? `第 ${f.payoff} 章已回收` : `第 ${f.payoff} 章回收`}` : ' · 仍开着'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <EmptyState icon="mystery" title="这之前还没有伏笔" desc={`截至第 ${n} 章还没有埋下的伏笔。`} />
              )}
            </Card>
          ) : null}

          {part === 'style' ? (
            <Card style={{ padding: 'var(--space-5)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
                <div>
                  <div className="label-caps label-caps-zh" style={{ color: 'var(--color-outline)', marginBottom: 6 }}>画风 / 主视觉参考</div>
                  <p style={{ fontSize: 13.5, lineHeight: 1.8 }}><Editable text={data.style.art} multiline /></p>
                </div>
                <div>
                  <div className="label-caps label-caps-zh" style={{ color: 'var(--color-outline)', marginBottom: 6 }}>旁白语气</div>
                  <p style={{ fontSize: 13.5, lineHeight: 1.8 }}><Editable text={data.style.narration} multiline /></p>
                </div>
              </div>
            </Card>
          ) : null}

          {part === 'glossary' ? (
            <Card style={{ padding: 'var(--space-5)' }}>
              <div style={{ fontSize: 12, color: 'var(--color-outline)', marginBottom: 12 }}>
                角色名和地名只记在角色和地点条目里。
              </div>
              {data.glossary.length ? (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: 'var(--color-outline)', textAlign: 'left' }}>
                      {['原文写法', '作品里的写法', '注音', '类别', '备注'].map((h) => (
                        <th key={h} style={{ padding: '8px 10px', fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.glossary.map((g, i) => (
                      <tr key={i} style={{ borderTop: '1px solid var(--divider)' }}>
                        <td style={{ padding: '10px' }}>{g.source}</td>
                        <td style={{ padding: '10px', fontWeight: 600 }}>{g.work}</td>
                        <td style={{ padding: '10px', color: 'var(--color-on-surface-variant)' }}>{g.ruby ?? '—'}</td>
                        <td style={{ padding: '10px' }}><Chip>{g.category}</Chip></td>
                        <td style={{ padding: '10px', color: 'var(--color-on-surface-variant)' }}>{g.note ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <EmptyState icon="translate" title="还没有术语" desc="综合提取的专名会列在这里。" />
              )}
            </Card>
          ) : null}

          {part === 'preview' ? <PreviewPanel data={data} n={n} /> : null}
        </div>
      </div>
      </div>

      <CandidatesDrawer data={{ ...data, conflicts }} open={drawerOpen} onClose={() => setDrawerOpen(false)} onResolve={resolveConflict} />
    </Page>
  )
}
