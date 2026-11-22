import type { ChapterStatus } from './types'

// 作品级对话面板 mock。
// 消息按树存（id / parentId）：同一 parent 下的多条消息互为分支，当前分支是从根到叶的一条路径。
// 每部作品多个会话；长会话的开头有一条压缩摘要。

export type ChatRole = 'user' | 'agent'

// ---- 消息内容：一条消息由若干「部分」按顺序组成 ----

export type ToolStatus = 'running' | 'done' | 'failed'

/** 工具调用卡片。title 用人话写，如「读取设定集」「查看第 3 章原文」 */
export interface ToolPart {
  kind: 'tool'
  id: string
  title: string
  status: ToolStatus
  /** 展开可见的调用参数 */
  args?: { label: string; value: string }[]
  /** 展开可见的结果说明 */
  result?: string
  /** 生成图片的缩略图占位 */
  imageThumb?: boolean
  /** 生成图片的技术检查和看图结论 */
  checks?: { label: string; pass: boolean; note?: string }[]
}

/** 子任务（子 Agent）：展开后嵌套显示它自己的正文和工具卡，只嵌一层 */
export interface SubtaskPart {
  kind: 'subtask'
  id: string
  title: string
  status: ToolStatus
  parts: MessagePart[]
}

/** 可折叠的思考 */
export interface ThinkingPart {
  kind: 'thinking'
  /** 界面显示「思考了 N 秒」或实时「正在思考 · N.Ns」 */
  seconds: number
  text: string
  /** 是否正在思考中 */
  active?: boolean
}

export type ConfirmKind =
  | 'bible'
  | 'glossary'
  | 'requirement'
  | 'redo-chapter'
  | 'rewrite-scene'
  | 'redraw-image'
  | 'recompose-volume'

export const confirmKindMeta: Record<ConfirmKind, { label: string; icon: string }> = {
  bible: { label: '设定集', icon: 'menu_book' },
  glossary: { label: '术语表', icon: 'translate' },
  requirement: { label: '改编要求', icon: 'tune' },
  'redo-chapter': { label: '重做章节', icon: 'restart_alt' },
  'rewrite-scene': { label: '重写场景', icon: 'edit_note' },
  'redraw-image': { label: '重画图片', icon: 'image' },
  'recompose-volume': { label: '重新综合', icon: 'autorenew' },
}

/** 确认卡里的一条：修改类（改前/改后）或工作流类（写清做什么、影响哪些章节） */
export interface ConfirmItem {
  id: string
  kind: ConfirmKind
  title: string
  before?: string
  after?: string
  note?: string
  /** 这条会影响到的章节，界面显示「影响：…」 */
  affectedChapters: string[]
  /** 会重做已完成内容或重画已有图，确认时再弹一句 */
  confirmHint?: string
}

/** 一组待确认的修改 / 工作流，挂在一条消息里 */
export interface ConfirmPart {
  kind: 'confirm'
  id: string
  items: ConfirmItem[]
}

export interface TextPart {
  kind: 'text'
  text: string
}

/** 贴图：用户贴给主控看的参考图，存在会话里 */
export interface ImagePart {
  kind: 'image'
  id: string
  /** 缩略图 data URL；演示里直接用读进来的本地图 */
  src: string
  name: string
}

export type MessagePart = TextPart | ImagePart | ThinkingPart | ToolPart | SubtaskPart | ConfirmPart

// ---- 消息树与会话 ----

export interface ChatNode {
  id: string
  parentId: string | null
  role: ChatRole
  parts: MessagePart[]
}

export interface ChatSession {
  id: string
  /** 会话标题由第一条消息自动生成 */
  title: string
  /** 显示用的最近时间，如「昨天」「11/18」 */
  updatedLabel: string
  /** 更早内容被压缩成的摘要；有值时消息流开头显示一条可展开的分隔条 */
  compressedSummary?: string
  nodes: ChatNode[]
}

// ---- 各作品的会话 mock ----

const wugangS1: ChatSession = {
  id: 'wugang-s1',
  title: '重做第 7 章',
  updatedLabel: '昨天',
  compressedSummary: '前面聊了第 1 到 6 章的方向：开场用雾做背景音、不急着解释；第 3 章的回忆压成一场。这些已经记进改编要求。',
  nodes: [
    {
      id: 'w1',
      parentId: null,
      role: 'agent',
      parts: [{ kind: 'text', text: '这周接着聊第 7 章。上次说的「凛先怀疑再求证」我记着，继续说。' }],
    },
    {
      id: 'w2',
      parentId: 'w1',
      role: 'user',
      parts: [{ kind: 'text', text: '第 7 章「沉没的回声」重做的时候，凛不要那么快接受「沉船是人为的」。她应该是先不信，再去找证据。' }],
    },
    {
      id: 'w3',
      parentId: 'w2',
      role: 'agent',
      parts: [
        { kind: 'thinking', seconds: 8, text: '先看这章现在的分场，再找凛「接受人为说」出现在哪一场、前后有没有铺垫……' },
        { kind: 'tool', id: 'w3-t1', title: '查看第 7 章剧本', status: 'done', args: [{ label: '章节', value: '第 7 章「沉没的回声」' }], result: '共 5 场。「人为说」现在出现在第 3 场，凛当场接受。' },
        { kind: 'tool', id: 'w3-t2', title: '读取设定集', status: 'done', args: [{ label: '条目', value: '凛 · 性格' }], result: '凛对「权威说法」一贯先存疑，习惯自己查证。' },
        {
          kind: 'subtask',
          id: 'w3-s',
          title: '核对凛在全书里的性格表现',
          status: 'done',
          parts: [
            { kind: 'tool', id: 'w3-s-t1', title: '查看第 3 章原文', status: 'done', args: [{ label: '章节', value: '第 3 章「灯塔看守人」' }], result: '凛在第 3 章对看守人的说法也是先不信、自己跑了一趟灯塔。' },
            { kind: 'text', text: '「先怀疑再求证」和凛在其他章节的表现一致，可以按这个方向重做。' },
          ],
        },
        { kind: 'text', text: '明白。「先怀疑再求证」这条我记进重做要点：第 3 场凛先不接受，第 4 场加一段她去查旧航海图的戏。' },
      ],
    },
    {
      id: 'w4a',
      parentId: 'w3',
      role: 'user',
      parts: [{ kind: 'text', text: '顺便把造型的事也理一下。' }],
    },
    {
      id: 'w4a-r',
      parentId: 'w4a',
      role: 'agent',
      parts: [{ kind: 'text', text: '哪一部分的造型？凛第 300 章之后换新造型，还是更早的旧造型？' }],
    },
    {
      id: 'w4b',
      parentId: 'w3',
      role: 'user',
      parts: [{ kind: 'text', text: '另外第 300 章之后凛换造型的事，帮我理一下要改哪些地方。' }],
    },
    {
      id: 'w4b-r',
      parentId: 'w4b',
      role: 'agent',
      parts: [
        { kind: 'thinking', seconds: 5, text: '换造型影响：设定集条目、术语表、用到旧造型的章节和图片……' },
        { kind: 'text', text: '按你的说法整理好了，确认后才生效：' },
        {
          kind: 'confirm',
          id: 'w4b-c',
          items: [
            {
              id: 'w4b-c1',
              kind: 'bible',
              title: '凛的外貌',
              before: '第 300 章起：长马尾、邮差大衣',
              after: '第 300 章起：短发、旅人斗篷（新造型）',
              note: '从第 300 章起改用新造型，新造型的图第一次用到时再画；前面章节的图照用，不会标过期。',
              affectedChapters: ['第 300 章起的全部章节'],
            },
            {
              id: 'w4b-c2',
              kind: 'glossary',
              title: '「北灯」',
              before: '北灯：北方灯塔的统称',
              after: '北灯：特指第 6 章提到的第三座灯塔',
              affectedChapters: ['第 6 章', '第 14 章'],
            },
            {
              id: 'w4b-c3',
              kind: 'redo-chapter',
              title: '第 5 章「旧航海图」',
              note: '按「凛先怀疑再求证」重新分场写剧本；重做进入制作队列。',
              affectedChapters: ['第 5 章'],
              confirmHint: '第 5 章已经制作完成，重做会覆盖现有剧本和演出。',
            },
            {
              id: 'w4b-c4',
              kind: 'redraw-image',
              title: '第 4 章场景 2 的码头背景',
              note: '背景里灯塔的画法和新的「北灯」说法对不上，需要重画。',
              affectedChapters: ['第 4 章'],
              confirmHint: '这张图已生成，重画会再出一次图。',
            },
          ],
        },
      ],
    },
    {
      id: 'w4c',
      parentId: 'w3',
      role: 'user',
      parts: [{ kind: 'text', text: '第 300 章造型的事也整理下。' }],
    },
    {
      id: 'w4c-r',
      parentId: 'w4c',
      role: 'agent',
      parts: [{ kind: 'text', text: '好，我按「第 300 章起凛换新造型」来理，会动到设定集、术语表和受影响章节，稍等。' }],
    },
  ],
}

const wugangS2: ChatSession = {
  id: 'wugang-s2',
  title: '第 1 章的雾',
  updatedLabel: '11/18',
  nodes: [
    {
      id: 'g1',
      parentId: null,
      role: 'user',
      parts: [{ kind: 'text', text: '第 1 章的雾感觉太「说明」了，能不能更克制一点。' }],
    },
    {
      id: 'g2',
      parentId: 'g1',
      role: 'agent',
      parts: [
        { kind: 'thinking', seconds: 6, text: '第 1 章三处写雾的句子，两处是解释性旁白……' },
        { kind: 'text', text: '可以。两处解释性旁白改成只写景，「这雾十年来最重」这种话让码头工人自己说。' },
        {
          kind: 'confirm',
          id: 'g2-c',
          items: [
            {
              id: 'g2-c1',
              kind: 'rewrite-scene',
              title: '第 1 章场景 1「清晨的码头」',
              note: '只改场景内的写法，不动分场结构；改完标「需要处理」，重进制作。',
              affectedChapters: ['第 1 章'],
            },
            {
              id: 'g2-c2',
              kind: 'requirement',
              title: '环境描写',
              after: '追加：雾、海这类环境只写景，不用旁白解释含义。',
              affectedChapters: ['全部章节'],
            },
          ],
        },
      ],
    },
  ],
}

const wugangS3: ChatSession = {
  id: 'wugang-s3',
  title: '第二卷的节奏',
  updatedLabel: '11/12',
  nodes: [
    {
      id: 'v1',
      parentId: null,
      role: 'user',
      parts: [{ kind: 'text', text: '第二卷整体想更慢一点，多用远景和长镜头。' }],
    },
    {
      id: 'v2',
      parentId: 'v1',
      role: 'agent',
      parts: [
        { kind: 'text', text: '记下来了。等第一卷做完，第二卷综合前我会把这条放进改编要求里。现在先不动。' },
      ],
    },
  ],
}

const xiariS1: ChatSession = {
  id: 'xiari-s1',
  title: '钢琴段落要完整',
  updatedLabel: '周一',
  nodes: [
    {
      id: 'x1',
      parentId: null,
      role: 'agent',
      parts: [{ kind: 'text', text: '「夏日残响」是日文原文、中文剧本。人名第一次出现时会按你的要求加注音。' }],
    },
    {
      id: 'x2',
      parentId: 'x1',
      role: 'user',
      parts: [{ kind: 'text', text: '第一章的钢琴段落可以保留得更完整一些吗？现在的版本压得太短了。' }],
    },
    {
      id: 'x3',
      parentId: 'x2',
      role: 'agent',
      parts: [
        { kind: 'thinking', seconds: 4, text: '钢琴段落在原文里占了两页，现在压成三句旁白……' },
        { kind: 'text', text: '可以这样调，确认后才生效：' },
        {
          kind: 'confirm',
          id: 'x3-c',
          items: [
            {
              id: 'x3-c1',
              kind: 'requirement',
              title: '音乐段落',
              after: '追加：钢琴演奏的段落保留完整节奏，不压缩成一两句旁白。',
              affectedChapters: ['第 1 章', '第 6 章'],
            },
            {
              id: 'x3-c2',
              kind: 'redo-chapter',
              title: '第 1 章「蝉鸣」',
              note: '保留钢琴段落的完整节奏重写；重做进入制作队列。',
              affectedChapters: ['第 1 章'],
              confirmHint: '第 1 章已发布，重做会覆盖现有剧本。',
            },
          ],
        },
      ],
    },
  ],
}

const chaoxiS1: ChatSession = {
  id: 'chaoxi-s1',
  title: '单元剧的感觉',
  updatedLabel: '11/19',
  nodes: [
    {
      id: 'c1',
      parentId: null,
      role: 'agent',
      parts: [{ kind: 'text', text: '「潮汐手记」还在全书预览。预览做完前可以先聊方向，具体章节要等预览结果出来。' }],
    },
    {
      id: 'c2',
      parentId: 'c1',
      role: 'user',
      parts: [{ kind: 'text', text: '手记里每个名字的故事，希望能保持单元剧的感觉。' }],
    },
    {
      id: 'c3',
      parentId: 'c2',
      role: 'agent',
      parts: [
        { kind: 'text', text: '记为改编要求，确认后生效：' },
        {
          kind: 'confirm',
          id: 'c3-c',
          items: [
            {
              id: 'c3-c1',
              kind: 'requirement',
              title: '单元剧结构',
              after: '追加：手记中每个名字自成一段故事，章内不交叉展开。',
              affectedChapters: ['全部章节'],
            },
          ],
        },
      ],
    },
  ],
}

const dengtaS1: ChatSession = {
  id: 'dengta-s1',
  title: '阿澈的独白',
  updatedLabel: '11/15',
  nodes: [
    {
      id: 'd1',
      parentId: null,
      role: 'agent',
      parts: [{ kind: 'text', text: '「灯塔看守人」停在角色设定确认点。设定定下之后，聊改编方向会更准。' }],
    },
    {
      id: 'd2',
      parentId: 'd1',
      role: 'user',
      parts: [{ kind: 'text', text: '阿澈守灯三十年，他的独白想做得克制一点。' }],
    },
    {
      id: 'd3',
      parentId: 'd2',
      role: 'agent',
      parts: [
        { kind: 'text', text: '这个方向我整理成两条，确认后才生效：' },
        {
          kind: 'confirm',
          id: 'd3-c',
          items: [
            {
              id: 'd3-c1',
              kind: 'requirement',
              title: '阿澈的独白',
              after: '追加：阿澈的内心独白短句为主，不直接说出情绪。',
              affectedChapters: ['全部章节'],
            },
            {
              id: 'd3-c2',
              kind: 'glossary',
              title: '「灯油」',
              before: '（未收录）',
              after: '灯油：看守日志里的固定说法，指鲸油与煤油的混合。',
              affectedChapters: ['第 6 章', '第 10 章'],
            },
          ],
        },
      ],
    },
  ],
}

export const chatSessionSeeds: Record<string, ChatSession[]> = {
  wugang: [wugangS1, wugangS2, wugangS3],
  xiari: [xiariS1],
  chaoxi: [chaoxiS1],
  dengta: [dengtaS1],
}

// ---- 新消息的演示回复 ----
let seq = 0
export function newNodeId() {
  return `m${Date.now().toString(36)}-${seq++}`
}

/** 新会话的标题从第一条消息自动生成 */
export function sessionTitleFrom(text: string) {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > 12 ? `${t.slice(0, 12)}…` : t || '新会话'
}

/**
 * 发新消息后的演示回复：思考 → 一条工具卡 → 流式正文 → 确认卡。
 * 面板按 steps 的顺序逐步把 part 补进消息，做出「正在跑」的效果。
 */
export function agentReplySteps(workTitle: string, context?: string | null): {
  thinking: ThinkingPart
  tool: ToolPart
  fullText: string
  confirm: ConfirmPart
} {
  const id = newNodeId()
  return {
    thinking: { kind: 'thinking', seconds: 7, text: '先看你说的这条会动到哪些地方，再看现在的写法……' },
    tool: {
      kind: 'tool',
      id: `${id}-t`,
      title: '查看改编要求',
      status: 'running',
      args: [{ label: '作品', value: workTitle }],
      result: '现有改编要求 3 条，这条会追加为第 4 条。',
    },
    fullText: context
      ? `就着「${context}」说，按这个方向我先整理了几处要动的地方——确认后才生效：`
      : '按这个方向，我先整理了几处要动的地方——确认后才生效：',
    confirm: {
      kind: 'confirm',
      id: `${id}-c`,
      items: [
        {
          id: `${id}-c1`,
          kind: 'requirement',
          title: '新补充',
          after: `「${workTitle}」追加一条改编要求（内容按你刚说的整理，可再改）。`,
          affectedChapters: ['全部章节'],
        },
        {
          id: `${id}-c2`,
          kind: 'redo-chapter',
          title: '下一章',
          note: '受这条调整影响，建议重做下一章；确认后进入制作队列。',
          affectedChapters: ['下一章'],
          confirmHint: '重做会覆盖这一章已经写好的剧本。',
        },
      ],
    },
  }
}

// ---- 运行记录（一章的制作过程） ----

export type RunStepStatus = 'done' | 'running' | 'waiting'

export interface RunRecordStep {
  title: string
  status?: RunStepStatus
  parts: MessagePart[]
  groups?: { title: string; parts: MessagePart[] }[]
}

export interface RunRecordData {
  /** 四段：写 → 审稿 → 演出 → 出图；出图段按画师分组显示 */
  steps: RunRecordStep[]
}

/**
 * 一章的运行记录 mock：写是一次输出；审稿是检查加一轮返修；
 * 演出是美术导演读剧本、插演出指令、列出图清单；
 * 出图按画师分三组，其中一张图看图不通过、重画后通过，一张沿用之前章节画好的。
 */
export function runRecordMock(chapterTitle: string, chapterStatus: ChapterStatus = 'published', chapterStep?: string): RunRecordData {
  if (chapterStatus === 'waiting') {
    return { steps: [] }
  }

  const completedSteps: RunRecordStep[] = [
    {
      title: '写',
      status: 'done',
      parts: [
        { kind: 'thinking', seconds: 42, text: '先看这一章在卷骨架里的位置、涉及的人物和伏笔，再按写手预设分场……' },
        {
          kind: 'text',
          text: `${chapterTitle}写完了，共 4 场 92 句。凛在这一章先不信「沉船是人为的」，结尾带着疑点离开。剧本已保存到工程。`,
        },
      ],
    },
    {
      title: '审稿',
      status: 'done',
      parts: [
        { kind: 'tool', id: 'rv-t1', title: `查看${chapterTitle}剧本`, status: 'done', args: [{ label: '章节', value: chapterTitle }], result: '通读全章，对照改编要求和人物设定。' },
        { kind: 'tool', id: 'rv-t2', title: '读取改编要求', status: 'done', result: '「凛先怀疑再求证」「海边不写晴天」都在检查范围。' },
        { kind: 'text', text: '提出 2 处问题：第 2 场凛的反应还是太快；第 4 场雾的描写用了旁白解释。已退回去修一轮。' },
        { kind: 'text', text: '返修完成：第 2 场加了停顿和回避的动作，第 4 场旁白改成只写景。' },
      ],
    },
    {
      title: '演出',
      status: 'done',
      parts: [
        { kind: 'thinking', seconds: 12, text: '先定每场要几张图：场景 1 用码头全景当背景，凛的立绘两张表情……' },
        { kind: 'tool', id: 'st-t1', title: `查看${chapterTitle}剧本`, status: 'done', args: [{ label: '章节', value: chapterTitle }], result: '共 4 场，插 11 条演出指令。' },
        { kind: 'tool', id: 'st-t2', title: '读取设定集', status: 'done', args: [{ label: '条目', value: '凛 · 外貌（截至本章）' }], result: '长马尾、邮差大衣、帆布包。新造型还不出现。' },
        {
          kind: 'text',
          text: '演出补完：4 场插了 11 条演出指令。本章要用 12 张图：新画 5 张，沿用 7 张；「微笑」并入已有的「开心」。',
        },
        {
          kind: 'text',
          text: '要新画：场景 3 CG「凛在旧灯塔前」、凛立绘基准图「邮差大衣」、凛差分「怀疑」「沉默」、场景 4 背景变体「雾变浓」。',
        },
      ],
    },
    {
      title: '出图',
      status: 'done',
      parts: [],
      groups: [
        {
          title: '立绘',
          parts: [
            {
              kind: 'tool',
              id: 'pt-l1',
              title: '生成图片',
              status: 'done',
              args: [{ label: '内容', value: '凛 · 立绘基准图 · 邮差大衣' }, { label: '格式', value: '竖版，透明底' }],
              result: '已保存到工程。',
              imageThumb: true,
              checks: [
                { label: '技术检查', pass: true, note: '透明通道正常' },
                { label: '看图结论', pass: true, note: '造型和角色设定图一致' },
              ],
            },
          ],
        },
        {
          title: '场景',
          parts: [
            {
              kind: 'tool',
              id: 'pt-s1',
              title: '生成图片',
              status: 'done',
              args: [{ label: '内容', value: '场景 1 背景 · 清晨的码头' }, { label: '比例', value: '16:9，主体在中间安全区' }],
              result: '沿用第 3 章已画的码头全景，没有重画。',
              imageThumb: true,
            },
            {
              kind: 'tool',
              id: 'pt-s2',
              title: '生成图片',
              status: 'failed',
              args: [{ label: '内容', value: '场景 3 CG · 凛在旧灯塔前' }, { label: '比例', value: '16:9，主体在中间安全区' }],
              result: '没通过检查，已丢弃。',
              imageThumb: true,
              checks: [
                { label: '技术检查', pass: true, note: '尺寸、通道正常' },
                { label: '看图结论', pass: false, note: '灯塔画成了新造型里的第三座，时间对不上' },
              ],
            },
            {
              kind: 'tool',
              id: 'pt-s3',
              title: '生成图片',
              status: 'done',
              args: [{ label: '内容', value: '场景 3 CG · 凛在旧灯塔前（重画）' }, { label: '比例', value: '16:9，主体在中间安全区' }],
              result: '已保存到工程。',
              imageThumb: true,
              checks: [
                { label: '技术检查', pass: true, note: '尺寸、通道正常' },
                { label: '看图结论', pass: true, note: '灯塔外观和本章时间线一致' },
              ],
            },
          ],
        },
        {
          title: '差分',
          parts: [
            {
              kind: 'tool',
              id: 'pt-v1',
              title: '生成图片',
              status: 'done',
              args: [{ label: '内容', value: '凛 · 差分 · 怀疑' }, { label: '基准', value: '凛 · 邮差大衣，只改表情' }],
              result: '已保存到工程。',
              imageThumb: true,
              checks: [
                { label: '技术检查', pass: true, note: '透明通道正常' },
                { label: '看图结论', pass: true, note: '只改了表情，其余和基准图一致' },
              ],
            },
            {
              kind: 'tool',
              id: 'pt-v2',
              title: '生成图片',
              status: 'done',
              args: [{ label: '内容', value: '场景 4 背景变体 · 雾变浓' }, { label: '基准', value: '清晨的码头，只改雾的浓度' }],
              result: '已保存到工程。',
              imageThumb: true,
              checks: [
                { label: '技术检查', pass: true, note: '尺寸、通道正常' },
                { label: '看图结论', pass: true, note: '只改了雾的浓度，构图不变' },
              ],
            },
            {
              kind: 'tool',
              id: 'pt-v3',
              title: '生成图片',
              status: 'done',
              args: [{ label: '内容', value: '凛 · 差分 · 沉默' }, { label: '基准', value: '凛 · 邮差大衣，只改表情' }],
              result: '已保存到工程。',
              imageThumb: true,
              checks: [
                { label: '技术检查', pass: true, note: '透明通道正常' },
                { label: '看图结论', pass: true, note: '只改了表情，其余和基准图一致' },
              ],
            },
          ],
        },
      ],
    },
  ]

  if (chapterStatus !== 'producing') {
    return { steps: completedSteps }
  }

  const activeIdx = chapterStep?.includes('出图')
    ? 3
    : chapterStep?.includes('演出')
      ? 2
      : chapterStep?.includes('审稿')
        ? 1
        : 0

  const runningSteps: Record<number, RunRecordStep> = {
    0: {
      title: '写',
      status: 'running',
      parts: [
        { kind: 'thinking', active: true, seconds: 14.2, text: '先梳理这一章在卷骨架里的伏笔与人物关系，正在组织第 3 场的对话节奏……' },
        {
          kind: 'tool',
          id: 'wr-t1',
          title: `撰写${chapterTitle}分场剧本`,
          status: 'running',
          args: [{ label: '章节', value: chapterTitle }, { label: '写手预设', value: '克制留白 · 推进中' }],
        },
      ],
    },
    1: {
      title: '审稿',
      status: 'running',
      parts: [
        { kind: 'tool', id: 'rv-t1', title: `查看${chapterTitle}剧本`, status: 'done', args: [{ label: '章节', value: chapterTitle }], result: '已通读全章 4 场剧本。' },
        {
          kind: 'tool',
          id: 'rv-t2',
          title: '对照原文与改编要求检查',
          status: 'running',
          args: [{ label: '检查项', value: '忠实度检查 · 人物语气' }],
        },
      ],
    },
    2: {
      title: '演出',
      status: 'running',
      parts: [
        { kind: 'thinking', seconds: 8, text: '先定每场要几张图：场景 1 用码头全景当背景，凛的立绘两张表情……' },
        { kind: 'tool', id: 'st-t1', title: `查看${chapterTitle}剧本`, status: 'done', args: [{ label: '章节', value: chapterTitle }], result: '已拆出 4 个场景镜头。' },
        {
          kind: 'tool',
          id: 'st-t2',
          title: `编排${chapterTitle}演出指令与图清单`,
          status: 'running',
          args: [{ label: '条目', value: '立绘差分 · 背景变体' }],
        },
      ],
    },
    3: {
      title: '出图',
      status: 'running',
      parts: [],
      groups: [
        {
          title: '立绘',
          parts: [
            {
              kind: 'tool',
              id: 'pt-l1',
              title: '生成图片',
              status: 'done',
              args: [{ label: '内容', value: '凛 · 立绘基准图 · 邮差大衣' }, { label: '格式', value: '竖版，透明底' }],
              result: '已保存到工程。',
              imageThumb: true,
              checks: [
                { label: '技术检查', pass: true, note: '透明通道正常' },
                { label: '看图结论', pass: true, note: '造型和角色设定图一致' },
              ],
            },
          ],
        },
        {
          title: '场景',
          parts: [
            {
              kind: 'tool',
              id: 'pt-s1',
              title: '生成图片',
              status: 'done',
              args: [{ label: '内容', value: '场景 1 背景 · 清晨的码头' }, { label: '比例', value: '16:9，主体在中间安全区' }],
              result: '沿用第 3 章已画的码头全景，没有重画。',
              imageThumb: true,
            },
            {
              kind: 'tool',
              id: 'pt-s2',
              title: '生成图片',
              status: 'running',
              args: [{ label: '内容', value: '场景 3 CG · 凛在旧灯塔前' }, { label: '比例', value: '16:9，主体在中间安全区' }],
            },
          ],
        },
      ],
    },
  }

  return {
    steps: completedSteps.map((step, idx) => {
      if (idx < activeIdx) return step
      if (idx === activeIdx) return runningSteps[idx]
      return { title: step.title, status: 'waiting', parts: [] }
    }),
  }
}
