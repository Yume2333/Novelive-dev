// Shared driver: generate → tech check → (optional) report for visual review.
// Visual review is done via eval judge() from the Python kernel, see p3-review.
import { mkdir, writeFileSync } from './api.mjs'
import { techCheck } from './techcheck.mjs'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync as wfs } from 'node:fs'

export { techCheck, mkdir, writeFileSync }

export function subjectStats(path) {
  const out = execFileSync('python3', [new URL('./visualcheck.py', import.meta.url).pathname, 'stats', path])
  return JSON.parse(out.toString())
}

export function faceCrop(src, dst) {
  return execFileSync('python3', [new URL('./visualcheck.py', import.meta.url).pathname, 'face', src, dst]).toString().trim() === 'True'
}

export function pasteOn(src, dst) {
  execFileSync('python3', [new URL('./visualcheck.py', import.meta.url).pathname, 'paste', src, dst])
}

export function ssim(a, b) {
  return +execFileSync('python3', [new URL('./visualcheck.py', import.meta.url).pathname, 'ssim', a, b]).toString().trim()
}

export function edgeDensity(path, dst) {
  return +execFileSync('python3', [new URL('./visualcheck.py', import.meta.url).pathname, 'edge', path, dst]).toString().trim()
}
