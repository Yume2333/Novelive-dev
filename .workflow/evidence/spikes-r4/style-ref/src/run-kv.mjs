// Phase A: key visuals KV-O / KV-P, text-only generate, 1536x864, 2 samples each.
// Writes gen/<kvid>-s<n>.png + thumbs. Sample 1 of each becomes the arm's KV.
import { gen, mkdir, writeFileSync, rec } from './api.mjs'
import { KVS, N_SAMPLES } from './prompts.mjs'
import sharp from 'sharp'

const G = new URL('../gen/', import.meta.url).pathname
const T = new URL('../thumbs/', import.meta.url).pathname
mkdir(G); mkdir(T)

const jobs = []
for (const [kvid, kv] of Object.entries(KVS))
  for (let s = 1; s <= N_SAMPLES; s++) jobs.push([kvid, kv, s])

console.log(`${jobs.length} KV calls queued`)
let done = 0, failed = 0
await Promise.all(jobs.map(async ([kvid, kv, s]) => {
  const name = `${kvid}-s${s}`
  const r = await gen(kv.prompt, kv.size, { meta: { phase: 'A', variant: kvid, sample: s } })
  if (r.ok && r.buf?.length) {
    writeFileSync(G + name + '.png', r.buf)
    try {
      await sharp(G + name + '.png').resize(480, 480, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 }).toFile(T + name + '-thumb.webp')
    } catch (e) { rec({ kind: 'thumb_error', variant: kvid, sample: s, err: String(e) }) }
    done++
    console.log(`ok ${name} ${r.ms}ms`)
  } else {
    failed++
    console.log(`FAIL ${name} ${r.ms}ms ${r.err?.code || ''} ${r.err?.msg?.slice(0, 160) || ''}`)
  }
}))
console.log(`KV done=${done} failed=${failed}`)
