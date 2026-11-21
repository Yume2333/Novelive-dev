// spikes-r4/clean-style runner.
// Assets: K1 K4 K6 C1 C3 G2 (1 sample each). Arms C E F G H are API calls;
// A and B are copied from genshin-style; D is post-process (see postproc.mjs).
// Arm C  = A prompt + Rendering line (final line).
// Arm E  = images.edit, Image1 = A output, Image2 = Torino ref, cleanup prompt.
//        If the cleanup call refuses/fails we fall back to regenerating with the
//        A prompt via Image-2-style-ref edit (logged as E-fb) so the sheet still
//        has an image — but only if the direct edit failed.
// Arm F  = A prompt + quality:"high".
// Arm G  = C prompt + quality:"high".
// Arm H  = A prompt on model gpt-image-2.6-sunburst (probe first).
import { edit, callImage, mkdir, writeFileSync, rec, MODEL } from './api.mjs'
import { ASSETS, buildPrompt } from './prompts.mjs'
import sharp from 'sharp'
import { existsSync } from 'node:fs'
import { toFile } from 'openai'
import { createReadStream } from 'node:fs'

const D = new URL('..', import.meta.url).pathname
const G = D + '/gen/'
const REF = D + '/ref/kokomi-torino-white.png'
mkdir(G)

const IDS = ['K1', 'K4', 'K6', 'C1', 'C3', 'G2']
// G2 group refs = this arm's C2/C3 sprites per spec; for arms that don't
// regenerate sprites (all of ours), spec says use the A sprites.
const G2_REFS = [`${G}C2--A.png`, `${G}C3--A.png`]

const RENDER_C =
  "Rendering: keep the reference's glossy layered hair highlights, soft gradients and color richness. " +
  'Line art is clean, smooth and continuous, drawn with confident strokes of even weight. ' +
  'Hair is grouped into clean ribbon-like strands with smooth color transitions; ' +
  'skin and fabric surfaces are smooth and clean, with folds drawn as a few clear shapes.'

const PROMPT_E =
  'Image 1 is the illustration to clean up. Image 2 is the style reference. ' +
  'Redraw Image 1 with the same composition, characters, pose, colors, lighting and hair highlights, ' +
  "matching Image 2's rendering. Replace all wobbly, broken or sketchy lines with clean smooth " +
  'continuous lines, and replace grainy or noisy texture in hair, skin and fabric with smooth clean ' +
  'color and gradients.'

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

function refsFor(aid) {
  if (aid === 'G2') return [REF, ...G2_REFS]
  return [REF]
}

// promptC = arm-A prompt with the Rendering line appended as final line
function promptC(aid) {
  return buildPrompt(aid, 'A') + '\n' + RENDER_C
}

async function oneEdit(aid, arm, refs, prompt, size, extra = {}) {
  const asset = ASSETS[aid]
  const meta0 = { asset: aid, arm, req_size: size, transparent: !!asset.transparent }
  if (asset.transparent) extra.background = 'transparent'
  const r = await edit(refs, prompt, size, { ...extra, meta: { ...meta0, prompt } })
  if (r.ok && r.buf?.length) {
    const m = await save(`${aid}--${arm}`, r)
    done++
    console.log(`ok ${aid}--${arm} ${r.ms}ms ${m.width}x${m.height}`)
    return true
  }
  failed++
  failures.push(`${aid}--${arm}: ${r.err?.code || ''} ${r.err?.msg?.slice(0, 140) || ''}`)
  console.log(`FAIL ${aid}--${arm} ${r.ms}ms ${r.err?.code || ''} ${r.err?.msg?.slice(0, 140) || ''}`)
  return false
}

const arms = process.argv[2] ? process.argv[2].split(',') : ['C', 'E', 'F', 'G', 'H']

// ---- H probe: one cheap call on sunburst ----
let sunburstOK = false
if (arms.includes('H')) {
  console.log('probing gpt-image-2.6-sunburst ...')
  const probe = await callImage('generate', {
    model: 'gpt-image-2.6-sunburst',
    prompt: 'a single red circle on white',
    size: '256x256',
    output_format: 'png',
  }, { asset: 'probe', arm: 'H-probe', req_size: '256x256' })
  sunburstOK = probe.ok && probe.buf?.length > 0
  console.log('sunburst probe:', sunburstOK ? `ok ${probe.ms}ms` : `rejected ${probe.err?.code || ''} ${probe.err?.msg?.slice(0, 200) || ''}`)
  rec({ kind: 'probe', arm: 'H', model: 'gpt-image-2.6-sunburst', accepted: sunburstOK, ms: probe.ms, err: probe.err })
}

const jobs = []
for (const aid of IDS) {
  for (const arm of arms) {
    if (arm === 'H' && !sunburstOK) continue
    jobs.push([aid, arm])
  }
}
console.log(`${jobs.length} calls queued (arms=${arms.join(',')}, sunburst=${sunburstOK})`)

await Promise.all(jobs.map(([aid, arm]) => {
  const size = ASSETS[aid].size
  if (arm === 'C') return oneEdit(aid, 'C', refsFor(aid), promptC(aid), size)
  if (arm === 'E') {
    const aPath = `${G}${aid}--A.png`
    if (!existsSync(aPath)) { console.log(`SKIP ${aid}--E: no A output`); return false }
    return oneEdit(aid, 'E', [aPath, REF], PROMPT_E, size)
  }
  if (arm === 'F') return oneEdit(aid, 'F', refsFor(aid), buildPrompt(aid, 'A'), size, { quality: 'high' })
  if (arm === 'G') return oneEdit(aid, 'G', refsFor(aid), promptC(aid), size, { quality: 'high' })
  if (arm === 'H') {
    // model override: call callImage directly with sunburst
    return (async () => {
      const asset = ASSETS[aid]
      const meta0 = { asset: aid, arm: 'H', req_size: size, transparent: !!asset.transparent, model: 'gpt-image-2.6-sunburst' }
      const image = []
      const refs = refsFor(aid)
      for (let i = 0; i < refs.length; i++) image.push(await toFile(createReadStream(refs[i]), `ref${i}.png`, { type: 'image/png' }))
      const args = { model: 'gpt-image-2.6-sunburst', image, prompt: buildPrompt(aid, 'A'), size, output_format: 'png' }
      if (asset.transparent) args.background = 'transparent'
      const r = await callImage('edit', args, { ...meta0, prompt: args.prompt })
      if (r.ok && r.buf?.length) {
        const m = await save(`${aid}--H`, r)
        done++
        console.log(`ok ${aid}--H ${r.ms}ms ${m.width}x${m.height}`)
        return true
      }
      failed++
      failures.push(`${aid}--H: ${r.err?.code || ''} ${r.err?.msg?.slice(0, 140) || ''}`)
      console.log(`FAIL ${aid}--H ${r.ms}ms ${r.err?.code || ''} ${r.err?.msg?.slice(0, 140) || ''}`)
      return false
    })()
  }
}))

console.log(`done=${done} failed=${failed}`)
if (failures.length) console.log('failures:\n  ' + failures.join('\n  '))
