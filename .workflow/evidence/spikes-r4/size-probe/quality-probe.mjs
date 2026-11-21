// Does the relay honor `quality`? Same prompt, low vs high, 3 samples each.
import OpenAI from 'openai'
import { writeFileSync, appendFileSync } from 'node:fs'
import sharp from 'sharp'
const c = new OpenAI({ baseURL: process.env.NL_IMAGE_BASE_URL, apiKey: process.env.NL_IMAGE_API_KEY, timeout: 600000, maxRetries: 0 })
const P = 'A cozy old bookshop interior at dusk, wooden shelves packed with books, a cat sleeping on a stool, warm lamp light, anime illustration.'
const jobs = []
for (const q of ['low', 'high']) for (let i = 1; i <= 3; i++) jobs.push([q, i])
await Promise.all(jobs.map(async ([q, i]) => {
  const t = Date.now()
  try {
    const r = await c.images.generate({ model: 'gpt-image-2.6-sunburst', prompt: P, size: '1536x1024', quality: q, output_format: 'png' })
    const buf = Buffer.from(r.data[0].b64_json, 'base64'); writeFileSync(`gen/q-${q}-${i}.png`, buf)
    const m = await sharp(buf).metadata()
    const row = { quality: q, sample: i, size: `${m.width}x${m.height}`, bytes: buf.length, ms: Date.now() - t, usage: r.usage, echo: { quality: r.quality, size: r.size } }
    appendFileSync('quality-probe.jsonl', JSON.stringify(row) + '\n'); console.log(JSON.stringify(row))
  } catch (e) { console.log(q, i, 'ERR', e.status, String(e.message).slice(0, 200)) }
}))
