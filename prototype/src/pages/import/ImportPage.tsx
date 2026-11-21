import { useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Icon } from '../../components/Button'
import { Card } from '../../components/Card'
import { RadioGroup, Stepper, Tooltip } from '../../components/Extended'
import { Field, SectionLabel, Select, TextInput, TierPicker, Toggle, inputStyle, textareaStyle } from '../../components/Form'
import { Page } from '../../components/Page'
import { useToast } from '../../components/Toast'
import {
  detectedInfo,
  draftChapters,
  draftVolumes,
  extraRefImages,
  extraSourceFiles,
  fileKindIcon,
  initialSourceFiles,
  type DraftChapter,
  type DraftVolume,
  type SourceFile,
} from '../../mock/import'
import { series, volumes } from '../../mock/library'

const steps = ['选择文件', '核对信息', '改编设置']

const langOptions = [
  { value: '简体中文', label: '简体中文' },
  { value: '繁體中文', label: '繁體中文' },
  { value: '日文', label: '日文' },
  { value: '英文', label: '英文' },
]

// ---- 步骤 1：选择文件 ----

function FileRow({ file, onRemove }: { file: SourceFile; onRemove: () => void }) {
  return (
    <div
      className="hover-row"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        minHeight: 52,
        padding: '0 var(--space-4)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--white-60)',
      }}
    >
      <Icon name={fileKindIcon[file.kind]} size={18} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {file.name}
      </span>
      <span className="label-caps" style={{ color: 'var(--color-outline)', fontSize: 11 }}>{file.size}</span>
      <span className="label-caps label-caps-zh" style={{ color: 'var(--color-success)', fontSize: 11 }}>{file.state}</span>
      <span className="row-actions" style={{ display: 'flex' }}>
        <button onClick={onRemove} style={{ display: 'flex', padding: 4, color: 'var(--color-outline)' }} title="移除">
          <Icon name="close" size={15} />
        </button>
      </span>
    </div>
  )
}

function DropZone({ icon, title, onPick }: { icon: string; title: string; onPick: () => void }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onPick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        padding: 'var(--space-6) var(--space-5)',
        borderRadius: 'var(--radius-xl)',
        border: `1.5px dashed ${hover ? 'var(--color-primary)' : 'var(--color-outline-variant)'}`,
        background: 'var(--white-40)',
        transition: 'all 0.2s ease',
        width: '100%',
      }}
    >
      <Icon name={icon} size={26} style={{ color: 'var(--color-on-surface-variant)' }} />
      <span style={{ fontWeight: 700, fontSize: 13 }}>{title}</span>
    </button>
  )
}

function StepFiles({
  files,
  setFiles,
  folder,
  setFolder,
  placement,
  setPlacement,
}: {
  files: SourceFile[]
  setFiles: (f: SourceFile[]) => void
  folder: string
  setFolder: (v: string) => void
  placement: { mode: 'new' | 'existing'; seriesId: string; volumeId: string }
  setPlacement: (p: { mode: 'new' | 'existing'; seriesId: string; volumeId: string }) => void
}) {
  const toast = useToast()
  const texts = files.filter((f) => f.kind !== 'image')
  const images = files.filter((f) => f.kind === 'image')
  const projectSeries = series.filter((s) => s.kind === 'project')
  const seriesVolumes = volumes.filter((v) => v.seriesId === placement.seriesId)

  const addText = () => {
    const next = extraSourceFiles[texts.length - initialSourceFiles.length]
    if (next) setFiles([...files, next])
    else toast('演示里就这几份文件', 'info')
  }
  const addImage = () => {
    const next = extraRefImages[images.length]
    if (next) setFiles([...files, next])
    else toast('演示里就这两张参考图', 'info')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
        <DropZone icon="upload_file" title="选择原文文件" onPick={addText} />
        <DropZone icon="image" title="参考图（可选）" onPick={addImage} />
      </div>

      {files.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {files.map((f) => (
            <FileRow key={f.name} file={f} onRemove={() => setFiles(files.filter((x) => x.name !== f.name))} />
          ))}
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
        <Field label="工程文件夹">
          <TextInput value={folder} onChange={setFolder} />
        </Field>
        <Field label="放进哪里">
          <RadioGroup
            value={placement.mode}
            onChange={(v) => setPlacement({ ...placement, mode: v as 'new' | 'existing' })}
            options={[
              { value: 'new', label: '新建系列' },
              { value: 'existing', label: '加入已有系列' },
            ]}
          />
        </Field>
      </div>

      {placement.mode === 'existing' ? (
        <p style={{ fontSize: 12, color: 'var(--color-on-surface-variant)', lineHeight: 1.6, margin: 0 }}>
          新原文会成为该系列的下一卷；沿用系列已有的角色、设定和素材，预览时在原有设定上增量更新。
        </p>
      ) : null}

      {placement.mode === 'existing' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          <Field label="系列">
            <Select
              value={placement.seriesId}
              onChange={(v) => {
                const first = volumes.find((x) => x.seriesId === v)
                setPlacement({ ...placement, seriesId: v, volumeId: first?.id ?? '' })
              }}
              options={projectSeries.map((s) => ({ value: s.id, label: s.title }))}
            />
          </Field>
          <Field label="卷">
            <Select
              value={placement.volumeId}
              onChange={(v) => setPlacement({ ...placement, volumeId: v })}
              options={seriesVolumes.map((v) => ({ value: v.id, label: `第 ${v.index} 卷 · ${v.title}` }))}
            />
          </Field>
        </div>
      ) : null}
    </div>
  )
}

// ---- 步骤 2：核对信息（可跳过） ----

function StepReview({
  info,
  setInfo,
  chapters,
  setChapters,
  vols,
  setVols,
}: {
  info: { title: string; author: string; sourceLanguage: string; workLanguage: string }
  setInfo: (i: typeof info) => void
  chapters: DraftChapter[]
  setChapters: (c: DraftChapter[]) => void
  vols: DraftVolume[]
  setVols: (v: DraftVolume[]) => void
}) {
  // 章的合并 / 拆分会让章节数组变长变短：后面每一卷的 from/to 都要跟着挪
  const shift = (fromIdx: number, delta: number) =>
    setVols(
      vols
        .map((v) => ({ ...v, from: v.from > fromIdx ? v.from + delta : v.from, to: v.to >= fromIdx ? v.to + delta : v.to }))
        .filter((v) => v.from <= v.to),
    )

  const mergeDown = (id: number) => {
    const idx = chapters.findIndex((c) => c.id === id)
    const a = chapters[idx]
    const b = chapters[idx + 1]
    const merged = { ...a, title: `${a.title} · ${b.title}` }
    shift(idx + 1, -1)
    setChapters([...chapters.slice(0, idx), merged, ...chapters.slice(idx + 2)])
  }
  const split = (id: number) => {
    const idx = chapters.findIndex((c) => c.id === id)
    if (idx < 0) return
    const c = chapters[idx]
    const half: DraftChapter = { id: Math.max(...chapters.map((x) => x.id)) + 1, title: `${c.title}（下）` }
    shift(idx, 1)
    setChapters([
      ...chapters.slice(0, idx),
      { ...c, title: `${c.title}（上）` },
      half,
      ...chapters.slice(idx + 1),
    ])
  }
  const rename = (id: number, title: string) => {
    setChapters(chapters.map((c) => (c.id === id ? { ...c, title } : c)))
  }

  const moveBoundary = (id: number, delta: number) => {
    const i = vols.findIndex((v) => v.id === id)
    const next = vols[i + 1]
    const to = Math.min(Math.max(vols[i].to + delta, vols[i].from), (next ? next.to : chapters.length) - 1)
    setVols(vols.map((v, j) => (j === i ? { ...v, to } : j === i + 1 ? { ...v, from: to + 1 } : v)).filter((v) => v.from <= v.to))
  }
  const mergeVol = (id: number) => {
    const idx = vols.findIndex((v) => v.id === id)
    const a = vols[idx]
    const b = vols[idx + 1]
    if (!b) return
    setVols([...vols.slice(0, idx), { ...a, title: a.title, to: b.to }, ...vols.slice(idx + 2)])
  }
  const splitVol = (id: number) => {
    const idx = vols.findIndex((v) => v.id === id)
    const v = vols[idx]
    if (v.to - v.from < 1) return
    const mid = v.from + Math.floor((v.to - v.from) / 2)
    setVols([
      ...vols.slice(0, idx),
      { ...v, to: mid },
      { id: Math.max(...vols.map((x) => x.id)) + 1, title: `${v.title}（下）`, from: mid + 1, to: v.to },
      ...vols.slice(idx + 1),
    ])
  }

  const smallBtn: CSSProperties = { display: 'flex', padding: 5, borderRadius: 'var(--radius-md)', color: 'var(--color-on-surface-variant)' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
        <Field label="标题">
          <TextInput value={info.title} onChange={(v) => setInfo({ ...info, title: v })} />
        </Field>
        <Field label="作者">
          <TextInput value={info.author} onChange={(v) => setInfo({ ...info, author: v })} />
        </Field>
        <Field label="原文语言">
          <Select value={info.sourceLanguage} onChange={(v) => setInfo({ ...info, sourceLanguage: v })} options={langOptions} />
        </Field>
        <Field label="作品语言">
          <Select value={info.workLanguage} onChange={(v) => setInfo({ ...info, workLanguage: v })} options={langOptions} />
        </Field>
      </div>

      <div>
        <SectionLabel>{`分卷 · ${vols.length} 卷 ${chapters.length} 章`}</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {vols.map((vol, vi) => {
            const inVol = chapters.slice(vol.from, vol.to + 1)
            if (!inVol.length) return null
            return (
              <div
                key={vol.id}
                style={{
                  borderRadius: 'var(--radius-lg)',
                  border: '1px solid var(--white-60)',
                  background: 'var(--white-35)',
                  padding: 'var(--space-3) var(--space-4)',
                }}
              >
                <div className="hover-row" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                  <input
                    style={{ ...inputStyle, padding: '5px 10px', fontSize: 12, width: 140, flexShrink: 0 }}
                    value={vol.title}
                    onChange={(e) => setVols(vols.map((v) => (v.id === vol.id ? { ...v, title: e.target.value } : v)))}
                  />
                  <span className="label-caps label-caps-zh" style={{ color: 'var(--color-outline)', fontSize: 11 }}>
                    {`第 ${vol.from + 1}–${vol.to + 1} 章 · ${inVol.length} 章`}
                  </span>
                  <span className="row-actions" style={{ display: 'flex', gap: 2, marginLeft: 'auto', flexShrink: 0 }}>
                    <Tooltip text="往下挪一章">
                      <button style={{ ...smallBtn, opacity: vol.to < (vols[vi + 1]?.to ?? chapters.length - 1) ? 1 : 0.35 }} onClick={() => moveBoundary(vol.id, 1)}>
                        <Icon name="arrow_downward" size={15} />
                      </button>
                    </Tooltip>
                    <Tooltip text="往上收一章">
                      <button style={{ ...smallBtn, opacity: vol.to > vol.from ? 1 : 0.35 }} onClick={() => moveBoundary(vol.id, -1)}>
                        <Icon name="arrow_upward" size={15} />
                      </button>
                    </Tooltip>
                    <Tooltip text="拆成两卷">
                      <button style={{ ...smallBtn, opacity: vol.to - vol.from >= 1 ? 1 : 0.35 }} onClick={() => splitVol(vol.id)}>
                        <Icon name="call_split" size={15} />
                      </button>
                    </Tooltip>
                    <Tooltip text={vi < vols.length - 1 ? '并入下一卷' : '已经是最后一卷'}>
                      <button style={{ ...smallBtn, opacity: vi < vols.length - 1 ? 1 : 0.35 }} onClick={() => mergeVol(vol.id)}>
                        <Icon name="merge" size={15} />
                      </button>
                    </Tooltip>
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                  {chapters.map((c, i) =>
                    i < vol.from || i > vol.to ? null : (
                      <div key={c.id} className="hover-row" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: 44, paddingRight: 'var(--space-2)', borderRadius: 'var(--radius-md)' }}>
                        <span className="label-caps" style={{ width: 22, color: 'var(--color-outline)', fontSize: 11, flexShrink: 0 }}>
                          {i + 1}
                        </span>
                        <input style={{ ...inputStyle, padding: '7px 10px', fontSize: 13 }} value={c.title} onChange={(e) => rename(c.id, e.target.value)} />
                        <span className="row-actions" style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                          <Tooltip text="拆成两章">
                            <button style={smallBtn} onClick={() => split(c.id)}>
                              <Icon name="call_split" size={15} />
                            </button>
                          </Tooltip>
                          <Tooltip text={i < chapters.length - 1 ? '与下一章合并' : '已经是最后一章'}>
                            <button
                              style={{ ...smallBtn, opacity: i < chapters.length - 1 ? 1 : 0.35 }}
                              onClick={() => mergeDown(c.id)}
                            >
                              <Icon name="merge" size={15} />
                            </button>
                          </Tooltip>
                        </span>
                      </div>
                    ),
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ---- 步骤 3：改编设置 ----

function StepSettings({
  strength,
  setStrength,
  density,
  setDensity,
  requirement,
  setRequirement,
  pauseOnRef,
  setPauseOnRef,
}: {
  strength: string
  setStrength: (v: string) => void
  density: string
  setDensity: (v: string) => void
  requirement: string
  setRequirement: (v: string) => void
  pauseOnRef: boolean
  setPauseOnRef: (v: boolean) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <Field label="改编强度">
        <TierPicker
          value={strength}
          onChange={setStrength}
          options={[
            { value: '忠实', label: '忠实', desc: '尽量贴着原文走，场景和段落顺序不变' },
            { value: '平衡', label: '平衡', desc: '默认。保留情节，把描写压缩成可演出的样子' },
            { value: '精简', label: '精简', desc: '大幅压缩支线与描写，只留主干剧情' },
          ]}
        />
      </Field>
      <Field label="演出密度">
        <TierPicker
          value={density}
          onChange={setDensity}
          options={[
            { value: '宽松', label: '宽松', desc: '克制用图，多用文字推进' },
            { value: '标准', label: '标准', desc: '默认。场景切换和表情按常规节奏' },
            { value: '激进', label: '激进', desc: '更多立绘、镜头和演出变化' },
          ]}
        />
      </Field>
      <Field label="改编要求">
        <textarea
          style={{ ...textareaStyle, minHeight: 72 }}
          value={requirement}
          onChange={(e) => setRequirement(e.target.value)}
          placeholder="例如：保留主角的口头禅；海边场景多用远景。"
        />
      </Field>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-4)',
          padding: 'var(--space-3) var(--space-4)',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--white-40)',
          border: '1px solid var(--white-60)',
          cursor: 'pointer',
        }}
        onClick={() => setPauseOnRef(!pauseOnRef)}
      >
        <span style={{ fontSize: 13, fontWeight: 600 }}>已有参考图时也停在角色设定</span>
        <Toggle on={pauseOnRef} onChange={() => {}} />
      </label>
    </div>
  )
}

// ---- 向导页 ----

export function ImportPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const [step, setStep] = useState(0)
  const [files, setFiles] = useState<SourceFile[]>(initialSourceFiles)
  const [folder, setFolder] = useState(`~/文档/Novelive/${detectedInfo.title}`)
  const [placement, setPlacement] = useState<{ mode: 'new' | 'existing'; seriesId: string; volumeId: string }>({
    mode: 'new',
    seriesId: 'wuhai',
    volumeId: 'wuhai-1',
  })
  const [info, setInfo] = useState(detectedInfo)
  const [chapters, setChapters] = useState<DraftChapter[]>(draftChapters)
  const [vols, setVols] = useState<DraftVolume[]>(draftVolumes)
  const [strength, setStrength] = useState('平衡')
  const [density, setDensity] = useState('标准')
  const [requirement, setRequirement] = useState('')
  const [pauseOnRef, setPauseOnRef] = useState(true)

  const hasText = files.some((f) => f.kind !== 'image')

  const finish = () => {
    toast('工程已创建，开始全书预览（演示跳到潮汐手记）', 'auto_fix_high')
    navigate('/work/chaoxi')
  }

  return (
    <Page title="新建工程" eyebrow="从原文开始" width={760}>
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <Stepper steps={steps} current={step} />
      </div>

      <Card style={{ padding: 'var(--space-6)' }}>
        {step === 0 ? (
          <StepFiles files={files} setFiles={setFiles} folder={folder} setFolder={setFolder} placement={placement} setPlacement={setPlacement} />
        ) : step === 1 ? (
          <StepReview info={info} setInfo={setInfo} chapters={chapters} setChapters={setChapters} vols={vols} setVols={setVols} />
        ) : (
          <StepSettings
            strength={strength}
            setStrength={setStrength}
            density={density}
            setDensity={setDensity}
            requirement={requirement}
            setRequirement={setRequirement}
            pauseOnRef={pauseOnRef}
            setPauseOnRef={setPauseOnRef}
          />
        )}
      </Card>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'var(--space-5)' }}>
        <div>
          {step > 0 ? (
            <Button variant="ghost" icon="arrow_back" onClick={() => setStep(step - 1)}>
              上一步
            </Button>
          ) : null}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          {step === 1 ? (
            <Button variant="ghost" onClick={() => setStep(2)}>
              跳过核对
            </Button>
          ) : null}
          {step < 2 ? (
            <Button
              variant="primary"
              icon="arrow_forward"
              disabled={step === 0 && !hasText}
              title={step === 0 && !hasText ? '先选至少一份原文文件' : undefined}
              onClick={() => setStep(step + 1)}
            >
              下一步
            </Button>
          ) : (
            <Button variant="primary" icon="auto_fix_high" onClick={finish}>
              开始制作
            </Button>
          )}
        </div>
      </div>
    </Page>
  )
}
