import OpenAI, { toFile } from 'openai'
import { createReadStream, writeFileSync } from 'node:fs'
import sharp from 'sharp'
const c = new OpenAI({ baseURL: process.env.NL_IMAGE_BASE_URL, apiKey: process.env.NL_IMAGE_API_KEY, timeout: 600000, maxRetries: 0 })
const REF = process.env.NL_STYLE_REF
const P = 'Image 1 is the style reference: draw in exactly the same art style, line quality, coloring, shading and level of detail. The character in Image 1 is Sangonomiya Kokomi; keep her face and hair the same. She sits on smooth rocks at a beach at sunset, waves behind her, holding a strand of hair against the wind, gentle smile.'
const jobs = [
  ['gen-2048x1152', 'gen', '2048x1152'],
  ['gen-3840x2160', 'gen', '3840x2160'],
  ['edit-2048x1152', 'edit', '2048x1152'],
  ['edit-2560x1440', 'edit', '2560x1440'],
  ['edit-3840x2160', 'edit', '3840x2160'],
]
await Promise.all(jobs.map(async ([name, mode, size]) => {
  const t = Date.now()
  try {
    const args = { model: 'gpt-image-2.6-sunburst', prompt: P, size, quality: 'high', output_format: 'png' }
    const r = mode === 'gen' ? await c.images.generate({ ...args, prompt: P.replace(/^.*?same\. /, 'Sangonomiya Kokomi from Genshin Impact, soft anime illustration. ') })
                             : await c.images.edit({ ...args, image: [await toFile(createReadStream(REF), 'ref.png', { type: 'image/png' })] })
    const buf = Buffer.from(r.data[0].b64_json, 'base64'); writeFileSync('gen/' + name + '.png', buf)
    const m = await sharp(buf).metadata()
    console.log(name, 'req', size, 'got', m.width + 'x' + m.height, ((Date.now() - t) / 1000).toFixed(0) + 's', 'out_tokens', r.usage?.output_tokens)
  } catch (e) { console.log(name, 'req', size, 'ERR', e.status, (e.error?.code || ''), String(e.message).slice(0, 200)) }
}))
