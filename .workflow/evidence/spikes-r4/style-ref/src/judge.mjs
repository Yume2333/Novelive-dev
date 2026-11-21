// Prints the judge_batch spec JSON on stdout.
// States: one per (asset, arm) -> blinded row image already embedded in contact
// sheet; but for per-cell judging we emit per-image states keyed by blind code.
// We generate blind per-image thumbs (asset--CODE-sK.webp) into thumbs/blind/
// so the judge never sees the arm id. Mapping -> metrics/blind-img-map.json.
import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs'
import { readdirSync } from 'node:fs'

const T = new URL('../thumbs/', import.meta.url).pathname
const B = new URL('../thumbs/blind/', import.meta.url).pathname
const M = new URL('../metrics/', import.meta.url).pathname
mkdirSync(B, { recursive: true }); mkdirSync(M, { recursive: true })

const ARMS = ['B0', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8']
const ASSETS = ['cg-first-rain', 'dazayuan', 'xiangzi-puller']
// stable codes per arm (same across assets so identity consistency can be judged
// within an arm? -> NO: blind must be per-asset to avoid judge matching arm
// patterns. Use per-asset shuffled codes.)
const codes = {}
const names = readdirSync(T).filter((f) => f.includes('--'))
let seed = 42
const rand = () => (seed = (seed * 1103515245 + 12345) % 2**31) / 2**31

const map = {}
for (const asset of ASSETS) {
  const pool = 'ABCDEFGHJ'.split('')
  const perm = [...ARMS].sort(() => rand() - 0.5)
  codes[asset] = {}
  ARMS.forEach((a, i) => (codes[asset][a] = pool[i]))
  for (const arm of ARMS) {
    for (let s = 1; s <= 2; s++) {
      const src = `${T}${asset}--${arm}-s${s}-thumb.webp`
      const dst = `${B}${asset}--${codes[asset][arm]}-s${s}.webp`
      try { copyFileSync(src, dst) } catch {}
    }
  }
}
writeFileSync(M + 'blind-img-map.json', JSON.stringify(codes, null, 1))
console.log(JSON.stringify(codes))
