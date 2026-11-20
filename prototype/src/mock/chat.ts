// 作品级对话面板 mock：消息按角色分；Agent 的提案回复带变更卡片，确认后才生效。

export type ChatRole = 'user' | 'agent'

export type ChangeKind = 'bible' | 'glossary' | 'requirement' | 'redo'

export const changeKindMeta: Record<ChangeKind, { label: string; icon: string }> = {
  bible: { label: '修改设定集', icon: 'menu_book' },
  glossary: { label: '修改术语表', icon: 'translate' },
  requirement: { label: '修改改编要求', icon: 'tune' },
  redo: { label: '重做章节', icon: 'restart_alt' },
}

export interface ChatChange {
  id: string
  kind: ChangeKind
  title: string
  /** 旧 → 新的对照 */
  before?: string
  after?: string
  note?: string
}

export type ChatItem = { id: string; role: ChatRole; kind: 'text'; text: string } | { id: string; role: ChatRole; kind: 'proposal'; summary: string; changes: ChatChange[] }

const wugangHistory: ChatItem[] = [
  {
    id: 'h1',
    role: 'agent',
    kind: 'text',
    text: '昨天我们把第 1 章开场定下来了：雾先做背景音，不急着解释。这周的讨论都在这，可以随时翻回去。',
  },
  {
    id: 'h2',
    role: 'user',
    kind: 'text',
    text: '第 7 章「沉没的回声」重做的时候，凛不要那么快接受「沉船是人为的」。她应该是先不信，再去找证据。',
  },
  {
    id: 'h3',
    role: 'agent',
    kind: 'text',
    text: '明白，「先怀疑再求证」这条我记进第 7 章的重做要点里。',
  },
  {
    id: 'h4',
    role: 'user',
    kind: 'text',
    text: '另外第 300 章之后凛换造型的事，帮我理一下要改哪些地方。',
  },
  {
    id: 'h5',
    role: 'agent',
    kind: 'proposal',
    summary: '按你的说法整理好了，确认后才生效：',
    changes: [
      {
        id: 'c1',
        kind: 'bible',
        title: '设定集 · 凛的外貌',
        before: '第 300 章起：长马尾、邮差大衣',
        after: '第 300 章起：短发、旅人斗篷（新造型）',
        note: '从第 300 章起改用新造型，新造型的图第一次用到时再画；前面章节的图照用，不会标过期。',
      },
      {
        id: 'c2',
        kind: 'glossary',
        title: '术语表 · 「北灯」',
        before: '北灯：北方灯塔的统称',
        after: '北灯：特指第 7 章提到的第三座灯塔',
      },
      {
        id: 'c3',
        kind: 'redo',
        title: '重做 · 第 7 章「沉没的回声」',
        note: '按「凛先怀疑再求证」重新分场景写剧本；重做进入制作队列。',
      },
    ],
  },
]

const xiariHistory: ChatItem[] = [
  {
    id: 'h1',
    role: 'agent',
    kind: 'text',
    text: '「夏日残响」是日文原文、中文剧本。人名第一次出现时会按你的要求加注音。',
  },
  {
    id: 'h2',
    role: 'user',
    kind: 'text',
    text: '第一章的钢琴段落可以保留得更完整一些吗？现在的版本压得太短了。',
  },
  {
    id: 'h3',
    role: 'agent',
    kind: 'proposal',
    summary: '可以这样调，确认后才生效：',
    changes: [
      {
        id: 'c1',
        kind: 'requirement',
        title: '改编要求 · 音乐段落',
        after: '追加：钢琴演奏的段落保留完整节奏，不压缩成一两句旁白。',
      },
      {
        id: 'c2',
        kind: 'redo',
        title: '重做 · 第 1 章「蝉鸣」',
        note: '保留钢琴段落的完整节奏重写；重做进入制作队列。',
      },
    ],
  },
]

const chaoxiHistory: ChatItem[] = [
  {
    id: 'h1',
    role: 'agent',
    kind: 'text',
    text: '「潮汐手记」还在全书预览。预览做完前可以先聊方向，具体章节要等预览结果出来。',
  },
  {
    id: 'h2',
    role: 'user',
    kind: 'text',
    text: '手记里每个名字的故事，希望能保持单元剧的感觉。',
  },
  {
    id: 'h3',
    role: 'agent',
    kind: 'proposal',
    summary: '记为改编要求，确认后生效：',
    changes: [
      {
        id: 'c1',
        kind: 'requirement',
        title: '改编要求 · 单元剧结构',
        after: '追加：手记中每个名字自成一段故事，章内不交叉展开。',
      },
    ],
  },
]

const dengtaHistory: ChatItem[] = [
  {
    id: 'h1',
    role: 'agent',
    kind: 'text',
    text: '「灯塔看守人」停在角色设定确认点。设定定下之后，聊改编方向会更准。',
  },
  {
    id: 'h2',
    role: 'user',
    kind: 'text',
    text: '阿澈守灯三十年，他的独白想做得克制一点。',
  },
  {
    id: 'h3',
    role: 'agent',
    kind: 'proposal',
    summary: '这个方向我整理成两条，确认后才生效：',
    changes: [
      {
        id: 'c1',
        kind: 'requirement',
        title: '改编要求 · 阿澈的独白',
        after: '追加：阿澈的内心独白短句为主，不直接说出情绪。',
      },
      {
        id: 'c2',
        kind: 'glossary',
        title: '术语表 · 「灯油」',
        before: '（未收录）',
        after: '灯油：看守日志里的固定说法，指鲸油与煤油的混合。',
      },
    ],
  },
]

export const chatSeeds: Record<string, ChatItem[]> = {
  wugang: wugangHistory,
  xiari: xiariHistory,
  chaoxi: chaoxiHistory,
  dengta: dengtaHistory,
}

/** 发新消息后 Agent 的演示回复：总是带可确认的变更卡片。 */
export function agentReply(workTitle: string, context?: string | null): ChatItem {
  return {
    id: `r${Date.now()}`,
    role: 'agent',
    kind: 'proposal',
    summary: context ? `就着「${context}」说，按这个方向我先整理了几处要动的地方——确认后才生效：` : '按这个方向，我先整理了几处要动的地方——确认后才生效：',
    changes: [
      {
        id: `r${Date.now()}-a`,
        kind: 'requirement',
        title: '改编要求 · 新补充',
        after: `「${workTitle}」追加一条改编要求（内容按你刚说的整理，可再改）。`,
      },
      {
        id: `r${Date.now()}-b`,
        kind: 'redo',
        title: '重做 · 下一章',
        note: '受这条调整影响，建议重做下一章；确认后进入制作队列。',
      },
    ],
  }
}
