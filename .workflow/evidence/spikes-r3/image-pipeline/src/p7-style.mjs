const IP = process.env.NL_IP_DIR ?? new URL("..", import.meta.url).pathname
// P7: style lock experiment — does a fixed style block + main-visual ref unify style?
import { gen, edit, mkdir, writeFileSync } from './api.mjs'
const G = `${IP}/gen/`
const LOCK = '画风锁定：柔和的水彩感厚涂上色，低饱和暖灰色调，细腻但克制的线条，民国北平的时代质感，偏写实插画而非高光动漫风。'

const jobs = [
  // main visual candidate (the style anchor itself)
  ['style-mainvisual', () => gen(`${LOCK} 视觉小说主视觉：1920年代北平街景长卷，灰砖门脸、黄包车、远处城门楼剪影，初冬灰黄天光，没有特写人物。`, '1792x1008', { meta: { stage: 'style', kind: 'mainvisual' } })],
  // CG with style text only
  ['style-cg-text', () => gen(`${LOCK} CG：雨后的北平街道，一个高壮剃平头的年轻车夫弓身拉洋车，车轮溅水。`, '1792x1008', { meta: { stage: 'style', kind: 'cg-text' } })],
]
for (const [name, fn] of jobs) {
  const r = await fn()
  if (r.ok && r.buf) { writeFileSync(G + name + '.png', r.buf); console.log(name, 'ok', (r.ms / 1000).toFixed(1) + 's') }
  else console.log(name, 'FAIL', JSON.stringify(r.err))
}
