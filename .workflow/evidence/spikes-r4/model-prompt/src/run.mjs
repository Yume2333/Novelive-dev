// spikes-r4/model-prompt runner.
// 2x2 arm matrix, all images.edit with Image 1 = Torino reference, quality:"high":
//   FR = gpt-image-2.6-flare    + RENDER block as last line
//   FS = gpt-image-2.6-flare    + clean-style arm-C style-fix line as last line
//   SR = gpt-image-2.6-sunburst + RENDER block as last line
//   SS = gpt-image-2.6-sunburst + style-fix line as last line
// Assets: K1 K4 K6 K7 K8 C1 C2 C3 C5 G2 (10 assets x 4 arms = 40 calls).
// G2 refs: Image 2/3 = THIS arm's C2/C3 raw sprites (G2 runs after sprites).
// Usage: node src/run.mjs [FR,FS,SR,SS] [K1,...]
import { edit, mkdir, writeFileSync, rec, callImage } from './api.mjs'
import { ASSETS, buildPrompt, RENDER } from './prompts.mjs'
import sharp from 'sharp'
import { existsSync } from 'node:fs'

const D = new URL('..', import.meta.url).pathname
const G = D + '/gen/'
const REF = D + '/ref/kokomi-torino-white.png'
mkdir(G)

const IDS = process.argv[3] ? process.argv[3].split(',') :
  ['K1', 'K4', 'K6', 'K7', 'K8', 'C1', 'C2', 'C3', 'C5', 'G2']
const ARMS = process.argv[2] ? process.argv[2].split(',') : ['FR', 'FS', 'SR', 'SS']

const MODELS = {
  F: 'gpt-image-2.6-flare',
  S: 'gpt-image-2.6-sunburst',
}
// clean-style arm C line, verbatim
const STYLE_FIX =
  "Rendering: keep the reference's glossy layered hair highlights, soft gradients and color richness. " +
  'Line art is clean, smooth and continuous, drawn with confident strokes of even weight. ' +
  'Hair is grouped into clean ribbon-like strands with smooth color transitions; ' +
  'skin and fabric surfaces are smooth and clean, with folds drawn as a few clear shapes.'
const LASTLINE = { R: RENDER, S: STYLE_FIX }

const promptFor = (aid, arm) => buildPrompt(aid, 'A') + '\n' + LASTLINE[arm[1]]
const refsFor = (aid, arm) =>
  aid === 'G2' ? [REF, `${G}C2--${arm}.png`, `${G}C3--${arm}.png`] : [REF]

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
  const model = MODELS[arm[0]]
  const size = asset.size
  const refs = refsFor(aid, arm)
  for (const p of refs) {
    if (!existsSync(p)) { console.log(`SKIP ${aid}--${arm}: missing ${p}`); failed++; failures.push(`${aid}--${arm}: missing ref ${p}`); return false }
  }
  const prompt = promptFor(aid, arm)
  const extra = { quality: 'high', model, meta: { asset: aid, arm, model, req_size: size, transparent: !!asset.transparent, prompt } }
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

// probe each model used (one cheap generate call); rejected models only
// disable their own column, the other model's arms still run.
const okKeys = new Set()
for (const k of new Set(ARMS.map((a) => a[0]))) {
  const model = MODELS[k]
  console.log(`probing ${model} ...`)
  const probe = await callImage('generate', {
    model, prompt: 'a single red circle on white', size: '256x256', output_format: 'png',
  }, { asset: 'probe', arm: `${k}-probe`, model, req_size: '256x256' })
  const ok = probe.ok && probe.buf?.length > 0
  console.log(`${model} probe:`, ok ? `ok ${probe.ms}ms` : `rejected ${probe.err?.code || ''} ${probe.err?.msg?.slice(0, 200) || ''}`)
  rec({ kind: 'probe', model, accepted: ok, ms: probe.ms, err: probe.err })
  if (ok) okKeys.add(k)
}

// sprites first (G2 needs this arm's C2/C3), then G2; arm-major keeps the
// per-arm C2/C3 results available when that arm's G2 runs.
for (const arm of ARMS) {
  if (!okKeys.has(arm[0])) { console.log(`skipping arm ${arm}: model rejected`); continue }
  const spriteIds = IDS.filter((i) => i !== 'G2')
  await Promise.all(spriteIds.map((aid) => one(aid, arm)))
  if (IDS.includes('G2')) await one('G2', arm)
}

console.log(`done=${done} failed=${failed} refusals=${refusals}`)
if (failures.length) console.log('failures:\n  ' + failures.join('\n  '))
