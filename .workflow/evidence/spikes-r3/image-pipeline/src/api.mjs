// Image API client + helpers. Credentials come from env only; never hardcoded.
import OpenAI, { toFile } from 'openai'
import { createReadStream, writeFileSync, mkdirSync, appendFileSync } from 'node:fs'

export const MODEL = process.env.NL_IMAGE_MODEL || 'gpt-image-2.6-flare'
export const client = new OpenAI({
  baseURL: process.env.NL_IMAGE_BASE_URL,
  apiKey: process.env.NL_IMAGE_API_KEY,
  timeout: 600_000,
  maxRetries: 2, // production default per decisions.md:605
})

const LOG = new URL('../results.jsonl', import.meta.url).pathname
export function rec(entry) {
  appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n')
}

// tiny semaphore: max 4 concurrent image calls (assignment cap)
let running = 0
const queue = []
function slot() {
  if (running < 4) { running++; return Promise.resolve() }
  return new Promise((r) => queue.push(r))
}
function release() { running--; const n = queue.shift(); if (n) { running++; n() } }

// classify error per visuals.md:48 error-shape table
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
  return { status, code, type, isRefusal, msg: msg.slice(0, 400), raw: e?.error ? JSON.stringify(e.error).slice(0, 600) : undefined }
}

export async function callImage(fnName, params, meta) {
  await slot()
  const t0 = Date.now()
  try {
    const r = params.mode === 'edit'
      ? await client.images.edit(params.args)
      : await client.images.generate(params.args)
    const ms = Date.now() - t0
    const d = r.data?.[0]
    let buf = null
    if (d?.b64_json) buf = Buffer.from(d.b64_json, 'base64')
    else if (d?.url) {
      const fr = await fetch(d.url, { signal: AbortSignal.timeout(30_000) })
      buf = Buffer.from(await fr.arrayBuffer())
    }
    const out = { ok: true, ms, usage: r.usage, revised_prompt: d?.revised_prompt, buf }
    rec({ fn: fnName, kind: 'ok', ms, ...meta, usage: r.usage })
    return out
  } catch (e) {
    const ms = Date.now() - t0
    const c = classifyError(e)
    rec({ fn: fnName, kind: c.isRefusal ? 'content_refusal' : 'error', ms, ...meta, err: c })
    return { ok: false, ms, err: c }
  } finally { release() }
}

export async function gen(prompt, size, extra = {}) {
  return callImage('generate', { mode: 'gen', args: { model: MODEL, prompt, size, output_format: 'png', ...extra } }, extra.meta)
}

export async function edit(refPaths, prompt, size, extra = {}) {
  const image = []
  for (let i = 0; i < refPaths.length; i++) {
    image.push(await toFile(createReadStream(refPaths[i]), `ref${i}.png`, { type: 'image/png' }))
  }
  return callImage('edit', { mode: 'edit', args: { model: MODEL, image, prompt, size, output_format: 'png', input_fidelity: 'high', ...extra } }, extra.meta)
}

export function saveB64(res, path) {
  // callImage strips data; do b64 in caller — this helper kept for symmetry
}
export function mkdir(p) { mkdirSync(p, { recursive: true }) }
export { writeFileSync }
