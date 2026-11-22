import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, Icon, Spinner } from '../../components/Button'
import { Card } from '../../components/Card'
import { Tooltip } from '../../components/Extended'
import { EmptyState, Field, SectionLabel, textareaStyle } from '../../components/Form'
import { Dropdown, Modal } from '../../components/Modal'
import { Page } from '../../components/Page'
import { useToast } from '../../components/Toast'
import { findVisualCandidates, type CandidateImage, type CharacterCandidate, type WorkVisualCandidates } from '../../mock/confirm'
import { findSeries, findVolume, findWork } from '../../mock/library'
import type { Work } from '../../mock/types'

interface PreviewTarget {
  img: CandidateImage
  subtitle: string
  description: string
  selected: boolean
  onPick: () => void
}

function RegenOverlay() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 3,
        borderRadius: 'var(--radius-md)',
        background: 'linear-gradient(90deg, var(--veil-90) 25%, var(--color-surface-container-high) 50%, var(--veil-90) 75%)',
        backgroundSize: '200% 100%',
        animation: 'skeleton-wave 1.4s ease infinite',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-2)',
        padding: 'var(--space-4)',
      }}
    >
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--color-primary)' }}>
        <Spinner size={15} />
        <span className="ink-shimmer" style={{ fontSize: 13, fontWeight: 600 }}>
          正在生成新候选…
        </span>
      </div>
    </div>
  )
}

/** 小图占位块：CSS 渐变 / 剪影 + 来源标签 + 说明文字，选中时描边 + 角标 + 悬浮放大预览 */
function Thumb({ img, selected, onSelect, onPreview, version = 1, h = 180 }: {
  img: CandidateImage
  selected: boolean
  onSelect: () => void
  onPreview: () => void
  version?: number
  h?: number
}) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const showZoom = hovered || focused

  return (
    <div
      style={{ position: 'relative', width: '100%' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false)
      }}
    >
      <button type="button" onClick={onSelect} style={{ padding: 0, textAlign: 'left', display: 'block', width: '100%' }}>
        <span
          className="nl-card-interactive"
          style={{
            display: 'block',
            height: h,
            borderRadius: 'var(--radius-md)',
            background: img.art,
            border: selected ? '2px solid var(--color-primary)' : '1px solid var(--divider)',
            boxShadow: selected ? 'var(--shadow-glass)' : 'none',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {version > 1 ? (
            <span
              style={{
                position: 'absolute',
                left: 8,
                bottom: 8,
                padding: '3px 8px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--veil-90)',
                color: 'var(--color-on-surface-variant)',
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.02em',
                border: '1px solid var(--divider)',
              }}
            >
              第 {version} 版
            </span>
          ) : null}
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
        <span style={{ display: 'block', marginTop: 'var(--space-2)', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{img.label}</span>
        <span style={{ display: 'block', marginTop: 2, fontSize: 11, color: 'var(--color-outline)' }}>{img.source}</span>
      </button>
      <button
        type="button"
        title="放大预览"
        aria-label={`放大预览 ${img.label}`}
        onClick={(e) => {
          e.stopPropagation()
          onPreview()
        }}
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          zIndex: 2,
          width: 26,
          height: 26,
          borderRadius: 'var(--radius-full)',
          background: 'var(--veil-90)',
          color: 'var(--color-on-surface)',
          border: '1px solid var(--divider)',
          boxShadow: 'var(--shadow-chip)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: showZoom ? 1 : 0,
          pointerEvents: showZoom ? 'auto' : 'none',
          transition: 'opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out)',
        }}
      >
        <Icon name="open_in_full" size={13} />
      </button>
    </div>
  )
}

/** 选中角色的详情卡：描述 + 每套造型的候选图（一行最多 3 张） */
function CharacterPanel({ char, picked, regenerating, versions, onPick, onDesc, onRegenerate, onPreview }: {
  char: CharacterCandidate
  picked: Record<string, string>
  regenerating: Record<string, boolean>
  versions: Record<string, number>
  onPick: (key: string, imageId: string) => void
  onDesc: (desc: string) => void
  onRegenerate: (outfitName: string) => void
  onPreview: (target: PreviewTarget) => void
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
          <button onClick={() => setEditingDesc(true)} style={{ marginLeft: 'var(--space-2)', padding: 0, display: 'inline-flex', color: 'var(--color-primary)', verticalAlign: 'middle' }} title="修改描述">
            <Icon name="edit" size={14} />
          </button>
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
        {char.outfits.map((outfit) => {
          const key = `${char.id}/${outfit.name}`
          const isRegen = !!regenerating[key]
          const ver = versions[key] ?? 1
          return (
            <div key={outfit.name}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                <SectionLabel>{`造型 · ${outfit.name}`}</SectionLabel>
                <Button
                  variant="ghost"
                  size="sm"
                  icon="refresh"
                  loading={isRegen}
                  onClick={() => onRegenerate(outfit.name)}
                >
                  重新生成
                </Button>
              </div>
              <div style={{ position: 'relative', marginTop: 'var(--space-3)', borderRadius: 'var(--radius-md)' }}>
                <div
                  key={`${key}-v${ver}`}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                    gap: 'var(--space-4)',
                    animation: ver > 1 ? 'fade-in var(--dur-slow) var(--ease-out)' : undefined,
                  }}
                >
                  {outfit.images.map((img) => (
                    <Thumb
                      key={img.id}
                      img={img}
                      version={ver}
                      selected={picked[key] === img.id}
                      onSelect={() => onPick(key, img.id)}
                      onPreview={() =>
                        onPreview({
                          img,
                          subtitle: `${char.name} · ${outfit.name}`,
                          description: char.desc,
                          selected: picked[key] === img.id,
                          onPick: () => onPick(key, img.id),
                        })
                      }
                    />
                  ))}
                </div>
                {isRegen ? <RegenOverlay /> : null}
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

  const data = work ? findVisualCandidates(work) : null

  if (!work || work.kind !== 'project' || !data) {
    return (
      <Page title="角色设定 / 主视觉" width={760}>
        <EmptyState icon="palette" title="这部作品不在这个确认点" desc="只有工程作品会停在确认点。" actions={<Button variant="primary" onClick={() => navigate('/')}>回到书库</Button>} />
      </Page>
    )
  }

  return <ConfirmVisualInner key={work.id} work={work} data={data} />
}

function rotateCandidateImages(images: CandidateImage[], nextVersion: number): CandidateImage[] {
  if (images.length <= 1) return images
  const rotated = [...images.slice(1), images[0]]
  const angleShift = nextVersion % 2 === 0 ? '145deg' : '175deg'
  return rotated.map((img, i) => ({
    ...img,
    art: i === 0 ? img.art.replace(/160deg|135deg/, angleShift) : img.art,
  }))
}

function ConfirmVisualInner({ work, data }: { work: Work; data: WorkVisualCandidates }) {
  const navigate = useNavigate()
  const toast = useToast()

  const [styleOptions, setStyleOptions] = useState<CandidateImage[]>(() => data.style.options)
  const [chars, setChars] = useState<CharacterCandidate[]>(() => data.characters)
  const [styleSel, setStyleSel] = useState<string | null>(null)
  const [stopWithRefs, setStopWithRefs] = useState(data.stopWithRefs)
  /** 每个造型选中的候选图 id：`charId/outfitName -> imageId` */
  const [picked, setPicked] = useState<Record<string, string>>({})
  const [selCharId, setSelCharId] = useState<string | null>(null)
  const [regenerating, setRegenerating] = useState<Record<string, boolean>>({})
  const [versions, setVersions] = useState<Record<string, number>>({})
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null)
  const regenTimersRef = useRef<number[]>([])

  useEffect(() => () => {
    regenTimersRef.current.forEach((t) => window.clearTimeout(t))
  }, [])

  const handleRegenerateMain = () => {
    if (regenerating.main) return
    setRegenerating((prev) => ({ ...prev, main: true }))
    const timer = window.setTimeout(() => {
      const nextVer = (versions.main ?? 1) + 1
      setStyleOptions((prev) => rotateCandidateImages(prev, nextVer))
      setVersions((prev) => ({ ...prev, main: nextVer }))
      setRegenerating((prev) => ({ ...prev, main: false }))
      toast('已更新候选', 'refresh')
    }, 1100)
    regenTimersRef.current.push(timer)
  }

  const handleRegenerateOutfit = (charId: string, outfitName: string) => {
    const key = `${charId}/${outfitName}`
    if (regenerating[key]) return
    setRegenerating((prev) => ({ ...prev, [key]: true }))
    const timer = window.setTimeout(() => {
      const nextVer = (versions[key] ?? 1) + 1
      setChars((prev) =>
        prev.map((c) =>
          c.id === charId
            ? {
                ...c,
                outfits: c.outfits.map((o) =>
                  o.name === outfitName ? { ...o, images: rotateCandidateImages(o.images, nextVer) } : o,
                ),
              }
            : c,
        ),
      )
      setVersions((prev) => ({ ...prev, [key]: nextVer }))
      setRegenerating((prev) => ({ ...prev, [key]: false }))
      toast('已更新候选', 'refresh')
    }, 1100)
    regenTimersRef.current.push(timer)
  }

  const vol = findVolume(work.volumeId)
  const ser = findSeries(work.seriesId)
  const selChar = chars.find((c) => c.id === selCharId) ?? chars[0]
  const outfitTotal = chars.reduce((n, c) => n + c.outfits.length, 0)
  const outfitPicked = chars.reduce((n, c) => n + c.outfits.filter((o) => picked[`${c.id}/${o.name}`]).length, 0)
  const allPicked = styleSel !== null && outfitPicked === outfitTotal
  const missing = (styleSel ? 0 : 1) + (outfitTotal - outfitPicked)
  const mainVersion = versions.main ?? 1

  return (
    <Page
      eyebrow={`${ser.title} · 第${vol.index}卷 · 确认点 1 / 2`}
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <span>{work.title} · 角色设定 / 主视觉</span>
          <Tooltip text="确认后开始制作第一章；第一章做完会再停一次。">
            <Icon name="info" size={16} style={{ color: 'var(--color-outline)' }} />
          </Tooltip>
        </span>
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
          <Button variant="ghost" size="sm" icon="refresh" loading={!!regenerating.main} onClick={handleRegenerateMain}>
            重新生成
          </Button>
        </div>
        <Card style={{ padding: 'var(--space-5)', marginTop: 'var(--space-3)', position: 'relative' }}>
          <div style={{ position: 'relative', borderRadius: 'var(--radius-md)' }}>
            <div
              key={`main-v${mainVersion}`}
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                gap: 'var(--space-4)',
                animation: mainVersion > 1 ? 'fade-in var(--dur-slow) var(--ease-out)' : undefined,
              }}
            >
              {styleOptions.map((opt) => (
                <Thumb
                  key={opt.id}
                  img={opt}
                  version={mainVersion}
                  selected={styleSel === opt.id}
                  onSelect={() => setStyleSel(opt.id)}
                  onPreview={() =>
                    setPreviewTarget({
                      img: opt,
                      subtitle: '主视觉 · 画风方向',
                      description: `《${work.title}》全书主视觉候选方向（来源：${opt.source}），选定后将作为整卷场景与光影的统一基调。`,
                      selected: styleSel === opt.id,
                      onPick: () => setStyleSel(opt.id),
                    })
                  }
                  h={140}
                />
              ))}
            </div>
            {regenerating.main ? <RegenOverlay /> : null}
          </div>
        </Card>
      </section>

      {/* 第一卷主要角色：一次只看一个；其余角色第一次出场时由立绘按设定集直接画 */}
      <section style={{ marginTop: 'var(--space-7)' }}>
        <SectionLabel>第一卷主要角色</SectionLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-5)', marginTop: 'var(--space-3)', alignItems: 'flex-start' }}>
          <div style={{ flex: '0 0 200px', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
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
                    background: active ? 'var(--white-90)' : 'transparent',
                    border: active ? '1px solid var(--accent-border-20)' : '1px solid transparent',
                    boxShadow: active ? 'var(--shadow-chip)' : 'none',
                    transition: 'all var(--dur-fast, 140ms) var(--ease-out, ease)',
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
            <div style={{ flex: '1 1 420px', minWidth: 0 }}>
              <CharacterPanel
                key={selChar.id}
                char={selChar}
                picked={picked}
                regenerating={regenerating}
                versions={versions}
                onPick={(key, imageId) => setPicked((prev) => ({ ...prev, [key]: imageId }))}
                onDesc={(desc) => setChars((prev) => prev.map((c) => (c.id === selChar.id ? { ...c, desc } : c)))}
                onRegenerate={(outfitName) => handleRegenerateOutfit(selChar.id, outfitName)}
                onPreview={setPreviewTarget}
              />
            </div>
          ) : null}
        </div>
      </section>

      {/* 候选图放大预览灯箱 */}
      <Modal
        open={previewTarget !== null}
        title={previewTarget?.img.label ?? ''}
        onClose={() => setPreviewTarget(null)}
        width={640}
        footer={
          previewTarget ? (
            <>
              <Button variant="ghost" onClick={() => setPreviewTarget(null)}>关闭</Button>
              <Button
                variant="primary"
                icon="check"
                onClick={() => {
                  previewTarget.onPick()
                  setPreviewTarget(null)
                }}
              >
                {previewTarget.selected ? '当前已选用' : '选用这一版'}
              </Button>
            </>
          ) : null
        }
      >
        {previewTarget ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div
              style={{
                height: 320,
                borderRadius: 'var(--radius-lg)',
                background: previewTarget.img.art,
                border: '1px solid var(--divider)',
                boxShadow: 'var(--shadow-glass)',
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <span className="label-caps label-caps-zh" style={{ color: 'var(--color-outline)', fontSize: 11 }}>
                {previewTarget.subtitle}
              </span>
              <span style={{ fontSize: 12, color: 'var(--color-on-surface-variant)' }}>
                来源：{previewTarget.img.source}
              </span>
            </div>
            <p style={{ fontSize: 13.5, lineHeight: 1.7, color: 'var(--color-on-surface-variant)' }}>
              {previewTarget.description}
            </p>
          </div>
        ) : null}
      </Modal>
    </Page>
  )
}
