// spikes-r4/texture runner.
// Same ref (ref/kokomi.png), same 3 scenes as single-ref with 2 content edits:
//   T1: "long wide sleeves in pale lavender silk"  (was "with a faint purple pattern")
//   T3: "a green capelet with leaf-shaped edges and gold trim" (was "leaf-pattern capelet")
// Arms (last line): F | F+R | F+N | F+X | F+R+N — pieces from style-branch +
// new R/N/X suppress-mottled-texture lines. Control OLD: T1 only, F with the
// ORIGINAL single-ref T1 content ("faint purple pattern"), 2 runs.
// 3 scenes x 5 arms x 2 + 2 control = 32 calls, concurrency <= 6.
// Usage: node src/run.mjs [F,FR,...] [T1,...] [r1,r2]
import { edit, mkdir, writeFileSync, rec, callImage } from './api.mjs'
import { FRAME_SPRITE } from './prompts.mjs'
import sharp from 'sharp'

const D = new URL('..', import.meta.url).pathname
const G = D + '/gen/'
const REF = D + '/ref/kokomi.png'
const MODEL = 'gpt-image-2.6-sunburst'
mkdir(G)

const ROLE =
  'Image 1 is the style reference: draw in exactly the same art style, line quality, coloring, shading and level of detail.'
const ROLE_OTHER = ' Do not copy the character in Image 1.'
const ROLE_KOKOMI = ' The character in Image 1 is Sangonomiya Kokomi; keep her face, hair and outfit the same.'

const T1_CONTENT =
  'Raiden Shogun stands alone, body turned slightly to the viewer\'s left, face toward the viewer. She is a tall young woman with very long dark violet hair worn in a single thick braid that falls over her right shoulder to her waist, straight blunt bangs, and a hair ornament of small purple flowers with a gold tassel on the right side of her head. Her eyes are violet, calm and steady; her mouth is closed in a level, composed line. She wears a purple kimono-style dress with long wide sleeves in pale lavender silk, worn off the shoulders, a deep red obi sash with a gold rope cord and a gold tassel at the front, a small purple tomoe-shaped ornament at the sash, a short purple skirt hem and dark purple thigh-high stockings. Her right hand rests flat on her chest; her left arm hangs relaxed at her side.'
// control: original single-ref T1 content (faint purple pattern)
const T1_CONTENT_OLD =
  'Raiden Shogun stands alone, body turned slightly to the viewer\'s left, face toward the viewer. She is a tall young woman with very long dark violet hair worn in a single thick braid that falls over her right shoulder to her waist, straight blunt bangs, and a hair ornament of small purple flowers with a gold tassel on the right side of her head. Her eyes are violet, calm and steady; her mouth is closed in a level, composed line. She wears a purple kimono-style dress with long wide sleeves in pale lavender with a faint purple pattern, worn off the shoulders, a deep red obi sash with a gold rope cord and a gold tassel at the front, a small purple tomoe-shaped ornament at the sash, a short purple skirt hem and dark purple thigh-high stockings. Her right hand rests flat on her chest; her left arm hangs relaxed at her side.'

const SCENES = {
  T1: {
    size: '1024x1536', sprite: true,
    role: ROLE + ROLE_OTHER,
    content: T1_CONTENT,
  },
  T2: {
    size: '1536x864',
    role: ROLE + ROLE_KOKOMI,
    content:
      'Sangonomiya Shrine on Watatsumi Island in light rain, late afternoon. A wide stone path runs through the middle of the picture toward a shrine gate and buildings with curved roofs in white and pale coral pink; stone lanterns stand along the path, and the grey-blue sea is visible behind the shrine. Thin streaks of rain fall across the picture; the wet stones are dark and shiny, with shallow puddles reflecting the lanterns. Sangonomiya Kokomi stands alone on the path, slightly left of center, shown from the head to the thighs, body in three-quarter view, face toward the viewer. She has long pale peach-pink hair fading to blue at the tips, a large bow on the back of her head with blue fish-fin ornaments, and violet-blue eyes. She wears the same outfit as in Image 1: a lavender long-sleeved blouse with ruffles and a ribbon tie, a navy-blue pleated skirt with a belt, a turquoise bead bracelet and dark tights. She holds a pale-blue oil-paper umbrella in her right hand, the shaft resting on her shoulder, the canopy tilted back so her whole face is visible; raindrops bead on the umbrella\'s edge. Her eyebrows are relaxed, her eyes soft, and her lips curve in a small closed-mouth smile. No other people are in the picture.',
  },
  T3: {
    size: '1536x864',
    role: ROLE + ROLE_KOKOMI,
    content:
      'A sunny garden terrace in the afternoon, flowering shrubs and trees softly behind. Exactly three girls sit around one round table with a white tablecloth, seen at eye level, each visible from the head to the waist above the table, faces fully visible and not overlapping. On the table: a white porcelain teapot with a blue pattern, three matching teacups on saucers, and a three-tier stand of small cakes in the center. On the left, Sangonomiya Kokomi: long pale peach-pink hair fading to blue at the tips, a large bow with blue fish-fin ornaments, violet-blue eyes, wearing the same lavender ruffled blouse with ribbon tie as in Image 1; she holds her teacup in both hands at chest height and smiles with her mouth closed, eyes turned toward the girl in the middle. In the middle, Nahida: a small girl, much shorter than the other two, with white hair turning green at the tips tied in a side ponytail, a green leaf-shaped hair ornament, pointed elf-like ears, bright green eyes, wearing a white sleeveless dress with a green capelet with leaf-shaped edges and gold trim; she reaches one hand toward a cake on the stand, mouth open in a happy smile. On the right, Raiden Shogun: a tall young woman with long dark violet hair in a single braid over her shoulder, blunt bangs, a purple flower hair ornament, violet eyes, wearing a purple kimono-style dress with pale lavender sleeves and a deep red obi sash with a gold cord; she sits upright holding her teacup by the handle near her lips, a faint calm smile. No other people are in the picture.',
  },
}

// ---- pieces (style-branch verbatim + new)
const S3 =
  'Finish this as a final, fully cleaned-up illustration: inked line art with no sketch lines, stray hairs or broken strokes; flat base colors with smooth airbrushed gradients; highlights placed as a few clean, deliberate shapes, as in Image 1.'
const H =
  'Put fine detail only on the face, eyes, hair ornaments and the main object of the scene; keep clothing folds, background and secondary areas simpler, with fewer lines.'
const E =
  'Every outline is one clean stroke, not several sketchy ones; hair strands end in clean tapered points; lines never break or wobble.'
const F = S3 + ' ' + H + ' ' + E
const RENDER =
  'large simple color masses, low visual frequency, restrained edge density, clear edge hierarchy, minimal internal contour lines, broad shadow shapes, suppress micro-texture and micro-contrast, no unnecessary specular highlights'
const R =
  'On large surfaces — fabric, skin, walls, sky and ground — keep large simple color masses with low visual frequency, and suppress micro-texture and micro-contrast inside them; show the material through sheen, folds and soft gradients instead. Hair highlights, eyes and the gradients of Image 1 stay as they are.'
const N =
  'Fabric still reads as its material — silk sheen, soft folds, the weight of the cloth — but no surface carries mottled, layered fish-scale smudges, repeated dabs or crackle marks; each area of color is one continuous, smooth gradient.'
const X = RENDER + ', except that hair highlights, eyes and the gradients of Image 1 stay exactly as in Image 1.'

const LASTLINE = {
  F,
  'F+R': F + ' ' + R,
  'F+N': F + ' ' + N,
  'F+X': F + ' ' + X,
  'F+R+N': F + ' ' + R + ' ' + N,
  'F+X+N': F + ' ' + X + ' ' + N,
  'F+X-med': F + ' ' + X,   // same text as F+X, quality:"medium" (see call())
}

const ARMS = process.argv[2] ? process.argv[2].split(',') : ['F', 'F+R', 'F+N', 'F+X', 'F+R+N']
const SCN = process.argv[3] ? process.argv[3].split(',') : ['T1', 'T2', 'T3']
const RUNS = process.argv[4] ? process.argv[4].split(',') : ['r1', 'r2']

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

function promptFor(skey, arm, { old = false, nameRemoved = false } = {}) {
  const s = SCENES[skey]
  let content = old ? T1_CONTENT_OLD : s.content
  if (nameRemoved) {
    content = content
      .replace(/Raiden Shogun/g, 'the tall violet-haired woman')
      .replace(/Sangonomiya Shrine on Watatsumi Island|Watatsumi Island/g, 'an island shrine')
      .replace(/Sangonomiya Kokomi/g, 'the girl from Image 1')
      .replace(/Nahida/g, 'the small green-haired girl')
  }
  const lines = [s.role, content]
  if (s.sprite) lines.push(FRAME_SPRITE)
  lines.push(LASTLINE[arm])
  return lines.join('\n')
}

async function call(skey, arm, run, opts = {}) {
  const s = SCENES[skey]
  const name = opts.old ? `${skey}--OLD--${run}` : `${skey}--${arm}--${run}`
  const prompt = promptFor(skey, arm, opts)
  const quality = arm === 'F+X-med' ? 'medium' : 'high'
  const extra = {
    quality, model: MODEL,
    meta: { scene: skey, arm: opts.old ? 'OLD' : arm, run, model: MODEL, quality, req_size: s.size, transparent: !!s.sprite, nameRemoved: !!opts.nameRemoved, prompt },
  }
  if (s.sprite) extra.background = 'transparent'
  return { name, r: await edit([REF], prompt, s.size, extra) }
}

async function one(skey, arm, run, opts = {}) {
  let { name, r } = await call(skey, arm, run, opts)
  if (!r.ok && r.err?.isRefusal) {
    refusals++
    console.log(`REFUSED ${name} ${r.err?.code || ''} -> name-removed retry`)
    rec({ kind: 'refusal_retry', name })
    const retry = await call(skey, arm, run, { ...opts, nameRemoved: true })
    r = retry.r
  }
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

console.log(`probing ${MODEL} ...`)
const probe = await callImage('generate', {
  model: MODEL, prompt: 'a single red circle on white', size: '256x256', output_format: 'png',
}, { asset: 'probe', arm: 'probe', model: MODEL, req_size: '256x256' })
const probeOK = probe.ok && probe.buf?.length > 0
console.log('probe:', probeOK ? `ok ${probe.ms}ms` : `rejected ${probe.err?.code || ''} ${probe.err?.msg?.slice(0, 200) || ''}`)
rec({ kind: 'probe', model: MODEL, accepted: probeOK, ms: probe.ms, err: probe.err })
if (!probeOK) { console.log('model rejected, aborting'); process.exit(1) }

const jobs = []
for (const skey of SCN) for (const arm of ARMS) for (const run of RUNS) jobs.push([skey, arm, run])
// control: T1 only, F with original content, 2 runs
for (const run of RUNS) jobs.push(['T1', 'F', run, { old: true }])
console.log(`${jobs.length} calls queued`)
await Promise.all(jobs.map(([skey, arm, run, opts]) => one(skey, arm, run, opts)))

console.log(`done=${done} failed=${failed} refusals=${refusals}`)
if (failures.length) console.log('failures:\n  ' + failures.join('\n  '))
