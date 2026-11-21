// Compare: same data as loose files — random read latency for images + json.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const DIR = 'extracted';
const N_IMG = 800, IMG_BYTES = 2_500_000, N_JSON = 2000;

// build only a subset on disk to keep time reasonable; 800 imgs * 2.5MB = 2GB
if (!fs.existsSync(DIR)) {
  fs.mkdirSync(path.join(DIR, 'img'), {recursive: true});
  fs.mkdirSync(path.join(DIR, 'json'), {recursive: true});
  for (let i = 0; i < N_IMG; i++)
    fs.writeFileSync(`${DIR}/img/e${i}.webp`, crypto.randomBytes(IMG_BYTES));
  for (let i = 0; i < N_JSON; i++)
    fs.writeFileSync(`${DIR}/json/e${i}.json`, JSON.stringify({id:i,lines:Array.from({length:40},(_,k)=>({t:`第 ${k} 句台词，包含一些中文字符以增加体积。`.repeat(3)}))}));
}
const imgs = fs.readdirSync(`${DIR}/img`).map(f => `${DIR}/img/${f}`);
const jsons = fs.readdirSync(`${DIR}/json`).map(f => `${DIR}/json/${f}`);
const pick = a => a[Math.floor(Math.random()*a.length)];
const stat = a => ({min:+a[0].toFixed(1), p50:+a[Math.floor(a.length/2)].toFixed(1),
  p95:+a[Math.floor(a.length*0.95)].toFixed(1), max:+a[a.length-1].toFixed(1)});

let times = [];
for (let i = 0; i < 100; i++) {
  const t0 = performance.now();
  fs.readFileSync(pick(imgs));
  times.push(performance.now() - t0);
}
times.sort((a,b)=>a-b);
console.log(`fs img read (100x): ${JSON.stringify(stat(times))}`);

times = [];
for (let i = 0; i < 100; i++) {
  const t0 = performance.now();
  fs.readFileSync(pick(jsons));
  times.push(performance.now() - t0);
}
times.sort((a,b)=>a-b);
console.log(`fs json read (100x): ${JSON.stringify(stat(times))}`);

times = [];
for (let i = 0; i < 30; i++) {
  const t0 = performance.now();
  fs.readFileSync(pick(imgs)); fs.readFileSync(pick(imgs)); fs.readFileSync(pick(imgs));
  fs.readFileSync(pick(jsons));
  times.push(performance.now() - t0);
}
times.sort((a,b)=>a-b);
console.log(`fs 4-entry bundle (30x): ${JSON.stringify(stat(times))}`);
