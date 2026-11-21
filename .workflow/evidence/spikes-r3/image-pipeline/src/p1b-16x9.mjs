import { gen, mkdir, writeFileSync } from './api.mjs'
import { PLACES, CGS } from './briefs.mjs'
const G = new URL('../gen/', import.meta.url).pathname
mkdir(G)
const jobs = []
for (const [id, p] of Object.entries(PLACES)) jobs.push(['bg-' + id, () => gen(p.base, '1792x1008', { meta: { stage: 'bg-base', id, size: '1792x1008' } })])
for (const [id, prompt] of Object.entries(CGS)) jobs.push(['cg-' + id, () => gen(prompt, '1792x1008', { meta: { stage: 'cg', id, size: '1792x1008' } })])
for (const [name, fn] of jobs) {
  const r = await fn()
  if (r.ok && r.buf) { writeFileSync(G + name + '.png', r.buf); console.log(name, 'ok', (r.ms / 1000).toFixed(1) + 's', JSON.stringify(r.usage)) }
  else console.log(name, 'FAIL', JSON.stringify(r.err))
}
