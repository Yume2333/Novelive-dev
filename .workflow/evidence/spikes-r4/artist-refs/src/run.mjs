// spikes-r4/artist-refs runner.
// F+X last line on three new third-party reference styles (ref/A.png, B.png, C.png;
// gitignored). Per ref: one sprite of the ref's character + one CG, 3 runs each.
// sunburst, quality high, images.edit, Image 1 = that ref only.
// Usage: node src/run.mjs [A,B,C] [sprite,cg] [r1,r2,r3]
import { edit, mkdir, writeFileSync, rec } from './api.mjs'
import { FRAME_SPRITE } from './prompts.mjs'
import sharp from 'sharp'

const D = new URL('..', import.meta.url).pathname
const G = D + '/gen/'
const MODEL = 'gpt-image-2.6-sunburst'
mkdir(G)

const ROLE =
  'Image 1 is the style reference: draw in exactly the same art style, line quality, coloring, shading and level of detail. The girl in Image 1 is the character to draw; keep her face, hair and outfit the same.'

const CONTENT = {
  A: {
    sprite:
      "The girl from Image 1 stands alone facing the viewer, body turned slightly to the viewer's right. She has a shoulder-length black bob with straight bangs, pale grey eyes, a black lily-shaped flower ornament with a thin black ribbon on the right side of her head, and a thin black choker. She wears a sheer black long-sleeved blouse with a small round collar, a single white button at the throat and a thin black ribbon tie, a black knit vest over it, a black knee-length pleated skirt and black tights; two thin silver bangles on her left wrist. Her hands are held loosely together in front of her skirt. Her eyebrows are level, her eyes half-lowered and calm, her lips slightly parted.",
    cg:
      'An old library at dusk, empty except for the girl from Image 1. Tall dark wooden bookshelves fill both sides; on the right, a tall window with rain running down the glass lets in cold blue-grey light, and a small desk lamp on a reading table gives a warm glow. She stands by the window, shown from the head to the thighs in three-quarter view, holding an open book against her chest with both hands, and looks out of the window with a quiet, faraway expression, lips closed. She has the same black bob, black lily hair ornament, choker, sheer black blouse with ribbon tie and black knit vest as in Image 1. No other people are in the picture.',
  },
  B: {
    sprite:
      "The girl from Image 1 stands alone, body in three-quarter view toward the viewer's left, face turned to the viewer. She has very long turquoise hair tied in a high ponytail with long red ribbons and a small white puzzle-piece hair clip, and bright blue eyes. She wears a red bow at her neck, a sleeveless top with a black-and-white checkered pattern, detached puffy translucent light-blue sleeves off the shoulders, black-and-white checkered arm warmers, a red sash wrapped around her waist, and a white pleated skirt with a black belt. Her hands are clasped loosely in front of her waist; she smiles with her mouth closed, eyebrows raised a little.",
    cg:
      'A city rooftop at sunset, wind blowing from the left. Low railings at the edge, a water tank on the right, and the city skyline in orange and violet haze below a sky with long pink clouds. The girl from Image 1 stands alone near the railing, shown from the head to the knees, body turned toward the sky, her long turquoise ponytail and red ribbons streaming in the wind. She raises her right hand toward the sky with fingers open and sings, mouth open, eyes bright. She wears the same red neck bow, checkered top and arm warmers, translucent light-blue sleeves, red sash and white pleated skirt as in Image 1. No other people are in the picture.',
  },
  C: {
    sprite:
      'The girl from Image 1 stands alone facing the viewer. She has long dark brown hair with a thin braid on the left side tied with a small yellow ribbon, brown eyes and lightly flushed cheeks. She wears a navy school blazer with gold buttons, a beige button-up cardigan, a white shirt with a dark grey tie, a pink-red scarf with white stripes, a brown plaid pleated skirt and black thigh-high socks; a navy school bag with a small green charm hangs from her right shoulder. She holds a red gift box with a yellow ribbon behind her back with both hands, shoulders slightly raised, and gives a shy closed-mouth smile with her eyes glancing to the side.',
    cg:
      'A school gate on a winter evening in light snow. Street lamps glow warm yellow along the snowy path, the school building with lit windows stands behind the gate, and the sky is deep blue. The girl from Image 1 stands alone in front of the gate, shown from the head to the thighs, facing the viewer, and holds out a red gift box with a yellow ribbon toward the viewer with both hands, arms straight. Her face is red, her eyebrows slightly raised, her eyes looking down and to the side, lips pressed together. Snowflakes rest on her hair and scarf. She wears the same navy blazer, beige cardigan, white shirt and tie, pink-red striped scarf and brown plaid skirt as in Image 1. No other people are in the picture.',
  },
}

// F+X, verbatim from texture/ (docs/visuals.md 2.4 item 7)
const LASTLINE =
  'Finish this as a final, fully cleaned-up illustration: inked line art with no sketch lines, stray hairs or broken strokes; flat base colors with smooth airbrushed gradients; highlights placed as a few clean, deliberate shapes, as in Image 1. Put fine detail only on the face, eyes, hair ornaments and the main object of the scene; keep clothing folds, background and secondary areas simpler, with fewer lines. Every outline is one clean stroke, not several sketchy ones; hair strands end in clean tapered points; lines never break or wobble. large simple color masses, low visual frequency, restrained edge density, clear edge hierarchy, minimal internal contour lines, broad shadow shapes, suppress micro-texture and micro-contrast, no unnecessary specular highlights, except that hair highlights, eyes and the gradients of Image 1 stay exactly as in Image 1.'

const REFS = process.argv[2] ? process.argv[2].split(',') : ['A', 'B', 'C']
const KINDS = process.argv[3] ? process.argv[3].split(',') : ['sprite', 'cg']
const RUNS = process.argv[4] ? process.argv[4].split(',') : ['r1', 'r2', 'r3']

function promptFor(ref, kind) {
  const lines = [ROLE, CONTENT[ref][kind]]
  if (kind === 'sprite') lines.push(FRAME_SPRITE)
  lines.push(LASTLINE)
  return lines.join('\n')
}

let done = 0
const failures = []
async function one(ref, kind, run) {
  const name = `${ref}-${kind}--${run}`
  const size = kind === 'sprite' ? '1024x1536' : '1536x864'
  const prompt = promptFor(ref, kind)
  const extra = { quality: 'high', model: MODEL, meta: { ref, kind, run, model: MODEL, req_size: size, prompt } }
  if (kind === 'sprite') extra.background = 'transparent'
  const r = await edit([`${D}/ref/${ref}.png`], prompt, size, extra)
  if (!r.ok || !r.buf?.length) {
    failures.push(`${name}: ${r.err?.isRefusal ? 'REFUSAL ' : ''}${r.err?.code || ''} ${r.err?.msg?.slice(0, 160) || ''}`)
    console.log('FAIL', name, r.err?.code || '', r.err?.msg?.slice(0, 160) || '')
    return
  }
  const p = G + name + '.png'
  writeFileSync(p, r.buf)
  const m = await sharp(p).metadata()
  rec({ kind: 'saved', name, actual_size: `${m.width}x${m.height}`, has_alpha: m.hasAlpha === true, bytes: r.buf.length })
  done++
  console.log(`ok ${name} ${r.ms}ms ${m.width}x${m.height} alpha=${m.hasAlpha} out=${r.usage?.output_tokens}`)
}

const jobs = []
for (const ref of REFS) for (const kind of KINDS) for (const run of RUNS) jobs.push(one(ref, kind, run))
console.log(`${jobs.length} calls queued`)
await Promise.all(jobs)
console.log(`done=${done} failed=${failures.length}`)
if (failures.length) console.log('failures:\n  ' + failures.join('\n  '))
