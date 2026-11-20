import type { Work } from './types'

// 用量统计的 mock 记录（页面专用）。
// 一个桶 = 某天某作品某阶段的一次汇总；面板按作品 / 阶段 / 模型 / 天 / 月过滤聚合。

export type UsageStage = '全书预览' | '综合' | '写剧本' | '审稿' | '演出与出图' | '对话'

export interface UsageBucket {
  date: string // YYYY-MM-DD
  workId: string
  stage: UsageStage
  model: string
  /** 文本调用：次数 + 文本量（字） */
  textCalls: number
  textChars: number
  /** 图片调用：张数 */
  images: number
  /** 参考单价（每 1000 字或每张图），拿不到单价的不填 */
  pricePerKChar?: number
  pricePerImage?: number
}

export const usageStages: UsageStage[] = ['全书预览', '综合', '写剧本', '审稿', '演出与出图', '对话']

const seed: UsageBucket[] = [
  // 雾港来信：制作中，写剧本 + 演出与出图为主（这部作品开了审稿）
  { date: '2026-11-15', workId: 'wugang', stage: '写剧本', model: '写作', textCalls: 38, textChars: 412_000, images: 0, pricePerKChar: 0.021 },
  { date: '2026-11-15', workId: 'wugang', stage: '演出与出图', model: '主模型', textCalls: 14, textChars: 96_000, images: 0, pricePerKChar: 0.021 },
  { date: '2026-11-15', workId: 'wugang', stage: '演出与出图', model: '图片', textCalls: 0, textChars: 0, images: 18, pricePerImage: 0.28 },
  { date: '2026-11-16', workId: 'wugang', stage: '写剧本', model: '写作', textCalls: 44, textChars: 506_000, images: 0, pricePerKChar: 0.021 },
  { date: '2026-11-16', workId: 'wugang', stage: '审稿', model: '主模型', textCalls: 12, textChars: 168_000, images: 0, pricePerKChar: 0.021 },
  { date: '2026-11-16', workId: 'wugang', stage: '演出与出图', model: '图片', textCalls: 0, textChars: 0, images: 22, pricePerImage: 0.28 },
  { date: '2026-11-17', workId: 'wugang', stage: '写剧本', model: '写作', textCalls: 29, textChars: 355_000, images: 0, pricePerKChar: 0.021 },
  { date: '2026-11-17', workId: 'wugang', stage: '对话', model: '主模型', textCalls: 9, textChars: 64_000, images: 0, pricePerKChar: 0.021 },
  { date: '2026-11-18', workId: 'wugang', stage: '写剧本', model: '写作', textCalls: 51, textChars: 610_000, images: 0, pricePerKChar: 0.021 },
  { date: '2026-11-18', workId: 'wugang', stage: '演出与出图', model: '主模型', textCalls: 16, textChars: 104_000, images: 0, pricePerKChar: 0.021 },
  { date: '2026-11-18', workId: 'wugang', stage: '演出与出图', model: '图片', textCalls: 0, textChars: 0, images: 15, pricePerImage: 0.28 },
  { date: '2026-11-19', workId: 'wugang', stage: '写剧本', model: '写作', textCalls: 33, textChars: 401_000, images: 0, pricePerKChar: 0.021 },
  { date: '2026-11-19', workId: 'wugang', stage: '审稿', model: '主模型', textCalls: 9, textChars: 122_000, images: 0, pricePerKChar: 0.021 },
  { date: '2026-11-19', workId: 'wugang', stage: '演出与出图', model: '视觉', textCalls: 6, textChars: 41_000, images: 0, pricePerKChar: 0.018 },
  { date: '2026-11-19', workId: 'wugang', stage: '演出与出图', model: '图片', textCalls: 0, textChars: 0, images: 12, pricePerImage: 0.28 },
  { date: '2026-11-20', workId: 'wugang', stage: '写剧本', model: '写作', textCalls: 12, textChars: 138_000, images: 0, pricePerKChar: 0.021 },
  { date: '2026-11-20', workId: 'wugang', stage: '演出与出图', model: '图片', textCalls: 0, textChars: 0, images: 8, pricePerImage: 0.28 },
  { date: '2026-11-20', workId: 'wugang', stage: '对话', model: '主模型', textCalls: 4, textChars: 22_000, images: 0, pricePerKChar: 0.021 },

  // 潮汐手记：还在全书预览
  { date: '2026-11-18', workId: 'chaoxi', stage: '全书预览', model: '快速', textCalls: 42, textChars: 690_000, images: 0 },
  { date: '2026-11-19', workId: 'chaoxi', stage: '全书预览', model: '快速', textCalls: 56, textChars: 918_000, images: 0 },
  { date: '2026-11-20', workId: 'chaoxi', stage: '全书预览', model: '快速', textCalls: 31, textChars: 474_000, images: 0 },

  // 灯塔看守人：综合完成，停在确认点 1
  { date: '2026-11-12', workId: 'dengta', stage: '全书预览', model: '快速', textCalls: 36, textChars: 588_000, images: 0 },
  { date: '2026-11-13', workId: 'dengta', stage: '综合', model: '主模型', textCalls: 18, textChars: 242_000, images: 0, pricePerKChar: 0.021 },
  { date: '2026-11-14', workId: 'dengta', stage: '演出与出图', model: '主模型', textCalls: 5, textChars: 38_000, images: 0, pricePerKChar: 0.021 },
  { date: '2026-11-14', workId: 'dengta', stage: '演出与出图', model: '图片', textCalls: 0, textChars: 0, images: 9, pricePerImage: 0.28 },

  // 夏日残响：第一章做完，停在确认点 2
  { date: '2026-11-10', workId: 'xiari', stage: '全书预览', model: '快速', textCalls: 22, textChars: 361_000, images: 0 },
  { date: '2026-11-11', workId: 'xiari', stage: '综合', model: '主模型', textCalls: 15, textChars: 198_000, images: 0, pricePerKChar: 0.021 },
  { date: '2026-11-11', workId: 'xiari', stage: '写剧本', model: '写作', textCalls: 26, textChars: 302_000, images: 0, pricePerKChar: 0.021 },
  { date: '2026-11-12', workId: 'xiari', stage: '演出与出图', model: '图片', textCalls: 0, textChars: 0, images: 14, pricePerImage: 0.28 },
]

const month = (d: string) => d.slice(0, 7)

export interface UsageFilters {
  workId: string // 'all'
  stage: string // 'all'
  model: string // 'all'
  from?: string // YYYY-MM(-DD)
  to?: string
  byMonth: boolean
}

export function listUsage(f: UsageFilters, works: Work[]) {
  const titles = new Map(works.map((w) => [w.id, w.title]))
  const buckets = seed.filter(
    (b) =>
      (f.workId === 'all' || b.workId === f.workId) &&
      (f.stage === 'all' || b.stage === f.stage) &&
      (f.model === 'all' || b.model === f.model) &&
      (!f.from || (f.byMonth ? month(b.date) >= f.from : b.date >= f.from)) &&
      (!f.to || (f.byMonth ? month(b.date) <= f.to : b.date <= f.to)),
  )

  const keyOf = (b: UsageBucket) => (f.byMonth ? month(b.date) : b.date)
  const days = [...new Set(buckets.map(keyOf))].sort()
  const workIds = [...new Set(buckets.map((b) => b.workId))].sort(
    (a, b) => (titles.get(a) ?? a).localeCompare(titles.get(b) ?? b, 'zh'),
  )
  const stages = usageStages.filter((s) => buckets.some((b) => b.stage === s))

  /** 单元格：某时间段 × 某行 × 某阶段的调用量指标 */
  const metric = (day: string, row: (b: UsageBucket) => boolean, stage?: UsageStage) => {
    let calls = 0
    let chars = 0
    let images = 0
    let cost: number | null = null
    let noPrice = false
    for (const b of buckets) {
      if (keyOf(b) !== day || !row(b) || (stage && b.stage !== stage)) continue
      calls += b.textCalls + b.images
      chars += b.textChars
      images += b.images
      const c =
        (b.pricePerKChar !== undefined ? (b.textChars / 1000) * b.pricePerKChar : 0) +
        (b.pricePerImage !== undefined ? b.images * b.pricePerImage : 0)
      if (c > 0) cost = (cost ?? 0) + c
      else if (b.textCalls + b.images > 0) noPrice = true
    }
    return { calls, chars, images, cost, noPrice }
  }

  const totals = (row: (b: UsageBucket) => boolean = () => true, day?: string, stage?: UsageStage) =>
    buckets.reduce(
      (acc, b) => {
        if (!row(b) || (day !== undefined && keyOf(b) !== day) || (stage && b.stage !== stage)) return acc
        acc.calls += b.textCalls + b.images
        acc.chars += b.textChars
        acc.images += b.images
        const c =
          (b.pricePerKChar !== undefined ? (b.textChars / 1000) * b.pricePerKChar : 0) +
          (b.pricePerImage !== undefined ? b.images * b.pricePerImage : 0)
        if (c > 0) acc.cost = (acc.cost ?? 0) + c
        else if (b.textCalls + b.images > 0) acc.noPrice = true
        return acc
      },
      { calls: 0, chars: 0, images: 0, cost: null as number | null, noPrice: false },
    )

  return { days, workIds, stages, metric, totals, titles }
}

// 五个模型槽位（应用设置里配置具体模型名）
export const usageModels = ['快速', '主模型', '写作', '视觉', '图片']

/** 给过滤器默认一个“全部”的时间段 */
export const usageRange = (byMonth: boolean) => {
  const dates = seed.map((b) => b.date).sort()
  return {
    min: byMonth ? month(dates[0]) : dates[0],
    max: byMonth ? month(dates[dates.length - 1]) : dates[dates.length - 1],
  }
}
