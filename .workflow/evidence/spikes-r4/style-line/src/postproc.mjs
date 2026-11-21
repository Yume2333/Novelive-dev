// spikes-r4/model-prompt post-process: every gen/<asset>--<arm>.png raw output
// gets two Real-ESRGAN variants, written next to the raw file:
//   -D1 = realesrgan-x4plus-anime x4 then Lanczos3 back to the raw size
//   -D2 = realesr-animevideov3-x4 x4 then Lanczos3 back to the raw size
// Binary+models come from env ONLY (no defaults):
//   REALESRGAN_BIN    path to realesrgan-ncnn-vulkan
//   REALESRGAN_MODELS path to its models dir
// Alpha: RGBA input is upscaled as RGBA -> alpha preserved (checked + logged).
// Usage: REALESRGAN_BIN=... REALESRGAN_MODELS=... node src/postproc.mjs [name ...]
import { execFileSync } from 'node:child_process'
import { mkdirSync, statSync, readdirSync } from 'node:fs'
import sharp from 'sharp'
import { rec } from './api.mjs'

const D = new URL('..', import.meta.url).pathname
const G = D + '/gen/'
const TMP = D + '/work/'
mkdirSync(TMP, { recursive: true })

const BIN = process.env.REALESRGAN_BIN
const MODELS = process.env.REALESRGAN_MODELS
if (!BIN || !MODELS) {
  console.error('set REALESRGAN_BIN and REALESRGAN_MODELS (see README)')
  process.exit(1)
}

const VARIANTS = [
  ['D1', 'realesrgan-x4plus-anime'],
  ['D2', 'realesr-animevideov3-x4'],
]

// names = raw outputs only (exclude -D1/-D2 derivatives)
let names = readdirSync(G)
  .filter((f) => f.endsWith('.png') && !/-D[12]\.png$/.test(f))
  .map((f) => f.replace(/\.png$/, ''))
if (process.argv[2]) names = process.argv.slice(2)

let ok = 0, bad = 0
for (const name of names.sort()) {
  const input = `${G}${name}.png`
  const meta = await sharp(input).metadata()
  for (const [suf, model] of VARIANTS) {
    const up = `${TMP}${name}-${suf}-up.png`
    const out = `${G}${name}-${suf}.png`
    const t0 = Date.now()
    try {
      execFileSync(BIN, ['-i', input, '-o', up, '-m', MODELS, '-n', model, '-s', '4', '-f', 'png'],
        { stdio: ['ignore', 'ignore', 'pipe'], timeout: 600_000 })
      const msUp = Date.now() - t0
      const buf = await sharp(up).resize(meta.width, meta.height, { kernel: 'lanczos3' }).png().toBuffer()
      await sharp(buf).toFile(out)
      const om = await sharp(out).metadata()
      rec({
        kind: 'postproc', name, variant: suf, model,
        ms: Date.now() - t0, ms_upscale: msUp,
        in_size: `${meta.width}x${meta.height}`, out_size: `${om.width}x${om.height}`,
        in_alpha: meta.hasAlpha === true, has_alpha: om.hasAlpha === true,
        bytes: statSync(out).size,
      })
      ok++
      console.log(`ok ${name}-${suf} ${model} ${Date.now() - t0}ms alpha=${meta.hasAlpha}->${om.hasAlpha}`)
    } catch (e) {
      bad++
      rec({ kind: 'postproc_error', name, variant: suf, model, err: String(e).slice(0, 300) })
      console.log(`FAIL ${name}-${suf} ${model}: ${String(e).slice(0, 200)}`)
    }
  }
}
console.log(`postproc done ok=${ok} fail=${bad}`)
