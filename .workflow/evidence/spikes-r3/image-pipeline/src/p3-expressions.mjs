// Phase 3a: expression derivations via method A (edit from outfit base).
// Generates all attempts to disk; a separate review pass judges them.
import { edit, mkdir, writeFileSync } from './api.mjs'
import { EXPR_PROMPT } from './briefs.mjs'

const G = new URL('../gen/', import.meta.url).pathname
mkdir(G)

const KEEP = {
  xiangzi: '脸型、五官位置、平头发型、右脸疤痕、肤色、瞳色、白毛巾和服装、姿势、构图、画风',
  huniu: '脸型、五官位置、发髻和银簪、肤色、瞳色、服装、姿势、构图、画风',
}

// [spriteFile, charId, outfitId]
const bases = [
  ['sprite-xiangzi-puller', 'xiangzi', 'puller'],
  ['sprite-xiangzi-winter', 'xiangzi', 'winter'],
  ['sprite-huniu-home', 'huniu', 'home'],
]
const exprs = process.argv[2] ? process.argv[2].split(',') : ['happy', 'angry', 'sad', 'surprised']

const jobs = []
for (const [base, cid, oid] of bases) {
  for (const e of exprs) {
    const prompt = EXPR_PROMPT(e, KEEP[cid])
    jobs.push([`expr-${cid}-${oid}-${e}`, () => edit([G + base + '.png'], prompt, '1024x1536', { background: 'transparent', meta: { stage: 'expr', cid, oid, expr: e, attempt: 1 } })])
  }
}

for (const [name, fn] of jobs) {
  const r = await fn()
  if (r.ok && r.buf) { writeFileSync(G + name + '.png', r.buf); console.log(name, 'ok', (r.ms / 1000).toFixed(1) + 's') }
  else console.log(name, 'FAIL', JSON.stringify(r.err))
}
