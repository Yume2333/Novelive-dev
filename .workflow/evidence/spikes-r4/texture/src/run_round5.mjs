// spikes-r4/texture round5: is the purple cast from the style reference or from purple content?
// One warm, purple-free CG scene (W), sunburst, 1536x864, quality high, 2 runs per arm:
//   ref   = images.edit with ref/kokomi.png, round4 arm A assembly (docs/visuals.md 2.5
//           declaration + content + color lock + FXB)
//   noref = images.generate, same prompt with every reference to Image 1 removed
// 4 calls. Output: gen/round5/W--{ref,noref}--r{1,2}.png
// Usage: node src/run_round5.mjs [ref,noref] [r1,r2] | --print <arm>
import { edit, callImage, mkdir, writeFileSync, rec } from './api.mjs'
import sharp from 'sharp'

const D = new URL('..', import.meta.url).pathname
const G = D + '/gen/round5/'
const REF = D + '/ref/kokomi.png'
const MODEL = 'gpt-image-2.6-sunburst'
const SIZE = '1536x864'
mkdir(G)

const DECL =
  'Image 1 is a style reference only. Match how it is drawn: line quality, coloring and shading method, brushwork, level of detail, lighting and overall color treatment, including whether it is in color or monochrome. Do not copy the person in it: face, hairstyle, hair and eye color, outfit and accessories come only from the description below.'
const CONTENT =
  'Inside a small wooden cabin at sunset, warm orange light coming through a window on the left and a lit oil lamp on the table. A young woman sits alone at a square wooden table covered with a plain white tablecloth, shown from the head to the waist, body in three-quarter view, face toward the viewer. She has shoulder-length copper-red hair with a short fringe and amber eyes. She wears a mustard-yellow knitted sweater over a cream-white collared shirt. She holds a white ceramic mug of tea in both hands in front of her chest and smiles with her mouth closed. On the table: the oil lamp, a loaf of bread on a wooden board and a small vase of red and orange flowers. Behind her, log walls, a shelf with jars and a stone fireplace with a low fire. No other people are in the picture.'
const LOCK =
  'The young woman: copper-red hair, amber eyes, mustard-yellow knitted sweater, cream-white collared shirt. These colors come from the description, not from the style reference; in a monochrome style, show them as tones.'
const S3 =
  'Finish this as a final, fully cleaned-up illustration: inked line art with no sketch lines, stray hairs or broken strokes; flat base colors with smooth airbrushed gradients; highlights placed as a few clean, deliberate shapes, as in Image 1.'
const H =
  'Put fine detail only on the face, eyes, hair ornaments and the main object of the scene; keep clothing folds, background and secondary areas simpler, with fewer lines.'
const E =
  'Every outline is one clean stroke, not several sketchy ones; hair strands end in clean tapered points; lines never break or wobble.'
const RENDER =
  'large simple color masses, low visual frequency, restrained edge density, clear edge hierarchy, minimal internal contour lines, broad shadow shapes, suppress micro-texture and micro-contrast, no unnecessary specular highlights'
const FXB = S3 + ' ' + H + ' ' + E + ' ' + RENDER +
  ', except that hair highlights, eyes, the gradients, and the brushwork and stroke texture of Image 1 stay exactly as in Image 1.'

function promptFor(arm) {
  if (arm === 'ref') return [DECL, CONTENT, LOCK, FXB].join('\n')
  const lock = LOCK.replace(' These colors come from the description, not from the style reference; in a monochrome style, show them as tones.', '')
  const fxb = FXB
    .replace(', as in Image 1.', '.')
    .replace(', except that hair highlights, eyes, the gradients, and the brushwork and stroke texture of Image 1 stay exactly as in Image 1.', '.')
  const p = [CONTENT, lock, fxb].join('\n')
  if (/Image 1|style reference/.test(p)) throw new Error('noref prompt still mentions the reference')
  return p
}

const ARMS = process.argv[2] ? process.argv[2].split(',') : ['ref', 'noref']
const RUNS = process.argv[3] ? process.argv[3].split(',') : ['r1', 'r2']

if (process.argv[2] === '--print') {
  console.log(promptFor(process.argv[3] || 'ref'))
  process.exit(0)
}

let done = 0, failed = 0
async function one(arm, run) {
  const name = `W--${arm}--${run}`
  const prompt = promptFor(arm)
  const meta = { round: 5, scene: 'W', arm, run, model: MODEL, quality: 'high', req_size: SIZE, prompt }
  const r = arm === 'ref'
    ? await edit([REF], prompt, SIZE, { quality: 'high', model: MODEL, meta })
    : await callImage('generate', { model: MODEL, prompt, size: SIZE, quality: 'high', output_format: 'png' }, meta)
  if (r.ok && r.buf?.length) {
    const p = G + name + '.png'
    writeFileSync(p, r.buf)
    const m = await sharp(p).metadata()
    rec({ kind: 'saved', round: 5, name, actual_size: `${m.width}x${m.height}`, bytes: r.buf.length })
    done++
    console.log(`ok ${name} ${r.ms}ms ${m.width}x${m.height} out=${r.usage?.output_tokens ?? '?'}`)
    return
  }
  failed++
  console.log(`FAIL ${name} ${r.ms}ms ${r.err?.status || ''} ${r.err?.code || ''} ${r.err?.msg?.slice(0, 300) || ''}`)
}

const jobs = []
for (const arm of ARMS) for (const run of RUNS) jobs.push(one(arm, run))
console.log(`${jobs.length} calls queued`)
await Promise.all(jobs)
console.log(`done=${done} failed=${failed}`)
