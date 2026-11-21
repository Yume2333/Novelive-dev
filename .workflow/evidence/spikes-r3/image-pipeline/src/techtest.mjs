const IP = process.env.NL_IP_DIR ?? new URL("..", import.meta.url).pathname
// Run techCheck over files given on argv; also synthesize a fake checkerboard + no-alpha cases.
import { techCheck } from './techcheck.mjs'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import sharp from 'sharp'

const VC = new URL('./visualcheck.py', import.meta.url).pathname
const G = new URL('../gen/', import.meta.url).pathname

async function go(path, opts, label) {
  const r = await techCheck(readFileSync(path), opts)
  console.log((r.pass ? 'PASS' : 'FAIL').padEnd(5), label || path, JSON.stringify(r.failedChecks), JSON.stringify(r.detail))
}

const mode = process.argv[2] || 'gen'
if (mode === 'gen') {
  for (const f of process.argv.slice(3)) await go(f, { wantAlpha: f.includes('sprite') || f.includes('expr') })
} else if (mode === 'synth') {
  // fake checkerboard (alpha opaque, painted board)
  execFileSync('python3', [VC, 'fakecheck', `${IP}/work/fake-checker.png`])
  await go(`${IP}/work/fake-checker.png`, { wantAlpha: true }, 'synth: painted checkerboard, alpha=255 everywhere')
  // real alpha but fully opaque
  const b = await sharp({ create: { width: 1024, height: 1536, channels: 4, background: { r: 100, g: 120, b: 200, alpha: 1 } } }).png().toBuffer()
  const fs = await import('node:fs')
  fs.writeFileSync(`${IP}/work/opaque.png`, b)
  await go(`${IP}/work/opaque.png`, { wantAlpha: true }, 'synth: RGBA but 0% transparent')
  // rgb no alpha
  const rgb = await sharp({ create: { width: 1024, height: 1536, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer()
  fs.writeFileSync(`${IP}/work/rgb.png`, rgb)
  await go(`${IP}/work/rgb.png`, { wantAlpha: true }, 'synth: RGB no alpha')
  // real transparent (a generated sprite)
  if (process.argv[3]) await go(process.argv[3], { wantAlpha: true }, 'real sprite (control)')
}
