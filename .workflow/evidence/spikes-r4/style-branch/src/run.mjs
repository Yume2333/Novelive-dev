// spikes-r4/style-branch runner.
// Same refs/tasks/settings as ref-transfer; only the last-line arm varies.
// Arms (8): S4 A B C S34 M P E — text pieces joined with one space.
// Fix vs ref-transfer: R2->K6 uses a Kokomi-specific role line because R2
// shows three girls (see KOKOMI_LEFT below).
// 4 refs x 3 tasks x 8 arms = 96 calls, concurrency <= 6.
// Usage: node src/run.mjs [S4,A,...] [R1,...]
import { edit, mkdir, writeFileSync, rec, callImage } from './api.mjs'
import {
  CONTENT, GROUP_ROLES,
  ROLE_BASE, ROLE_KOKOMI, ROLE_OTHER, FRAME_SPRITE,
} from './prompts.mjs'
import sharp from 'sharp'
import { existsSync } from 'node:fs'

const D = new URL('..', import.meta.url).pathname
const G = D + '/gen/'
const MODEL = 'gpt-image-2.6-sunburst'
mkdir(G)

const REFS = {
  R1: { path: D + '/ref/R1.png', kokomi: false },   // Raiden sprite
  R2: { path: D + '/ref/R2.png', kokomi: 'left' },  // three girls; Kokomi on the left
  R3: { path: D + '/ref/R3.png', kokomi: true },    // Kokomi beach
  R4: { path: D + '/ref/R4.png', kokomi: true },    // Kokomi jellyfish
}
// R2 has three girls -> name WHICH one is Kokomi
const ROLE_KOKOMI_LEFT =
  ' The girl on the left in Image 1 is Sangonomiya Kokomi; keep her face and hair the same.'

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

// ---- text pieces
const S0 =
  "Rendering: keep the reference's glossy layered hair highlights, soft gradients and color richness. " +
  'Line art is clean, smooth and continuous, drawn with confident strokes of even weight. ' +
  'Hair is grouped into clean ribbon-like strands with smooth color transitions; ' +
  'skin and fabric surfaces are smooth and clean, with folds drawn as a few clear shapes.'
const S3 =
  'Finish this as a final, fully cleaned-up illustration: inked line art with no sketch lines, stray hairs or broken strokes; flat base colors with smooth airbrushed gradients; highlights placed as a few clean, deliberate shapes, as in Image 1.'
const H =
  'Put fine detail only on the face, eyes, hair ornaments and the main object of the scene; keep clothing folds, background and secondary areas simpler, with fewer lines.'
const KEEP =
  "Rendering: keep the reference's glossy layered hair highlights, soft gradients and color richness."

const LASTLINE = {
  S4: S0 + ' ' + H,
  A: KEEP + ' ' + H,
  B: S0 + ' Detail falls off with distance from the face, or from the main object when there is no character: the face, eyes and hair highlights carry the finest detail; ornaments and hands a little less; clothing folds are a few broad shapes; the background is the simplest, with large calm areas and few lines.',
  C: S0 + ' ' + H + ' The background is painted softer and simpler than the characters, with fewer edges and lower contrast, so the characters have the crispest lines in the picture; when there is no character, the main object takes that role.',
  S34: S3 + ' ' + H,
  M: S0 + ' ' + H + ' Fabric, armor and other materials are flat color with a few shading shapes, without printed patterns, weave texture or tiny repeated marks.',
  P: S0 + ' ' + H + ' The picture is viewed on a 1080p screen: the smallest details are still several pixels wide, and areas too small to read stay as plain color.',
  E: S0 + ' ' + H + ' Every outline is one clean stroke, not several sketchy ones; hair strands end in clean tapered points; lines never break or wobble.',
}

const ARMS = process.argv[2] ? process.argv[2].split(',') : ['S4', 'A', 'B', 'C', 'S34', 'M', 'P', 'E']
const REFKEYS = process.argv[3] ? process.argv[3].split(',') : ['R1', 'R2', 'R3', 'R4']

function basePrompt(rkey, task) {
  if (task.id === 'CLEAN') return task.prompt
  let role
  if (task.kokomi && REFS[rkey].kokomi === 'left') role = ROLE_BASE + ROLE_KOKOMI_LEFT
  else if (task.kokomi && REFS[rkey].kokomi === true) role = ROLE_BASE + ROLE_KOKOMI
  else role = ROLE_BASE + ROLE_OTHER
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
  const full = prompt + '\n' + LASTLINE[arm]
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
