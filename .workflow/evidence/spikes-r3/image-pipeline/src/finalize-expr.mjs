const IP = process.env.NL_IP_DIR ?? new URL("..", import.meta.url).pathname
// Finalize accepted expression sprites: pick the last passing attempt, upscale
// with the fast model (animevideov3 x4 → resample to 2048x3072), webp q90 + thumb.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs'
import sharp from 'sharp'
const UP = process.env.UPSCAYL_BIN ?? 'upscayl-bin'
const MODEL_DIR = process.env.REALESRGAN_MODELS ?? 'models'
const G = `${IP}/gen`
const OUT = `${IP}/out`
const TMP = `${IP}/work/up`
mkdirSync(OUT, { recursive: true }); mkdirSync(TMP, { recursive: true })

// accepted final file per expression (last attempt that passed tech check)
const finals = {
  'expr-xiangzi-puller-happy': 'expr-xiangzi-puller-happy-r3',
  'expr-xiangzi-puller-angry': 'expr-xiangzi-puller-angry',
  'expr-xiangzi-puller-sad': 'expr-xiangzi-puller-sad',
  'expr-xiangzi-puller-surprised': 'expr-xiangzi-puller-surprised',
  'expr-xiangzi-winter-happy': 'expr-xiangzi-winter-happy',
  'expr-xiangzi-winter-angry': 'expr-xiangzi-winter-angry',
  'expr-xiangzi-winter-sad': 'expr-xiangzi-winter-sad',
  'expr-xiangzi-winter-surprised': 'expr-xiangzi-winter-surprised',
  'expr-huniu-home-happy': 'expr-huniu-home-happy-r2',
  'expr-huniu-home-angry': 'expr-huniu-home-angry-r2',
  'expr-huniu-home-sad': 'expr-huniu-home-sad',
  'expr-huniu-home-surprised': 'expr-huniu-home-surprised-r2',
}
const model = process.argv[2] || 'realesr-animevideov3'
for (const [outName, srcStem] of Object.entries(finals)) {
  const src = `${G}/${srcStem}.png`
  if (!existsSync(src)) { console.log(outName, 'MISSING', srcStem); continue }
  const raw = `${TMP}/${outName}-up.png`
  const t0 = Date.now()
  execFileSync(UP, ['-i', src, '-o', raw, '-m', MODEL_DIR, '-n', model, '-s', '4', '-g', '1', '-f', 'png'])
  const ms = Date.now() - t0
  const png = await sharp(raw).resize(2048, 3072, { kernel: 'lanczos3' }).png().toBuffer()
  const webp = await sharp(png).webp({ quality: 90 }).toBuffer()
  writeFileSync(`${OUT}/${outName}.webp`, webp)
  const thumb = await sharp(webp).resize(480, 270, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 85 }).toBuffer()
  writeFileSync(`${OUT}/${outName}-thumb.webp`, thumb)
  console.log(outName, '<-', srcStem, ms + 'ms', 'webp', webp.length, 'B')
}
