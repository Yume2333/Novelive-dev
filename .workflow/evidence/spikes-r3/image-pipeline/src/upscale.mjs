const IP = process.env.NL_IP_DIR ?? new URL("..", import.meta.url).pathname
// Phase 6: post-processing on real outputs — integer upscale via upscayl-bin
// then sharp resample to target, WebP q90, 480x270 thumbnail.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, statSync, readFileSync } from 'node:fs'
import sharp from 'sharp'
const UP = process.env.UPSCAYL_BIN ?? 'upscayl-bin'
const DIRS = [
  (process.env.UPSCAYL_MODEL_DIRS ?? 'models').split(':')
]
const G = `${IP}/gen`
const OUT = `${IP}/out`
const TMP = `${IP}/work/up`
mkdirSync(OUT, { recursive: true }); mkdirSync(TMP, { recursive: true })

// pick model dir containing both .param and .bin for the model name
function modelDir(name) {
  for (const d of DIRS) {
    try { statSync(`${d}/${name}.param`); statSync(`${d}/${name}.bin`); return d } catch { }
  }
  throw new Error('model not found: ' + name)
}

function upscale(input, output, model, scale = 4, gpu = 1) {
  const t0 = Date.now()
  const out = execFileSync('/usr/bin/time', ['-v', UP, '-i', input, '-o', output, '-m', modelDir(model), '-n', model, '-s', String(scale), '-g', String(gpu), '-f', 'png'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  return Date.now() - t0
}

async function processOne(input, name, kind, model = 'realesrgan-x4plus-anime') {
  // kind: 'bg'|'cg' → target 2560x1440 ; 'sprite' → same factor (x4) then resample to 1024x1536*? spec says 立绘按同样倍数放大 → upscale to 4x? Actually decision: 立绘按同样倍数放大 → same scale factor to reach similar effective res. We'll do integer x4 then resample to keep alpha; for sprite target = 1024*? The docs: "默认把图放大到 2560×1440（2K）…立绘按同样倍数放大" → factor = 2560/1792 ≈ 1.43 for bg; sprite: same factor ≈ x2.5 → integer x4 then resample to round(1024*1.43) ≈ 1466? That seems arbitrary; better: sprites get 4x then resample to 2x? For demo purposes produce 2K-height sprites? — I'll do integer x4 then resample to height 3000 (2x of 1536*2=3072?) Hmm. Decide: sprite upscale x4 then resample to 2048×3072 (2x). Record both.
  const raw = `${TMP}/${name}-up.png`
  const ms = upscale(input, raw, model, 4)
  const im = sharp(raw)
  const meta = await im.metadata()
  let targetW, targetH
  if (kind === 'sprite') { targetW = 2048; targetH = 3072 }
  else { targetW = 2560; targetH = 1440 }
  const pngBuf = await im.resize(targetW, targetH, { kernel: 'lanczos3' }).png().toBuffer()
  const webpBuf = await sharp(pngBuf).webp({ quality: 90 }).toBuffer()
  writeFileSync(`${OUT}/${name}.webp`, webpBuf)
  const thumb = await sharp(webpBuf).resize(480, 270, { fit: kind === 'sprite' ? 'contain' : 'cover', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 85 }).toBuffer()
  writeFileSync(`${OUT}/${name}-thumb.webp`, thumb)
  return { name, model, ms, inSize: meta.width + 'x' + meta.height, upBytes: statSync(raw).size, webpBytes: webpBuf.length, thumbBytes: thumb.length, outDim: `${targetW}x${targetH}` }
}

const which = process.argv.slice(2)
const jobs = []
if (!which.length || which.includes('bg')) {
  for (const n of ['bg-renhe-yard', 'bg-renhe-yard-night', 'bg-renhe-yard-rain', 'bg-beiping-street', 'bg-beiping-street-night', 'bg-beiping-street-dusk']) jobs.push([`${G}/${n}.png`, n, 'bg'])
}
if (!which.length || which.includes('cg')) {
  for (const n of ['cg-cg-first-rain', 'cg-cg-escape-camels']) jobs.push([`${G}/${n}.png`, n, 'cg'])
}
if (!which.length || which.includes('sprite')) {
  for (const n of ['sprite-xiangzi-puller', 'sprite-huniu-home']) jobs.push([`${G}/${n}.png`, n, 'sprite'])
}
const rows = []
for (const [i, n, k] of jobs) {
  try { rows.push(await processOne(i, n, k)) ; console.log(n, 'done', rows.at(-1).ms + 'ms') }
  catch (e) { console.log(n, 'FAIL', String(e).slice(0, 200)) }
}
console.table(rows)
