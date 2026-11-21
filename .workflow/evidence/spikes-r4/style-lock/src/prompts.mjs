// spikes-r4/style-lock prompts.
// Question: does passing a third-party art reference as Image 1 to images.edit
// actually lock the style? 4 assets x 5 arms x 2 samples.
// Reference: ref/kokomi-torino.png (Torino fan art, third-party, untracked).

// ---- code-owned fixed strings (same role as creator package constants) ----
export const IMG_LINE =
  'Image 1 is the style reference: match its rendering, line quality, palette treatment and level of detail; do not copy its character, outfit or pose.'

// S: own style description of the reference, written by viewing it.
// Media/technique only, <=50 words.
export const S =
  'Style: soft anime illustration; thin colored line art; airy pastel lavender-blue palette; smooth airbrushed gradient shading; glossy layered hair highlights; large detailed eyes with bright iris reflections; soft glowing light effects.'

export const BLOCK =
  'large simple color masses, low visual frequency, restrained edge density, clear edge hierarchy, minimal internal contour lines, broad shadow shapes, suppress micro-texture and micro-contrast, no unnecessary specular highlights'

export const N_SAMPLES = 2
export const ARMS = ['T0', 'R0', 'R1', 'R2', 'R3']

// ---- assets: content paragraphs written like painter content segments ----
// No style/medium/quality words inside content.

const GIRL =
  'An original modern girl in her late teens: short black bob with straight bangs, amber eyes, gentle calm face. She wears a beige trench coat over a white sweater, dark trousers, and holds a paper coffee cup in one hand. Natural standing pose, quiet expression.'

const XZ =
  '祥子，年轻男性人力车夫，二十来岁，乡下进城的壮实青年。个子高大，肩背宽厚，圆眼，肉鼻，眉毛短而粗，剃得发亮的平头，脸上气色红润，右耳和颧骨之间有一道明显的旧疤（被驴啃的）。神情憨厚沉默、有倔劲。服装：民国时期人力车夫的粗布短打——洗旧的白布对襟短褂，肥大的黑布裤，裤脚用布带扎紧，脚穿千层底布鞋，肩上搭一条擦汗的白毛巾。站姿自然，两手垂在身侧，表情平静。'

const SEASIDE =
  'A quiet seaside town street at late afternoon: a narrow sloping lane of small houses with tiled roofs and wooden facades leading down toward the sea, a few shop awnings and potted plants along the walls, telephone poles and wires, warm low sunlight casting long shadows, the sea and pale sky visible at the end of the street. Empty street, no people.'

const CAFE =
  'The same girl — short black bob, amber eyes, beige trench coat over a white sweater — sitting at a wooden table by a cafe window on a rainy evening, turned sideways toward the glass, one hand around a warm paper cup, raindrops running down the window, warm lamplight inside, blurred rainy street lights outside.'

const SPRITE_COMPOSITION =
  'Framing: from the top of the head to just above the knees, legs cut off by the bottom edge; character centered, small headroom margin, vertical orientation.'

const SPRITE_CONSTRAINTS =
  'Fully transparent background; no ground, no shadow, no border, no text; semi-transparent edge pixels carry colors continuous with the adjacent cloth or skin.'

const SCENE_COMPOSITION =
  'Composition: the main subject stays inside the central 4:3 area; left and right sides only extend the scenery.'

export const ASSETS = {
  'a1-sprite': {
    kind: 'sprite',
    size: '1024x1536',
    transparent: true,
    typeSentence: 'Asset type: character base sprite for a visual novel.',
    content: GIRL,
    tail: [SPRITE_COMPOSITION, SPRITE_CONSTRAINTS].join(' '),
  },
  'a2-xiangzi': {
    kind: 'sprite',
    size: '1024x1536',
    transparent: true,
    typeSentence: 'Asset type: character base sprite for a visual novel.',
    content: XZ,
    tail: [SPRITE_COMPOSITION, SPRITE_CONSTRAINTS].join(' '),
  },
  'a3-seaside': {
    kind: 'background',
    size: '1536x864',
    transparent: false,
    typeSentence: 'Asset type: background (空景) for a visual novel scene.',
    content: SEASIDE,
    tail: [SCENE_COMPOSITION, 'Constraints: no people, no text, no watermark.'].join(' '),
  },
  'a4-cafe-cg': {
    kind: 'cg',
    size: '1536x864',
    transparent: false,
    typeSentence: 'Asset type: CG illustration for a visual novel.',
    content: CAFE,
    tail: [SCENE_COMPOSITION, 'Constraints: no text, no watermark.'].join(' '),
  },
}

// ---- arm assembly (paragraph-separated prose, per visuals.md 2.4) ----
// T0: generate, content + S            (text-only control, no reference)
// R0: img line + type + content + tail (reference only)
// R1: R0 + S + BLOCK                   (current pipeline)
// R2: R0 + S                           (no render block)
// R3: R0 + BLOCK                       (no S)
function build(aid) {
  const a = ASSETS[aid]
  const head = `${IMG_LINE}\n${a.typeSentence}`
  const body = `${a.content}\n${a.tail}`
  return {
    T0: `${a.typeSentence}\n${body}\n${S}`,
    R0: `${head}\n${body}`,
    R1: `${head}\n${body}\n${S}\n${BLOCK}`,
    R2: `${head}\n${body}\n${S}`,
    R3: `${head}\n${body}\n${BLOCK}`,
  }
}

export const PROMPTS = Object.fromEntries(Object.keys(ASSETS).map((k) => [k, build(k)]))
