// Measure: yauzl open time (central dir scan) + random entry open+read latency,
// vs reading the same file from an extracted dir.
import yauzl from 'yauzl';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';

const ZIP = process.argv[2] || 'pkg-deflate.zip';
const N_READS = Number(process.argv[3] || 100);

const open = (p) => new Promise((res, rej) =>
  yauzl.open(p, {lazyEntries: true, autoClose: false}, (e, z) => e ? rej(e) : res(z)));

const readEntry = (z, entry) => new Promise((res, rej) =>
  z.openReadStream(entry, (e, rs) => {
    if (e) return rej(e);
    let n = 0;
    rs.on('data', c => n += c.length);
    rs.on('end', () => res(n));
    rs.on('error', rej);
  }));

async function main() {
  // 1. open + central directory scan
  let t = performance.now();
  const z = await open(ZIP);
  const openMs = performance.now() - t;

  // 2. enumerate entries (also measures CD walk)
  t = performance.now();
  const entries = [];
  await new Promise((res, rej) => {
    z.on('entry', e => { entries.push(e); z.readEntry(); });
    z.on('end', res); z.on('error', rej);
    z.readEntry();
  });
  const enumMs = performance.now() - t;
  console.log(`entries=${entries.length} openMs=${openMs.toFixed(1)} enumMs=${enumMs.toFixed(1)}`);

  // 3. random reads of image + json entries through yauzl
  const imgs = entries.filter(e => e.fileName.endsWith('.webp'));
  const jsons = entries.filter(e => e.fileName.endsWith('.json'));
  const pick = (arr) => arr[crypto_random(arr.length)];
  function crypto_random(n) { return Math.floor(Math.random() * n); }

  let times = [];
  for (let i = 0; i < N_READS; i++) {
    const e = pick(imgs);
    const t0 = performance.now();
    await readEntry(z, e);
    times.push(performance.now() - t0);
  }
  times.sort((a,b)=>a-b);
  const stat = (a) => ({min:+a[0].toFixed(1), p50:+a[Math.floor(a.length/2)].toFixed(1),
    p95:+a[Math.floor(a.length*0.95)].toFixed(1), max:+a[a.length-1].toFixed(1)});
  console.log(`yauzl img read (${N_READS}x): ${JSON.stringify(stat(times))}`);

  times = [];
  for (let i = 0; i < N_READS; i++) {
    const e = pick(jsons);
    const t0 = performance.now();
    await readEntry(z, e);
    times.push(performance.now() - t0);
  }
  times.sort((a,b)=>a-b);
  console.log(`yauzl json read (${N_READS}x): ${JSON.stringify(stat(times))}`);

  // 4. interleaved random access pattern (player-like: bg + 2 sprites + scene json)
  times = [];
  for (let i = 0; i < Math.min(N_READS, 30); i++) {
    const t0 = performance.now();
    await readEntry(z, pick(imgs));
    await readEntry(z, pick(imgs));
    await readEntry(z, pick(imgs));
    await readEntry(z, pick(jsons));
    times.push(performance.now() - t0);
  }
  times.sort((a,b)=>a-b);
  console.log(`yauzl 4-entry bundle (${Math.min(N_READS,30)}x): ${JSON.stringify(stat(times))}`);

  z.close();
}
main().catch(e => { console.error(e); process.exit(1); });
