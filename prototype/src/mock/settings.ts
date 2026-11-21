// 设置页与引导页共用的模型配置 mock：五个模型、接口格式、内置模型目录。

/** 文本模型支持的接口格式；选中时预填官方地址 */
export type ApiFormat = 'openai-chat' | 'openai-responses' | 'anthropic'

export const apiFormats: { value: ApiFormat; label: string; defaultBase: string }[] = [
  { value: 'openai-chat', label: 'OpenAI Chat Completions', defaultBase: 'https://api.openai.com/v1' },
  { value: 'openai-responses', label: 'OpenAI Responses', defaultBase: 'https://api.openai.com/v1' },
  { value: 'anthropic', label: 'Anthropic Messages', defaultBase: 'https://api.anthropic.com' },
]

export const defaultBaseUrl = (format: ApiFormat) => apiFormats.find((f) => f.value === format)?.defaultBase ?? ''

/** 文本模型「兼容哪家」：决定请求形状；「自动」按接口地址猜 */
export type CompatPreset = 'auto' | 'openai' | 'deepseek' | 'qwen' | 'zhipu' | 'openrouter' | 'anthropic-compat'

export const compatPresets: { value: CompatPreset; label: string; defaultBase: string }[] = [
  { value: 'auto', label: '自动', defaultBase: '' },
  { value: 'openai', label: 'OpenAI', defaultBase: 'https://api.openai.com/v1' },
  { value: 'deepseek', label: 'DeepSeek', defaultBase: 'https://api.deepseek.com/v1' },
  { value: 'qwen', label: '通义千问', defaultBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { value: 'zhipu', label: '智谱', defaultBase: 'https://open.bigmodel.cn/api/paas/v4' },
  { value: 'openrouter', label: 'OpenRouter', defaultBase: 'https://openrouter.ai/api/v1' },
  { value: 'anthropic-compat', label: '兼容 Anthropic', defaultBase: 'https://api.anthropic.com' },
]

/** 五个模型位 */
export type ModelSlot = 'fast' | 'main' | 'writing' | 'visual' | 'image'

export const modelSlots: { id: ModelSlot; label: string; icon: string }[] = [
  { id: 'fast', label: '快速模型', icon: 'bolt' },
  { id: 'main', label: '主模型', icon: 'psychology' },
  { id: 'writing', label: '写作模型', icon: 'edit_note' },
  { id: 'visual', label: '视觉模型', icon: 'visibility' },
  { id: 'image', label: '图片模型', icon: 'image' },
]

export const modelSlotLabel = (slot: ModelSlot) => modelSlots.find((s) => s.id === slot)?.label ?? slot

/** 文本模型配置；「兼容」决定请求形状，接口格式决定地址怎么拼、上下文长度可以从内置目录自动填 */
export interface TextModelConfig {
  /** 兼容哪家（默认自动） */
  compat: CompatPreset
  format: ApiFormat
  base: string
  model: string
  context: string
  key: string
  /** 主模型 / 写作 / 视觉可以一键沿用快速模型的格式、兼容、地址和 Key */
  inheritFast: boolean
}

/** 内置模型目录：按模型名查到上下文长度（原型假数据） */
export const contextCatalog: Record<string, number> = {
  'gpt-5.2': 400000,
  'gpt-5-mini': 272000,
  'claude-sonnet-4-6': 200000,
  'claude-haiku-4-5': 200000,
  'gemini-3-pro': 1048576,
  'gemini-3-flash': 1048576,
  'qwen3-max': 262144,
  'qwen3-flash': 262144,
  'deepseek-v4': 131072,
}

export const defaultTextConfig = (slot: Exclude<ModelSlot, 'image'>): TextModelConfig => {
  const seed: Record<Exclude<ModelSlot, 'image'>, string> = {
    fast: 'qwen3-flash',
    main: 'claude-sonnet-4-6',
    writing: 'claude-sonnet-4-6',
    visual: 'gemini-3-flash',
  }
  return { compat: 'auto', format: 'openai-chat', base: defaultBaseUrl('openai-chat'), model: seed[slot], context: '', key: '', inheritFast: slot !== 'fast' }
}

export type ImageApiShape = 'openai-images' | 'other'
export type ImageEditSupport = 'yes' | 'no' | 'unknown'
export type ImageTransparentSupport = 'yes' | 'no' | 'unknown'
export type ImageSizeRule = 'free' | 'tiers' | 'enum'
export type ImageQuality = 'high' | 'medium' | 'low'
export type UpscaleTier = 'anime' | 'fast'

export interface ImageModelConfig {
  base: string
  model: string
  key: string
  /** 同时出图数（默认 8） */
  concurrency: string
  /** 一张图检查不通过后最多重画几次，用完用占位图并标“需要处理”（默认 3） */
  retries: string
  /** 生图质量：高 / 中 / 低（默认高；协议形状为 OpenAI images 时发送） */
  quality: ImageQuality
  /** 原生长边上限（像素，默认 1536） */
  nativeMaxEdge: string
  /** 协议形状：填地址时按预设自动套 */
  api: ImageApiShape
  /** 能不能图片编辑 / 出透明底（用户声明，影响测试预期和可用功能） */
  canEdit: ImageEditSupport
  transparent: ImageTransparentSupport
  /** 尺寸规则 */
  sizeRule: ImageSizeRule
  /** 后处理（放大降噪）开关 */
  postProcess: boolean
  /** 放大档位 */
  upscaleTier: UpscaleTier
}

export const defaultImageConfig = (): ImageModelConfig => ({
  base: 'https://api.openai.com/v1',
  model: 'gpt-image-2.6-sunburst',
  key: '',
  concurrency: '8',
  retries: '3',
  quality: 'high',
  nativeMaxEdge: '1536',
  api: 'openai-images',
  canEdit: 'yes',
  transparent: 'yes',
  sizeRule: 'free',
  postProcess: true,
  upscaleTier: 'anime',
})

/** 图片模型 4 项声明与质量/放大选项 */
export const imageApiOptions: { value: ImageApiShape; label: string }[] = [
  { value: 'openai-images', label: 'OpenAI images 协议' },
  { value: 'other', label: '其他' },
]

export const imageDeclOptions = {
  canEdit: [
    { value: 'yes', label: '支持' },
    { value: 'no', label: '仅文生图' },
    { value: 'unknown', label: '不确定' },
  ] as { value: ImageEditSupport; label: string }[],
  transparent: [
    { value: 'yes', label: '支持' },
    { value: 'no', label: '不支持' },
    { value: 'unknown', label: '不确定' },
  ] as { value: ImageTransparentSupport; label: string }[],
  sizeRule: [
    { value: 'free', label: '任意 WxH' },
    { value: 'tiers', label: '分辨率档位' },
    { value: 'enum', label: '固定枚举' },
  ] as { value: ImageSizeRule; label: string }[],
}

export const imageQualityOptions: { value: ImageQuality; label: string }[] = [
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' },
]

export const upscaleTierOptions: { value: UpscaleTier; label: string }[] = [
  { value: 'anime', label: '动漫模型（默认）' },
  { value: 'fast', label: '快速档' },
]

/** 按接口地址域名自动套预设；认不出的域名回退到通用 OpenAI 兼容声明 */
export const imagePresetFor = (
  base: string,
): { api: ImageApiShape; canEdit: ImageEditSupport; transparent: ImageTransparentSupport; sizeRule: ImageSizeRule } | null => {
  const b = base.trim().toLowerCase()
  if (!b) return null
  if (b.includes('openai.com')) return { api: 'openai-images', canEdit: 'yes', transparent: 'yes', sizeRule: 'free' }
  if (b.includes('volces.com') || b.includes('ark.cn')) return { api: 'other', canEdit: 'yes', transparent: 'unknown', sizeRule: 'tiers' }
  if (b.includes('dashscope') || b.includes('aliyuncs.com')) return { api: 'other', canEdit: 'yes', transparent: 'unknown', sizeRule: 'free' }
  if (b.includes('googleapis.com') || b.includes('generativelanguage')) return { api: 'other', canEdit: 'no', transparent: 'no', sizeRule: 'tiers' }
  if (b.includes('siliconflow')) return { api: 'other', canEdit: 'unknown', transparent: 'no', sizeRule: 'enum' }
  return { api: 'openai-images', canEdit: 'unknown', transparent: 'unknown', sizeRule: 'free' }
}

/** 图片模型能力测试：文生图、透明底、图片编辑三项各给一个结果 */
export type ImageCapability = 't2i' | 'transparent' | 'edit'

export const imageCapabilityTests: { id: ImageCapability; label: string }[] = [
  { id: 't2i', label: '文生图' },
  { id: 'transparent', label: '透明底' },
  { id: 'edit', label: '图片编辑' },
]

export type CapabilityState = 'testing' | 'ok' | 'unsupported' | 'fail'

/** 演示：模型名带 dalle / sd / flux 的不支持透明底，带 dalle 的不支持图片编辑 */
export const imageCapabilitySupport = (model: string, cap: ImageCapability): boolean => {
  const m = model.toLowerCase()
  if (cap === 'transparent') return !['dalle', 'sd', 'flux'].some((k) => m.includes(k))
  if (cap === 'edit') return !['dalle'].some((k) => m.includes(k))
  return true
}

// ---- 高级设置 ----

/** Agent 角色（这里可以出现在界面上） */
export const agentRoles: { id: string; label: string; slot: ModelSlot }[] = [
  { id: 'organizer', label: '整理', slot: 'fast' },
  { id: 'director', label: '主控', slot: 'main' },
  { id: 'writer', label: '写手', slot: 'writing' },
  { id: 'reviewer-script', label: '审稿', slot: 'main' },
  { id: 'artist', label: '美术导演', slot: 'main' },
  { id: 'painter-portrait', label: '立绘画师', slot: 'main' },
  { id: 'painter-scene', label: '场景画师', slot: 'main' },
  { id: 'painter-variant', label: '差分画师', slot: 'fast' },
  { id: 'reviewer-visual', label: '视觉审核', slot: 'visual' },
]

/** 写手预设：文风与输出约束，作品可改选或在默认上改几项 */
export interface WriterPreset {
  id: string
  name: string
  isDefault: boolean
  style: string
  constraints: string
  /** 可选采样参数（温度等）；空字符串表示不设 */
  sampling: { temperature: string; topP: string; maxTokens: string }
  /** 输出替换规则：写完剧本后按列表查找替换 */
  replacements: { find: string; replace: string }[]
}

export const defaultWriterPresets: WriterPreset[] = [
  {
    id: 'default',
    name: '默认',
    isDefault: true,
    style: '叙述简洁，少修饰。对白贴合角色口吻，不堆形容词。',
    constraints: '一章 3-6 个场景。一句一行。场景切换处用换场标记。',
    sampling: { temperature: '0.9', topP: '', maxTokens: '' },
    replacements: [{ find: '……', replace: '…' }],
  },
]

/** 图片保存格式：有损（默认）/ 无损 */
export type ImageFormat = 'lossy' | 'lossless'
