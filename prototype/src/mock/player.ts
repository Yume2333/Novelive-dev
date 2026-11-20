import type { ChapterStatus } from './types'

// 播放器 mock：剧本语义结构（对应 docs/work-format.md 的剧本语言能力），
// 只放播放界面看得到的概念。逐作品提供剧本；没有可玩章节的作品返回空数组。

/* ---- 文本 ---- */

/** 四种文本类型：对白 / 内心独白 / 旁白 / 字幕（字幕单独显示在画面上，不进文本框） */
export type LineKind = 'talk' | 'inner' | 'narration' | 'caption'

export type TextSegment =
  | { t: 'text'; v: string }
  /** 内置标记：em 强调 / b 加粗 / dim 弱化 / whisper 小声 / shout 大喊 / glitch 扭曲 / hl 高亮 */
  | { t: 'mark'; k: 'em' | 'b' | 'dim' | 'whisper' | 'shout' | 'glitch' | 'hl'; v: string }
  /** 注音：ruby 是标在字上方的读音或原名 */
  | { t: 'ruby'; ruby: string; v: string }
  /** 句中停顿（秒）：还在出字时点击直接补完整句 */
  | { t: 'wait'; sec: number }
  /** 变速：倍率 >1 更快、<1 更慢 */
  | { t: 'speed'; factor: number; v: string }

/* ---- 舞台 ---- */

export type Pos = 'left' | 'center' | 'right'
export type Expr = 'calm' | 'smile' | 'angry' | 'surprised'
export type Bg = 'harborNight' | 'harborDawn' | 'lighthouse' | 'letterCg'
export type Filter = 'sepia' | 'gray' | 'night'
export type Particles = 'fog' | 'snow'

export interface ActorState {
  id: 'lin' | 'xiu'
  name: string
  pos: Pos
  expr: Expr
}

export interface StageFx {
  bg?: Bg
  /** 背景过渡方式，默认淡入淡出 */
  bgTransition?: 'fade' | 'flash'
  cg?: boolean
  actorEnter?: { id: 'lin' | 'xiu'; pos: Pos; expr?: Expr }
  actorLeave?: 'lin' | 'xiu' | 'all'
  expr?: { id: 'lin' | 'xiu'; expr: Expr }
  camera?: 'shake' | 'zoom' | 'zoomOut'
  filter?: Filter | null
  particles?: Particles | null
  /** 需要处理章节：图片画不出来时使用的占位图（角色 / 背景 / CG 三类） */
  placeholder?: 'character' | 'background' | 'cg' | 'clear-character'
}

export interface PlayerLine {
  kind: LineKind
  /** 角色内部 ID；存档、已读按它认人，不受显示名影响 */
  charId?: 'lin' | 'xiu' | 'narrator'
  /** 说话人显示名；可以给单句单独指定（身份揭晓前的“神秘少女”） */
  name?: string
  segs?: TextSegment[]
  /** 字幕卡主标题 / 副标题（如「第一章 码头的雾」「清晨 · 港口」） */
  caption?: { title: string; sub?: string }
  /** 字幕默认不等点击；置 true 时停在字幕卡上等待玩家点击 */
  captionWait?: boolean
  /** 写在这句前面的演出指令，和这句同时生效 */
  fx?: StageFx
}

export interface ChapterScript {
  workId: string
  /** 对应 work.chapters 的 id */
  chapterId: string
  /** 章末后接的章节状态（制作中作品章末行为演示用） */
  next?: { title: string; status: ChapterStatus; step?: string }
  lines: PlayerLine[]
}

const wugangCh1: PlayerLine[] = [
  { kind: 'caption', captionWait: true, caption: { title: '第一章 码头的雾', sub: '清晨 · 港口' }, fx: { bg: 'harborNight', particles: 'fog' } },
  { kind: 'narration', charId: 'narrator', segs: [{ t: 'text', v: '天还没亮，雾就把整个码头藏了起来。' }], fx: { bg: 'harborDawn', bgTransition: 'fade' } },
  { kind: 'inner', charId: 'lin', name: '凛', segs: [{ t: 'text', v: '（雾这么大……今天的信，怕是很难送出去了。）' }], fx: { actorEnter: { id: 'lin', pos: 'left', expr: 'calm' } } },
  { kind: 'talk', charId: 'lin', name: '凛', segs: [{ t: 'text', v: '算了，' }, { t: 'mark', k: 'b', v: '先送信' }, { t: 'text', v: '。' }] },
  {
    kind: 'talk',
    charId: 'xiu',
    name: '神秘少女',
    segs: [
      { t: 'text', v: '你就是……邮差？' },
      { t: 'wait', sec: 0.6 },
      { t: 'speed', factor: 0.4, v: '我等了你好久、好久。' },
    ],
    fx: { actorEnter: { id: 'xiu', pos: 'right', expr: 'calm' } },
  },
  {
    kind: 'talk',
    charId: 'xiu',
    name: '凛',
    segs: [
      { t: 'text', v: '我叫' },
      { t: 'ruby', ruby: 'リン', v: '凛' },
      { t: 'text', v: '。这封信，请你一定要送到。' },
    ],
  },
  {
    kind: 'narration',
    charId: 'narrator',
    segs: [
      { t: 'text', v: '信封上没有署名，只有一个' },
      { t: 'mark', k: 'hl', v: '烫金的灯塔印记' },
      { t: 'text', v: '。' },
    ],
    fx: { cg: true, camera: 'zoom' },
  },
  { kind: 'narration', charId: 'narrator', segs: [{ t: 'text', v: '（十年前 · 风暴夜）' }], fx: { cg: false, filter: 'sepia', camera: 'zoomOut' } },
  {
    kind: 'talk',
    charId: 'xiu',
    name: '凛',
    segs: [
      { t: 'mark', k: 'em', v: '那一晚' },
      { t: 'text', v: '，我亲眼看见灯塔的灯' },
      { t: 'mark', k: 'dim', v: '熄灭了整整三分钟' },
      { t: 'text', v: '。' },
    ],
    fx: { expr: { id: 'xiu', expr: 'surprised' } },
  },
  {
    kind: 'talk',
    charId: 'xiu',
    name: '凛',
    segs: [
      { t: 'mark', k: 'shout', v: '有人在雾里喊救命！' },
      { t: 'speed', factor: 2.5, v: '可我赶到的时候——' },
      { t: 'text', v: '已经太晚了。' },
    ],
    fx: { camera: 'shake' },
  },
  { kind: 'narration', charId: 'narrator', segs: [{ t: 'text', v: '雾号低低地响了一声，海面重新安静下去。' }], fx: { particles: 'snow', filter: 'gray' } },
  { kind: 'inner', charId: 'lin', name: '凛', segs: [{ t: 'text', v: '（她说的这些事……为什么和十年前那篇报道一模一样？）' }], fx: { filter: null, particles: 'fog' } },
  { kind: 'inner', charId: 'lin', name: '凛', segs: [{ t: 'text', v: '（而且……她刚才说她叫凛？和我一样的名字。这不可能。）' }] },
  { kind: 'talk', charId: 'lin', name: '凛', segs: [{ t: 'text', v: '这封信……我收下了。' }], fx: { expr: { id: 'lin', expr: 'smile' } } },
  {
    kind: 'talk',
    charId: 'xiu',
    name: '凛',
    segs: [
      { t: 'text', v: '收信人在灯塔等它。' },
      { t: 'wait', sec: 0.5 },
      { t: 'speed', factor: 0.5, v: '别忘了——雾散之前。' },
    ],
    fx: { actorLeave: 'xiu', bg: 'lighthouse', bgTransition: 'fade' },
  },
  { kind: 'narration', charId: 'narrator', segs: [{ t: 'text', v: '她的身影散进雾里，像从来没有出现过。' }], fx: { particles: null } },
]

const wugangCh5: PlayerLine[] = [
  { kind: 'caption', captionWait: true, caption: { title: '第五章 旧航海图', sub: '深夜 · 灯塔阁楼' }, fx: { bg: 'lighthouse', filter: 'night' } },
  { kind: 'narration', charId: 'narrator', segs: [{ t: 'text', v: '阁楼里堆着三十年的海图，最上面那一张没有署名。' }], fx: { filter: null } },
  { kind: 'talk', charId: 'lin', name: '凛', segs: [{ t: 'text', v: '这张图的航线上……标着一个' }, { t: 'mark', k: 'hl', v: '不该存在的岛' }, { t: 'text', v: '。' }], fx: { actorEnter: { id: 'lin', pos: 'center', expr: 'surprised' } } },
  { kind: 'narration', charId: 'narrator', segs: [{ t: 'text', v: '铅笔画的岛屿轮廓下面，压着一行小字：' }, { t: 'mark', k: 'whisper', v: '雾散之前，不要靠近。' }] },
  { kind: 'inner', charId: 'lin', name: '凛', segs: [{ t: 'text', v: '（这笔迹……和阿澈的，一模一样。）' }] },
  { kind: 'talk', charId: 'lin', name: '凛', segs: [{ t: 'text', v: '原来那封信要送到的「岛」，' }, { t: 'wait', sec: 0.5 }, { t: 'speed', factor: 0.5, v: '从来不在任何一张海图上。' }] },
  { kind: 'narration', charId: 'narrator', segs: [{ t: 'text', v: '她把海图折好塞进口袋，灯芯啪地爆了个灯花。' }], fx: { camera: 'shake' } },
]

const wugangCh7: PlayerLine[] = [
  { kind: 'caption', captionWait: true, caption: { title: '第七章 沉没的回声', sub: '黄昏 · 旧栈桥' }, fx: { bg: 'harborNight', particles: 'fog', placeholder: 'background' } },
  { kind: 'narration', charId: 'narrator', segs: [{ t: 'text', v: '栈桥的木板在脚下发出空洞的响声，像踩在什么巨大东西的脊背上。' }] },
  { kind: 'talk', charId: 'lin', name: '凛', segs: [{ t: 'text', v: '阿澈，你听——雾里有人在叫我的名字。' }], fx: { actorEnter: { id: 'lin', pos: 'left', expr: 'surprised' }, placeholder: 'character' } },
  { kind: 'inner', charId: 'lin', name: '凛', segs: [{ t: 'text', v: '（那不是回声。回声不会先开口。）' }] },
  { kind: 'caption', captionWait: true, caption: { title: '同一片雾里', sub: '看不清的地方' }, fx: { camera: 'shake' } },
  {
    kind: 'talk',
    charId: 'xiu',
    name: '???',
    segs: [
      { t: 'mark', k: 'glitch', v: '凛——凛——' },
      { t: 'wait', sec: 0.4 },
      { t: 'speed', factor: 0.4, v: '把信……还给我。' },
    ],
  },
  { kind: 'narration', charId: 'narrator', segs: [{ t: 'text', v: '她攥紧口袋里的信封，退潮的水声漫过脚背。' }], fx: { actorLeave: 'lin', placeholder: 'clear-character' } },
  { kind: 'caption', captionWait: true, caption: { title: '第七章 · 完', sub: '沉没的回声' }, fx: { cg: true, placeholder: 'cg' } },
]

const xingxieCh1: PlayerLine[] = [
  { kind: 'caption', captionWait: true, caption: { title: '第一章 山路', sub: '深夜 · 山道' }, fx: { bg: 'harborNight', particles: 'snow' } },
  { kind: 'narration', charId: 'narrator', segs: [{ t: 'text', v: '旅馆只在流星雨的夜里开门，我沿着石阶往上走，走了很久。' }], fx: { bg: 'lighthouse', bgTransition: 'fade' } },
  { kind: 'talk', charId: 'lin', name: '旅人', segs: [{ t: 'text', v: '有人吗？我想……住一晚。' }], fx: { actorEnter: { id: 'lin', pos: 'center', expr: 'calm' } } },
  { kind: 'talk', charId: 'xiu', name: '店主', segs: [{ t: 'text', v: '房费不收钱。' }, { t: 'wait', sec: 0.5 }, { t: 'speed', factor: 0.5, v: '收一个秘密。' }] },
  { kind: 'inner', charId: 'lin', name: '旅人', segs: [{ t: 'text', v: '（秘密……我正好带了一个，一路都没敢拆开看。）' }] },
  { kind: 'caption', captionWait: true, caption: { title: '第一章 · 完', sub: '山路' } },
]

export const chapterScripts: ChapterScript[] = [
  { workId: 'wugang', chapterId: 'c1', lines: wugangCh1 },
  { workId: 'wugang', chapterId: 'c5', lines: wugangCh5, next: { title: '风暴前夜', status: 'producing', step: '出图 12/20' } },
  { workId: 'wugang', chapterId: 'c7', lines: wugangCh7, next: { title: '雾散时分', status: 'waiting' } },
  { workId: 'xiari', chapterId: 'c1', lines: wugangCh1, next: { title: '音乐教室', status: 'waiting' } },
  { workId: 'xingxie', chapterId: 'c1', lines: xingxieCh1 },
  { workId: 'baiye', chapterId: 'c1', lines: xingxieCh1 },
]

export function findChapterScript(workId: string, chapterId: string): ChapterScript | undefined {
  return chapterScripts.find((s) => s.workId === workId && s.chapterId === chapterId)
}

/** 播放某章用：没有专属剧本时复用该作品第一章的剧本（原型只做了开头几段） */
export function scriptForChapter(workId: string, chapterId: string): ChapterScript | undefined {
  return findChapterScript(workId, chapterId) ?? findChapterScript(workId, 'c1')
}

