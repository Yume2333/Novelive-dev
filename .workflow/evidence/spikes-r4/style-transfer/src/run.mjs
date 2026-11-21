// spikes-r4/style-transfer runner.
// Refs A and C are style only: draw a NEW character (same one for both refs) in the
// ref's style, one sprite + one portrait CG (1024x1536), 2 runs, same 4 last-line arms
// as brushwork. sunburst, quality high, images.edit, Image 1 = that ref only.
// Usage: node src/run.mjs [A,C] [sprite,cg] [r1,r2] [FX,FXB,FXBM,NXBM]
import { edit, mkdir, writeFileSync, rec } from './api.mjs'
import { FRAME_SPRITE } from './prompts.mjs'
import sharp from 'sharp'

const D = new URL('..', import.meta.url).pathname
const G = D + '/gen/'
const MODEL = 'gpt-image-2.6-sunburst'
mkdir(G)

const ROLE =
  'Image 1 is the style reference: draw in exactly the same art style, line quality, coloring, shading and level of detail. Do not copy the character in Image 1.'

// One new character for every ref, so styles can be compared on the same subject.
const NEW = {
  sprite:
    "A girl stands alone facing the viewer, body turned slightly to the viewer's left. She has short wavy ash-blonde hair that ends just below her ears, parted on the side, a small silver star-shaped hair clip above her left ear, green eyes and thin round gold-rimmed glasses. She wears a loose cream cable-knit sweater with the sleeves covering half of her hands, a white collared shirt under it with the collar showing, and a long dark green pleated skirt. She holds a closed brown leather notebook against her chest with both hands. Her eyebrows are slightly raised, her eyes look at the viewer, and she smiles with her lips closed.",
  cg:
    'A small cafe in the afternoon, empty except for one girl. Warm sunlight comes through a large window on the left and falls across a wooden table by the window, with a white cup of coffee and a slice of cake on a plate; potted plants sit on the windowsill and shelves of glass jars line the back wall. The girl sits at the table, shown from the head to the waist, turned three-quarters toward the viewer, writing in an open brown notebook with a pen in her right hand; her left hand rests beside the cup. She looks down at the page with a soft, focused expression, lips closed. She has short wavy ash-blonde hair parted on the side, a small silver star-shaped hair clip above her left ear, green eyes and thin round gold-rimmed glasses, and wears a loose cream cable-knit sweater over a white collared shirt. No other people are in the picture.',
}
const CONTENT = { A: NEW, C: NEW }

const S3 =
  'Finish this as a final, fully cleaned-up illustration: inked line art with no sketch lines, stray hairs or broken strokes; flat base colors with smooth airbrushed gradients; highlights placed as a few clean, deliberate shapes, as in Image 1.'
const S3N =
  'Finish this as a final, fully cleaned-up illustration in the same medium as Image 1: no sketch lines, stray hairs or broken strokes; highlights placed as a few clean, deliberate shapes, as in Image 1.'
const H =
  'Put fine detail only on the face, eyes, hair ornaments and the main object of the scene; keep clothing folds, background and secondary areas simpler, with fewer lines.'
const E =
  'Every outline is one clean stroke, not several sketchy ones; hair strands end in clean tapered points; lines never break or wobble.'
const RENDER =
  'large simple color masses, low visual frequency, restrained edge density, clear edge hierarchy, minimal internal contour lines, broad shadow shapes, suppress micro-texture and micro-contrast, no unnecessary specular highlights'
const X = RENDER + ', except that hair highlights, eyes and the gradients of Image 1 stay exactly as in Image 1.'
const XB = RENDER + ', except that hair highlights, eyes, the gradients, and the brushwork and stroke texture of Image 1 stay exactly as in Image 1.'
const MED =
  "Texture that belongs to the artist's medium — visible brush strokes, pencil or grain texture, soft painterly edges — is part of the style and stays as in Image 1; only accidental mottled, layered fish-scale smudges are removed."

const LASTLINE = {
  FX: [S3, H, E, X].join(' '),               // current F+X (docs/visuals.md 2.4 item 7)
  FXB: [S3, H, E, XB].join(' '),             // exception also keeps brushwork
  FXBM: [S3, H, E, XB, MED].join(' '),       // + medium-texture vs smudge sentence
  NXBM: [S3N, H, E, XB, MED].join(' '),      // S3 without "flat base colors with smooth airbrushed gradients"
}

const REFS = process.argv[2] ? process.argv[2].split(',') : ['A', 'C']
const KINDS = process.argv[3] ? process.argv[3].split(',') : ['sprite', 'cg']
const RUNS = process.argv[4] ? process.argv[4].split(',') : ['r1', 'r2']
const ARMS = process.argv[5] ? process.argv[5].split(',') : ['FX', 'FXB', 'FXBM', 'NXBM']

function promptFor(ref, kind, arm) {
  const lines = [ROLE, CONTENT[ref][kind]]
  if (kind === 'sprite') lines.push(FRAME_SPRITE)
  lines.push(LASTLINE[arm])
  return lines.join('\n')
}

let done = 0
const failures = []
async function one(ref, kind, arm, run) {
  const name = `${ref}-${kind}--${arm}--${run}`
  const size = '1024x1536'
  const prompt = promptFor(ref, kind, arm)
  const extra = { quality: 'high', model: MODEL, meta: { ref, kind, arm, run, model: MODEL, req_size: size, prompt } }
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
for (const ref of REFS) for (const kind of KINDS) for (const arm of ARMS) for (const run of RUNS) jobs.push(one(ref, kind, arm, run))
console.log(`${jobs.length} calls queued`)
await Promise.all(jobs)
console.log(`done=${done} failed=${failures.length}`)
if (failures.length) console.log('failures:\n  ' + failures.join('\n  '))
