// Phase 1: character design sheets + place bases + CGs (all generations, no refs needed).
import { gen, mkdir, writeFileSync, MODEL } from './api.mjs'
import { CHAR, PLACES, CGS } from './briefs.mjs'

const G = new URL('../gen/', import.meta.url).pathname
mkdir(G)

const jobs = []
// design sheets (landscape 1536x1024 — a sheet isn't a sprite)
for (const [id, c] of Object.entries(CHAR)) {
  jobs.push(['design-' + id, () => gen(c.design, '1536x1024', { meta: { stage: 'design', id } })])
}
// place bases (16:9)
for (const [id, p] of Object.entries(PLACES)) {
  jobs.push(['bg-' + id, () => gen(p.base, '1536x1024', { meta: { stage: 'bg-base', id } })])
}
// CGs
for (const [id, prompt] of Object.entries(CGS)) {
  jobs.push(['cg-' + id, () => gen(prompt, '1536x1024', { meta: { stage: 'cg', id } })])
}

console.log('MODEL =', MODEL)
for (const [name, fn] of jobs) {
  const r = await fn()
  if (r.ok && r.buf) {
    writeFileSync(G + name + '.png', r.buf)
    console.log(name, 'ok', (r.ms / 1000).toFixed(1) + 's', JSON.stringify(r.usage ?? ''))
  } else {
    console.log(name, 'FAIL', JSON.stringify(r.err))
  }
}
