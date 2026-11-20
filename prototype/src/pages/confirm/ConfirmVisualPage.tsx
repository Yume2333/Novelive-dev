import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, Icon } from '../../components/Button'
import { Card } from '../../components/Card'
import { Tooltip } from '../../components/Extended'
import { EmptyState, Field, SectionLabel, textareaStyle } from '../../components/Form'
import { Dropdown } from '../../components/Modal'
import { Page } from '../../components/Page'
import { useToast } from '../../components/Toast'
import { findVisualCandidates, type CandidateImage, type CharacterCandidate } from '../../mock/confirm'
import { findSeries, findVolume, findWork } from '../../mock/library'

/** 小图占位块：CSS 渐变 / 剪影 + 来源标签 + 说明文字，选中时描边 + 角标 */
function Thumb({ img, selected, onSelect, h = 180 }: {
  img: CandidateImage
  selected: boolean
  onSelect: () => void
  h?: number
}) {
  return (
    <button onClick={onSelect} style={{ padding: 0, textAlign: 'left', display: 'block', width: '100%' }}>
      <span
        style={{
          display: 'block',
          height: h,
          borderRadius: 'var(--radius-md)',
          background: img.art,
          border: selected ? '2px solid var(--color-primary)' : '1px solid var(--divider)',
          boxShadow: selected ? 'var(--shadow-glass)' : 'none',
          position: 'relative',
          overflow: 'hidden',
          transition: 'all 0.15s ease',
        }}
      >
        {selected ? (
          <span
            style={{
              position: 'absolute',
              top: 6,
              right: 6,
              width: 20,
              height: 20,
              borderRadius: 'var(--radius-full)',
              background: 'var(--color-primary)',
              color: 'var(--color-on-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="check" size={13} />
          </span>
        ) : null}
      </span>
      <span style={{ display: 'block', marginTop: 6, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{img.label}</span>
      <span style={{ display: 'block', marginTop: 2, fontSize: 11, color: 'var(--color-outline)' }}>{img.source}</span>
    </button>
  )
}

/** 选中角色的详情卡：描述 + 每套造型的候选图（一行最多 3 张） */
function CharacterPanel({ char, picked, onPick, onDesc }: {
  char: CharacterCandidate
  picked: Record<string, string>
  onPick: (key: string, imageId: string) => void
  onDesc: (desc: string) => void
}) {
  const toast = useToast()
  const [editingDesc, setEditingDesc] = useState(false)
  const [desc, setDesc] = useState(char.desc)
  return (
    <Card style={{ padding: 'var(--space-5)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <h4 className="headline" style={{ fontSize: 18 }}>{char.name}</h4>
        <span style={{ fontSize: 12, color: 'var(--color-outline)' }}>{char.role}</span>
      </div>

      {editingDesc ? (
        <div style={{ margin: 'var(--space-3) 0 var(--space-5)', maxWidth: 560 }}>
          <Field label="外貌描述">
            <textarea style={{ ...textareaStyle, minHeight: 64 }} value={desc} onChange={(e) => setDesc(e.target.value)} />
          </Field>
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                onDesc(desc)
                setEditingDesc(false)
                toast(`已更新「${char.name}」的外貌描述`, 'edit')
              }}
            >
              保存描述
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setDesc(char.desc); setEditingDesc(false) }}>取消</Button>
          </div>
        </div>
      ) : (
        <p style={{ fontSize: 13, color: 'var(--color-on-surface-variant)', lineHeight: 1.7, marginTop: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
          {char.desc}
          <button onClick={() => setEditingDesc(true)} style={{ marginLeft: 8, padding: 0, display: 'inline-flex', color: 'var(--color-primary)', verticalAlign: 'middle' }} title="修改描述">
            <Icon name="edit" size={14} />
          </button>
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
        {char.outfits.map((outfit) => {
          const key = `${char.id}/${outfit.name}`
          return (
            <div key={outfit.name}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                <SectionLabel>{`造型 · ${outfit.name}`}</SectionLabel>
                <Button variant="ghost" size="sm" icon="refresh" onClick={() => toast(`按书中描写为「${char.name} · ${outfit.name}」重新生成几版`, 'refresh')}>
                  重新生成
                </Button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 'var(--space-4)', marginTop: 'var(--space-3)' }}>
                {outfit.images.map((img) => (
                  <Thumb key={img.id} img={img} selected={picked[key] === img.id} onSelect={() => onPick(key, img.id)} />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

export function ConfirmVisualPage() {
  const { id } = useParams()
  const work = findWork(id)
  const navigate = useNavigate()
  const toast = useToast()

  const data = work ? findVisualCandidates(work) : null
  const [chars, setChars] = useState<CharacterCandidate[]>(() => (work ? findVisualCandidates(work).characters : []))
  const [styleSel, setStyleSel] = useState<string | null>(null)
  const [stopWithRefs, setStopWithRefs] = useState(data?.stopWithRefs ?? true)
  /** 每个造型选中的候选图 id：`charId/outfitName -> imageId` */
  const [picked, setPicked] = useState<Record<string, string>>({})
  const [selCharId, setSelCharId] = useState<string | null>(null)

  if (!work || work.kind !== 'project' || !data) {
    return (
      <Page title="角色设定 / 主视觉" width={760}>
        <EmptyState icon="palette" title="这部作品不在这个确认点" desc="只有工程作品会停在确认点。" actions={<Button variant="primary" onClick={() => navigate('/')}>回到书库</Button>} />
      </Page>
    )
  }

  const vol = findVolume(work.volumeId)
  const ser = findSeries(work.seriesId)
  const selChar = chars.find((c) => c.id === selCharId) ?? chars[0]
  const outfitTotal = chars.reduce((n, c) => n + c.outfits.length, 0)
  const outfitPicked = chars.reduce((n, c) => n + c.outfits.filter((o) => picked[`${c.id}/${o.name}`]).length, 0)
  const allPicked = styleSel !== null && outfitPicked === outfitTotal
  const missing = (styleSel ? 0 : 1) + (outfitTotal - outfitPicked)

  return (
    <Page
      eyebrow={`${ser.title} · 第${vol.index}卷 · 确认点 1 / 2`}
      title={`${work.title} · 角色设定 / 主视觉`}
      subtitle={
        <Tooltip text="确认后开始制作第一章；第一章做完会再停一次。">
          <Icon name="info" size={15} style={{ color: 'var(--color-outline)', verticalAlign: 'middle' }} />
        </Tooltip>
      }
      actions={
        <>
          {!allPicked ? (
            <span style={{ fontSize: 12, color: 'var(--color-outline)' }}>{`还差 ${missing} 项未选定`}</span>
          ) : null}
          <Dropdown
            trigger={<Button variant="ghost" icon="more_horiz">更多</Button>}
            items={[
              { label: '先不确认，回作品页', icon: 'arrow_back', onClick: () => navigate(`/work/${work.id}`) },
              {
                label: '有参考图时也停在这里',
                icon: stopWithRefs ? 'check_box' : 'check_box_outline_blank',
                onClick: () => setStopWithRefs((v) => !v),
              },
            ]}
          />
          <Button
            variant="primary"
            icon="check"
            disabled={!allPicked}
            title={allPicked ? undefined : `还差 ${missing} 项未选定`}
            onClick={() => {
              toast('角色设定和主视觉已确认，开始制作第一章', 'check')
              navigate(`/work/${work.id}/production`)
            }}
          >
            确认并开始制作
          </Button>
        </>
      }
    >
      {/* 主视觉：整部作品一个决定 */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
          <SectionLabel>主视觉 · 画风方向</SectionLabel>
          <Button variant="ghost" size="sm" icon="refresh" onClick={() => toast('已重新生成几版主视觉方向', 'refresh')}>重新生成</Button>
        </div>
        <Card style={{ padding: 'var(--space-5)', marginTop: 'var(--space-3)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 'var(--space-4)' }}>
            {data.style.options.map((opt) => (
              <Thumb key={opt.id} img={opt} selected={styleSel === opt.id} onSelect={() => setStyleSel(opt.id)} h={140} />
            ))}
          </div>
        </Card>
      </section>

      {/* 第一卷主要角色：一次只看一个；其余角色第一次出场时由立绘按设定集直接画 */}
      <section style={{ marginTop: 'var(--space-7)' }}>
        <SectionLabel>第一卷主要角色</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 'var(--space-5)', marginTop: 'var(--space-3)', alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {chars.map((c) => {
              const done = c.outfits.filter((o) => picked[`${c.id}/${o.name}`]).length
              const all = done === c.outfits.length
              const active = selChar?.id === c.id
              return (
                <button
                  key={c.id}
                  onClick={() => setSelCharId(c.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-3)',
                    minHeight: 52,
                    padding: 'var(--space-2) var(--space-3)',
                    borderRadius: 'var(--radius-lg)',
                    textAlign: 'left',
                    background: active ? 'var(--accent-wash)' : 'transparent',
                    border: active ? '1px solid var(--color-primary)' : '1px solid transparent',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 600, fontSize: 14 }}>{c.name}</span>
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--color-outline)', marginTop: 2 }}>{all ? '已选定' : `已选 ${done}/${c.outfits.length}`}</span>
                  </span>
                  {all ? <Icon name="check_circle" size={16} style={{ color: 'var(--color-success)', flexShrink: 0 }} /> : null}
                </button>
              )
            })}
          </div>
          {selChar ? (
            <CharacterPanel
              key={selChar.id}
              char={selChar}
              picked={picked}
              onPick={(key, imageId) => setPicked((prev) => ({ ...prev, [key]: imageId }))}
              onDesc={(desc) => setChars((prev) => prev.map((c) => (c.id === selChar.id ? { ...c, desc } : c)))}
            />
          ) : null}
        </div>
      </section>
    </Page>
  )
}
