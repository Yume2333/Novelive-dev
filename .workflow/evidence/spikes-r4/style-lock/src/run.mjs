// spikes-r4/style-lock runner: 4 assets x 5 arms x 2 samples.
// T0 = images.generate (no ref); R* = images.edit with ref/kokomi-torino.png
// as Image 1. Writes gen/<asset>--<arm>-s<n>.png, records actual returned
// pixel size in results.jsonl. Usage: node src/run.mjs [asset-substring]
import { gen, edit, mkdir, writeFileSync, rec } from './api.mjs'
import { ASSETS, PROMPTS, ARMS, N_SAMPLES } from './prompts.mjs'
import sharp from 'sharp'

const G = new URL('../gen/', import.meta.url).pathname
const REF = new URL('../ref/kokomi-torino.png', import.meta.url).pathname
mkdir(G)

const onlyAsset = process.argv[2]
const jobs = []
for (const aid of Object.keys(ASSETS)) {
  if (onlyAsset && !aid.includes(onlyAsset)) continue
  for (const arm of ARMS)
    for (let s = 1; s <= N_SAMPLES; s++) jobs.push([aid, arm, s])
}
console.log(`${jobs.length} calls queued`)
let done = 0, failed = 0
await Promise.all(jobs.map(async ([aid, arm, s]) => {
  const asset = ASSETS[aid]
  const prompt = PROMPTS[aid][arm]
  const name = `${aid}--${arm}-s${s}`
  const extra = {}
  if (asset.transparent) extra.background = 'transparent'
  extra.meta = { asset: aid, arm, sample: s, req_size: asset.size, transparent: !!asset.transparent }
  const r = arm === 'T0'
    ? await gen(prompt, asset.size, extra)
    : await edit([REF], prompt, asset.size, extra)
  if (r.ok && r.buf?.length) {
    writeFileSync(G + name + '.png', r.buf)
    let meta = {}
    try { meta = await sharp(G + name + '.png').metadata() } catch {}
    rec({
      kind: 'saved', asset: aid, arm, sample: s,
      actual_size: `${meta.width}x${meta.height}`, has_alpha: meta.hasAlpha === true,
      bytes: r.buf.length,
    })
    done++
    console.log(`ok ${name} ${r.ms}ms ${meta.width}x${meta.height} (${done}/${jobs.length})`)
  } else {
    failed++
    const kind = r.err?.isParam ? 'param' : r.err?.isRefusal ? 'refusal' : 'error'
    console.log(`FAIL ${name} ${r.ms}ms [${kind}] ${r.err?.code || ''} ${r.err?.msg?.slice(0, 160) || ''}`)
  }
}))
console.log(`done=${done} failed=${failed}`)
