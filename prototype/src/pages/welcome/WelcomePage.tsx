import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Icon } from '../../components/Button'
import { RadioGroup, Tooltip } from '../../components/Extended'
import { Field, TextInput } from '../../components/Form'
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
        animation: 'fade-up 0.25s ease',
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
        flex: 1,
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
        className="neu-button"
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

/** 模型配置行：名称 + 模型名 + API Key */
function ModelRow({ label, model, key_, onModel, onKey, secret }: {
  label: string
  model: string
  key_: string
  onModel: (v: string) => void
  onKey: (v: string) => void
  secret?: boolean
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '88px 1fr 1fr', gap: 'var(--space-3)', alignItems: 'end' }}>
      <span className="label-caps label-caps-zh" style={{ color: 'var(--color-on-surface-variant)', paddingBottom: 11 }}>
        {label}
      </span>
      <TextInput value={model} onChange={onModel} placeholder="模型名称" />
      <TextInput value={key_} onChange={onKey} placeholder={secret ? 'API Key' : '接口地址或 Key'} type="password" />
    </div>
  )
}

export function WelcomePage() {
  const navigate = useNavigate()
  const toast = useToast()
  const [step, setStep] = useState(0)
  const [lang, setLang] = useState('zh-Hans')
  const [path, setPath] = useState<'create' | 'play'>('create')
  const [models, setModels] = useState({ fast: '', fastKey: '', creative: '', creativeKey: '', image: '', imageKey: '' })
  const set = (k: keyof typeof models) => (v: string) => setModels((m) => ({ ...m, [k]: v }))

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
        <StepCard>
          <Dots total={3} current={0} />
          <h1 className="headline" style={{ fontSize: 24, marginBottom: 'var(--space-5)' }}>欢迎使用 Novelive</h1>
          <Field label="界面语言">
            <RadioGroup
              value={lang}
              onChange={setLang}
              options={[
                { value: 'zh-Hans', label: '简体中文' },
                { value: 'zh-Hant', label: '繁體中文' },
                { value: 'en', label: 'English' },
                { value: 'ja', label: '日本語' },
              ]}
            />
          </Field>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-6)' }}>
            <Button variant="primary" onClick={() => setStep(1)}>
              继续
            </Button>
          </div>
        </StepCard>
      ) : null}

      {step === 1 ? (
        <StepCard>
          <Dots total={3} current={1} />
          <h1 className="headline" style={{ fontSize: 24, marginBottom: 'var(--space-5)' }}>创作还是游玩</h1>
          <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
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
        <StepCard>
          <Dots total={3} current={2} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--space-5)' }}>
            <h1 className="headline" style={{ fontSize: 24 }}>模型配置</h1>
            <Tooltip text="Key 只保存在本机配置文件中">
              <Icon name="info" size={15} style={{ color: 'var(--color-outline)' }} />
            </Tooltip>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <ModelRow label="快速模型" model={models.fast} key_={models.fastKey} onModel={set('fast')} onKey={set('fastKey')} secret />
            <ModelRow label="创作模型" model={models.creative} key_={models.creativeKey} onModel={set('creative')} onKey={set('creativeKey')} secret />
            <ModelRow label="图片模型" model={models.image} key_={models.imageKey} onModel={set('image')} onKey={set('imageKey')} />
          </div>
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

      <span className="label-caps label-caps-zh" style={{ color: 'var(--color-outline)' }}>
        小说 → 视觉小说 · 创作与游玩一体
      </span>
    </div>
  )
}
