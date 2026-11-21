// spikes-r4/genshin-style runner.
// All calls are images.edit with ref/kokomi-torino-white.png as Image 1.
// Phase 1: K1-K8 + C1-C8, arms A and B (32 calls, concurrency <=6 via api.mjs).
// Phase 2: G1/G2, arms A and B (4 calls); Image 2+ = that arm's C-sprites.
// On moderation refusal: retry once with the name-removed prompt, saved as
// <asset>--<arm>-nr.png and logged with nr:true.
// Usage: node src/run.mjs [substring filter]
import { edit, mkdir, writeFileSync, rec } from './api.mjs'
import { ASSETS, buildPrompt } from './prompts.mjs'
import sharp from 'sharp'
import { existsSync } from 'node:fs'

const D = new URL('..', import.meta.url).pathname
const G = D + '/gen/'
const REF = D + '/ref/kokomi-torino-white.png'
mkdir(G)

const ARMS = ['A', 'B']
const NON_GROUP = Object.keys(ASSETS).filter((a) => !ASSETS[a].group)
const GROUPS = Object.keys(ASSETS).filter((a) => ASSETS[a].group)
const onlyAsset = process.argv[2]

let done = 0, failed = 0, refusals = 0
const failures = []

async function save(name, r) {
  const p = G + name + '.png'
  writeFileSync(p, r.buf)
  let meta = {}
  try { meta = await sharp(p).metadata() } catch {}
  rec({ kind: 'saved', name, actual_size: `${meta.width}x${meta.height}`, has_alpha: meta.hasAlpha === true, bytes: r.buf.length })
  return meta
}

async function one(aid, arm, extraRefs = []) {
  const asset = ASSETS[aid]
  const meta0 = { asset: aid, arm, req_size: asset.size, transparent: !!asset.transparent }
  const extra = {}
  if (asset.transparent) extra.background = 'transparent'
  const refs = [REF, ...extraRefs]
  for (const nr of [false, true]) {
    const prompt = buildPrompt(aid, arm, { nameRemoved: nr })
    const meta = { ...meta0, nr, n_extra_refs: extraRefs.length, prompt }
    extra.meta = meta
    const r = await edit(refs, prompt, asset.size, extra)
    if (r.ok && r.buf?.length) {
      const m = await save(`${aid}--${arm}${nr ? '-nr' : ''}`, r)
      done++
      console.log(`ok ${aid}--${arm}${nr ? '-nr' : ''} ${r.ms}ms ${m.width}x${m.height}`)
      return true
    }
    if (r.err?.isRefusal && !nr) {
      refusals++
      console.log(`REFUSED ${aid}--${arm} -> retry without names (${r.err.code || r.err.msg?.slice(0, 80)})`)
      continue
    }
    failed++
    failures.push(`${aid}--${arm}${nr ? '-nr' : ''}: ${r.err?.code || ''} ${r.err?.msg?.slice(0, 120) || ''}`)
    console.log(`FAIL ${aid}--${arm}${nr ? '-nr' : ''} ${r.ms}ms ${r.err?.code || ''} ${r.err?.msg?.slice(0, 120) || ''}`)
    return false
  }
  // named refusal + nr refusal
  failed++
  failures.push(`${aid}--${arm}: refused both variants`)
  console.log(`FAIL ${aid}--${arm} refused both variants`)
  return false
}

// ---------- phase 1: sprites + Kokomi CGs ----------
const jobs1 = []
for (const aid of NON_GROUP) {
  if (onlyAsset && !aid.includes(onlyAsset)) continue
  for (const arm of ARMS) jobs1.push([aid, arm])
}
console.log(`phase1: ${jobs1.length} calls queued`)
await Promise.all(jobs1.map(([a, b]) => one(a, b)))

// ---------- phase 2: group CGs, arm-matched C-sprites as Image 2+ ----------
const jobs2 = []
for (const aid of GROUPS) {
  if (onlyAsset && !aid.includes(onlyAsset)) continue
  for (const arm of ARMS) {
    const extraRefs = ASSETS[aid].group.map((cid) => {
      const named = `${G}${cid}--${arm}.png`
      const nr = `${G}${cid}--${arm}-nr.png`
      return existsSync(named) ? named : nr
    })
    const missing = extraRefs.filter((p) => !existsSync(p))
    if (missing.length) {
      failed++
      failures.push(`${aid}--${arm}: missing sprite refs ${missing.join(',')}`)
      console.log(`SKIP ${aid}--${arm}: no C-sprite for arm ${arm}`)
      rec({ kind: 'error', asset: aid, arm, err: { msg: 'missing arm-matched sprite ref' } })
      continue
    }
    jobs2.push([aid, arm, extraRefs])
  }
}
console.log(`phase2: ${jobs2.length} calls queued`)
await Promise.all(jobs2.map(([a, b, refs]) => one(a, b, refs)))

console.log(`done=${done} failed=${failed} refusals=${refusals}`)
if (failures.length) console.log('failures:\n  ' + failures.join('\n  '))
