import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Icon, Spinner } from '../../components/Button'
import { Card } from '../../components/Card'
import { ConfirmDialog, RadioGroup } from '../../components/Extended'
import { CompactSelect, Field, SectionLabel, TextInput, textareaStyle } from '../../components/Form'
import { Modal } from '../../components/Modal'
import { Collapse } from '../../components/Motion'
import { Page } from '../../components/Page'
import { useToast } from '../../components/Toast'
import {
  agentRoles,
  apiFormats,
  compatPresets,
  contextCatalog,
  defaultBaseUrl,
  defaultImageConfig,
  defaultTextConfig,
  defaultWriterPresets,
  imageCapabilityOutcome,
  imageCapabilityTests,
  imageQualityOptions,
  modelSlots,
  nativeMaxEdgeOptions,
  postProcessOptions,
  upscaleTierOptions,
  upscaleTierHints,
  type CapabilityResult,
  type CapabilityState,
  type CompatPreset,
  type ImageCapability,
  type ImageQuality,
  type ModelSlot,
  type PostProcessMode,
  type TextModelConfig,
  type UpscaleTier,
  type WriterPreset,
} from '../../mock/settings'
import { useTheme, type ThemeMode } from '../../shell/theme'

/** 设置行：图标 + 标题 + 右侧控件 */
function SettingRow({ icon, title, control }: { icon: string; title: string; control: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px' }}>
      <div
        className="glass-panel"
        style={{
          width: 36,
          height: 36,
          borderRadius: 'var(--radius-md)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-on-surface-variant)',
          flexShrink: 0,
        }}
      >
        <Icon name={icon} size={19} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13.5 }}>{title}</div>
      </div>
      <div style={{ flexShrink: 0 }}>{control}</div>
    </div>
  )
}

function RowDivider() {
  return <div style={{ height: 1, background: 'var(--divider)', margin: '0 18px' }} />
}

type TestState = 'idle' | 'testing' | 'ok' | 'fail'

const failText = '连接失败 · 检查接口地址、API Key、模型名'

const testMeta: Record<Exclude<TestState, 'idle'>, { text: string; icon: string; color: string }> = {
  testing: { text: '正在测试…', icon: 'progress_activity', color: 'var(--color-on-surface-variant)' },
  ok: { text: '连接成功', icon: 'check_circle', color: 'var(--color-success)' },
  fail: { text: failText, icon: 'error', color: 'var(--color-on-error-container)' },
}

/** 模型卡：收起时只有摘要行（图标 / 名称 / 当前模型 / 测试），点开才编辑 */
function ModelCard({
  icon,
  title,
  summary,
  configured,
  test,
  onTest,
  result,
  children,
}: {
  icon: string
  title: string
  /** 收起时的一行摘要，如接口地址与模型名 */
  summary: string
  configured: boolean
  test: TestState
  onTest: () => void
  /** 测试成功后显示在编辑区的内容（图片描述 / 缩略图） */
  result?: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const m = test === 'idle' ? null : testMeta[test]
  return (
    <Card style={{ padding: 0 }}>
      <div
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            setOpen((v) => !v)
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        style={{ display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left', padding: 'var(--space-4) var(--space-5)', minHeight: 52, cursor: 'pointer' }}
      >
        <div
          className="glass-panel"
          style={{
            width: 36, height: 36, borderRadius: 'var(--radius-md)', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-primary)',
          }}
        >
          <Icon name={icon} size={19} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>{title}</div>
          <div style={{ fontSize: 12, color: 'var(--color-outline)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {summary}
          </div>
        </div>
        <span style={{ fontSize: 12, color: configured ? 'var(--color-success)' : 'var(--color-outline)', whiteSpace: 'nowrap' }}>
          {configured ? '已配置' : '未配置'}
        </span>
        <span
          onClick={(e) => e.stopPropagation()}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
        >
          <Button size="sm" icon="cable" loading={test === 'testing'} onClick={onTest}>
            测试
          </Button>
          {m ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: m.color, whiteSpace: 'nowrap' }}>
              {test === 'testing' ? <Spinner size={13} /> : <Icon name={m.icon} size={14} />}
              {m.text}
            </span>
          ) : null}
        </span>
        <span className="nl-chevron" data-open={open} style={{ display: 'inline-flex', color: 'var(--color-outline)' }}>
          <Icon name="expand_more" size={18} />
        </span>
      </div>
      <Collapse open={open}>
        <div style={{ padding: '0 var(--space-5) var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {result ?? null}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>{children}</div>
        </div>
      </Collapse>
    </Card>
  )
}

/** 视觉模型测试成功：模型对小图的描述 */
function VisualTestResult() {
  return (
    <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
      <div
        style={{
          width: 72,
          height: 48,
          borderRadius: 'var(--radius-md)',
          flexShrink: 0,
          background: 'linear-gradient(150deg, var(--color-surface-container-highest), var(--color-primary-container))',
        }}
      />
      <p style={{ fontSize: 13, color: 'var(--color-on-surface-variant)', lineHeight: 1.7 }}>
        「雾气笼罩的港口，灰蓝色水面，一艘小船亮着灯。」
      </p>
    </div>
  )
}

/** 图片模型测试：依次测文生图、透明底、图片编辑，三项各自显示结果、缩略图或失败原因 */
function ImageTestResult({
  caps,
}: {
  caps: Record<ImageCapability, CapabilityResult>
}) {
  const active = imageCapabilityTests.some((c) => caps[c.id].state !== 'idle')
  if (!active) return null

  const meta: Record<CapabilityState, { icon: string; text: string; color: string }> = {
    testing: { icon: 'progress_activity', text: '进行中', color: 'var(--color-on-surface-variant)' },
    ok: { icon: 'check_circle', text: '通过', color: 'var(--color-success)' },
    unsupported: { icon: 'error', text: '不支持', color: 'var(--color-on-error-container)' },
    fail: { icon: 'error', text: '失败', color: 'var(--color-on-error-container)' },
  }

  const thumb = (cap: ImageCapability) => {
    const baseStyle = {
      width: '100%',
      height: 60,
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--white-60)',
    }
    if (cap === 't2i') {
      return (
        <div
          style={{
            ...baseStyle,
            background: 'linear-gradient(150deg, var(--color-primary-container), var(--color-surface-container-highest))',
          }}
        />
      )
    }
    if (cap === 'transparent') {
      return (
        <div
          style={{
            ...baseStyle,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'var(--color-surface-container-lowest)',
            backgroundImage:
              'linear-gradient(45deg, var(--color-surface-container-highest) 25%, transparent 25%), linear-gradient(-45deg, var(--color-surface-container-highest) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--color-surface-container-highest) 75%), linear-gradient(-45deg, transparent 75%, var(--color-surface-container-highest) 75%)',
            backgroundSize: '12px 12px',
            backgroundPosition: '0 0, 0 6px, 6px -6px, -6px 0',
          }}
        >
          <div
            style={{
              width: 24,
              height: 36,
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-primary-container)',
              opacity: 0.85,
            }}
          />
        </div>
      )
    }
    return (
      <div
        style={{
          ...baseStyle,
          background: 'linear-gradient(135deg, var(--color-secondary-container), var(--color-primary-container))',
        }}
      />
    )
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-3)' }}>
      {imageCapabilityTests.map((c) => {
        const { state: s, reason } = caps[c.id]
        if (s === 'idle') return null
        const fallbackReason = s === 'unsupported' ? '当前模型不支持此项' : s === 'fail' ? '请求失败' : undefined
        const detail = reason ?? fallbackReason
        return (
          <div
            key={c.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)',
              padding: 'var(--space-3)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--white-40)',
              border: '1px solid var(--white-60)',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: meta[s].color }}>
              {s === 'testing' ? <Spinner size={13} /> : <Icon name={meta[s].icon} size={14} />}
              {c.label} · {meta[s].text}
            </span>
            {s === 'ok' ? thumb(c.id) : null}
            {(s === 'fail' || s === 'unsupported') && detail ? (
              <span style={{ fontSize: 12, color: 'var(--color-on-error-container)', lineHeight: 1.5 }}>{detail}</span>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

/** 文本模型字段；canInherit 的槽位可以一键沿用快速模型的格式、兼容、地址和 Key */
function TextModelFields({
  slot,
  config,
  fast,
  onChange,
}: {
  slot: Exclude<ModelSlot, 'image'>
  config: TextModelConfig
  fast: TextModelConfig
  onChange: (c: TextModelConfig) => void
}) {
  const inherit = slot !== 'fast' && config.inheritFast
  return (
    <>
      <Field label="兼容哪家">
        <CompactSelect
          value={inherit ? fast.compat : config.compat}
          disabled={inherit}
          onChange={(v) => {
            const preset = compatPresets.find((p) => p.value === v)
            onChange({
              ...config,
              compat: v as CompatPreset,
              ...(preset && preset.value !== 'auto' ? { base: preset.defaultBase } : {}),
            })
          }}
          options={compatPresets.map((p) => ({ value: p.value, label: p.label }))}
        />
      </Field>
      <Field label="接口格式">
        <CompactSelect
          value={inherit ? fast.format : config.format}
          disabled={inherit}
          onChange={(v) => onChange({ ...config, format: v as TextModelConfig['format'], base: defaultBaseUrl(v as TextModelConfig['format']) })}
          options={apiFormats.map((f) => ({ value: f.value, label: f.label }))}
        />
      </Field>
      {slot !== 'fast' ? (
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <Button size="sm" icon={config.inheritFast ? 'check_box' : 'check_box_outline_blank'} onClick={() => onChange({ ...config, inheritFast: !config.inheritFast })}>
            同快速模型
          </Button>
        </div>
      ) : null}
      <Field label="接口地址">
        <TextInput value={inherit ? fast.base : config.base} disabled={inherit} placeholder="https://…" onChange={(v) => onChange({ ...config, base: v })} />
      </Field>
      <Field label="模型名">
        <TextInput value={config.model} placeholder="模型名" onChange={(v) => onChange({ ...config, model: v })} />
      </Field>
      <Field label="上下文长度" hint={contextCatalog[config.model.trim()] ? undefined : '目录里没有，可以手填'}>
        <TextInput
          value={contextCatalog[config.model.trim()] ? String(contextCatalog[config.model.trim()]) : config.context}
          placeholder="如 200000"
          onChange={(v) => onChange({ ...config, context: v })}
        />
      </Field>
      <Field label="API Key">
        <TextInput type="password" value={inherit ? fast.key : config.key} disabled={inherit} placeholder="sk-…" onChange={(v) => onChange({ ...config, key: v })} />
      </Field>
    </>
  )
}

/** 写手预设编辑弹窗 */
function PresetEditor({ preset, onClose, onSave }: { preset: WriterPreset; onClose: () => void; onSave: (p: WriterPreset) => void }) {
  const [draft, setDraft] = useState(preset)
  const set = (patch: Partial<WriterPreset>) => setDraft((d) => ({ ...d, ...patch }))
  return (
    <Modal
      open
      title={preset.id ? `写手预设 · ${preset.name}` : '新建写手预设'}
      onClose={onClose}
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={() => onSave(draft)}>保存</Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <Field label="名称">
          <TextInput value={draft.name} onChange={(v) => set({ name: v })} />
        </Field>
        <Field label="文风说明">
          <textarea style={{ ...textareaStyle, minHeight: 72 }} value={draft.style} onChange={(e) => set({ style: e.target.value })} />
        </Field>
        <Field label="输出约束">
          <textarea style={{ ...textareaStyle, minHeight: 72 }} value={draft.constraints} onChange={(e) => set({ constraints: e.target.value })} />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-3)' }}>
          <Field label="温度（可选）">
            <TextInput value={draft.sampling.temperature} placeholder="不设" onChange={(v) => set({ sampling: { ...draft.sampling, temperature: v } })} />
          </Field>
          <Field label="Top-P（可选）">
            <TextInput value={draft.sampling.topP} placeholder="不设" onChange={(v) => set({ sampling: { ...draft.sampling, topP: v } })} />
          </Field>
          <Field label="最大输出（可选）">
            <TextInput value={draft.sampling.maxTokens} placeholder="不设" onChange={(v) => set({ sampling: { ...draft.sampling, maxTokens: v } })} />
          </Field>
        </div>
        <Field label="输出替换规则">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {draft.replacements.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                <TextInput value={r.find} placeholder="查找" onChange={(v) => set({ replacements: draft.replacements.map((x, j) => (j === i ? { ...x, find: v } : x)) })} />
                <Icon name="arrow_forward" size={14} style={{ color: 'var(--color-outline)', flexShrink: 0 }} />
                <TextInput value={r.replace} placeholder="替换为" onChange={(v) => set({ replacements: draft.replacements.map((x, j) => (j === i ? { ...x, replace: v } : x)) })} />
                <button
                  onClick={() => set({ replacements: draft.replacements.filter((_, j) => j !== i) })}
                  style={{ display: 'flex', padding: 5, color: 'var(--color-outline)', flexShrink: 0 }}
                  title="删除"
                >
                  <Icon name="close" size={15} />
                </button>
              </div>
            ))}
            <Button size="sm" icon="add" style={{ alignSelf: 'flex-start' }} onClick={() => set({ replacements: [...draft.replacements, { find: '', replace: '' }] })}>
              加一条
            </Button>
          </div>
        </Field>
      </div>
    </Modal>
  )
}

export function SettingsPage() {
  const toast = useToast()
  const { mode, setMode } = useTheme()

  const [texts, setTexts] = useState<Record<Exclude<ModelSlot, 'image'>, TextModelConfig>>({
    fast: defaultTextConfig('fast'),
    main: defaultTextConfig('main'),
    writing: defaultTextConfig('writing'),
    visual: defaultTextConfig('visual'),
  })
  const [image, setImage] = useState(defaultImageConfig())
  const [tests, setTests] = useState<Record<ModelSlot, TestState>>({ fast: 'idle', main: 'idle', writing: 'idle', visual: 'idle', image: 'idle' })
  const [caps, setCaps] = useState<Record<ImageCapability, CapabilityResult>>({
    t2i: { state: 'idle' },
    transparent: { state: 'idle' },
    edit: { state: 'idle' },
  })
  const [advanced, setAdvanced] = useState(false)
  const [roleModel, setRoleModel] = useState<Record<string, ModelSlot>>(Object.fromEntries(agentRoles.map((r) => [r.id, r.slot])))
  const [presets, setPresets] = useState<WriterPreset[]>(defaultWriterPresets)
  const [editing, setEditing] = useState<WriterPreset | null>(null)
  const [deletingPreset, setDeletingPreset] = useState<WriterPreset | null>(null)
  const [licensesOpen, setLicensesOpen] = useState(false)
  const [imageFormat, setImageFormat] = useState<'lossy' | 'lossless'>('lossy')
  const [lang, setLang] = useState('zh-Hans')
  const [folder] = useState('~/文档/Novelive')
  const timersRef = useRef<number[]>([])

  const schedule = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timersRef.current = timersRef.current.filter((t) => t !== id)
      fn()
    }, ms)
    timersRef.current.push(id)
  }

  useEffect(() => () => {
    timersRef.current.forEach((id) => window.clearTimeout(id))
    timersRef.current = []
  }, [])
  const setText = (slot: Exclude<ModelSlot, 'image'>) => (c: TextModelConfig) => {
    setTexts((t) => ({ ...t, [slot]: c }))
    setTests((t) => ({ ...t, [slot]: 'idle' }))
  }

  const textReady = (slot: Exclude<ModelSlot, 'image'>) => {
    const c = texts[slot]
    const inherit = slot !== 'fast' && c.inheritFast
    const base = inherit ? texts.fast.base : c.base
    const key = inherit ? texts.fast.key : c.key
    return base.trim().length > 0 && key.trim().length > 0 && c.model.trim().length > 0
  }

  const runTest = (slot: ModelSlot) => {
    if (slot === 'image') {
      const ok = image.key.trim().length > 0 && image.base.trim().length > 0 && image.model.trim().length > 0
      setTests((t) => ({ ...t, image: 'testing' }))
      setCaps({ t2i: { state: 'idle' }, transparent: { state: 'idle' }, edit: { state: 'idle' } })
      if (!ok) {
        schedule(() => setTests((t) => ({ ...t, image: 'fail' })), 700)
        return
      }
      // 依次试文生图、透明底、图片编辑，三项分别出结果
      imageCapabilityTests.forEach((c, i) => {
        schedule(() => {
          setCaps((prev) => (prev[c.id].state === 'idle' ? { ...prev, [c.id]: { state: 'testing' } } : prev))
          schedule(() => {
            const outcome = imageCapabilityOutcome(image.model, c.id)
            setCaps((prev) => (prev[c.id].state === 'testing' ? { ...prev, [c.id]: outcome } : prev))
            if (i === imageCapabilityTests.length - 1) {
              setTests((t) => ({ ...t, image: 'ok' }))
            }
          }, 500)
        }, i * 700)
      })
      return
    }
    setTests((t) => ({ ...t, [slot]: 'testing' }))
    const ok = textReady(slot)
    schedule(() => setTests((t) => ({ ...t, [slot]: ok ? 'ok' : 'fail' })), 700)
  }

  const setImageField = (patch: Partial<typeof image>) => {
    setImage((img) => ({ ...img, ...patch }))
    setTests((t) => ({ ...t, image: 'idle' }))
    setCaps({ t2i: { state: 'idle' }, transparent: { state: 'idle' }, edit: { state: 'idle' } })
  }

  const savePreset = (p: WriterPreset) => {
    setPresets((list) => (list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? p : x)) : [...list, p]))
    setEditing(null)
    toast('写手预设已保存', 'check')
  }

  const textSummary = (slot: Exclude<ModelSlot, 'image'>) => {
    const c = texts[slot]
    const inherit = slot !== 'fast' && c.inheritFast
    const format = inherit ? texts.fast.format : c.format
    return `${c.model || '未填模型'} · ${apiFormats.find((f) => f.value === format)?.label ?? format}${inherit ? ' · 同快速模型' : ''}`
  }

  return (
    <Page title="设置" width={760}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-7)' }}>
        <section>
          <SectionLabel>模型</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {modelSlots.filter((s) => s.id !== 'image').map((s) => (
              <ModelCard
                key={s.id}
                icon={s.icon}
                title={s.label}
                summary={textSummary(s.id as Exclude<ModelSlot, 'image'>)}
                configured={textReady(s.id as Exclude<ModelSlot, 'image'>)}
                test={tests[s.id]}
                onTest={() => runTest(s.id)}
                result={tests[s.id] === 'ok' && s.id === 'visual' ? <VisualTestResult /> : undefined}
              >
                <TextModelFields slot={s.id as Exclude<ModelSlot, 'image'>} config={texts[s.id as Exclude<ModelSlot, 'image'>]} fast={texts.fast} onChange={setText(s.id as Exclude<ModelSlot, 'image'>)} />
              </ModelCard>
            ))}
            <ModelCard
              icon="image"
              title="图片模型"
              summary={image.model || '未填模型'}
              configured={image.key.trim().length > 0 && image.base.trim().length > 0 && image.model.trim().length > 0}
              test={tests.image}
              onTest={() => runTest('image')}
              result={tests.image !== 'idle' ? <ImageTestResult caps={caps} /> : undefined}
            >
              <Field label="接口地址">
                <TextInput
                  value={image.base}
                  placeholder="https://…/v1"
                  onChange={(v) => setImageField({ base: v })}
                />
              </Field>
              <Field label="模型名">
                <TextInput value={image.model} onChange={(v) => setImageField({ model: v })} />
              </Field>
              <div style={{ gridColumn: '1 / -1' }}>
                <Field label="API Key">
                  <TextInput type="password" value={image.key} placeholder="sk-…" onChange={(v) => setImageField({ key: v })} />
                </Field>
              </div>
              <Field label="生图质量">
                <CompactSelect
                  value={image.quality}
                  onChange={(v) => setImageField({ quality: v as ImageQuality })}
                  options={imageQualityOptions}
                />
              </Field>
              <Field label="原生长边上限" hint="超出部分由本地放大">
                <CompactSelect
                  value={String(image.nativeMaxEdge)}
                  onChange={(v) => setImageField({ nativeMaxEdge: Number(v) })}
                  options={nativeMaxEdgeOptions}
                />
              </Field>
              <Field label="同时出图数">
                <TextInput value={image.concurrency} onChange={(v) => setImageField({ concurrency: v.replace(/\D/g, '') })} />
              </Field>
              <Field label="生图失败重试次数">
                <TextInput value={image.retries} onChange={(v) => setImageField({ retries: v.replace(/\D/g, '') })} />
              </Field>
              <div
                style={{
                  gridColumn: '1 / -1',
                  borderTop: '1px solid var(--divider)',
                  paddingTop: 'var(--space-4)',
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 'var(--space-4)',
                  alignItems: 'start',
                }}
              >
                <Field
                  label="后处理"
                  hint={image.postProcess === 'double' ? '放大降噪后缩回，再放大降噪一次，线条更清楚也更慢' : undefined}
                >
                  <CompactSelect
                    value={image.postProcess}
                    onChange={(v) => setImageField({ postProcess: v as PostProcessMode })}
                    options={postProcessOptions}
                  />
                </Field>
                <Field label="放大档位" hint={upscaleTierHints[image.upscaleTier]}>
                  <CompactSelect
                    value={image.upscaleTier}
                    disabled={image.postProcess === 'off'}
                    onChange={(v) => setImageField({ upscaleTier: v as UpscaleTier })}
                    options={upscaleTierOptions}
                  />
                </Field>
              </div>
            </ModelCard>
          </div>
        </section>

        <section>
          <button
            type="button"
            aria-expanded={advanced}
            onClick={() => setAdvanced(!advanced)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-on-surface-variant)', marginBottom: 8 }}
          >
            <span className="label-caps label-caps-zh">高级</span>
            <span className="nl-chevron" data-open={advanced} style={{ display: 'inline-flex' }}>
              <Icon name="expand_more" size={16} />
            </span>
          </button>
          <Collapse open={advanced}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <Card style={{ padding: '2px 0' }}>
                {agentRoles.map((role, i) => (
                  <div key={role.id}>
                    {i ? <RowDivider /> : null}
                    <SettingRow
                      icon="bot"
                      title={role.label}
                      control={
                        <CompactSelect
                          value={roleModel[role.id]}
                          onChange={(v) => setRoleModel((m) => ({ ...m, [role.id]: v as ModelSlot }))}
                          options={modelSlots.map((s) => ({ value: s.id, label: `${s.label}${s.id === role.slot ? '（默认）' : ''}` }))}
                        />
                      }
                    />
                  </div>
                ))}
              </Card>

              <Card style={{ padding: 'var(--space-4) var(--space-5)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
                  <span style={{ fontWeight: 700, fontSize: 13.5 }}>写手预设</span>
                  <Button size="sm" icon="add" onClick={() => setEditing({ id: `p${Date.now()}`, name: '', isDefault: false, style: '', constraints: '', sampling: { temperature: '', topP: '', maxTokens: '' }, replacements: [] })}>
                    新建
                  </Button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  {presets.map((p) => (
                    <div key={p.id} className="hover-row" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minHeight: 44, padding: '0 var(--space-2)', borderRadius: 'var(--radius-md)' }}>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>
                        {p.name}
                        {p.isDefault ? <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--color-outline)' }}>全局默认</span> : null}
                      </span>
                      <span className="row-actions" style={{ display: 'flex', gap: 4 }}>
                        {!p.isDefault ? (
                          <Button size="sm" variant="ghost" onClick={() => setPresets((list) => list.map((x) => ({ ...x, isDefault: x.id === p.id })))}>
                            设为默认
                          </Button>
                        ) : null}
                        <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditing(p)}>
                          编辑
                        </Button>
                        <Button size="sm" variant="ghost" icon="description" onClick={() => setPresets((list) => [...list, { ...p, id: `p${Date.now()}`, name: `${p.name} 副本`, isDefault: false }])}>
                          复制
                        </Button>
                        {!p.isDefault ? (
                          <Button size="sm" variant="ghost" icon="delete" onClick={() => setDeletingPreset(p)}>
                            删除
                          </Button>
                        ) : null}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>

              <Card style={{ padding: '2px 0' }}>
                <SettingRow
                  icon="image"
                  title="图片保存格式"
                  control={
                    <RadioGroup
                      value={imageFormat}
                      onChange={(v) => setImageFormat(v as 'lossy' | 'lossless')}
                      options={[
                        { value: 'lossy', label: '有损 WebP（默认）' },
                        { value: 'lossless', label: '无损 WebP' },
                      ]}
                    />
                  }
                />
              </Card>
            </div>
          </Collapse>
        </section>

        <section>
          <SectionLabel>界面</SectionLabel>
          <Card style={{ padding: '2px 0' }}>
            <SettingRow
              icon="language"
              title="界面语言"
              control={
                <CompactSelect
                  value={lang}
                  onChange={(v) => {
                    if (v !== 'zh-Hans') {
                      toast('M5 翻译后启用', 'language')
                      setLang('zh-Hans')
                      return
                    }
                    setLang(v)
                  }}
                  options={[
                    { value: 'zh-Hans', label: '简体中文' },
                    { value: 'zh-Hant', label: '繁體中文（待翻译）' },
                    { value: 'en', label: 'English（待翻译）' },
                    { value: 'ja', label: '日本語（待翻译）' },
                  ]}
                />
              }
            />
            <RowDivider />
            <SettingRow
              icon="contrast"
              title="主题"
              control={
                <CompactSelect
                  value={mode}
                  onChange={(v) => setMode(v as ThemeMode)}
                  options={[
                    { value: 'light', label: '亮' },
                    { value: 'dark', label: '暗' },
                    { value: 'system', label: '跟随系统' },
                  ]}
                />
              }
            />
          </Card>
        </section>

        <section>
          <SectionLabel>工程</SectionLabel>
          <Card style={{ padding: '2px 0' }}>
            <SettingRow
              icon="folder_open"
              title="默认工程位置"
              control={
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, color: 'var(--color-on-surface-variant)' }}>{folder}</span>
                  <Button size="sm" icon="folder" onClick={() => toast('这里会打开目录选择（演示）', 'folder_open')}>
                    更改
                  </Button>
                </div>
              }
            />
          </Card>
        </section>

        <section>
          <SectionLabel>关于</SectionLabel>
          <Card style={{ padding: '14px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Icon name="auto_stories" size={22} style={{ color: 'var(--color-primary)' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Novelive</div>
                <div style={{ fontSize: 12, color: 'var(--color-outline)' }}>把小说改编为视觉小说并直接游玩。</div>
              </div>
              <span style={{ fontSize: 12, color: 'var(--color-outline)' }}>v0.1.0 · AGPL-3.0</span>
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
              <button
                type="button"
                onClick={() => setLicensesOpen(true)}
                style={{ fontSize: 12, color: 'var(--color-primary)', display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0 }}
              >
                第三方许可<Icon name="call_made" size={12} />
              </button>
              <button
                type="button"
                onClick={() => toast('源代码仓库：github.com/novelive/novelive（本地演示）', 'call_made')}
                style={{ fontSize: 12, color: 'var(--color-primary)', display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0 }}
              >
                源代码<Icon name="call_made" size={12} />
              </button>
            </div>
          </Card>
        </section>
      </div>
      {editing ? <PresetEditor preset={editing} onClose={() => setEditing(null)} onSave={savePreset} /> : null}
      <ConfirmDialog
        open={deletingPreset !== null}
        danger
        title="删除写手预设"
        message={deletingPreset ? `确定删除写手预设「${deletingPreset.name}」吗？删除后无法恢复。` : ''}
        confirmLabel="删除"
        onCancel={() => setDeletingPreset(null)}
        onConfirm={() => {
          if (deletingPreset) {
            setPresets((list) => list.filter((x) => x.id !== deletingPreset.id))
            toast(`已删除「${deletingPreset.name}」`, 'delete')
          }
          setDeletingPreset(null)
        }}
      />
      <Modal
        open={licensesOpen}
        title="第三方许可"
        onClose={() => setLicensesOpen(false)}
        width={520}
        footer={<Button variant="primary" onClick={() => setLicensesOpen(false)}>关闭</Button>}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {[
            ['React & React DOM', 'MIT License'],
            ['React Router', 'MIT License'],
            ['lucide-react', 'ISC License'],
            ['CodeMirror 6', 'MIT License'],
            ['Real-ESRGAN', 'BSD-3-Clause License'],
            ['upscayl-bin', 'AGPL-3.0 License'],
            ['Noto Sans SC / Noto Serif SC', 'SIL Open Font License 1.1'],
          ].map(([name, license], idx) => (
            <div
              key={name}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: 'var(--space-2) 0',
                borderTop: idx > 0 ? '1px solid var(--divider)' : 'none',
                fontSize: 13,
              }}
            >
              <span style={{ fontWeight: 600 }}>{name}</span>
              <span style={{ color: 'var(--color-outline)', fontSize: 12 }}>{license}</span>
            </div>
          ))}
        </div>
      </Modal>
    </Page>
  )
}
