// spikes-r4/ref-transfer runner.
// Fixed: model gpt-image-2.6-sunburst, quality "high", images.edit,
// Image 1 = ref/R{n}.png only (no character refs, no Torino).
// Per ref: 1 CLEAN (redraw the ref itself) + 2 TRANSFER (ref as style, new content).
// Arms: N (no last line), S0..S5 last-line variants; S5's style description
// describes THIS ref (S5_DESC below, verbatim in README).
// 4 refs x 3 images x 7 arms = 84 calls, concurrency <= 6.
// Usage: node src/run.mjs [N,S0,...] [R1,...]
import { edit, mkdir, writeFileSync, rec, callImage } from './api.mjs'
import {
  ASSETS, CONTENT, GROUP_ROLES,
  ROLE_BASE, ROLE_KOKOMI, ROLE_OTHER, FRAME_SPRITE,
} from './prompts.mjs'
import sharp from 'sharp'
import { existsSync } from 'node:fs'

const D = new URL('..', import.meta.url).pathname
const G = D + '/gen/'
const MODEL = 'gpt-image-2.6-sunburst'
mkdir(G)

// ---- refs: what each shows + per-ref S5 style description (verbatim in README)
const REFS = {
  R1: {
    path: D + '/ref/R1.png', kokomi: false,   // Raiden Shogun sprite
    s5: 'Rendering as in Image 1: soft anime illustration, delicate thin colored line art, purple-lavender palette with gold accents, smooth painterly gradient shading, diffuse violet-blue sheen along the hair strands, detailed violet eyes with glossy catchlights, soft diffused frontal light. ',
  },
  R2: {
    path: D + '/ref/R2.png', kokomi: true,    // tea-party group CG (Kokomi+Nahida+Furina)
    s5: 'Rendering as in Image 1: soft anime illustration, very fine low-contrast colored line art, bright pastel palette, smooth gradients with soft-edge cel shading, glowing translucent hair highlights, jewel-like detailed eyes, diffused bright daylight. ',
  },
  R3: {
    path: D + '/ref/R3.png', kokomi: true,    // Kokomi beach sunset CG
    s5: 'Rendering as in Image 1: soft anime illustration, extremely thin soft colored line art, pastel sunset palette, smooth airbrushed gradient shading, diffused hair sheen, detailed blue-violet eyes, warm golden-hour backlight. ',
  },
  R4: {
    path: D + '/ref/R4.png', kokomi: true,    // Kokomi underwater jellyfish CG
    s5: 'Rendering as in Image 1: soft anime illustration, very fine tinted line art, cool indigo-cyan palette, smooth airbrushed gradients with glowing accents, crisp cyan light streaks in the hair, intricate violet eyes, ethereal bioluminescent light. ',
  },
}

// ---- tasks per ref: CLEAN + two TRANSFERs
const TASKS = {
  R1: [
    { id: 'CLEAN', size: '1024x1536', sprite: true,
      prompt: 'Redraw Image 1 as the same picture: the same characters, pose, expression, composition, colors and framing. Fully transparent background, no ground or shadow.' },
    { id: 'C5', size: '1024x1536', sprite: true, kokomi: false },
    { id: 'K8', size: '1536x864', kokomi: false },
  ],
  R2: [
    { id: 'CLEAN', size: '1536x864',
      prompt: 'Redraw Image 1 as the same picture: the same characters, pose, expression, composition, colors and framing.' },
    { id: 'K6', size: '1536x864', kokomi: true },
    { id: 'C3', size: '1024x1536', sprite: true, kokomi: false },
  ],
  R3: [
    { id: 'CLEAN', size: '1536x864',
      prompt: 'Redraw Image 1 as the same picture: the same characters, pose, expression, composition, colors and framing.' },
    { id: 'K1', size: '1024x1536', sprite: true, kokomi: true },
    { id: 'K8', size: '1536x864', kokomi: false },
  ],
  R4: [
    { id: 'CLEAN', size: '1536x864',
      prompt: 'Redraw Image 1 as the same picture: the same characters, pose, expression, composition, colors and framing.' },
    { id: 'C1', size: '1024x1536', sprite: true, kokomi: false },
    { id: 'K6', size: '1536x864', kokomi: true },
  ],
}

// ---- last-line arms (text identical to style-line where applicable)
const STYLE_FIX =
  "Rendering: keep the reference's glossy layered hair highlights, soft gradients and color richness. " +
  'Line art is clean, smooth and continuous, drawn with confident strokes of even weight. ' +
  'Hair is grouped into clean ribbon-like strands with smooth color transitions; ' +
  'skin and fabric surfaces are smooth and clean, with folds drawn as a few clear shapes.'
const S2_TEXT =
  'Line art is clean, smooth and continuous, drawn with confident strokes of even weight. ' +
  'Hair is grouped into clean ribbon-like strands with smooth color transitions; ' +
  'skin and fabric surfaces are smooth and clean, with folds drawn as a few clear shapes.'
const LASTLINE = (arm, rkey) => ({
  N: null,
  S0: STYLE_FIX,
  S1: 'Finish: the same rendering as Image 1, cleanly finished.',
  S2: S2_TEXT,
  S3: 'Finish this as a final, fully cleaned-up illustration: inked line art with no sketch lines, stray hairs or broken strokes; flat base colors with smooth airbrushed gradients; highlights placed as a few clean, deliberate shapes, as in Image 1.',
  S4: STYLE_FIX + ' Put fine detail only on the face, eyes, hair ornaments and the main object of the scene; keep clothing folds, background and secondary areas simpler, with fewer lines.',
  S5: REFS[rkey].s5 + S2_TEXT,
}[arm])

const ARMS = process.argv[2] ? process.argv[2].split(',') : ['N', 'S0', 'S1', 'S2', 'S3', 'S4', 'S5']
const REFKEYS = process.argv[3] ? process.argv[3].split(',') : ['R1', 'R2', 'R3', 'R4']

function basePrompt(rkey, task) {
  if (task.id === 'CLEAN') return task.prompt
  const role = ROLE_BASE + (task.kokomi && REFS[rkey].kokomi ? ROLE_KOKOMI : ROLE_OTHER)
  const lines = [role]
  const grole = GROUP_ROLES[task.id]
  if (grole) lines.push(grole)
  lines.push(CONTENT[task.id])
  if (task.sprite) lines.push(FRAME_SPRITE)
  return lines.join('\n')
}
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

async function one(rkey, task, arm) {
  const name = `${rkey}-${task.id}--${arm}`
  const prompt = basePrompt(rkey, task)
  const last = LASTLINE(arm, rkey)
  const full = last ? prompt + '\n' + last : prompt
  const extra = {
    quality: 'high', model: MODEL,
    meta: { ref: rkey, task: task.id, arm, model: MODEL, req_size: task.size, transparent: !!task.sprite, prompt: full },
  }
  if (task.sprite) extra.background = 'transparent'
  const r = await edit([REFS[rkey].path], full, task.size, extra)
  if (r.ok && r.buf?.length) {
    const m = await save(name, r)
    done++
    console.log(`ok ${name} ${r.ms}ms ${m.width}x${m.height}`)
    return true
  }
  if (r.err?.isRefusal) refusals++
  failed++
  failures.push(`${name}: ${r.err?.code || ''} ${r.err?.msg?.slice(0, 140) || ''}`)
  console.log(`FAIL ${name} ${r.ms}ms ${r.err?.code || ''} ${r.err?.msg?.slice(0, 140) || ''}`)
  return false
}

for (const rkey of REFKEYS) {
  if (!existsSync(REFS[rkey].path)) { console.log(`missing ref ${REFS[rkey].path}`); process.exit(1) }
}

console.log(`probing ${MODEL} ...`)
const probe = await callImage('generate', {
  model: MODEL, prompt: 'a single red circle on white', size: '256x256', output_format: 'png',
}, { asset: 'probe', arm: 'probe', model: MODEL, req_size: '256x256' })
const probeOK = probe.ok && probe.buf?.length > 0
console.log('probe:', probeOK ? `ok ${probe.ms}ms` : `rejected ${probe.err?.code || ''} ${probe.err?.msg?.slice(0, 200) || ''}`)
rec({ kind: 'probe', model: MODEL, accepted: probeOK, ms: probe.ms, err: probe.err })
if (!probeOK) { console.log('model rejected, aborting'); process.exit(1) }

const jobs = []
for (const rkey of REFKEYS) for (const task of TASKS[rkey]) for (const arm of ARMS) jobs.push([rkey, task, arm])
console.log(`${jobs.length} calls queued`)
await Promise.all(jobs.map(([rkey, task, arm]) => one(rkey, task, arm)))

console.log(`done=${done} failed=${failed} refusals=${refusals}`)
if (failures.length) console.log('failures:\n  ' + failures.join('\n  '))
