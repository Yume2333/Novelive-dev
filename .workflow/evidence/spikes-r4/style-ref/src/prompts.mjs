// R4 round-2 style-ref prompts. Format: Codex-style labeled spec in English for
// structure, content sentences in Chinese. Order per assignment:
// Input images / Asset type / Scene / Subject / M / block / Composition / Constraints.

export const M = 'Style/medium: soft cel-shaded Japanese animation illustration for a visual novel; period-accurate 1920s Beiping clothing and architecture.'
export const BLOCK_O = 'Rendering: large simple color masses, low visual frequency, restrained edge density, clear edge hierarchy, minimal internal contour lines, broad shadow shapes, suppress micro-texture and micro-contrast, no unnecessary specular highlights.'
export const BLOCK_P = 'Rendering: broad flat color planes and large simple shadow shapes; two or three value groups per object with clear value separation; crisp silhouette, hard edges only at the focal silhouette, soft edges inside shadow masses; grouped hair and fabric masses with few strand and fold lines; matte surfaces. Translate fine detail into clean, organized, medium-scale shapes rather than micro-texture.'
export const LINE_N = 'Avoid: micro-texture, speckled highlights, scratchy linework, cluttered fine detail, glossy plastic shine.'


export const IMG_LINE_ZH = '随附的图片是风格参考（主视觉）：只参考它的画法、上色方式和整体色调，不要照搬画面内容。'
export const M_ZH = '日式动画柔和赛璐璐上色的视觉小说插画，服饰与建筑符合1920年代北平的时代特征。'
export const SPRITE_FRAME2 = '全身从头顶到膝盖以上完整入镜，腿部在膝盖上方被画面底边裁断，人物居中，头顶留少量余量。'
export const ALPHA_EDGE = '透明区域必须干净：半透明描边颜色要与相邻的服装或肤色一致，不要棕色或红色的边缘杂色。'
export const IMG_LINE = 'Image 1: style reference (key visual). Match its rendering, palette and level of detail; do not copy its content.'
// round-1 winner block (Chinese translation of owner's block), for B7
export const BLOCK_ZH = '大而简洁的色块，低视觉频率，克制的边缘密度，清晰的边缘层级，最少的内部轮廓线，大形状的阴影，抑制微纹理和微对比度，无不必要的高光'
// round-3 (baseline) constants
export const STYLE_R3 = '视觉小说立绘风格，干净的日式动画线稿，柔和赛璐璐上色，民国时代（1920年代北平）写实服饰质感。'
export const SPRITE_FRAME = '膝上构图（从头顶到膝盖以上完整入镜），人物居中，头顶留少量余量，全身竖版，无任何裁切。纯透明背景，无地面、无影子、无外框。'


const XZ_APPEARANCE =
  '祥子，年轻男性人力车夫，二十来岁，乡下进城的壮实青年。个子高大，肩背宽厚，圆眼，肉鼻，眉毛短而粗，剃得发亮的平头，脸上气色红润，右耳和颧骨之间有一道明显的旧疤（被驴啃的）。神情憨厚沉默、有倔劲。'
const XZ_PULLER =
  '民国时期人力车夫的粗布短打——洗旧的白布对襟短褂，肥大的黑布裤，裤脚用布带扎紧，脚穿千层底布鞋，肩上搭一条擦汗的白毛巾。'

// ---------- Phase A: key visuals (text-only, 1536x864) ----------
const KV_SCENE = '初冬的北平内城街口，灰砖门脸、灰瓦房、远处城门楼，一辆洋车停在路边，洋车旁站着一个高壮剃平头、穿白布短褂的年轻车夫。'
const KV_BODY = (block) => [
  'Asset type: key visual (主视觉) — style-defining establishing illustration for a visual novel',
  `Scene: ${KV_SCENE}`,
  'Subject: 街景为主体；车夫为唯一人物，中远景比例。',
  M,
  block,
  'Composition: 16:9 横构图，街道纵深朝远处城门楼延伸，车夫与洋车位于画面中央4:3区域内。',
  'Constraints: no text, no watermark, no modern objects.',
].join('\n')

export const KVS = {
  'KV-O': { prompt: KV_BODY(BLOCK_O), size: '1536x864' },
  'KV-P': { prompt: KV_BODY(BLOCK_P), size: '1536x864' },
}

// ---------- Phase B: downstream assets (edit calls, Image 1 = arm KV) ----------
// en=null -> Chinese content sentences; en=<obj> -> English translations (B6 arm).

const EN_CG = {
  scene: 'early-autumn Beiping, the street just after rain, grey tiled houses receding into the distance on both sides, grey-bright sky',
  subject: 'Xiangzi, a tall young rickshaw puller, leaning forward to pull his own new rickshaw; the wheels kick up water spray',
  composition: '16:9; the subject and main action stay inside the central 4:3 area; the left and right sides only extend the streetscape',
  constraints: 'no text, no watermark, no modern objects',
}
const EN_BG = {
  scene: 'inner courtyard of a Beiping dazayuan (shared tenement compound) in the 1920s: a small yard enclosed by grey-brick single-story houses, clotheslines, a water vat, a stack of honeycomb briquettes, a broken table and chairs; flat even daylight, no people',
  subject: 'the courtyard itself; no characters',
  composition: '16:9; the courtyard subject and visual focus stay inside the central 4:3 area; left and right sides only extend the scenery',
  constraints: 'no people, no clearly recognizable faces, no modern objects, no text, no watermark',
}
const EN_SP = {
  scene: null,
  subject: 'Xiangzi, a young male rickshaw puller in his twenties, a sturdy young man who came to the city from the countryside; tall build, broad shoulders and back, round eyes, fleshy nose, short thick eyebrows, a shaved buzz cut, ruddy complexion, a noticeable old scar between the right ear and the cheekbone; simple, silent, stubborn expression. Costume: a Republican-era rickshaw puller\'s coarse-cloth outfit — a worn white cloth short jacket, baggy black cloth trousers with ankles tied by cloth bands, thousand-layer cloth shoes, a white sweat towel over the shoulder; natural standing pose, both arms at the sides, calm expression',
  composition: 'the full figure from head to just above the knees, legs cut off by the bottom edge of the frame, character centered, small headroom margin, vertical orientation',
  constraints: 'fully transparent background; no ground, no shadow, no border, no text; semi-transparent edge pixels must carry colors continuous with the adjacent cloth or skin — no brown/red edge fringe; do not crop the figure above the knees',
}

function specFmt({ asset, scene, subject, block, composition, constraints, en }) {
  const lines = [`Input images:\n- ${IMG_LINE}`, `Asset type: ${asset}`]
  if (scene) lines.push(`Scene: ${en ? en.scene : scene}`)
  if (subject) lines.push(`Subject: ${en ? en.subject : subject}`)
  lines.push(M)
  if (block) lines.push(block)
  lines.push(`Composition: ${en ? en.composition : composition}`)
  lines.push(`Constraints: ${en ? en.constraints : constraints}`)
  return lines.join('\n')
}

const CG = (block, en) => specFmt({
  asset: 'visual novel event CG (关键场景 CG)',
  scene: '初秋的北平，雨后的街道——街道两旁灰瓦房退成远景，天光灰亮。',
  subject: '祥子，年轻高大的车夫，弓身拉着自己的新洋车穿过街道，车轮溅起水光。',
  block,
  composition: '16:9 横构图；人物和主体动作落在画面中央的4:3区域内，左右两侧只画延展的街景。',
  constraints: 'no text, no watermark, no modern objects.',
  en: en ? EN_CG : null,
})

const BG = (block, en) => specFmt({
  asset: 'visual novel background (场景背景)',
  scene: '北平大杂院内院，灰砖平房围出的小院，晒衣绳、水缸、蜂窝煤堆、破桌椅，天光平铺。',
  subject: '院子本身；无人物。',
  block,
  composition: '16:9 横构图；院子主体和视线焦点保持在画面中间的4:3区域内，左右两侧只做延展配景。',
  constraints: '无人物、无现代物品、no text, no watermark.',
  en: en ? EN_BG : null,
})

const SP = (block, en) => specFmt({
  asset: 'visual novel character sprite (角色立绘, compositing over backgrounds)',
  scene: null,
  subject: `${XZ_APPEARANCE}服装：${XZ_PULLER}站姿自然，两手垂在身侧，表情平静。`,
  block,
  composition: SPRITE_FRAME2,
  constraints: `纯透明背景；无地面、无影子、无外框、无文字；${ALPHA_EDGE}`,
  en: en ? EN_SP : null,
})

// B0: round-3 Chinese prose prompt + round-3 style line (production baseline).
const B0_CG = `${STYLE_R3}CG 图，电影感构图。场景：初秋的北平，祥子拉着自己的新洋车穿过雨后的街道——年轻高大的车夫弓身拉车，车轮溅起水光，街道两旁灰瓦房退成远景，天光灰亮。人物和主体动作必须落在画面中央的4:3区域（约中间1440×1080）内，左右两侧只画延展的街景。`
const B0_BG = `${STYLE_R3}场景图，视觉小说背景。北平大杂院内院：灰砖平房围出的小院，晒衣绳、水缸、蜂窝煤堆、破桌椅，天光平铺，无人物。晴日白天。院子主体和视线焦点保持在画面中间的4:3区域内，左右两侧只做延展配景。画面里不要出现人物、不要出现现代物品。`
const B0_SP = `${STYLE_R3}视觉小说角色立绘。人物：${XZ_APPEARANCE}服装：${XZ_PULLER}站姿自然，两手垂在身侧，表情平静。${SPRITE_FRAME}`

// B7/B8: plain Chinese prose (round-3 style), one code-written Chinese
// reference-role sentence first, Chinese medium line M_ZH, then the block as
// the last line (B7 = BLOCK_ZH, B8 = owner's English block verbatim).
const ZH_PROSE = (body) => `${IMG_LINE_ZH}${M_ZH}${body}`
const B7_CG = ZH_PROSE('CG 图，电影感构图。场景：初秋的北平，祥子拉着自己的新洋车穿过雨后的街道——年轻高大的车夫弓身拉车，车轮溅起水光，街道两旁灰瓦房退成远景，天光灰亮。人物和主体动作必须落在画面中央的4:3区域（约中间1440×1080）内，左右两侧只画延展的街景。') + '\n' + BLOCK_ZH
const B7_BG = ZH_PROSE('场景图，视觉小说背景。北平大杂院内院：灰砖平房围出的小院，晒衣绳、水缸、蜂窝煤堆、破桌椅，天光平铺，无人物。晴日白天。院子主体和视线焦点保持在画面中间的4:3区域内，左右两侧只做延展配景。画面里不要出现人物、不要出现现代物品。') + '\n' + BLOCK_ZH
const B7_SP = ZH_PROSE(`视觉小说角色立绘。人物：${XZ_APPEARANCE}服装：${XZ_PULLER}站姿自然，两手垂在身侧，表情平静。${SPRITE_FRAME2}纯透明背景，无地面、无影子、无外框。${ALPHA_EDGE}`) + '\n' + BLOCK_ZH
const B8_CG = ZH_PROSE('CG 图，电影感构图。场景：初秋的北平，祥子拉着自己的新洋车穿过雨后的街道——年轻高大的车夫弓身拉车，车轮溅起水光，街道两旁灰瓦房退成远景，天光灰亮。人物和主体动作必须落在画面中央的4:3区域（约中间1440×1080）内，左右两侧只画延展的街景。') + '\n' + BLOCK_O
const B8_BG = ZH_PROSE('场景图，视觉小说背景。北平大杂院内院：灰砖平房围出的小院，晒衣绳、水缸、蜂窝煤堆、破桌椅，天光平铺，无人物。晴日白天。院子主体和视线焦点保持在画面中间的4:3区域内，左右两侧只做延展配景。画面里不要出现人物、不要出现现代物品。') + '\n' + BLOCK_O
const B8_SP = ZH_PROSE(`视觉小说角色立绘。人物：${XZ_APPEARANCE}服装：${XZ_PULLER}站姿自然，两手垂在身侧，表情平静。${SPRITE_FRAME2}纯透明背景，无地面、无影子、无外框。${ALPHA_EDGE}`) + '\n' + BLOCK_O

const KV = { B0: 'kv-r3', B1: 'KV-O', B2: 'KV-P', B3: 'KV-P', B4: 'KV-P', B5: 'KV-P', B6: 'KV-P', B7: 'KV-O', B8: 'KV-O' }


export const ASSETS = {
  'cg-first-rain': {
    size: '1536x864', transparent: false,
    prompts: { B0: B0_CG, B1: CG(BLOCK_O), B2: CG(BLOCK_P), B3: CG(null), B4: CG(BLOCK_P), B5: CG(BLOCK_P) + '\n' + LINE_N, B6: CG(BLOCK_P, true), B7: B7_CG, B8: B8_CG },
  },
  'dazayuan': {
    size: '1536x864', transparent: false,
    prompts: { B0: B0_BG, B1: BG(BLOCK_O), B2: BG(BLOCK_P), B3: BG(null), B4: BG(BLOCK_P), B5: BG(BLOCK_P) + '\n' + LINE_N, B6: BG(BLOCK_P, true), B7: B7_BG, B8: B8_BG },
  },
  'xiangzi-puller': {
    size: '1024x1536', transparent: true,
    prompts: { B0: B0_SP, B1: SP(BLOCK_O), B2: SP(BLOCK_P), B3: SP(null), B4: SP(BLOCK_P), B5: SP(BLOCK_P) + '\n' + LINE_N, B6: SP(BLOCK_P, true), B7: B7_SP, B8: B8_SP },
  },
}

export const ARM_IDS = ['B0', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8']
export const ARM_KV = KV
export const ARM_EXTRA = { B4: { quality: 'medium' } }
export const N_SAMPLES = 2
