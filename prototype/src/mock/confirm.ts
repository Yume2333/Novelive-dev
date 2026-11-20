import type { Work } from './types'

// 确认点页面专用的 mock 数据。候选图全部用 CSS 渐变 + 剪影图形占位，不放位图。

export interface CandidateImage {
  id: string
  /** 来源标签：创作者参考图 / EPUB 插图 / AI 生成 */
  source: string
  label: string
  /** CSS 背景（渐变 / 图形占位） */
  art: string
}

export interface CharacterCandidate {
  id: string
  name: string
  role: string
  desc: string
  /** 每套造型的候选图 */
  outfits: { name: string; images: CandidateImage[] }[]
}

export interface WorkVisualCandidates {
  /** 作品设置：已经有参考图时仍停在这个确认点 */
  stopWithRefs: boolean
  style: { options: CandidateImage[] }
  characters: CharacterCandidate[]
}

const silhouette = (inner: string, outer: string) =>
  `radial-gradient(ellipse 46% 60% at 50% 34%, ${inner} 0%, ${inner} 58%, transparent 60%), radial-gradient(ellipse 64% 46% at 50% 98%, ${inner} 0%, ${inner} 60%, transparent 62%), ${outer}`

export const visualCandidates: Record<string, WorkVisualCandidates> = {
  dengta: {
    stopWithRefs: true,
    style: {
      options: [
        {
          id: 'style-1',
          source: 'AI 生成',
          label: '雾·灰蓝海面',
          art: 'linear-gradient(180deg, #31404e 0%, #5a7183 48%, #93a7b4 82%, #c4cfd6 100%)',
        },
        {
          id: 'style-2',
          source: 'EPUB 插图',
          label: '灯塔黄昏',
          art: 'linear-gradient(180deg, #4a3c33 0%, #8a6a4a 45%, #d9b98a 75%, #f0ddba 100%)',
        },
        {
          id: 'style-3',
          source: 'AI 生成',
          label: '夜与灯',
          art: 'radial-gradient(circle at 50% 30%, rgba(240,220,170,0.9) 0%, rgba(240,220,170,0.25) 22%, transparent 40%), linear-gradient(180deg, #1f2530 0%, #33404f 60%, #5a6a78 100%)',
        },
      ],
    },
    characters: [
      {
        id: 'a-che',
        name: '阿澈',
        role: '灯塔看守人，守了三十年灯',
        desc: '瘦高，背微驼。灰白短发，眼神安静。常年穿旧雨衣，手上有机油痕。',
        outfits: [
          {
            name: '旧雨衣',
            images: [
              { id: 'ache-ref', source: '创作者参考图', label: '创作者提供', art: silhouette('rgba(35,42,50,0.85)', 'linear-gradient(180deg, #8a94a0, #c3cbd2)') },
              { id: 'ache-epub', source: 'EPUB 插图', label: '第三章内页插图', art: silhouette('rgba(50,44,36,0.85)', 'linear-gradient(180deg, #a08a68, #d8c6a4)') },
              { id: 'ache-ai-1', source: 'AI 生成', label: '版本 A', art: silhouette('rgba(38,48,58,0.85)', 'linear-gradient(180deg, #6d8090, #aebfca)') },
              { id: 'ache-ai-2', source: 'AI 生成', label: '版本 B', art: silhouette('rgba(44,52,44,0.85)', 'linear-gradient(180deg, #74806e, #bcc6b4)') },
            ],
          },
          {
            name: '年轻看守人（回忆）',
            images: [
              { id: 'ache-y-ai-1', source: 'AI 生成', label: '版本 A', art: silhouette('rgba(40,44,56,0.8)', 'linear-gradient(180deg, #7a86a0, #c0c8d8)') },
              { id: 'ache-y-ai-2', source: 'AI 生成', label: '版本 B', art: silhouette('rgba(52,44,52,0.8)', 'linear-gradient(180deg, #96788a, #d0bcc8)') },
            ],
          },
        ],
      },
      {
        id: 'lin-mu',
        name: '林牧',
        role: '岸上来的船工，旧友',
        desc: '矮壮，方脸，笑纹深。声音很大。总带着一只修过多次的铝饭盒。',
        outfits: [
          {
            name: '工装',
            images: [
              { id: 'linmu-epub', source: 'EPUB 插图', label: '封面内页合影', art: silhouette('rgba(48,38,30,0.85)', 'linear-gradient(180deg, #9a8058, #e0cfa8)') },
              { id: 'linmu-ai-1', source: 'AI 生成', label: '版本 A', art: silhouette('rgba(52,44,34,0.85)', 'linear-gradient(180deg, #8a7a5e, #d5c8aa)') },
              { id: 'linmu-ai-2', source: 'AI 生成', label: '版本 B', art: silhouette('rgba(40,50,44,0.85)', 'linear-gradient(180deg, #6e8070, #b8c8ba)') },
            ],
          },
        ],
      },
    ],
  },
  xiari: {
    stopWithRefs: true,
    style: {
      options: [
        {
          id: 'style-1',
          source: 'AI 生成',
          label: '盛夏·教室',
          art: 'linear-gradient(180deg, #f2d9b0 0%, #eec39a 45%, #d99a78 80%, #b97a60 100%)',
        },
      ],
    },
    characters: [
      {
        id: 'mio',
        name: '泽村澪',
        role: '转学生',
        desc: '及肩黑发，总戴着一副旧耳机。',
        outfits: [
          {
            name: '校服',
            images: [
              { id: 'mio-ai-1', source: 'AI 生成', label: '版本 A', art: silhouette('rgba(52,40,46,0.85)', 'linear-gradient(180deg, #c88a76, #efd2b8)') },
              { id: 'mio-ai-2', source: 'AI 生成', label: '版本 B', art: silhouette('rgba(40,48,58,0.85)', 'linear-gradient(180deg, #8498b0, #d4dfe8)') },
            ],
          },
        ],
      },
    ],
  },
}

const fallback: WorkVisualCandidates = {
  stopWithRefs: true,
  style: {
    options: [
      { id: 'style-1', source: 'AI 生成', label: '版本 A', art: 'linear-gradient(180deg, #4a5560 0%, #7d8b98 60%, #c3ccd4 100%)' },
      { id: 'style-2', source: 'AI 生成', label: '版本 B', art: 'linear-gradient(180deg, #5a4a52 0%, #8f7680 60%, #d5c6cc 100%)' },
    ],
  },
  characters: [
    {
      id: 'protagonist',
      name: '主角',
      role: '主要角色',
      desc: '外貌按书中描写生成，可以改描述后重新生成。',
      outfits: [
        {
          name: '默认造型',
          images: [
            { id: 'p-ai-1', source: 'AI 生成', label: '版本 A', art: silhouette('rgba(44,50,58,0.85)', 'linear-gradient(180deg, #7d8b98, #c3ccd4)') },
            { id: 'p-ai-2', source: 'AI 生成', label: '版本 B', art: silhouette('rgba(56,46,52,0.85)', 'linear-gradient(180deg, #8f7680, #d5c6cc)') },
          ],
        },
      ],
    },
  ],
}

/** 取这部作品的确认点数据；没有就按通用占位给一套 AI 生成的 */
export function findVisualCandidates(work: Work): WorkVisualCandidates {
  return visualCandidates[work.id] ?? fallback
}
