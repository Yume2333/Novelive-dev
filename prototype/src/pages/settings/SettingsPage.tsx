import { useState, type ReactNode } from 'react'
import { Button, Icon, Spinner } from '../../components/Button'
import { Card } from '../../components/Card'
import { CompactSelect, Field, SectionLabel, TextInput } from '../../components/Form'
import { Page } from '../../components/Page'
import { useToast } from '../../components/Toast'
import { useTheme, type ThemeMode } from '../../shell/theme'

/** 设置行：图标 + 标题 + 右侧控件 */
function SettingRow({ icon, title, control }: { icon: string; title: string; control: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px' }}>
      <div
        className="neu-button"
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

const testMeta: Record<Exclude<TestState, 'idle'>, { text: string; icon: string; color: string }> = {
  testing: { text: '正在测试…', icon: 'progress_activity', color: 'var(--color-on-surface-variant)' },
  ok: { text: '连接成功', icon: 'check_circle', color: 'var(--color-success)' },
  fail: { text: '连接失败，请检查地址和密钥', icon: 'error', color: 'var(--color-on-error-container)' },
}

/** 三类模型之一：收起时只显示摘要行（图标 / 名称 / 当前模型 / 测试），点开才编辑 */
function ModelCard({
  icon,
  title,
  summary,
  configured,
  test,
  onTest,
  children,
}: {
  icon: string
  title: string
  /** 收起时的一行摘要，如当前服务与模型名 */
  summary: string
  /** 已填 Key 视为已配置 */
  configured: boolean
  test: TestState
  onTest: () => void
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const m = test === 'idle' ? null : testMeta[test]
  return (
    <Card style={{ padding: 0 }}>
      <div
        onClick={() => setOpen(!open)}
        role="button"
        style={{ display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left', padding: 'var(--space-4) var(--space-5)', minHeight: 52, cursor: 'pointer' }}
      >
        <div
          className="neu-button"
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
          <Button size="sm" icon="cable" disabled={test === 'testing'} onClick={onTest}>
            测试
          </Button>
          {m ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: m.color, whiteSpace: 'nowrap' }}>
              {test === 'testing' ? <Spinner size={13} /> : <Icon name={m.icon} size={14} />}
              {m.text}
            </span>
          ) : null}
        </span>
        <Icon name={open ? 'expand_less' : 'expand_more'} size={18} style={{ color: 'var(--color-outline)' }} />
      </div>
      {open ? (
        <div style={{ padding: '0 var(--space-5) var(--space-5)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>{children}</div>
        </div>
      ) : null}
    </Card>
  )
}

const textServices = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'google', label: 'Google' },
  { value: 'qwen', label: '通义千问' },
]

const textModelsByService: Record<string, { value: string; label: string }[]> = {
  anthropic: [
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  ],
  openai: [
    { value: 'gpt-5.2', label: 'GPT-5.2' },
    { value: 'gpt-5-mini', label: 'GPT-5 mini' },
  ],
  google: [
    { value: 'gemini-3-pro', label: 'Gemini 3 Pro' },
    { value: 'gemini-3-flash', label: 'Gemini 3 Flash' },
  ],
  qwen: [
    { value: 'qwen3-max', label: 'Qwen3-Max' },
    { value: 'qwen3-flash', label: 'Qwen3-Flash' },
  ],
}

interface TextModelConfig {
  service: string
  model: string
  key: string
  test: TestState
}

export function SettingsPage() {
  const toast = useToast()
  const { mode, setMode } = useTheme()

  const [fast, setFast] = useState<TextModelConfig>({ service: 'qwen', model: 'qwen3-flash', key: '', test: 'idle' })
  const [creative, setCreative] = useState<TextModelConfig>({ service: 'anthropic', model: 'claude-sonnet-4-6', key: '', test: 'idle' })
  const [image, setImage] = useState({ base: 'https://api.openai.com/v1', model: 'gpt-image-1', key: '', test: 'idle' as TestState })
  const [lang, setLang] = useState('zh-Hans')
  const [folder] = useState('~/文档/Novelive')

  const runTextTest = (config: TextModelConfig, setConfig: (fn: (c: TextModelConfig) => TextModelConfig) => void) => {
    setConfig((c) => ({ ...c, test: 'testing' }))
    const ok = config.key.trim().length > 0
    setTimeout(() => setConfig((c) => ({ ...c, test: ok ? 'ok' : 'fail' })), 700)
  }

  const runImageTest = () => {
    setImage((c) => ({ ...c, test: 'testing' }))
    const ok = image.key.trim().length > 0 && image.base.trim().length > 0
    setTimeout(() => setImage((c) => ({ ...c, test: ok ? 'ok' : 'fail' })), 700)
  }

  const textFields = (config: TextModelConfig, setConfig: (c: TextModelConfig) => void) => (
    <>
      <Field label="服务">
        <CompactSelect
          value={config.service}
          onChange={(v) => setConfig({ ...config, service: v, model: textModelsByService[v][0].value, test: 'idle' })}
          options={textServices}
        />
      </Field>
      <Field label="模型">
        <CompactSelect
          value={config.model}
          onChange={(v) => setConfig({ ...config, model: v, test: 'idle' })}
          options={textModelsByService[config.service]}
        />
      </Field>
      <div style={{ gridColumn: '1 / -1' }}>
        <Field label="API Key">
          <TextInput type="password" value={config.key} placeholder="sk-…" onChange={(v) => setConfig({ ...config, key: v, test: 'idle' })} />
        </Field>
      </div>
    </>
  )

  return (
    <Page title="设置" width={760}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-7)' }}>
        <section>
          <SectionLabel>模型</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <ModelCard
              icon="bolt"
              title="快速模型"
              summary={`${textServices.find((s) => s.value === fast.service)?.label ?? fast.service} · ${textModelsByService[fast.service].find((m) => m.value === fast.model)?.label ?? fast.model}`}
              configured={fast.key.trim().length > 0}
              test={fast.test}
              onTest={() => runTextTest(fast, setFast)}
            >
              {textFields(fast, setFast)}
            </ModelCard>
            <ModelCard
              icon="edit_note"
              title="创作模型"
              summary={`${textServices.find((s) => s.value === creative.service)?.label ?? creative.service} · ${textModelsByService[creative.service].find((m) => m.value === creative.model)?.label ?? creative.model}`}
              configured={creative.key.trim().length > 0}
              test={creative.test}
              onTest={() => runTextTest(creative, setCreative)}
            >
              {textFields(creative, setCreative)}
            </ModelCard>
            <ModelCard
              icon="image"
              title="图片模型"
              summary={image.model}
              configured={image.key.trim().length > 0 && image.base.trim().length > 0}
              test={image.test}
              onTest={runImageTest}
            >
              <Field label="接口地址">
                <TextInput value={image.base} placeholder="https://…/v1" onChange={(v) => setImage({ ...image, base: v, test: 'idle' })} />
              </Field>
              <Field label="模型">
                <TextInput value={image.model} onChange={(v) => setImage({ ...image, model: v, test: 'idle' })} />
              </Field>
              <div style={{ gridColumn: '1 / -1' }}>
                <Field label="API Key">
                  <TextInput type="password" value={image.key} placeholder="sk-…" onChange={(v) => setImage({ ...image, key: v, test: 'idle' })} />
                </Field>
              </div>
            </ModelCard>
          </div>
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
                  onChange={(v) => { setLang(v); toast('界面语言已更新（演示）', 'language') }}
                  options={[
                    { value: 'zh-Hans', label: '简体中文' },
                    { value: 'zh-Hant', label: '繁體中文' },
                    { value: 'en', label: 'English' },
                    { value: 'ja', label: '日本語' },
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
          </Card>
        </section>
      </div>
    </Page>
  )
}
