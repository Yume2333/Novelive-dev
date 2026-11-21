const IP = process.env.NL_IP_DIR ?? new URL("..", import.meta.url).pathname
// P7b: style lock with main-visual as reference image across asset types.
import { gen, edit, mkdir, writeFileSync } from './api.mjs'
const G = `${IP}/gen/`
const LOCK = '画风锁定：柔和的水彩感厚涂上色，低饱和暖灰色调，细腻但克制的线条，民国北平的时代质感，偏写实插画而非高光动漫风。'
const MV = G + 'style-mainvisual.png'

const jobs = [
  // CG: text + MV ref
  ['style-cg-ref', () => edit([MV], `随附的是作品的画风主视觉（风格参考图）。画一张 CG，画风必须和参考图一致：${LOCK} 场景：雨后北平街道，一个高壮剃平头的年轻车夫弓身拉洋车，车轮溅水。`, '1792x1008', { meta: { stage: 'style', kind: 'cg-ref' } })],
  // BG: text + MV ref (new place: 大杂院）
  ['style-bg-ref', () => edit([MV], `随附的是作品的画风主视觉（风格参考图）。画一张背景，画风必须和参考图一致：${LOCK} 场景：北平大杂院内院，灰砖平房围出的小院，晾衣绳、水缸、蜂窝煤堆、破桌椅，天光平铺，主体在画面中央4:3区域内，无人物。`, '1792x1008', { meta: { stage: 'style', kind: 'bg-ref' } })],
  // BG text only (same place, no ref — control)
  ['style-bg-text', () => gen(`${LOCK} 场景：北平大杂院内院，灰砖平房围出的小院，晾衣绳、水缸、蜂窝煤堆、破桌椅，天光平铺，主体在画面中央4:3区域内，无人物。`, '1792x1008', { meta: { stage: 'style', kind: 'bg-text' } })],
]
for (const [name, fn] of jobs) {
  const r = await fn()
  if (r.ok && r.buf) { writeFileSync(G + name + '.png', r.buf); console.log(name, 'ok', (r.ms / 1000).toFixed(1) + 's') }
  else console.log(name, 'FAIL', JSON.stringify(r.err))
}
