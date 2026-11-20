import type { Chapter, Series, Volume, Work } from './types'

// 两个工程（一个多卷系列、一个单部作品）+ 两部导入的作品

export const series: Series[] = [
  { id: 'wuhai', title: '雾海纪行', kind: 'project', folder: '~/文档/Novelive/雾海纪行' },
  { id: 'xiari', title: '夏日残响', kind: 'project', folder: '~/文档/Novelive/夏日残响' },
  { id: 'xingxie', title: '星屑旅馆', kind: 'imported' },
  { id: 'baiye', title: '白夜行路', kind: 'imported' },
]

export const volumes: Volume[] = [
  { id: 'wuhai-1', seriesId: 'wuhai', index: 1, title: '灯塔之外' },
  { id: 'wuhai-2', seriesId: 'wuhai', index: 2, title: '潮声以北' },
  { id: 'xiari-1', seriesId: 'xiari', index: 1, title: '夏日残响' },
  { id: 'xingxie-1', seriesId: 'xingxie', index: 1, title: '星屑旅馆' },
  { id: 'baiye-1', seriesId: 'baiye', index: 1, title: '白夜行路' },
]

function chapters(titles: string[], f: (i: number) => Partial<Chapter> = () => ({})): Chapter[] {
  return titles.map((title, k) => ({ id: `c${k + 1}`, index: k + 1, title, status: 'waiting', scenes: 3 + (k % 4), ...f(k + 1) }))
}

const wugangTitles = [
  '码头的雾', '未署名的信', '灯塔看守人', '退潮之后', '旧航海图', '风暴前夜', '沉没的回声', '雾散时分',
  '港口的钟', '第二封信', '海图上的空白', '守夜人', '盐与铁', '北方来客', '无名岛', '归航',
  '灯火', '潮汐表', '被遗忘的码头', '回信', '雾中的人', '最后一班渡轮', '启航', '雾港',
]

export const works: Work[] = [
  {
    id: 'wugang',
    title: '雾港来信',
    author: '林泊',
    seriesId: 'wuhai',
    volumeId: 'wuhai-1',
    kind: 'project',
    phase: 'producing',
    synopsis: '港口小镇的邮差凛，在雾最浓的那天收到一封没有署名的信。信里写着十年前沉船那晚的事，而寄信人似乎还活着。',
    coverGradient: 'linear-gradient(160deg, #5b7a99 0%, #8fa9c2 55%, #c9d6e2 100%)',
    coverMotif: 'letter',
    accent: '#7f9bb8',
    sourceLanguage: '简体中文',
    workLanguage: '简体中文',
    chapters: chapters(wugangTitles, (i) => {
      if (i <= 5) return { status: 'published', staleImages: i === 3 ? 2 : undefined }
      if (i === 6) return { status: 'producing', step: '演出与出图 12/20' }
      if (i === 7) return { status: 'attention', issue: '两张背景没画出来，先用了占位图' }
      if (i === 12) return { priority: true }
      return {}
    }),
    reading: { chapter: 3, progress: 0.4 },
    version: 1,
    presets: { strength: '平衡', density: '标准' },
    requirement: '保留凛的口头禅“算了，先送信”。海边场景多用远景。',
    writerPreset: 'default',
    reviewEnabled: false,
    pauseOnRefImages: true,
    outputResolution: '2K',
    customMarks: [
      { id: 'letter', name: '信件', perChar: false, css: '' },
      { id: 'tide', name: '潮声', perChar: true, css: '.mark-tide { color: #4a7f9e; } .mark-tide span { display: inline-block; }' },
    ],
    rules: [
      { id: 'r1', text: '凛的口头禅只在她自己说话时出现，旁白不用。' },
      { id: 'r2', text: '海边的戏不写晴天。' },
    ],
  },
  {
    id: 'dengta',
    title: '灯塔看守人',
    author: '林泊',
    seriesId: 'wuhai',
    volumeId: 'wuhai-1',
    kind: 'project',
    phase: 'confirm-visual',
    synopsis: '灯塔看守人阿澈守了三十年的灯，直到有一天，灯在没有风的夜里熄灭了。',
    coverGradient: 'linear-gradient(160deg, #8a6a3f 0%, #c7a46c 55%, #e8d5b0 100%)',
    coverMotif: 'lighthouse',
    accent: '#c7a46c',
    sourceLanguage: '简体中文',
    workLanguage: '简体中文',
    chapters: chapters(['熄灭的灯', '看守日志', '没有风的夜', '来自岸上的船', '第三十年', '灯油', '雾号', '旧友', '塔顶', '天亮以前', '新的看守人', '尾声']),
    reading: null,
    version: 1,
    presets: { strength: '忠实', density: '标准' },
    requirement: '',
  },
  {
    id: 'chaoxi',
    title: '潮汐手记',
    author: '林泊',
    seriesId: 'wuhai',
    volumeId: 'wuhai-2',
    kind: 'project',
    phase: 'preview',
    synopsis: '凛在北方港口找到一本潮汐手记，每一页都记着一个没有回来的人。',
    coverGradient: 'linear-gradient(160deg, #3f6b5e 0%, #6f9c8c 55%, #c3d9cf 100%)',
    coverMotif: 'wave',
    accent: '#6f9c8c',
    sourceLanguage: '简体中文',
    workLanguage: '简体中文',
    chapters: chapters(['北港', '手记', '第一个名字', '退潮', '冬汛', '灯语', '回声', '涨潮', '名单', '离港']),
    reading: null,
    version: 1,
    previewProgress: { done: 6, total: 10, stage: '全书预览' },
    presets: { strength: '平衡', density: '标准' },
    requirement: '',
  },
  {
    id: 'xiari',
    title: '夏日残响',
    author: '水无月遥',
    seriesId: 'xiari',
    volumeId: 'xiari-1',
    kind: 'project',
    phase: 'confirm-first',
    synopsis: '高三暑假，转学生在废弃的音乐教室里听见一架没人弹的钢琴。',
    coverGradient: 'linear-gradient(160deg, #c97b5a 0%, #e6a77f 50%, #f5dcc4 100%)',
    coverMotif: 'sun',
    accent: '#e09a72',
    sourceLanguage: '日文',
    workLanguage: '简体中文',
    chapters: chapters(['蝉鸣', '音乐教室', '没人弹的钢琴', '夏季祭', '雨', '最后的合奏'], (i) =>
      i === 1 ? { status: 'published' } : {},
    ),
    reading: null,
    version: 1,
    presets: { strength: '平衡', density: '激进' },
    requirement: '日文人名保留原名，第一次出现时加注音。',
  },
  {
    id: 'xingxie',
    title: '星屑旅馆',
    author: '安溪',
    seriesId: 'xingxie',
    volumeId: 'xingxie-1',
    kind: 'imported',
    phase: 'imported',
    synopsis: '山顶的旅馆只在流星雨的夜里开门，每位客人都要用一个秘密付房费。',
    coverGradient: 'linear-gradient(160deg, #2f3550 0%, #59608a 55%, #a9acc9 100%)',
    coverMotif: 'star',
    accent: '#8a8fc0',
    sourceLanguage: '简体中文',
    workLanguage: '简体中文',
    chapters: chapters(['山路', '前台', '第一个秘密', '流星雨', '203 号房', '退房'], () => ({ status: 'published' })),
    reading: { chapter: 6, progress: 1 },
    version: 3,
    presets: { strength: '平衡', density: '标准' },
    requirement: '',
  },
  {
    id: 'baiye',
    title: '白夜行路',
    author: 'K. Morrow',
    seriesId: 'baiye',
    volumeId: 'baiye-1',
    kind: 'imported',
    phase: 'imported',
    synopsis: '极昼的小镇上，一个不会入睡的旅人沿着铁路一直往北走。',
    coverGradient: 'linear-gradient(160deg, #6d6a73 0%, #a8a3ad 55%, #e4e1e6 100%)',
    coverMotif: 'moon',
    accent: '#a8a3ad',
    sourceLanguage: '英文',
    workLanguage: '简体中文',
    chapters: chapters(['北行', '不落的太阳', '车站', '旅人', '铁路尽头', '极夜', '回程', '白夜'], () => ({ status: 'published' })),
    reading: { chapter: 2, progress: 0.7 },
    version: 1,
    presets: { strength: '平衡', density: '标准' },
    requirement: '',
  },
]

export const findWork = (id: string | undefined) => works.find((w) => w.id === id)
export const findSeries = (id: string) => series.find((s) => s.id === id)!
export const findVolume = (id: string) => volumes.find((v) => v.id === id)!
