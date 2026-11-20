// 原型共享的 mock 类型：只放界面上看得到的概念。页面专用的数据放在 mock/<页面>.ts。

/** 章节状态（界面用词：已发布 / 制作中 / 等待 / 需要处理） */
export type ChapterStatus = 'published' | 'producing' | 'waiting' | 'attention'

/** 全局制作状态（界面用词：空闲 / 制作中 / 已停止 / 待确认） */
export type GlobalStatus = 'idle' | 'producing' | 'stopped' | 'confirm'

/**
 * 作品所处阶段。
 * - preview：全书预览与按卷综合
 * - confirm-visual：停在确认点 1（角色设定 / 主视觉）
 * - confirm-first：停在确认点 2（第一章成品）
 * - producing：后台按卷制作（是否真的在跑看全局队列）
 * - done：全部章节做完
 * - imported：导入的作品包，只能游玩
 */
export type WorkPhase = 'preview' | 'confirm-visual' | 'confirm-first' | 'producing' | 'done' | 'imported'

export type CoverMotif = 'lighthouse' | 'letter' | 'wave' | 'star' | 'sun' | 'moon'

export interface Chapter {
  id: string
  /** 作品内序号，从 1 开始 */
  index: number
  title: string
  status: ChapterStatus
  /** 制作中章节当前在做的步骤，如“写”“审稿”“演出”“出图 5/8” */
  step?: string
  /** 需要处理的原因（用户能看懂的一句话） */
  issue?: string
  /** 创作者设为优先 */
  priority?: boolean
  /** 过期图片数量 */
  staleImages?: number
  /** 场景数 */
  scenes?: number
}

export interface Work {
  id: string
  title: string
  author: string
  /** 工程即系列；导入的作品也带系列信息 */
  seriesId: string
  volumeId: string
  kind: 'project' | 'imported'
  phase: WorkPhase
  synopsis: string
  /** 作品主视觉的主色，播放器游戏皮肤据此着色（属于作品画面，不走界面 tokens） */
  accent: string
  coverGradient: string
  coverMotif: CoverMotif
  /** 原文语言 / 作品语言 */
  sourceLanguage: string
  workLanguage: string
  chapters: Chapter[]
  /** 主线进度：读到第几章、本章读了多少（0-1）；null 表示没开始 */
  reading: { chapter: number; progress: number } | null
  /** 作品包版本号（导入的作品；工程里是下次导出的版本） */
  version: number
  /** 导入为工程时记录的来源作品 */
  derivedFrom?: string
  /** 全书预览进度（phase = preview 时） */
  previewProgress?: { done: number; total: number; stage: string }
  presets: { strength: '忠实' | '平衡' | '精简'; density: '宽松' | '标准' | '激进' }
  requirement: string
  /** 写手预设：全局预设 id，或 "custom" 表示在默认上改了几项 */
  writerPreset?: string
  /** 审稿开关（默认关）：剧本定稿后先审稿一轮再演出 */
  reviewEnabled?: boolean
  /** 已有参考图时也停在角色设定确认点 */
  pauseOnRefImages?: boolean
  /** 出图放大到的分辨率（默认 2K） */
  outputResolution?: '2K' | '4K'
  /** 作品自定义标记：名称、逐字开关与覆盖样式 */
  customMarks?: { id: string; name: string; perChar: boolean; css: string }[]
  /** 本作品规则（创作者写给各角色看的硬要求） */
  rules?: { id: string; text: string }[]
}

export interface Volume {
  id: string
  seriesId: string
  index: number
  title: string
}

export interface Series {
  id: string
  title: string
  kind: 'project' | 'imported'
  /** 工程文件夹位置 */
  folder?: string
}
