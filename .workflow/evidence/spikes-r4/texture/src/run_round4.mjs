// spikes-r4/texture round4: palette leak from the style reference (A/B), sunburst only.
// Both arms use the docs/visuals.md 2.5 assembly instead of the old single-ref role line:
//   style-reference declaration (singular) + content + framing + color-lock lines + FXB.
//   A = 2.5 verbatim (declaration includes "overall color treatment").
//   B = declaration without "overall color treatment" + PALETTE line after the color locks.
// Content: round3 scenes with "as in Image 1" outfit references spelled out (the
// declaration forbids copying the person), identical for A and B.
// 3 scenes x 2 arms x 2 runs = 12 calls. Output: gen/round4/<scene>--<arm>--r{1,2}.png
// Usage: node src/run_round4.mjs [A,B] [T1,T2,T3] [r1,r2] | --print <scene> <arm>
import { edit, mkdir, writeFileSync, rec } from './api.mjs'
import { FRAME_SPRITE } from './prompts.mjs'
import sharp from 'sharp'

const D = new URL('..', import.meta.url).pathname
const G = D + '/gen/round4/'
const REF = D + '/ref/kokomi.png'
const MODEL = 'gpt-image-2.6-sunburst'
const SIZE = { sprite: '1024x1536', wide: '1536x864' }
mkdir(G)

// docs/visuals.md 2.5 declaration, singular form (one style reference)
const DECL = {
  A: 'Image 1 is a style reference only. Match how it is drawn: line quality, coloring and shading method, brushwork, level of detail, lighting and overall color treatment, including whether it is in color or monochrome. Do not copy the person in it: face, hairstyle, hair and eye color, outfit and accessories come only from the description below.',
  B: 'Image 1 is a style reference only. Match how it is drawn: line quality, coloring and shading method, brushwork, level of detail and lighting, including whether it is in color or monochrome. Do not copy the person in it: face, hairstyle, hair and eye color, outfit and accessories come only from the description below.',
}
const PALETTE =
  "The palette comes from the description: time of day, weather, light sources and the stated colors of objects decide the colors; white objects stay white. Keep the style reference's way of coloring, not its color cast."
// docs/visuals.md 2.5 color-lock sentence, singular
const lock = (name, colors) =>
  `${name}: ${colors}. These colors come from the description, not from the style reference; in a monochrome style, show them as tones.`
const KC = {
  raiden: lock('Raiden Shogun', 'dark violet hair, violet eyes, purple kimono-style dress with pale lavender sleeves, deep red obi sash with a gold cord'),
  kokomi: lock('Sangonomiya Kokomi', 'pale peach-pink hair fading to blue at the tips, violet-blue eyes, lavender blouse, navy-blue pleated skirt'),
  nahida: lock('Nahida', 'white hair turning green at the tips, bright green eyes, white sleeveless dress, green capelet with gold trim'),
}

const T1_CONTENT =
  'Raiden Shogun stands alone, body turned slightly to the viewer\'s left, face toward the viewer. She is a tall young woman with very long dark violet hair worn in a single thick braid that falls over her right shoulder to her waist, straight blunt bangs, and a hair ornament of small purple flowers with a gold tassel on the right side of her head. Her eyes are violet, calm and steady; her mouth is closed in a level, composed line. She wears a purple kimono-style dress with long wide sleeves in pale lavender silk, worn off the shoulders, a deep red obi sash with a gold rope cord and a gold tassel at the front, a small purple tomoe-shaped ornament at the sash, a short purple skirt hem and dark purple thigh-high stockings. Her right hand rests flat on her chest; her left arm hangs relaxed at her side.'
const SCENES = {
  T1: {
    sprite: true,
    locks: [KC.raiden],
    content: T1_CONTENT,
  },
  T2: {
    locks: [KC.kokomi],
    content:
      'Sangonomiya Shrine on Watatsumi Island in light rain, late afternoon. A wide stone path runs through the middle of the picture toward a shrine gate and buildings with curved roofs in white and pale coral pink; stone lanterns stand along the path, and the grey-blue sea is visible behind the shrine. Thin streaks of rain fall across the picture; the wet stones are dark and shiny, with shallow puddles reflecting the lanterns. Sangonomiya Kokomi stands alone on the path, slightly left of center, shown from the head to the thighs, body in three-quarter view, face toward the viewer. She has long pale peach-pink hair fading to blue at the tips, a large bow on the back of her head with blue fish-fin ornaments, and violet-blue eyes. She wears the same outfit as in Image 1: a lavender long-sleeved blouse with ruffles and a ribbon tie, a navy-blue pleated skirt with a belt, a turquoise bead bracelet and dark tights. She holds a pale-blue oil-paper umbrella in her right hand, the shaft resting on her shoulder, the canopy tilted back so her whole face is visible; raindrops bead on the umbrella\'s edge. Her eyebrows are relaxed, her eyes soft, and her lips curve in a small closed-mouth smile. No other people are in the picture.',
  },
  T3: {
    locks: [KC.kokomi, KC.nahida, KC.raiden],
    content:
      'A sunny garden terrace in the afternoon, flowering shrubs and trees softly behind. Exactly three girls sit around one round table with a white tablecloth, seen at eye level, each visible from the head to the waist above the table, faces fully visible and not overlapping. On the table: a white porcelain teapot with a blue pattern, three matching teacups on saucers, and a three-tier stand of small cakes in the center. On the left, Sangonomiya Kokomi: long pale peach-pink hair fading to blue at the tips, a large bow with blue fish-fin ornaments, violet-blue eyes, wearing the same lavender ruffled blouse with ribbon tie as in Image 1; she holds her teacup in both hands at chest height and smiles with her mouth closed, eyes turned toward the girl in the middle. In the middle, Nahida: a small girl, much shorter than the other two, with white hair turning green at the tips tied in a side ponytail, a green leaf-shaped hair ornament, pointed elf-like ears, bright green eyes, wearing a white sleeveless dress with a green capelet with leaf-shaped edges and gold trim; she reaches one hand toward a cake on the stand, mouth open in a happy smile. On the right, Raiden Shogun: a tall young woman with long dark violet hair in a single braid over her shoulder, blunt bangs, a purple flower hair ornament, violet eyes, wearing a purple kimono-style dress with pale lavender sleeves and a deep red obi sash with a gold cord; she sits upright holding her teacup by the handle near her lips, a faint calm smile. No other people are in the picture.',
  },
}

// ---- final adopted last line = FXB (docs/visuals.md 2.4 item 7, verbatim)
const S3 =
  'Finish this as a final, fully cleaned-up illustration: inked line art with no sketch lines, stray hairs or broken strokes; flat base colors with smooth airbrushed gradients; highlights placed as a few clean, deliberate shapes, as in Image 1.'
const H =
  'Put fine detail only on the face, eyes, hair ornaments and the main object of the scene; keep clothing folds, background and secondary areas simpler, with fewer lines.'
const E =
  'Every outline is one clean stroke, not several sketchy ones; hair strands end in clean tapered points; lines never break or wobble.'
const F = S3 + ' ' + H + ' ' + E
const RENDER =
  'large simple color masses, low visual frequency, restrained edge density, clear edge hierarchy, minimal internal contour lines, broad shadow shapes, suppress micro-texture and micro-contrast, no unnecessary specular highlights'
const XB = RENDER + ', except that hair highlights, eyes, the gradients, and the brushwork and stroke texture of Image 1 stay exactly as in Image 1.'
export const FXB = F + ' ' + XB

const ARMS = process.argv[2] ? process.argv[2].split(',') : ['A', 'B']
const SCN = process.argv[3] ? process.argv[3].split(',') : ['T1', 'T2', 'T3']
const RUNS = process.argv[4] ? process.argv[4].split(',') : ['r1', 'r2']

let done = 0, failed = 0, refusals = 0
const failures = []

async function save(name, r) {
  const p = G + name + '.png'
  writeFileSync(p, r.buf)
  let meta = {}
  try { meta = await sharp(p).metadata() } catch {}
  rec({ kind: 'saved', round: 4, name, actual_size: `${meta.width}x${meta.height}`, has_alpha: meta.hasAlpha === true, bytes: r.buf.length })
  return meta
}

function promptFor(skey, arm, { nameRemoved = false } = {}) {
  const s = SCENES[skey]
  let content = s.content
    .replace('She wears the same outfit as in Image 1: a lavender', 'She wears a lavender')
    .replace('wearing the same lavender ruffled blouse with ribbon tie as in Image 1', 'wearing a lavender ruffled blouse with a ribbon tie')
  if (content.includes('as in Image 1')) throw new Error(`${skey}: leftover "as in Image 1" in content`)
  let locks = s.locks
  if (nameRemoved) {
    const nr = (t) => t
      .replace(/Raiden Shogun/g, 'the tall violet-haired woman')
      .replace(/Sangonomiya Shrine on Watatsumi Island|Watatsumi Island/g, 'an island shrine')
      .replace(/Sangonomiya Kokomi/g, 'the girl with peach-pink hair')
      .replace(/Nahida/g, 'the small green-haired girl')
    content = nr(content)
    locks = locks.map(nr)
  }
  const lines = [DECL[arm], content]
  if (s.sprite) lines.push(FRAME_SPRITE)
  lines.push(...locks)
  if (arm === 'B') lines.push(PALETTE)
  lines.push(FXB)
  return lines.join('\n')
}

async function call(skey, arm, run, opts = {}) {
  const s = SCENES[skey]
  const size = s.sprite ? SIZE.sprite : SIZE.wide
  const name = `${skey}--${arm}--${run}`
  const prompt = promptFor(skey, arm, opts)
  const extra = {
    quality: 'high', model: MODEL,
    meta: { round: 4, scene: skey, arm, run, model: MODEL, quality: 'high', req_size: size, transparent: !!s.sprite, nameRemoved: !!opts.nameRemoved, prompt },
  }
  if (s.sprite) extra.background = 'transparent'
  return { name, r: await edit([REF], prompt, size, extra) }
}

async function one(skey, arm, run) {
  let { name, r } = await call(skey, arm, run)
  if (!r.ok && r.err?.isRefusal) {
    refusals++
    console.log(`REFUSED ${name} ${r.err?.code || ''} -> name-removed retry`)
    rec({ kind: 'refusal_retry', round: 4, name })
    r = (await call(skey, arm, run, { nameRemoved: true })).r
  }
  if (r.ok && r.buf?.length) {
    const m = await save(name, r)
    done++
    console.log(`ok ${name} ${r.ms}ms ${m.width}x${m.height} out=${r.usage?.output_tokens ?? '?'}`)
    return true
  }
  if (r.err?.isRefusal) refusals++
  failed++
  failures.push(`${name}: ${r.err?.status || ''} ${r.err?.code || ''} ${r.err?.msg?.slice(0, 300) || ''}`)
  console.log(`FAIL ${name} ${r.ms}ms ${r.err?.status || ''} ${r.err?.code || ''} ${r.err?.msg?.slice(0, 300) || ''}`)
  return false
}

if (process.argv[2] === '--print') {
  console.log(promptFor(process.argv[3] || 'T1', process.argv[4] || 'A'))
  process.exit(0)
}

const jobs = []
for (const skey of SCN) for (const arm of ARMS) for (const run of RUNS) jobs.push([skey, arm, run])
console.log(`${jobs.length} calls queued`)
await Promise.all(jobs.map(([skey, arm, run]) => one(skey, arm, run)))

console.log(`done=${done} failed=${failed} refusals=${refusals}`)
if (failures.length) console.log('failures:\n  ' + failures.join('\n  '))
