// R4 A/B runner: 3 subjects x 6 variants x 2 samples, concurrency <= 6.
// Writes gen/<subject>--<variant>-s<n>.png and thumbs/<...>-thumb.webp (480px long side).
import { gen, mkdir, writeFileSync, rec } from './api.mjs'
import { SUBJECTS, N_SAMPLES } from './prompts.mjs'
import sharp from 'sharp'

const G = new URL('../gen/', import.meta.url).pathname
const T = new URL('../thumbs/', import.meta.url).pathname
mkdir(G); mkdir(T)

const onlySubject = process.argv[2] // optional filter
const jobs = []
for (const [sid, sub] of Object.entries(SUBJECTS)) {
  if (onlySubject && !sid.includes(onlySubject)) continue
  for (const [vid, v] of Object.entries(sub.vars)) {
    for (let s = 1; s <= N_SAMPLES; s++) {
      jobs.push([sid, vid, s, v])
    }
  }
}

console.log(`${jobs.length} calls queued`)
let done = 0, failed = 0
await Promise.all(jobs.map(async ([sid, vid, s, v]) => {
  const sub = SUBJECTS[sid]
  const name = `${sid}--${vid}-s${s}`
  const extra = { ...(v.extra || {}) }
  if (sub.transparent) extra.background = 'transparent'
  extra.meta = { subject: sid, variant: vid, sample: s }
  const r = await gen(v.prompt, sub.size, extra)
  if (r.ok && r.buf?.length) {
    writeFileSync(G + name + '.png', r.buf)
    try {
      await sharp(G + name + '.png')
        .resize(480, 480, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(T + name + '-thumb.webp')
    } catch (e) { rec({ kind: 'thumb_error', subject: sid, variant: vid, sample: s, err: String(e) }) }
    done++
    console.log(`ok ${name} ${r.ms}ms (${done}/${jobs.length})`)
  } else {
    failed++
    console.log(`FAIL ${name} ${r.ms}ms ${r.err?.code || ''} ${r.err?.msg?.slice(0, 120) || ''}`)
  }
}))
console.log(`done=${done} failed=${failed}`)
