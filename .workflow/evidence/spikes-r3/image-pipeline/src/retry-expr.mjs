// Retry expressions that failed checks. argv: comma-separated expr files w/o ext.
// Appends review feedback to the painter prompt per visuals.md:104.
import { edit, mkdir, writeFileSync } from './api.mjs'
import { EXPR_PROMPT } from './briefs.mjs'
const G = new URL('../gen/', import.meta.url).pathname
const KEEP = {
  xiangzi: '脸型、五官位置、平头发型、右脸疤痕、肤色、瞳色、白毛巾和服装、姿势、构图、画风',
  huniu: '脸型、五官位置、发髻和银簪、肤色、瞳色、服装、姿势、构图、画风',
}
const FB = {
  alphaFail: '上一次出图失败了：返回的图片没有透明背景，把灰白棋盘格图案画进了像素里。这次必须输出真正带透明通道的 PNG，背景区域 alpha 为 0，不要画任何棋盘格、纯色底或场景背景。',
}
const list = process.argv[2].split(',')
const attempt = +(process.argv[3] || 2)
for (const stem of list) {
  const [, cid, oid, expr] = stem.split('-')
  const base = `${G}sprite-${cid}-${oid}.png`
  const prompt = EXPR_PROMPT(expr, KEEP[cid]) + ' ' + FB.alphaFail
  const r = await edit([base], prompt, '1024x1536', { background: 'transparent', meta: { stage: 'expr', cid, oid, expr, attempt } })
  if (r.ok && r.buf) { writeFileSync(`${G}${stem}-r${attempt}.png`, r.buf); console.log(stem, 'r' + attempt, 'ok', (r.ms / 1000).toFixed(1) + 's') }
  else console.log(stem, 'r' + attempt, 'FAIL', JSON.stringify(r.err))
}
