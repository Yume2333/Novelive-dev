// R4 prompt-style A/B: 3 subjects x 6 variants x 2 samples.
// V0 = round-3 Chinese prose (verbatim from spikes-r3 briefs.mjs).
// V1 = V0 + owner anti-fragmentation block appended on its own line.
// V2 = Codex-style labeled English spec, same content as V0, translated.
// V3 = V2 + owner's block as a `Rendering:` line.
// V4 = V3 + API param complexity:"low". V5 = V0 + complexity:"low".

export const STYLE =
  '视觉小说立绘风格，干净的日式动画线稿，柔和赛璐璐上色，民国时代（1920年代北平）写实服饰质感。'

export const STYLE_EN =
  'Visual novel sprite style; clean Japanese-anime line art; soft cel shading; realistic costume texture of the Republican era (1920s Beiping).'

export const SPRITE_FRAME =
  '膝上构图（从头顶到膝盖以上完整入镜），人物居中，头顶留少量余量，全身竖版，无任何裁切。纯透明背景，无地面、无影子、无外框。'

// Owner's anti-fragmentation block — appended VERBATIM in V1, and translated for the V3 `Rendering:` line.
export const BLOCK_ZH =
  '大而简洁的色块，低视觉频率，克制的边缘密度，清晰的边缘层级，最少的内部轮廓线，大形状的阴影，抑制微纹理和微对比度，无不必要的高光'

export const BLOCK_EN =
  'large simple color masses, low visual frequency, restrained edge density, clear edge hierarchy, minimal internal contour lines, broad shadow shapes, suppress micro-texture and micro-contrast, no unnecessary specular highlights'

const S = {}

// ---------- S1: CG cg-first-rain (V0 = briefs.mjs CGS['cg-first-rain']) ----------
const s1V0 =
  `${STYLE}CG 图，电影感构图。场景：初秋的北平，祥子拉着自己的新洋车穿过雨后的街道——` +
  '年轻高大的车夫弓身拉车，车轮溅起水光，街道两旁灰瓦房退成远景，天光灰亮。' +
  '人物和主体动作必须落在画面中央的4:3区域（约中间1440×1080）内，左右两侧只画延展的街景。'

const s1V2 = [
  'Use case: illustration-story',
  'Asset type: visual novel event CG (key scene illustration)',
  'Primary request: cinematic CG of a rickshaw puller crossing a rain-washed street',
  'Scene/backdrop: early-autumn Beiping (1920s), grey tiled roofs receding into the distance on both sides of the street, bright overcast sky',
  'Subject: Xiangzi, a tall young rickshaw puller, leaning forward to pull his new rickshaw; wheels kicking up water spray',
  `Style/medium: ${STYLE_EN}`,
  'Composition/framing: cinematic 16:9; characters and the main action must stay inside the central 4:3 area (about the middle 1440x1080); the left and right sides only extend the streetscape',
  'Lighting/mood: grey-bright daylight right after rain',
  'Color palette: muted grey-green early-autumn tones',
  'Constraints: no text; no watermark',
].join('\n')

// ---------- S2: background beiping-street (V0 = briefs.mjs PLACES['beiping-street'].base) ----------
const s2V0 =
  `${STYLE}场景图，视觉小说背景。` +
  '北平街道：1920年代北平内城街道，灰砖门脸和灰瓦房沿街排开，土路街面，电线杆斜立，远处城门楼剪影，街上可有模糊的黄包车影子，初冬灰黄色调。' +
  '晴日白天。街道主体和视线焦点保持在画面中间的4:3区域内，左右两侧只做延展配景。画面里不要出现清晰人物面孔、不要出现现代物品。'

const s2V2 = [
  'Use case: stylized-concept',
  'Asset type: visual novel background',
  'Primary request: a 1920s inner-city street in Beiping',
  'Scene/backdrop: grey-brick shopfronts and grey-tile roofs lining the street, unpaved dirt road surface, leaning utility poles, the silhouette of a city gate tower in the far distance; faint blurred rickshaw shapes are allowed on the street',
  `Style/medium: ${STYLE_EN}`,
  'Composition/framing: the street subject and the visual focal point must stay inside the central 4:3 area; left and right sides only extend the scenery',
  'Lighting/mood: sunny daytime',
  'Color palette: grey-yellow tones of early winter',
  'Constraints: no clearly recognizable human faces; no modern objects; no text; no watermark',
].join('\n')

// ---------- S3: sprite xiangzi/puller (V0 = CHAR design appearance + OUTFITS puller + SPRITE_FRAME, as a generate prompt) ----------
const s3V0 =
  `${STYLE}视觉小说角色立绘。人物：祥子，年轻男性人力车夫，二十来岁，乡下进城的壮实青年。` +
  '外貌：个子高大，肩背宽厚，圆眼，肉鼻，眉毛短而粗，剃得发亮的平头，脸上气色红润，右耳和颧骨之间有一道明显的旧疤（被驴啃的）。神情憨厚沉默、有倔劲。' +
  '服装：民国时期人力车夫的粗布短打——洗旧的白布对襟短褂，肥大的黑布裤，裤脚用布带扎紧，脚穿千层底布鞋，肩上搭一条擦汗的白毛巾。' +
  '站姿自然，两手垂在身侧，表情平静。' + SPRITE_FRAME

const s3V2 = [
  'Use case: stylized-concept',
  'Asset type: visual novel character sprite (standing figure for compositing over backgrounds)',
  'Primary request: full-length sprite of Xiangzi, a young male rickshaw puller in his twenties, a sturdy young man who came to the city from the countryside',
  'Subject: tall build, broad shoulders and back, round eyes, fleshy nose, short thick eyebrows, a shaved buzz cut with a sheen, ruddy complexion, a noticeable old scar between the right ear and the cheekbone (from a donkey bite); simple, silent, stubborn expression',
  'Costume: a Republican-era rickshaw puller\'s coarse-cloth outfit — a worn white cloth short jacket with a front opening, baggy black cloth trousers with ankles tied by cloth bands, thousand-layer cloth shoes, a white sweat towel draped over the shoulder',
  `Style/medium: ${STYLE_EN}`,
  'Composition/framing: knee-up framing (head to above the knees fully in frame), character centered, small headroom margin, vertical full-body orientation, no cropping; natural standing pose, both arms hanging at the sides, calm expression',
  'Lighting/mood: even neutral lighting',
  'Color palette: muted period tones, worn white and black cloth',
  'Constraints: fully transparent background; no ground, no shadow, no border, no text; do not crop the figure',
].join('\n')

function variants(v0, v2) {
  return {
    V0: { prompt: v0 },
    V1: { prompt: v0 + '\n' + BLOCK_ZH },
    V2: { prompt: v2 },
    V3: { prompt: v2 + '\nRendering: ' + BLOCK_EN },
    V4: { prompt: v2 + '\nRendering: ' + BLOCK_EN, extra: { complexity: 'low' } },
    V5: { prompt: v0, extra: { complexity: 'low' } },
  }
}

export const SUBJECTS = {
  's1-cg-first-rain': { size: '1536x864', transparent: false, vars: variants(s1V0, s1V2) },
  's2-beiping-street': { size: '1536x864', transparent: false, vars: variants(s2V0, s2V2) },
  's3-xiangzi-puller': { size: '1024x1536', transparent: true, vars: variants(s3V0, s3V2) },
}

export const VARIANT_IDS = ['V0', 'V1', 'V2', 'V3', 'V4', 'V5']
export const N_SAMPLES = 2
