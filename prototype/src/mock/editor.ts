// 编辑器页专用 mock：场景剧本（含行内标签）、原文段落、角色与自定义标记。
// 剧本写法见 docs/work-format.md：{mark}…{/mark}、{ruby 读音}字{/ruby}、{wait 秒}、{speed 倍率}…{/speed}。

export type LineKind = 'dialogue' | 'inner' | 'narration' | 'caption'
export type StagePos = 'left' | 'center' | 'right'

export interface SceneLine {
  id: string
  kind: LineKind
  /** 角色英文名（lin / xi），显示名从角色档案查 */
  speaker?: string
  /** 这一句单独的显示名，如「神秘少女」 */
  displayAs?: string
  /** 表情英文名，缺省用站位里的默认表情 */
  expression?: string
  /** 带行内标签的剧本文字 */
  text: string
  /** 对应原文段落 id（原文对照双向跳转用） */
  sourcePara?: string
}

export interface CastSlot {
  char: string
  outfit: string
  expression: string
  position: StagePos
}

export interface SourcePara {
  id: string
  text: string
  /** 由这段原文改编出的句子 id */
  lines: string[]
}

export interface EditorScene {
  id: string
  index: number
  title: string
  background: { name: string; gradient: string; variants: string[] }
  cast: CastSlot[]
  sourceRange: string
  sourceParagraphs: SourcePara[]
  lines: SceneLine[]
  /** Agent 重写演示：lineId → 新文本 */
  rewrite: Record<string, string>
}

export interface EditorCharacter {
  id: string
  name: string
  outfits: { id: string; label: string }[]
  expressions: { id: string; label: string }[]
}

export interface CustomMark {
  id: string
  name: string
  desc: string
  /** 作品自定义标记的状态：proposed = Agent 提议、待确认 */
  state: 'confirmed' | 'proposed' | 'rejected'
  /** 逐字开关（每个字单独套样式） */
  perChar?: boolean
}

export const lineKindMeta: Record<LineKind, { label: string; icon: string }> = {
  dialogue: { label: '对白', icon: 'chat_bubble' },
  inner: { label: '内心独白', icon: 'psychology' },
  narration: { label: '旁白', icon: 'notes' },
  caption: { label: '字幕', icon: 'subtitles' },
}

export const builtinMarks = [
  { id: 'em', label: '强调' },
  { id: 'b', label: '加粗' },
  { id: 'dim', label: '弱化' },
  { id: 'whisper', label: '小声' },
  { id: 'shout', label: '大喊' },
  { id: 'glitch', label: '扭曲' },
  { id: 'hl', label: '高亮' },
]

export const customMarkSeeds: CustomMark[] = [
  { id: 'letter', name: '信件', desc: '信纸样式，用于信、字条的内容', state: 'confirmed' },
  { id: 'tide', name: '潮声', desc: '逐字波浪，用于心里听到的潮声幻听', state: 'proposed', perChar: true },
]

export function markLabel(id: string, customs: CustomMark[]): string {
  return builtinMarks.find((m) => m.id === id)?.label ?? customs.find((m) => m.id === id)?.name ?? id
}

// ---- 角色档案 ----

export const editorCharacters: EditorCharacter[] = [
  {
    id: 'lin',
    name: '凛',
    outfits: [
      { id: 'uniform', label: '邮差制服' },
      { id: 'raincoat', label: '雨衣' },
    ],
    expressions: [
      { id: 'calm', label: '平静' },
      { id: 'frown', label: '皱眉' },
      { id: 'surprised', label: '惊讶' },
      { id: 'uneasy', label: '不安' },
      { id: 'smile', label: '微笑' },
    ],
  },
  {
    id: 'xi',
    name: '汐',
    outfits: [{ id: 'dress', label: '连衣裙' }],
    expressions: [
      { id: 'calm', label: '平静' },
      { id: 'smile', label: '微笑' },
      { id: 'sad', label: '悲伤' },
    ],
  },
  {
    id: 'laozhou',
    name: '老周',
    outfits: [{ id: 'vest', label: '工装背心' }],
    expressions: [
      { id: 'calm', label: '平静' },
      { id: 'worried', label: '担心' },
      { id: 'angry', label: '生气' },
    ],
  },
  {
    id: 'haruka',
    name: '遥',
    outfits: [{ id: 'uniform', label: '夏季制服' }],
    expressions: [
      { id: 'calm', label: '平静' },
      { id: 'surprised', label: '惊讶' },
      { id: 'uneasy', label: '不安' },
    ],
  },
  {
    id: 'aoi',
    name: '葵',
    outfits: [{ id: 'dress', label: '白裙' }],
    expressions: [
      { id: 'calm', label: '平静' },
      { id: 'smile', label: '微笑' },
      { id: 'sad', label: '悲伤' },
    ],
  },
  {
    id: 'ache',
    name: '阿澈',
    outfits: [{ id: 'coat', label: '看守人外套' }],
    expressions: [
      { id: 'calm', label: '平静' },
      { id: 'frown', label: '皱眉' },
      { id: 'sad', label: '悲伤' },
    ],
  },
]

export const findCharacter = (id: string | undefined) => editorCharacters.find((c) => c.id === id)

/** 每部作品在编辑器里登场的角色 */
export const workCast: Record<string, string[]> = {
  wugang: ['lin', 'xi', 'laozhou'],
  chaoxi: ['lin', 'xi'],
  dengta: ['ache'],
  xiari: ['haruka', 'aoi'],
}

// ---- 行内标签解析（剧本语言的界面侧实现） ----

export type RichSeg =
  | { kind: 'text'; text: string }
  | { kind: 'mark'; mark: string; text: string }
  | { kind: 'ruby'; text: string; reading: string }
  | { kind: 'wait'; seconds: string }
  | { kind: 'speed'; factor: string; text: string }

export function parseRich(src: string): RichSeg[] {
  const segs: RichSeg[] = []
  let buf = ''
  let i = 0
  const flush = () => {
    if (buf) {
      segs.push({ kind: 'text', text: buf })
      buf = ''
    }
  }
  while (i < src.length) {
    if (src[i] !== '{') {
      buf += src[i++]
      continue
    }
    if (src[i + 1] === '{') {
      buf += '{'
      i += 2
      continue
    }
    const close = src.indexOf('}', i)
    if (close === -1) {
      buf += src[i++]
      continue
    }
    const tag = src.slice(i + 1, close).trim()
    const sp = tag.indexOf(' ')
    const name = sp === -1 ? tag : tag.slice(0, sp)
    const arg = sp === -1 ? '' : tag.slice(sp + 1).trim()
    if (!name || name.startsWith('/')) {
      buf += src.slice(i, close + 1)
      i = close + 1
      continue
    }
    if (name === 'wait') {
      flush()
      segs.push({ kind: 'wait', seconds: arg || '0.5' })
      i = close + 1
      continue
    }
    const closeTag = `{/${name}}`
    const end = src.indexOf(closeTag, close)
    if (end === -1) {
      buf += src.slice(i, close + 1)
      i = close + 1
      continue
    }
    flush()
    const inner = src.slice(close + 1, end)
    if (name === 'ruby') segs.push({ kind: 'ruby', text: inner, reading: arg })
    else if (name === 'speed') segs.push({ kind: 'speed', factor: arg || '1', text: inner })
    else segs.push({ kind: 'mark', mark: name, text: inner })
    i = end + closeTag.length
  }
  flush()
  return segs
}

/** 文本里已有的标记片段（含位置），用于标记编辑条。 */
export interface MarkSpan {
  mark: string
  param?: string
  inner: string
  start: number
  end: number
}

export function scanMarks(src: string): MarkSpan[] {
  const out: MarkSpan[] = []
  let i = 0
  while (i < src.length) {
    if (src[i] !== '{') {
      i++
      continue
    }
    if (src[i + 1] === '{') {
      i += 2
      continue
    }
    const close = src.indexOf('}', i)
    if (close === -1) break
    const tag = src.slice(i + 1, close).trim()
    const sp = tag.indexOf(' ')
    const name = sp === -1 ? tag : tag.slice(0, sp)
    const arg = sp === -1 ? '' : tag.slice(sp + 1).trim()
    if (name === 'wait') {
      out.push({ mark: 'wait', param: arg || undefined, inner: '', start: i, end: close + 1 })
      i = close + 1
      continue
    }
    if (!name || name.startsWith('/')) {
      i = close + 1
      continue
    }
    const closeTag = `{/${name}}`
    const end = src.indexOf(closeTag, close)
    if (end === -1) {
      i = close + 1
      continue
    }
    out.push({ mark: name, param: arg || undefined, inner: src.slice(close + 1, end), start: i, end: end + closeTag.length })
    i = close + 1 // 嵌套标记也会各自扫到
  }
  return out.sort((a, b) => a.start - b.start)
}

// ---- 场景数据（舞台渐变是画面占位，允许字面色） ----

const dockBg = {
  name: '码头清晨（大雾）',
  gradient: 'linear-gradient(180deg, #141e29 0%, #24384c 55%, #40586e 100%)',
  variants: [
    'linear-gradient(180deg, #1a2531 0%, #2e4358 55%, #4d657d 100%)',
    'linear-gradient(180deg, #101820 0%, #1f3040 55%, #35495c 100%)',
    'linear-gradient(180deg, #17202b 0%, #33465a 55%, #5a738a 100%)',
  ],
}

const reefBg = {
  name: '灯塔礁石滩',
  gradient: 'linear-gradient(180deg, #0e1722 0%, #1c2d40 60%, #2e4459 100%)',
  variants: [
    'linear-gradient(180deg, #131e2b 0%, #25394e 60%, #3a526b 100%)',
    'linear-gradient(180deg, #0a121b 0%, #182635 60%, #27394c 100%)',
    'linear-gradient(180deg, #152030 0%, #2b3f58 60%, #47607e 100%)',
  ],
}

const officeBg = {
  name: '邮局柜台（傍晚）',
  gradient: 'linear-gradient(180deg, #221a12 0%, #3a2d1e 60%, #574531 100%)',
  variants: [
    'linear-gradient(180deg, #2a2115 0%, #463722 60%, #665038 100%)',
    'linear-gradient(180deg, #1c150e 0%, #302516 60%, #493a28 100%)',
    'linear-gradient(180deg, #262013 0%, #413524 60%, #5f4c35 100%)',
  ],
}

const schoolBg = {
  name: '旧校舍走廊（黄昏）',
  gradient: 'linear-gradient(180deg, #231d2e 0%, #453654 60%, #6e5a72 100%)',
  variants: [
    'linear-gradient(180deg, #2b2338 0%, #524165 60%, #7f6a84 100%)',
    'linear-gradient(180deg, #1c1726 0%, #3a2d47 60%, #5d4c61 100%)',
    'linear-gradient(180deg, #281f33 0%, #4b3a5e 60%, #77628a 100%)',
  ],
}

const wugangC1S1: EditorScene = {
  id: 'w-c1-s1',
  index: 1,
  title: '清晨的码头',
  background: dockBg,
  cast: [
    { char: 'lin', outfit: 'uniform', expression: 'calm', position: 'left' },
    { char: 'laozhou', outfit: 'vest', expression: 'worried', position: 'right' },
  ],
  sourceRange: '第 1–5 段',
  sourceParagraphs: [
    { id: 'p0001', text: '凌晨五点，雾从海面上漫上来，把整个雾港泡得发白。', lines: ['a1', 'a2'] },
    { id: 'p0002', text: '凛把邮包甩上肩，推门出去。送信的路线他闭着眼都能走完。', lines: ['a3'] },
    { id: 'p0003', text: '「凛——」老周在栈道那头喊，声音被雾咬掉了一半，「今天这雾邪门，别往灯塔那边去。」', lines: ['a4'] },
    { id: 'p0004', text: '他没答话，心里却咯噔一下：又是这种错觉，好像雾在听。', lines: ['a5'] },
    { id: 'p0005', text: '铁皮信箱立在栈道尽头，凝着一层细水。最里面躺着一封信，信封上干干净净，没有署名。', lines: ['a6', 'a7'] },
  ],
  lines: [
    { id: 'a1', kind: 'caption', text: '雾港 · 清晨', sourcePara: 'p0001' },
    { id: 'a2', kind: 'narration', text: '雾从海面上漫上来，{dim}把整个雾港泡得发白。{/dim}', sourcePara: 'p0001' },
    { id: 'a3', kind: 'dialogue', speaker: 'lin', expression: 'calm', text: '{em}算了，先送信。{/em}', sourcePara: 'p0002' },
    { id: 'a4', kind: 'dialogue', speaker: 'laozhou', expression: 'worried', text: '{shout}凛——{/shout}{wait 0.4}今天这雾，{speed 0.6}邪门得很。{/speed}别往灯塔那边去。', sourcePara: 'p0003' },
    { id: 'a5', kind: 'inner', speaker: 'lin', expression: 'uneasy', text: '{whisper}又是这种错觉{/whisper}……好像雾在听。', sourcePara: 'p0004' },
    { id: 'a6', kind: 'narration', text: '铁皮信箱立在栈道尽头，凝着一层细水。', sourcePara: 'p0005' },
    { id: 'a7', kind: 'dialogue', speaker: 'lin', expression: 'surprised', text: '这封……{letter}没有署名{/letter}。', sourcePara: 'p0005' },
  ],
  rewrite: {
    a2: '雾从海面上漫上来，{dim}把栈桥、船笛和屋顶都泡得发白。{/dim}',
    a3: '{em}算了，先送信。{/em}{wait 0.3}别的事，回来再说。',
    a5: '{whisper}又来了{/whisper}……{speed 0.5}好像雾在听我说话。{/speed}',
  },
}

const wugangC1S2: EditorScene = {
  id: 'w-c1-s2',
  index: 2,
  title: '灯塔下的礁石',
  background: reefBg,
  cast: [
    { char: 'lin', outfit: 'uniform', expression: 'surprised', position: 'left' },
    { char: 'xi', outfit: 'dress', expression: 'calm', position: 'right' },
  ],
  sourceRange: '第 6–9 段',
  sourceParagraphs: [
    { id: 'p0006', text: '灯塔下的礁石上站着个女孩，裙子湿到膝盖，像刚从海里上来。', lines: ['b1', 'b2'] },
    { id: 'p0007', text: '「你终于看到了。」她说，声音不高，却清清楚楚钻进凛的耳朵。', lines: ['b3'] },
    { id: 'p0008', text: '凛后退半步。「谁——」', lines: ['b4'] },
    { id: 'p0009', text: '「信里写的，都是真的。」女孩说完这句，忽然回头望了一眼灯塔。「包括那座灯。」潮声一下子远了。', lines: ['b5', 'b6'] },
  ],
  lines: [
    { id: 'b1', kind: 'caption', text: '灯塔下 · 礁石滩', sourcePara: 'p0006' },
    { id: 'b2', kind: 'narration', text: '礁石上站着个女孩，{dim}裙子湿到膝盖，像刚从海里上来。{/dim}', sourcePara: 'p0006' },
    { id: 'b3', kind: 'dialogue', speaker: 'xi', displayAs: '神秘少女', expression: 'calm', text: '你终于看到了。', sourcePara: 'p0007' },
    { id: 'b4', kind: 'dialogue', speaker: 'lin', expression: 'surprised', text: '{shout}谁——{/shout}', sourcePara: 'p0008' },
    { id: 'b5', kind: 'dialogue', speaker: 'xi', displayAs: '神秘少女', expression: 'calm', text: '信里写的，{glitch}都是真的{/glitch}。{wait 0.5}包括那座灯。', sourcePara: 'p0009' },
    { id: 'b6', kind: 'inner', speaker: 'lin', expression: 'uneasy', text: '潮声忽然远了。{whisper}我为什么会想到「{ruby xī}汐{/ruby}」这个字？{/whisper}', sourcePara: 'p0009' },
  ],
  rewrite: {
    b3: '你终于看到了。{wait 0.4}比我想的，晚了一点。',
    b5: '信里写的，{glitch}全是真的{/glitch}——{wait 0.5}连那座灯也算。',
  },
}

const wugangC2S1: EditorScene = {
  id: 'w-c2-s1',
  index: 1,
  title: '邮局里',
  background: officeBg,
  cast: [
    { char: 'lin', outfit: 'uniform', expression: 'frown', position: 'left' },
    { char: 'laozhou', outfit: 'vest', expression: 'calm', position: 'right' },
  ],
  sourceRange: '第 21–24 段',
  sourceParagraphs: [
    { id: 'p0021', text: '邮局的铜铃响了一声。凛把信摊在柜台上，就着灯看第二遍。', lines: ['c1', 'c2'] },
    { id: 'p0022', text: '信上只有一行字：「船不是沉下去的，是有人让它沉的。」', lines: ['c3'] },
    { id: 'p0023', text: '老周凑过来看了一眼，脸色变了。「这东西谁送来的？」', lines: ['c4', 'c5'] },
    { id: 'p0024', text: '凛摇头。他忽然觉得，这封信不是寄给他的，是寄给十年前那个夜晚的。', lines: ['c6'] },
  ],
  lines: [
    { id: 'c1', kind: 'caption', text: '邮局 · 傍晚', sourcePara: 'p0021' },
    { id: 'c2', kind: 'narration', text: '铜铃响了一声。凛把信摊在柜台上，{speed 0.7}就着灯看第二遍。{/speed}', sourcePara: 'p0021' },
    { id: 'c3', kind: 'narration', text: '{letter}船不是沉下去的，是有人让它沉的。{/letter}', sourcePara: 'p0022' },
    { id: 'c4', kind: 'dialogue', speaker: 'laozhou', expression: 'worried', text: '这东西……{wait 0.3}谁送来的？', sourcePara: 'p0023' },
    { id: 'c5', kind: 'narration', text: '老周凑过来看了一眼，{hl}脸色变了{/hl}。', sourcePara: 'p0023' },
    { id: 'c6', kind: 'inner', speaker: 'lin', expression: 'frown', text: '这封信不是寄给我的。{whisper}是寄给十年前那个夜晚的。{/whisper}', sourcePara: 'p0024' },
  ],
  rewrite: {
    c2: '铜铃响了一声。凛把信摊在柜台上，{dim}就着灯，一个字一个字看第二遍。{/dim}',
    c4: '这东西……{wait 0.3}{whisper}谁送来的？{/whisper}',
  },
}

const xiariC1S1: EditorScene = {
  id: 'x-c1-s1',
  index: 1,
  title: '旧校舍后',
  background: schoolBg,
  cast: [
    { char: 'haruka', outfit: 'uniform', expression: 'calm', position: 'left' },
    { char: 'aoi', outfit: 'dress', expression: 'calm', position: 'right' },
  ],
  sourceRange: '第 3–6 段',
  sourceParagraphs: [
    { id: 'j1', text: '蝉の声が、旧校舎の裏から波のように聞こえてきた。', lines: ['x1', 'x2'] },
    { id: 'j2', text: '「誰かいるの？」遥は足を止めた。', lines: ['x3'] },
    { id: 'j3', text: 'ピアノの音が一つ、また一つ、誰もいないはずの音楽室から漏れてくる。', lines: ['x4', 'x5'] },
    { id: 'j4', text: '振り返ると、制服姿の少女が廊下の隅に立っていた。名札には「葵」とあった。', lines: ['x6'] },
  ],
  lines: [
    { id: 'x1', kind: 'caption', text: '七月 · 放学后的旧校舍', sourcePara: 'j1' },
    { id: 'x2', kind: 'narration', text: '蝉声从旧校舍后面涌上来，{dim}一阵盖过一阵。{/dim}', sourcePara: 'j1' },
    { id: 'x3', kind: 'dialogue', speaker: 'haruka', expression: 'surprised', text: '{em}有人吗？{/em}', sourcePara: 'j2' },
    { id: 'x4', kind: 'narration', text: '钢琴声{wait 0.4}一个音、又一个音，{speed 0.6}从本该无人的音乐教室里漏出来。{/speed}', sourcePara: 'j3' },
    { id: 'x5', kind: 'inner', speaker: 'haruka', expression: 'uneasy', text: '{whisper}这个时间在弹琴的，会是谁。{/whisper}', sourcePara: 'j3' },
    { id: 'x6', kind: 'narration', text: '回过头，走廊角落站着{ruby あおい}葵{/ruby}——她在看遥的手。', sourcePara: 'j4' },
  ],
  rewrite: {
    x2: '蝉声从旧校舍后面涌上来，{dim}一波一波，盖住整条走廊。{/dim}',
    x4: '钢琴声{wait 0.4}一个音、又一个音，{speed 0.6}从锁着的音乐教室里漏出来。{/speed}',
  },
}

/** workId → chapterId → 场景列表。没有数据的章节由 fallbackScenes 生成占位场景。 */
export const editorScenes: Record<string, Record<string, EditorScene[]>> = {
  wugang: { c1: [wugangC1S1, wugangC1S2], c2: [wugangC2S1] },
  xiari: { c1: [xiariC1S1] },
}

/** 没有手写场景数据的章节，按章节名生成两节占位场景，保证编辑器处处可用。 */
export function fallbackScenes(chapter: { index: number; title: string }, chars: EditorCharacter[]): EditorScene[] {
  const a = chars[0]
  const b = chars[1] ?? chars[0]
  const build = (half: 1 | 2): EditorScene => {
    const k = `f${chapter.index}-${half}`
    const ids = [`${k}1`, `${k}2`, `${k}3`, `${k}4`, `${k}5`]
    return {
      id: k,
      index: half,
      title: `${chapter.title} · ${half === 1 ? '上' : '下'}`,
      background: half === 1 ? dockBg : reefBg,
      cast: [
        { char: a.id, outfit: a.outfits[0].id, expression: a.expressions[0].id, position: 'left' },
        ...(b.id !== a.id ? [{ char: b.id, outfit: b.outfits[0].id, expression: b.expressions[0].id, position: 'right' as StagePos }] : []),
      ],
      sourceRange: half === 1 ? '第 1–3 段' : '第 4–6 段',
      sourceParagraphs: [
        { id: `${k}p1`, text: `（${chapter.title} 原文段落一：改编为开场叙述。）`, lines: [ids[0], ids[1]] },
        { id: `${k}p2`, text: `（${chapter.title} 原文段落二：${a.name}与${b.name}的对话。）`, lines: [ids[2], ids[3]] },
        { id: `${k}p3`, text: `（${chapter.title} 原文段落三：收束的内心独白。）`, lines: [ids[4]] },
      ],
      lines: [
        { id: ids[0], kind: 'caption', text: `${chapter.title}`, sourcePara: `${k}p1` },
        { id: ids[1], kind: 'narration', text: `{dim}${chapter.title}的开场，海风先把雾气推上岸。{/dim}`, sourcePara: `${k}p1` },
        { id: ids[2], kind: 'dialogue', speaker: a.id, expression: a.expressions[0].id, text: '{em}先把手头的事做完。{/em}', sourcePara: `${k}p2` },
        { id: ids[3], kind: 'dialogue', speaker: b.id, expression: b.expressions[0].id, text: `今天不太对劲。{wait 0.4}${a.name}，你也感觉到了吧。`, sourcePara: `${k}p2` },
        { id: ids[4], kind: 'inner', speaker: a.id, expression: a.expressions[Math.min(2, a.expressions.length - 1)].id, text: '{whisper}总觉得，有什么事要开始了。{/whisper}', sourcePara: `${k}p3` },
      ],
      rewrite: {
        [ids[1]]: `{dim}${chapter.title}的开场。雾比往常到得更早，也更低。{/dim}`,
      },
    }
  }
  return [build(1), build(2)]
}
