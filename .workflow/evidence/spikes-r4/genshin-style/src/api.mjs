// Image API client, r4 round 2 (style-ref). Credentials from env only.
// Same pattern as spikes-r3 api.mjs; edit calls use an image array and do NOT pass input_fidelity.
import OpenAI, { toFile } from 'openai'
import { createReadStream, appendFileSync, mkdirSync } from 'node:fs'

export const MODEL = process.env.NL_IMAGE_MODEL || 'gpt-image-2.6-flare'
export const client = new OpenAI({
  baseURL: process.env.NL_IMAGE_BASE_URL,
  apiKey: process.env.NL_IMAGE_API_KEY,
  timeout: 600_000,
  maxRetries: 2,
})

const LOG = new URL('../results.jsonl', import.meta.url).pathname
export function rec(entry) {
  appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n')
}

// semaphore: max 6 concurrent image calls
let running = 0
const queue = []
function slot() {
  if (running < 6) { running++; return Promise.resolve() }
  return new Promise((r) => queue.push(r))
}
function release() { running--; const n = queue.shift(); if (n) { running++; n() } }

export function classifyError(e) {
  const code = e?.code || e?.error?.code || ''
  const type = e?.type || e?.error?.type || ''
  const msg = String(e?.message || e?.error?.message || '')
  const status = e?.status
  const isRefusal =
    code === 'moderation_blocked' ||
    /^(Input|Output)(Text|Image|Video|Audio)(SensitiveContentDetected|RiskDetection)/.test(code) ||
    (type === 'invalid_request_error' && /敏感|审核|sensitive|moderat|content.?polic|safety/i.test(msg)) ||
    (status === 422 && /safety|moderat/i.test(msg)) ||
    /moderation_blocked|SensitiveContentDetected/.test(msg)
  const isParam = status === 400 || /unknown|unsupported|invalid.*param/i.test(msg)
  return { status, code, type, isRefusal, isParam, msg: msg.slice(0, 400) }
}

// meta-safe params log: never log the prompt? assignment says log params -> we log
// non-image params and byte size of images, not the image data.
export async function callImage(fnName, args, meta) {
  await slot()
  const t0 = Date.now()
  const { image, ...rest } = args
  const plog = { ...rest, n_images: image ? image.length : 0 }
  try {
    const r = fnName === 'edit' ? await client.images.edit(args) : await client.images.generate(args)
    const ms = Date.now() - t0
    const d = r.data?.[0]
    let buf = null
    if (d?.b64_json) buf = Buffer.from(d.b64_json, 'base64')
    else if (d?.url) {
      const fr = await fetch(d.url, { signal: AbortSignal.timeout(60_000) })
      buf = Buffer.from(await fr.arrayBuffer())
    }
    rec({ fn: fnName, kind: 'ok', ms, ...meta, params: plog, usage: r.usage })
    return { ok: true, ms, usage: r.usage, revised_prompt: d?.revised_prompt, buf }
  } catch (e) {
    const ms = Date.now() - t0
    const c = classifyError(e)
    rec({ fn: fnName, kind: c.isRefusal ? 'content_refusal' : 'error', ms, ...meta, params: plog, err: c })
    return { ok: false, ms, err: c }
  } finally { release() }
}

export async function gen(prompt, size, extra = {}) {
  const { meta, ...rest } = extra
  return callImage('generate', { model: MODEL, prompt, size, output_format: 'png', ...rest }, meta)
}

export async function edit(refPaths, prompt, size, extra = {}) {
  const { meta, ...rest } = extra
  const image = []
  for (let i = 0; i < refPaths.length; i++) {
    image.push(await toFile(createReadStream(refPaths[i]), `ref${i}.png`, { type: 'image/png' }))
  }
  // no input_fidelity (per assignment); production path sends the array only
  return callImage('edit', { model: MODEL, image, prompt, size, output_format: 'png', ...rest }, meta)
}

export function mkdir(p) { mkdirSync(p, { recursive: true }) }
export { writeFileSync } from 'node:fs'
