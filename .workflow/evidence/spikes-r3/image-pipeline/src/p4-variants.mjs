// Phase 4: background variants via edit derivation.
import { edit, mkdir, writeFileSync } from './api.mjs'
import { BG_VARIANT } from './briefs.mjs'

const G = new URL('../gen/', import.meta.url).pathname
mkdir(G)
const bases = ['bg-renhe-yard', 'bg-beiping-street']
const variants = process.argv[2] ? process.argv[2].split(',') : ['night', 'rain', 'dusk']

for (const b of bases) {
  for (const v of variants) {
    const r = await edit([G + b + '.png'], BG_VARIANT[v], '1792x1008', { meta: { stage: 'bg-variant', base: b, variant: v, attempt: 1 } })
    if (r.ok && r.buf) { writeFileSync(`${G}${b}-${v}.png`, r.buf); console.log(`${b}-${v} ok`, (r.ms / 1000).toFixed(1) + 's') }
    else console.log(`${b}-${v} FAIL`, JSON.stringify(r.err))
  }
}
