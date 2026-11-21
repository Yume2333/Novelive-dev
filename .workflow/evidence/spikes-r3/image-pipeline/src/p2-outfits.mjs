// Phase 2: outfit base sprites via method B (reference redraw from design sheet).
import { edit, mkdir, writeFileSync } from './api.mjs'
import { CHAR, OUTFITS } from './briefs.mjs'

const G = new URL('../gen/', import.meta.url).pathname
mkdir(G)

// keep-list built from bible appearance fields (visuals.md:22 — code splits fields, not the painter)
const KEEP = {
  xiangzi: '脸型、五官位置、平头发型、右脸疤痕的位置形状、肤色、瞳色、画风和线条',
  huniu: '脸型、五官位置、发髻和银簪、肤色、瞳色、画风和线条',
}

const jobs = []
for (const [cid, outfits] of Object.entries(OUTFITS)) {
  const ref = G + 'design-' + cid + '.png'
  for (const [oid, o] of Object.entries(outfits)) {
    const prompt = o.prompt(cid === 'xiangzi' ? CHAR.xiangzi.design.split('外貌：')[1].split('服装：')[0] : CHAR.huniu.design.split('外貌：')[1].split('服装：')[0])
      + ` 其余保持项：${KEEP[cid]}。`
    jobs.push([`sprite-${cid}-${oid}`, () => edit([ref], prompt, '1024x1536', { background: 'transparent', meta: { stage: 'sprite-base', cid, oid } })])
  }
}

for (const [name, fn] of jobs) {
  const r = await fn()
  if (r.ok && r.buf) {
    writeFileSync(G + name + '.png', r.buf)
    console.log(name, 'ok', (r.ms / 1000).toFixed(1) + 's')
  } else console.log(name, 'FAIL', JSON.stringify(r.err))
}
