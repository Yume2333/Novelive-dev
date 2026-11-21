// spikes-r4/style-line runner.
// Fixed: model gpt-image-2.6-sunburst, quality "high", images.edit,
// Image 1 = Torino ref; role line + content + framing exactly as model-prompt SS.
// Only the style-fix LAST LINE varies (arms S0..S6; S6 puts it after the role
// line instead of at the end).
// Assets: K1 K4 K7 C3 G2 (7 arms x 5 = 35 calls, concurrency <= 6).
// G2 refs: Image 2/3 = ref/C2.png + ref/C3.png = model-prompt's C2--SS / C3--SS
// (fixed for every arm so only the line varies).
// Every raw output gets D1 postproc via src/postproc.mjs (separate step).
// Usage: node src/run.mjs [S0,S1,...] [K1,...]
import { edit, mkdir, writeFileSync, rec, callImage } from './api.mjs'
import { ASSETS, buildPrompt } from './prompts.mjs'
import sharp from 'sharp'
import { existsSync } from 'node:fs'

const D = new URL('..', import.meta.url).pathname
const G = D + '/gen/'
const REF = D + '/ref/kokomi-torino-white.png'
const G2_REFS = [REF, D + '/ref/C2.png', D + '/ref/C3.png']
const MODEL = 'gpt-image-2.6-sunburst'
mkdir(G)

const IDS = process.argv[3] ? process.argv[3].split(',') : ['K1', 'K4', 'K7', 'C3', 'G2']
const ARMS = process.argv[2] ? process.argv[2].split(',') : ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6']

// S0 = clean-style arm C / model-prompt SS style-fix line, verbatim
const STYLE_FIX =
  "Rendering: keep the reference's glossy layered hair highlights, soft gradients and color richness. " +
  'Line art is clean, smooth and continuous, drawn with confident strokes of even weight. ' +
  'Hair is grouped into clean ribbon-like strands with smooth color transitions; ' +
  'skin and fabric surfaces are smooth and clean, with folds drawn as a few clear shapes.'
const S2_TEXT =
  'Line art is clean, smooth and continuous, drawn with confident strokes of even weight. ' +
  'Hair is grouped into clean ribbon-like strands with smooth color transitions; ' +
  'skin and fabric surfaces are smooth and clean, with folds drawn as a few clear shapes.'
const LINES = {
  S0: STYLE_FIX,
  S1: 'Finish: the same rendering as Image 1, cleanly finished.',
  S2: S2_TEXT,
  S3: 'Finish this as a final, fully cleaned-up illustration: inked line art with no sketch lines, stray hairs or broken strokes; flat base colors with smooth airbrushed gradients; highlights placed as a few clean, deliberate shapes, as in Image 1.',
  S4: STYLE_FIX + ' Put fine detail only on the face, eyes, hair ornaments and the main object of the scene; keep clothing folds, background and secondary areas simpler, with fewer lines.',
  S5: 'Rendering as in Image 1: soft anime illustration, thin colored line art, airy pastel palette, smooth airbrushed gradient shading, glossy layered hair highlights, large eyes with bright iris reflections, soft glowing light. ' + S2_TEXT,
  // S6: STYLE_FIX placed right after the role line (before content) — see promptFor
}

function promptFor(aid, arm) {
  const base = buildPrompt(aid, 'A')   // same as model-prompt SS base
  if (arm === 'S6') {
    const lines = base.split('\n')
    return [lines[0], STYLE_FIX, ...lines.slice(1)].join('\n')
  }
  return base + '\n' + LINES[arm]
}

const refsFor = (aid) => (aid === 'G2' ? G2_REFS : [REF])

let done = 0, failed = 0, refusals = 0
const failures = []

async function save(name, r) {
  const p = G + name + '.png'
  writeFileSync(p, r.buf)
  let meta = {}
  try { meta = await sharp(p).metadata() } catch {}
  rec({ kind: 'saved', name, actual_size: `${meta.width}x${meta.height}`, has_alpha: meta.hasAlpha === true, bytes: r.buf.length })
  return meta
}

async function one(aid, arm) {
  const asset = ASSETS[aid]
  const size = asset.size
  const refs = refsFor(aid)
  for (const p of refs) {
    if (!existsSync(p)) { console.log(`SKIP ${aid}--${arm}: missing ${p}`); failed++; failures.push(`${aid}--${arm}: missing ref ${p}`); return false }
  }
  const prompt = promptFor(aid, arm)
  const extra = { quality: 'high', model: MODEL, meta: { asset: aid, arm, model: MODEL, req_size: size, transparent: !!asset.transparent, prompt } }
  if (asset.transparent) extra.background = 'transparent'
  const r = await edit(refs, prompt, size, extra)
  if (r.ok && r.buf?.length) {
    const m = await save(`${aid}--${arm}`, r)
    done++
    console.log(`ok ${aid}--${arm} ${r.ms}ms ${m.width}x${m.height}`)
    return true
  }
  if (r.err?.isRefusal) refusals++
  failed++
  failures.push(`${aid}--${arm}: ${r.err?.code || ''} ${r.err?.msg?.slice(0, 140) || ''}`)
  console.log(`FAIL ${aid}--${arm} ${r.ms}ms ${r.err?.code || ''} ${r.err?.msg?.slice(0, 140) || ''}`)
  return false
}

// probe sunburst once
console.log(`probing ${MODEL} ...`)
const probe = await callImage('generate', {
  model: MODEL, prompt: 'a single red circle on white', size: '256x256', output_format: 'png',
}, { asset: 'probe', arm: 'probe', model: MODEL, req_size: '256x256' })
const probeOK = probe.ok && probe.buf?.length > 0
console.log('probe:', probeOK ? `ok ${probe.ms}ms` : `rejected ${probe.err?.code || ''} ${probe.err?.msg?.slice(0, 200) || ''}`)
rec({ kind: 'probe', model: MODEL, accepted: probeOK, ms: probe.ms, err: probe.err })
if (!probeOK) { console.log('model rejected, aborting'); process.exit(1) }

// sprites first (G2 refs are fixed files, so only ordering matters for log clarity)
const jobs = []
for (const arm of ARMS) for (const aid of IDS) jobs.push([aid, arm])
console.log(`${jobs.length} calls queued`)
await Promise.all(jobs.map(([aid, arm]) => one(aid, arm)))

console.log(`done=${done} failed=${failed} refusals=${refusals}`)
if (failures.length) console.log('failures:\n  ' + failures.join('\n  '))
