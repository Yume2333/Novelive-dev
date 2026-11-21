// Phase B: 3 assets x 7 arms x 2 samples, each an edit call with the arm's KV
// as Image 1. Requires Phase A outputs (gen/KV-O-s1.png, gen/KV-P-s1.png) and
// gen/kv-r3.png. Writes gen/<asset>--<arm>-s<n>.png + thumbs.
import { edit, mkdir, writeFileSync, rec } from './api.mjs'
import { ASSETS, ARM_IDS, ARM_KV, ARM_EXTRA, N_SAMPLES } from './prompts.mjs'
import { existsSync } from 'node:fs'
import sharp from 'sharp'

const G = new URL('../gen/', import.meta.url).pathname
const T = new URL('../thumbs/', import.meta.url).pathname
mkdir(G); mkdir(T)

const kvPath = (arm) => `${G}${ARM_KV[arm]}-s1.png`
const missing = ARM_IDS.filter((a) => !existsSync(a === 'B0' ? `${G}kv-r3.png` : kvPath(a)))
if (missing.length) {
  console.error('missing KV files for arms:', missing.join(', '))
  process.exit(1)
}
const refFor = (arm) => (arm === 'B0' ? `${G}kv-r3.png` : kvPath(arm))

const onlyAsset = process.argv[2] // optional filter substring
const jobs = []
for (const [aid, asset] of Object.entries(ASSETS)) {
  if (onlyAsset && !aid.includes(onlyAsset)) continue
  for (const arm of ARM_IDS)
    for (let s = 1; s <= N_SAMPLES; s++) jobs.push([aid, arm, s])
}

console.log(`${jobs.length} edit calls queued`)
let done = 0, failed = 0
await Promise.all(jobs.map(async ([aid, arm, s]) => {
  const asset = ASSETS[aid]
  const prompt = asset.prompts[arm]
  const name = `${aid}--${arm}-s${s}`
  const extra = { ...(ARM_EXTRA[arm] || {}) }
  if (asset.transparent) extra.background = 'transparent'
  extra.meta = { phase: 'B', asset: aid, arm, sample: s, kv: ARM_KV[arm] }
  const r = await edit([refFor(arm)], prompt, asset.size, extra)
  if (r.ok && r.buf?.length) {
    writeFileSync(G + name + '.png', r.buf)
    try {
      await sharp(G + name + '.png').resize(480, 480, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 }).toFile(T + name + '-thumb.webp')
    } catch (e) { rec({ kind: 'thumb_error', asset: aid, arm, sample: s, err: String(e) }) }
    done++
    console.log(`ok ${name} ${r.ms}ms (${done}/${jobs.length})`)
  } else {
    failed++
    const kind = r.err?.isParam ? 'param-rejected' : r.err?.isRefusal ? 'refusal' : 'error'
    console.log(`FAIL ${name} ${r.ms}ms [${kind}] ${r.err?.code || ''} ${r.err?.msg?.slice(0, 160) || ''}`)
  }
}))
console.log(`done=${done} failed=${failed}`)
