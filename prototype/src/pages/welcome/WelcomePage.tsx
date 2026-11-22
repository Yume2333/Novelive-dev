import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Icon } from '../../components/Button'
import { Banner, Tooltip } from '../../components/Extended'
import { Field, Select, TextInput } from '../../components/Form'
import { apiFormats, defaultBaseUrl, modelSlots, type ApiFormat } from '../../mock/settings'
import type { CSSProperties, ReactNode } from 'react'
import { useToast } from '../../components/Toast'

/** 居中的玻璃卡片步骤（引导页是整页流程，外壳不带侧边栏） */
function StepCard({ children }: { children: ReactNode }) {
  return (
    <div
      className="glass-panel"
      style={{
        width: '100%',
        maxWidth: 640,
        borderRadius: 'var(--radius-2xl)',
        padding: 'var(--space-7) var(--space-7) var(--space-6)',
        animation: 'fade-up var(--dur-slow) var(--ease-out)',
      }}
    >
      {children}
    </div>
  )
}

const stepDot: CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: 'var(--radius-full)',
  display: 'inline-block',
}

function Dots({ total, current }: { total: number; current: number }) {
  return (
    <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 'var(--space-5)' }}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          style={{
            ...stepDot,
            background: i === current ? 'var(--color-primary)' : 'var(--color-outline-variant)',
            width: i === current ? 18 : 7,
            transition: 'all 0.2s ease',
          }}
        />
      ))}
    </div>
  )
}

/** 两条使用路径的说明卡 */
function PathCard({ icon, title, desc, active, onClick }: {
  icon: string
  title: string
  desc: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: '1 1 200px',
        textAlign: 'left',
        padding: 'var(--space-5)',
        borderRadius: 'var(--radius-xl)',
        border: active ? '1px solid var(--color-primary)' : '1px solid var(--white-80)',
        background: active ? 'var(--accent-wash)' : 'var(--white-40)',
        transition: 'all 0.2s ease',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
      }}
    >
      <span
        className="glass-panel"
        style={{
          width: 38,
          height: 38,
          borderRadius: 'var(--radius-lg)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-primary)',
        }}
      >
        <Icon name={icon} size={19} />
      </span>
      <span style={{ fontWeight: 700, fontSize: 14 }}>{title}</span>
      <span style={{ fontSize: 12, color: 'var(--color-on-surface-variant)', lineHeight: 1.6 }}>{desc}</span>
    </button>
  )
}

/** 模型配置区：接口格式/地址/Key 一组共享，五个文本模型只填模型名，图片模型单独一组 */
function ModelStep() {
  const [format, setFormat] = useState<ApiFormat>('openai-chat')
  const [base, setBase] = useState(defaultBaseUrl('openai-chat'))
  const [key_, setKey] = useState('')
  const [names, setNames] = useState<Record<string, string>>({ fast: '', main: '', writing: '', visual: '' })
  const [img, setImg] = useState({ base: '', model: '', key: '' })
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const timerRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
  }, [])

  const runTest = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
    setTestState('testing')
    const ok = base.trim().length > 0
    timerRef.current = window.setTimeout(() => {
      setTestState(ok ? 'ok' : 'fail')
      timerRef.current = null
    }, 600)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
        <Field label="接口格式">
          <Select
            value={format}
            onChange={(v) => { setFormat(v as ApiFormat); setBase(defaultBaseUrl(v as ApiFormat)); setTestState('idle') }}
            options={apiFormats.map((f) => ({ value: f.value, label: f.label }))}
          />
        </Field>
        <Field label="接口地址">
          <TextInput value={base} onChange={(v) => { setBase(v); setTestState('idle') }} placeholder="https://…" />
        </Field>
      </div>
      <Field label="API Key">
        <TextInput type="password" value={key_} onChange={(v) => { setKey(v); setTestState('idle') }} placeholder="sk-…" />
      </Field>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <Button size="sm" icon="cable" loading={testState === 'testing'} onClick={runTest}>
          测试连接
        </Button>
        {testState === 'ok' ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '3px 8px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-success-container)',
              color: 'var(--color-success)',
              fontSize: 12,
              fontWeight: 600,
              animation: 'fade-in var(--dur-fast) var(--ease-out)',
            }}
          >
            <Icon name="check_circle" size={14} />
            连接成功
          </span>
        ) : null}
        {testState === 'fail' ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '3px 8px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-error-container)',
              color: 'var(--color-on-error-container)',
              fontSize: 12,
              fontWeight: 600,
              animation: 'fade-in var(--dur-fast) var(--ease-out)',
            }}
          >
            <Icon name="error" size={14} />
            请填写接口地址
          </span>
        ) : null}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
        {modelSlots.filter((s) => s.id !== 'image').map((s) => (
          <Field key={s.id} label={s.label}>
            <TextInput value={names[s.id]} onChange={(v) => setNames((n) => ({ ...n, [s.id]: v }))} placeholder="模型名" />
          </Field>
        ))}
      </div>
      <div style={{ borderTop: '1px solid var(--divider)', paddingTop: 'var(--space-4)', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-3)' }}>
        <Field label="图片模型 · 接口地址">
          <TextInput value={img.base} onChange={(v) => setImg({ ...img, base: v })} placeholder="https://…/v1" />
        </Field>
        <Field label="模型名">
          <TextInput value={img.model} onChange={(v) => setImg({ ...img, model: v })} placeholder="模型名" />
        </Field>
        <Field label="API Key">
          <TextInput type="password" value={img.key} onChange={(v) => setImg({ ...img, key: v })} placeholder="sk-…" />
        </Field>
      </div>
    </div>
  )
}


export function WelcomePage() {
  const navigate = useNavigate()
  const toast = useToast()
  const [step, setStep] = useState(0)
  const [lang, setLang] = useState('zh-Hans')
  const [path, setPath] = useState<'create' | 'play'>('create')

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-7)',
        gap: 'var(--space-4)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-1)' }}>
        <img className="brand-mark-light" src="/icon/novelive-mark.svg" alt="" width={28} height={28} />
        <img className="brand-mark-dark" src="/icon/novelive-mark-dark.svg" alt="" width={28} height={28} />
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, letterSpacing: '0.14em' }}>
          NOVELIVE
        </span>
      </div>

      {step === 0 ? (
        <StepCard key={0}>
          <Dots total={3} current={0} />
          <h1 className="headline" style={{ fontSize: 24, marginBottom: 'var(--space-5)' }}>欢迎使用 Novelive</h1>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="label-caps label-caps-zh" style={{ color: 'var(--color-on-surface-variant)' }}>界面语言</span>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              {[
                { value: 'zh-Hans', label: '简体中文', disabled: false },
                { value: 'zh-Hant', label: '繁體中文（待翻译）', disabled: true },
                { value: 'en', label: 'English（待翻译）', disabled: true },
                { value: 'ja', label: '日本語（待翻译）', disabled: true },
              ].map((o) => {
                const active = o.value === lang
                return (
                  <button
                    key={o.value}
                    type="button"
                    disabled={o.disabled}
                    onClick={() => !o.disabled && setLang(o.value)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 7,
                      fontSize: 13,
                      padding: 0,
                      opacity: o.disabled ? 0.5 : 1,
                      cursor: o.disabled ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <span
                      style={{
                        width: 17,
                        height: 17,
                        borderRadius: '50%',
                        border: active ? '5px solid var(--color-primary)' : '1px solid var(--color-outline-variant)',
                        background: 'var(--white-60)',
                        transition: 'all var(--dur-fast, 140ms) var(--ease-out, ease)',
                        boxSizing: 'border-box',
                        flexShrink: 0,
                      }}
                    />
                    {o.label}
                  </button>
                )
              })}
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-6)' }}>
            <Button variant="primary" onClick={() => setStep(1)}>
              继续
            </Button>
          </div>
        </StepCard>
      ) : null}

      {step === 1 ? (
        <StepCard key={1}>
          <Dots total={3} current={1} />
          <h1 className="headline" style={{ fontSize: 24, marginBottom: 'var(--space-5)' }}>创作还是游玩</h1>
          <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
            <PathCard
              icon="auto_stories"
              title="创作"
              active={path === 'create'}
              onClick={() => setPath('create')}
              desc="导入原文，改编成视觉小说"
            />
            <PathCard
              icon="play_circle"
              title="游玩"
              active={path === 'play'}
              onClick={() => setPath('play')}
              desc="导入 .novelive 作品包直接玩"
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-6)' }}>
            <Button variant="ghost" onClick={() => setStep(0)}>
              上一步
            </Button>
            <Button variant="primary" onClick={() => setStep(2)}>
              继续
            </Button>
          </div>
        </StepCard>
      ) : null}

      {step === 2 ? (
        <StepCard key={2}>
          <Dots total={3} current={2} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--space-4)' }}>
            <h1 className="headline" style={{ fontSize: 24 }}>模型配置</h1>
            <Tooltip text="Key 只保存在本机配置文件中">
              <Icon name="info" size={15} style={{ color: 'var(--color-outline)' }} />
            </Tooltip>
          </div>
          {path === 'play' ? (
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <Banner kind="info" icon="play_circle">
                已选「游玩」路线：模型配置为可选项，可直接跳过前往书库导入 .novelive 作品包。
              </Banner>
            </div>
          ) : null}
          <ModelStep />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-6)' }}>
            <Button variant="ghost" onClick={() => setStep(1)}>
              上一步
            </Button>
            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <Button variant="ghost" onClick={() => navigate('/')}>
                跳过
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  toast('已进入书库', 'local_library')
                  navigate('/')
                }}
              >
                完成，进入书库
              </Button>
            </div>
          </div>
        </StepCard>
      ) : null}
    </div>
  )
}
