// Build a synthetic .novelive-like zip: ~2GB of incompressible "WebP" blobs + JSON.
// Two variants: deflate vs store for the image entries. Measure: central directory
// size, write time, then yauzl open + random entry read latency vs plain fs.
import { ZipFile } from 'yazl';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';

const OUT = process.argv[2] || 'pkg-deflate.zip';
const COMPRESS = process.argv[3] !== 'store';
const N_IMG = Number(process.argv[4] || 800);          // image entries
const IMG_BYTES = Number(process.argv[5] || 2_500_000); // ~2.5MB each => ~2GB total
const N_JSON = Number(process.argv[6] || 2000);         // scene/chapter json files
const N_EXTRA = Number(process.argv[7] || 18000);       // filler small entries to hit ~20k

// incompressible blob (WebP-like: high entropy)
function blob(n) {
  return crypto.randomBytes(n);
}
const jsonEntry = (i) => Buffer.from(JSON.stringify({
  id: `scene-${i}`, title: `场景 ${i}`,
  lines: Array.from({length: 40}, (_, k) => ({speaker:'lin-xiao', text:`第 ${k} 句台词，包含一些中文字符以增加体积。`.repeat(3)})),
}));

async function main() {
  const z = new ZipFile();
  const t0 = performance.now();
  let total = 0;
  for (let i = 0; i < N_IMG; i++) {
    const b = blob(IMG_BYTES); total += b.length;
    z.addBuffer(b, `volumes/v1/works/w1/assets/characters/char${i%20}/base/expr${i%40}.webp`, {compress: COMPRESS});
    if (i % 50 === 0) console.error(`img ${i}/${N_IMG}`);
  }
  for (let i = 0; i < N_JSON; i++) {
    z.addBuffer(jsonEntry(i), `volumes/v1/works/w1/chapters/ch${Math.floor(i/10)}/scene${i}.json`, {compress: COMPRESS});
  }
  for (let i = 0; i < N_EXTRA; i++) {
    z.addBuffer(Buffer.from(`x${i}`), `filler/e${i}.txt`, {compress: COMPRESS});
  }
  z.end();
  const ws = createWriteStream(OUT);
  z.outputStream.pipe(ws);
  await new Promise((res, rej) => { ws.on('finish', res); ws.on('error', rej); });
  const dt = performance.now() - t0;
  const st = fs.statSync(OUT);
  console.log(JSON.stringify({out: OUT, compress: COMPRESS, entries: N_IMG+N_JSON+N_EXTRA,
    uncompressed: total, size: st.size, writeMs: Math.round(dt)}));
}
main().catch(e => { console.error(e); process.exit(1); });
