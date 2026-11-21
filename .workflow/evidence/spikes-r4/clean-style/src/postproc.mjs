// spikes-r4/clean-style post-process: arm D.
// D1 = realesrgan-x4plus-anime x4 then Lanczos3 back to A's size.
// D2 = realesr-animevideov3-x4   x4 then Lanczos3 back to A's size.
// Binary+models: /tmp/nl-r2/upscale/bin/realesrgan (Real-ESRGAN ncnn-vulkan
// release; alpha channel processed as part of RGBA — verified RGBA->RGBA).
// Usage: node src/postproc.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync, statSync } from 'node:fs'
import sharp from 'sharp'
import { rec } from './api.mjs'

const D = new URL('..', import.meta.url).pathname
const G = D + '/gen/'
const TMP = D + '/work/'
mkdirSync(TMP)

const BIN = process.env.REALESRGAN_BIN ?? '/tmp/nl-r2/upscale/bin/realesrgan/realesrgan-ncnn-vulkan'
const MODELS = process.env.REALESRGAN_MODELS ?? '/tmp/nl-r2/upscale/bin/realesrgan/models'
const IDS = ['K1', 'K4', 'K6', 'C1', 'C3', 'G2']
const ARMS = [
  ['D1', 'realesrgan-x4plus-anime'],
  ['D2', 'realesr-animevideov3-x4'],
]

for (const aid of IDS) {
  const input = `${G}${aid}--A.png`
  const meta = await sharp(input).metadata()
  for (const [arm, model] of ARMS) {
    const up = `${TMP}${aid}-${arm}-up.png`
    const out = `${G}${aid}--${arm}.png`
    const t0 = Date.now()
    try {
      execFileSync(BIN, ['-i', input, '-o', up, '-m', MODELS, '-n', model, '-s', '4', '-f', 'png'],
        { stdio: ['ignore', 'ignore', 'pipe'], timeout: 600_000 })
      const msUp = Date.now() - t0
      // lanczos back to original size, keep alpha
      const buf = await sharp(up).resize(meta.width, meta.height, { kernel: 'lanczos3' }).png().toBuffer()
      const t1 = Date.now()
      await sharp(buf).toFile(out)
      const om = await sharp(out).metadata()
      rec({
        kind: 'postproc', asset: aid, arm, model,
        ms: Date.now() - t0, ms_upscale: msUp, ms_resize: Date.now() - t0 - msUp,
        in_size: `${meta.width}x${meta.height}`, out_size: `${om.width}x${om.height}`,
        has_alpha: om.hasAlpha === true, bytes: statSync(out).size,
      })
      console.log(`ok ${aid}--${arm} ${model} ${Date.now() - t0}ms alpha=${om.hasAlpha}`)
    } catch (e) {
      rec({ kind: 'postproc_error', asset: aid, arm, model, err: String(e).slice(0, 300) })
      console.log(`FAIL ${aid}--${arm} ${model}: ${String(e).slice(0, 200)}`)
    }
  }
}
console.log('postproc done')
