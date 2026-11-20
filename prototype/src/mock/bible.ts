import type { Work } from './types'

// 设定集 / 术语表 / 全书预览的 mock 数据（页面专用）。
// 结构与 bible.md 对应：条目整条覆盖（系列 → 卷 → 作品），候选分不冲突 / 冲突两种，
// 角色、关系、地点带“变化”列表（第 from 章起 field 变成 to）。

export type Layer = '系列' | '卷' | '作品'
export type EntryStatus = '已确认' | '候选'

export interface Change {
  /** 从第几章起生效 */
  from: number
  field: string
  fromText: string
  to: string
}

export interface ExpressionSpec {
  id: string
  name: string
  /** false = 登记了但还没画（第一次在剧本里用到时才画） */
  drawn: boolean
}

export interface Outfit {
  id: string
  name: string
  desc: string
  /** 从第几章开始穿 */
  fromChapter: number
  /** 因外貌变化而开的造型（bible.md：旧图照旧用，不标过期） */
  dueToChange?: boolean
  expressions: ExpressionSpec[]
}

export interface BibleCharacter {
  id: string
  name: string
  sourceName: string
  aliases: string
  addressBy: { who: string; call: string }[]
  identity: string
  personality: string
  speech: string
  appearance: string
  reference: string
  reusable: boolean
  firstChapter: number
  outfits: Outfit[]
  changes: Change[]
  status: EntryStatus
  layer: Layer
  extractedFrom: number
}

export interface Relation {
  id: string
  a: string
  b: string
  desc: string
  changes: Change[]
  status: EntryStatus
  layer: Layer
}

export interface LocationVariant { id: string; name: string; desc: string }

export interface BibleLocation {
  id: string
  name: string
  sourceName: string
  desc: string
  variants: LocationVariant[]
  reference: string
  firstChapter: number
  changes: Change[]
  status: EntryStatus
  layer: Layer
}

export interface TimelineEvent {
  id: string
  chapter: number
  storyTime: string
  event: string
}

export interface Foreshadow {
  id: string
  text: string
  planted: number
  payoff?: number
}

export interface ConflictItem {
  id: string
  kind: string
  target: string
  field: string
  confirmed: string
  candidate: string
  fromChapter: number
}

export interface GlossaryItem {
  source: string
  work: string
  ruby?: string
  category: string
  note?: string
}

export interface PreviewChapter {
  chapter: number
  summary: string
  characters: string[]
  locations: string[]
  timeline?: string
  foreshadowing?: string
}

export interface BibleData {
  skeleton: string
  style: { art: string; narration: string }
  characters: BibleCharacter[]
  relations: Relation[]
  locations: BibleLocation[]
  timeline: TimelineEvent[]
  foreshadowing: Foreshadow[]
  glossary: GlossaryItem[]
  /** 与已确认设定冲突、等创作者处理的候选 */
  conflicts: ConflictItem[]
  /** 不冲突的候选：直接用于制作，事后可确认 */
  adopted: { id: string; kind: string; name: string; fromChapter: number }[]
  preview: PreviewChapter[]
}

const wugang: BibleData = {
  skeleton:
    '邮差凛在雾最浓的清晨收到一封没有署名的信，信里写着十年前“白鸥号”沉船那晚的细节。她与灯塔看守人阿澈一起追查寄信人，发现当年获救名单上有一个名字被人划掉。随着第二封、第三封信送来，镇上最老的秘密被一层层揭开。',
  style: {
    art: '水彩厚涂，低饱和蓝灰色调；海雾用大面积留白，人物边缘柔和。主视觉参考：雾中邮筒与旧航海图。',
    narration: '克制、平静，偶尔带一点海风一样的凉意；重要的话放在短句里。',
  },
  characters: [
    {
      id: 'lin',
      name: '凛',
      sourceName: '凛',
      aliases: '小凛',
      addressBy: [
        { who: '阿澈', call: '小凛' },
        { who: '薇拉', call: '邮差小姐' },
        { who: '镇上的人', call: '送信的' },
      ],
      identity: '雾港的邮差，本作主角。每天骑车穿过雾送信，知道镇上每一户人的名字。',
      personality: '话少，固执，答应了的事一定做到。嘴上抱怨，脚下一步不停。',
      speech: '自称“我”。口癖是“算了，先送信”。语气短促，很少用感叹号。',
      appearance: '二十岁上下，个子不高。起初留及肩长发，第 10 章剪成齐耳短发。灰色旧邮差制服，背着磨白的帆布邮包。',
      reference: '确认点 1 选用的第三版设定：灰蓝制服、帆布邮包、薄雾背景。',
      reusable: true,
      firstChapter: 1,
      outfits: [
        {
          id: 'uniform',
          name: '邮差制服',
          desc: '灰蓝色双排扣制服外套、帆布邮包、长靴。及肩长发别在耳后。',
          fromChapter: 1,
          expressions: [
            { id: 'calm', name: '平静', drawn: true },
            { id: 'happy', name: '开心', drawn: true },
            { id: 'angry', name: '生气', drawn: true },
            { id: 'sad', name: '悲伤', drawn: true },
            { id: 'surprised', name: '惊讶', drawn: false },
            { id: 'shy', name: '害羞', drawn: false },
            { id: 'determined', name: '坚定', drawn: false },
          ],
        },
        {
          id: 'uniform-short',
          name: '制服·短发',
          desc: '同一套制服，头发剪短到齐耳。第 10 章起使用；之前的章节仍用旧造型的图。',
          fromChapter: 10,
          dueToChange: true,
          expressions: [
            { id: 'calm', name: '平静', drawn: false },
            { id: 'happy', name: '开心', drawn: false },
            { id: 'angry', name: '生气', drawn: false },
            { id: 'sad', name: '悲伤', drawn: false },
            { id: 'surprised', name: '惊讶', drawn: false },
            { id: 'shy', name: '害羞', drawn: false },
            { id: 'determined', name: '坚定', drawn: false },
          ],
        },
      ],
      changes: [
        { from: 10, field: '外貌', fromText: '及肩长发', to: '剪成齐耳短发，发尾刚碰到制服领子' },
      ],
      status: '已确认',
      layer: '系列',
      extractedFrom: 1,
    },
    {
      id: 'ache',
      name: '阿澈',
      sourceName: '阿澈',
      aliases: '看守人',
      addressBy: [
        { who: '凛', call: '阿澈' },
        { who: '镇上的人', call: '看守人' },
      ],
      identity: '灯塔看守人，守了三十年的灯。年轻时是“白鸥号”的船员。',
      personality: '沉默，慢热，习惯把话记在日志里而不是说出口。',
      speech: '自称“我”，上了年纪的人常用的慢语调，句尾常带“嗯”。',
      appearance: '六十岁左右，背微驼，灰白色胡子。常穿旧海员大衣，手里提着灯。',
      reference: '确认点 1 选用的第一版设定：旧海员大衣与手提灯。',
      reusable: true,
      firstChapter: 3,
      outfits: [
        {
          id: 'coat',
          name: '海员大衣',
          desc: '深色旧海员大衣，领口磨得发亮，手里提着灯。',
          fromChapter: 3,
          expressions: [
            { id: 'calm', name: '平静', drawn: true },
            { id: 'happy', name: '开心', drawn: true },
            { id: 'angry', name: '生气', drawn: false },
            { id: 'sad', name: '悲伤', drawn: true },
            { id: 'surprised', name: '惊讶', drawn: false },
            { id: 'shy', name: '害羞', drawn: false },
          ],
        },
      ],
      changes: [],
      status: '已确认',
      layer: '作品',
      extractedFrom: 3,
    },
    {
      id: 'weila',
      name: '薇拉',
      sourceName: '薇拉',
      aliases: '老板娘',
      addressBy: [
        { who: '凛', call: '老板娘' },
        { who: '镇上的人', call: '薇拉' },
      ],
      identity: '码头酒馆“锚与灯”的老板娘，消息最灵通的人。',
      personality: '爽利，爱开玩笑，关键时刻靠得住。',
      speech: '自称“我”，招呼客人时爱用“来了您”。',
      appearance: '四十岁上下，红棕色卷发盘起，围裙上总有酒渍。',
      reference: '无参考图，AI 按书中描写生成的第二版。',
      reusable: true,
      firstChapter: 5,
      outfits: [
        {
          id: 'apron',
          name: '酒馆围裙',
          desc: '白衬衫外面罩深绿色围裙，袖子挽到小臂。',
          fromChapter: 5,
          expressions: [
            { id: 'calm', name: '平静', drawn: true },
            { id: 'happy', name: '开心', drawn: true },
            { id: 'angry', name: '生气', drawn: false },
            { id: 'sad', name: '悲伤', drawn: false },
            { id: 'surprised', name: '惊讶', drawn: false },
            { id: 'shy', name: '害羞', drawn: false },
          ],
        },
      ],
      changes: [],
      status: '候选',
      layer: '卷',
      extractedFrom: 5,
    },
    {
      id: 'haigui',
      name: '海龟爷爷',
      sourceName: '海龟爷爷',
      aliases: '老船匠',
      addressBy: [{ who: '凛', call: '海龟爷爷' }],
      identity: '码头尽头的修船匠，只在第 2 章出场一次。年轻时见过“白鸥号”下水。',
      personality: '耳背，说话绕，喜欢拿旧船钉当礼物送人。',
      speech: '自称“老头子”，重复别人的话尾。',
      appearance: '八十多岁，背驼得厉害，戴一顶退了色的船形帽。',
      reference: '无参考图，只画当前场景需要的表情。',
      reusable: false,
      firstChapter: 2,
      outfits: [
        {
          id: 'work-apron',
          name: '工作围裙',
          desc: '沾着桐油的粗布围裙，口袋里露出船钉。',
          fromChapter: 2,
          expressions: [
            { id: 'calm', name: '平静', drawn: true },
            { id: 'happy', name: '开心', drawn: true },
            { id: 'surprised', name: '惊讶', drawn: false },
          ],
        },
      ],
      changes: [],
      status: '已确认',
      layer: '作品',
      extractedFrom: 2,
    },
  ],
  relations: [
    {
      id: 'rel-lin-ache',
      a: '凛',
      b: '阿澈',
      desc: '送信途中认识的熟人。',
      changes: [
        { from: 4, field: '关系', fromText: '送信途中认识的熟人', to: '共同追查寄信人的搭档' },
        { from: 8, field: '关系', fromText: '共同追查的搭档', to: '阿澈把凛当成了没回来的那个人' },
      ],
      status: '已确认',
      layer: '作品',
    },
    {
      id: 'rel-lin-weila',
      a: '凛',
      b: '薇拉',
      desc: '酒馆老板娘是凛打听消息的第一站，互相打趣的熟人。',
      changes: [],
      status: '已确认',
      layer: '卷',
    },
  ],
  locations: [
    {
      id: 'pier',
      name: '码头',
      sourceName: '码头',
      desc: '石砌的旧码头，雾大时看不见海。系船柱上挂着锈链，地面永远湿滑。',
      variants: [
        { id: 'day', name: '白天', desc: '灰白天光，渔船进出的日常景象' },
        { id: 'dusk', name: '黄昏', desc: '落日压得很低，雾被染成暖色' },
        { id: 'fog', name: '浓雾', desc: '能见度极低，只剩轮廓和灯' },
      ],
      reference: '综合阶段生成的基准图，变体从基准图派生。',
      firstChapter: 1,
      changes: [],
      status: '已确认',
      layer: '系列',
    },
    {
      id: 'post-office',
      name: '邮局',
      sourceName: '邮局',
      desc: '镇中心的小邮局，绿色木门，柜台后面是整面墙的信格。',
      variants: [
        { id: 'day', name: '白天', desc: '开门营业，信格里插着没取走的信' },
        { id: 'night', name: '夜晚', desc: '只剩柜台一盏灯' },
      ],
      reference: '综合阶段生成的基准图。',
      firstChapter: 1,
      changes: [],
      status: '已确认',
      layer: '卷',
    },
    {
      id: 'lighthouse',
      name: '灯塔',
      sourceName: '灯塔',
      desc: '海岬上的白色灯塔，塔身有盐渍冲刷的痕迹，顶灯每夜亮着。',
      variants: [
        { id: 'dusk', name: '黄昏', desc: '灯刚点亮，海面泛金光' },
        { id: 'night', name: '夜晚', desc: '光束扫过海面，塔下浪声' },
      ],
      reference: '创作者提供的参考照片。',
      firstChapter: 3,
      changes: [{ from: 8, field: '描述', fromText: '顶灯每夜亮着', to: '第 8 章灯灭过一次，塔身留下焦黑的痕迹' }],
      status: '已确认',
      layer: '卷',
    },
    {
      id: 'tavern',
      name: '酒馆“锚与灯”',
      sourceName: '酒馆“锚与灯”',
      desc: '码头边的酒馆，木头桌椅，墙上挂着旧船锚和一盏防风灯。',
      variants: [{ id: 'night', name: '夜晚', desc: '营业时段，暖光和人声' }],
      reference: '无参考图，AI 生成的基准图。',
      firstChapter: 5,
      changes: [],
      status: '候选',
      layer: '卷',
    },
  ],
  timeline: [
    { id: 'tl-10y', chapter: 1, storyTime: '十年前 冬', event: '“白鸥号”在雾中沉没，官方记录十九人获救。' },
    { id: 'tl-1', chapter: 1, storyTime: '现在 清晨', event: '凛在邮筒里收到没有署名的信。' },
    { id: 'tl-3', chapter: 3, storyTime: '次日 傍晚', event: '凛在灯塔见到阿澈，提到信里的沉船细节。' },
    { id: 'tl-5', chapter: 5, storyTime: '当夜', event: '薇拉认出信纸是灯塔的日志纸。' },
    { id: 'tl-8', chapter: 8, storyTime: '三日后 凌晨', event: '灯塔的灯第一次在无风的夜里熄灭。' },
  ],
  foreshadowing: [
    { id: 'fs-1', text: '第一封信没有署名，却知道凛的小名。', planted: 1, payoff: 7 },
    { id: 'fs-2', text: '获救名单上有一个被划掉的名字。', planted: 3 },
    { id: 'fs-3', text: '阿澈三十年没离开过灯塔，却认得新邮票的版式。', planted: 4, payoff: 7 },
    { id: 'fs-4', text: '灯塔的灯在无风的夜里熄灭。', planted: 8 },
  ],
  glossary: [
    { source: '雾信号', work: '雾信号', category: '称谓', note: '镇上对灯塔雾号的叫法' },
    { source: '白鸥号', work: '白鸥号', category: '物品', note: '十年前沉没的渡轮' },
    { source: '锚与灯', work: '锚与灯', category: '组织', note: '薇拉的酒馆' },
    { source: '潮期表', work: '潮期表', ruby: 'cháo qī biǎo', category: '物品', note: '老船匠留下的手写潮汐记录' },
    { source: '算了，先送信', work: '算了，先送信', category: '口头禅', note: '凛的口癖，制作时保留' },
  ],
  conflicts: [
    {
      id: 'cf-1',
      kind: '地点',
      target: '灯塔',
      field: '描述',
      confirmed: '海岬上的白色灯塔，塔身有盐渍冲刷的痕迹。',
      candidate: '红色砖石灯塔，塔顶是铜制灯室（第 6 章提取）。',
      fromChapter: 6,
    },
    {
      id: 'cf-2',
      kind: '角色',
      target: '薇拉',
      field: '身份',
      confirmed: '酒馆“锚与灯”的老板娘。',
      candidate: '酒馆老板，同时也是退役海员（第 5 章提取）。',
      fromChapter: 5,
    },
  ],
  adopted: [
    { id: 'ad-1', kind: '角色', name: '薇拉', fromChapter: 5 },
    { id: 'ad-2', kind: '地点', name: '酒馆“锚与灯”', fromChapter: 5 },
    { id: 'ad-3', kind: '术语', name: '雾信号', fromChapter: 3 },
  ],
  preview: [
    {
      chapter: 1,
      summary: '雾最浓的清晨，凛在邮筒里发现一封没有署名的信。信里写着十年前“白鸥号”沉没那晚的事。',
      characters: ['凛', '海龟爷爷'],
      locations: ['码头', '邮局'],
      timeline: '十年前“白鸥号”沉没；现在，第一封信出现。',
      foreshadowing: '埋下：信知道凛的小名。',
    },
    {
      chapter: 2,
      summary: '凛送信到码头尽头，听修船的海龟爷爷讲起“白鸥号”下水那天的旧闻。',
      characters: ['凛', '海龟爷爷'],
      locations: ['码头', '邮局'],
    },
    {
      chapter: 3,
      summary: '凛第一次去灯塔送信，阿澈看到信上的日期后关上了门。夜里他翻出了看守日志。',
      characters: ['凛', '阿澈'],
      locations: ['灯塔', '邮局'],
      timeline: '阿澈年轻时是“白鸥号”的船员。',
      foreshadowing: '埋下：获救名单上有一个被划掉的名字。',
    },
    {
      chapter: 4,
      summary: '凛和阿澈一起对照信里的细节，发现只有当年船上的人才会知道。两人开始一起查。',
      characters: ['凛', '阿澈'],
      locations: ['灯塔'],
      timeline: '两人决定追查寄信人。',
      foreshadowing: '埋下：阿澈认得新邮票的版式。',
    },
    {
      chapter: 5,
      summary: '酒馆歇业后，薇拉认出信纸是灯塔的日志纸。镇上传起了“寄信人还活着”的说法。',
      characters: ['凛', '薇拉', '阿澈'],
      locations: ['酒馆“锚与灯”', '码头'],
      timeline: '信纸被认出是灯塔日志纸。',
    },
    {
      chapter: 6,
      summary: '风暴前夜，第二封信送到，里面夹着一页被水泡过的航海日志。',
      characters: ['凛', '阿澈'],
      locations: ['邮局', '灯塔'],
    },
    {
      chapter: 7,
      summary: '信里的日期指向阿澈没记进日志的那一晚。凛在码头等到天亮，第一次怀疑阿澈瞒了什么。',
      characters: ['凛', '阿澈'],
      locations: ['码头'],
      foreshadowing: '回收：第一封信知道凛的小名（凛开始明白原因）；回收：阿澈认得新邮票的版式。',
    },
    {
      chapter: 8,
      summary: '雾散时，灯塔的灯第一次在没有风的夜里熄灭。镇上所有人都抬头看见了。',
      characters: ['凛', '阿澈', '薇拉'],
      locations: ['灯塔', '码头'],
      timeline: '灯第一次熄灭，塔身留下焦黑痕迹。',
      foreshadowing: '埋下：灯在无风的夜里熄灭。',
    },
  ],
}

const empty = (skeleton: string): BibleData => ({
  skeleton,
  style: { art: '（待综合）', narration: '（待综合）' },
  characters: [],
  relations: [],
  locations: [],
  timeline: [],
  foreshadowing: [],
  glossary: [],
  conflicts: [],
  adopted: [],
  preview: [],
})

const byWork: Record<string, BibleData> = {
  wugang,
  xiari: {
    ...empty('转学生在废弃音乐教室听见一架没人弹的钢琴，随后被卷进高三最后一场合奏。'),
    style: {
      art: '清淡的水彩铅笔风，夏日高光偏暖，阴影带青。',
      narration: '安静、怀旧，带一点没说完的话。',
    },
    glossary: [
      { source: 'おばけ', work: '妖怪', ruby: 'yāo guài', category: '文化表达', note: '直译，第一次出现加注音' },
      { source: '吹奏楽部', work: '吹奏乐部', category: '组织', note: '学校社团名统一译法' },
      { source: '先輩', work: '学姐', ruby: 'xué jiě', category: '称谓', note: '只有主角这样叫她' },
    ],
    adopted: [
      { id: 'ad-x1', kind: '角色', name: '遥', fromChapter: 1 },
      { id: 'ad-x2', kind: '地点', name: '旧音乐教室', fromChapter: 2 },
    ],
    preview: [
      {
        chapter: 1,
        summary: '转学第一天，主角在旧校舍听见钢琴声，推门却只看见敞开的窗。',
        characters: ['主角', '遥'],
        locations: ['旧音乐教室', '教学楼'],
        foreshadowing: '埋下：琴盖内侧写着一行小字。',
      },
    ],
  },
}

/** 设定集只对有制作数据的工程返回内容；其余工程给一份待综合的骨架。 */
export function getBible(work: Work): BibleData {
  return byWork[work.id] ?? empty('（待综合）')
}
