#!/usr/bin/env node
/* Measure: snapshot bytes/line + 200-line total, restore time, texture memory
 * for all ch01 assets at their native size (≈2K canvas 2560×1440). */
import { execFileSync } from 'node:child_process';
const CD = 'chrome-devtools';
const pageId = process.argv[2] ?? '4';
const cd = (...a) => execFileSync(CD, a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const cdp = (expr) => {
  const out = cd('evaluate_script', expr, '--pageId', pageId);
  const m = out.match(/```json\n([\s\S]*?)\n```/) || out.match(/```\n([\s\S]*?)\n```/);
  return m ? JSON.parse(m[1]) : out.trim();
};

const r = cdp(`async () => {
  const P = window.__player;
  // walk whole script, collect snap sizes
  const sizes = [];
  for (let gi = 0; gi < P.groupCount; gi++) {
    P.setCharDelay(0);
    await P.goto(gi); P.advance();
    await new Promise(r => setTimeout(r, 30));
    sizes.push(P.measureSnapshot());
  }
  // restore timing: average of 8
  let rest = 0;
  for (let i = 0; i < 8; i++) rest += await P.restoreTime();
  rest /= 8;
  // texture memory for all ch01 assets in the registry (native px, RGBA8 +33% mipmap)
  const reg = await fetch('/assets/registry.json').then(r => r.json());
  const imgs = [];
  let texBytes = 0, rawBytes = 0;
  for (const e of reg) {
    if (!e.file || e.status === 'speaker-only') continue;
    const img = new Image();
    img.src = '/assets/' + e.file;
    await img.decode();
    const px = img.naturalWidth * img.naturalHeight;
    rawBytes += px * 4;
    texBytes += px * 4 * 1.33;
    imgs.push({ id: e.id, w: img.naturalWidth, h: img.naturalHeight });
  }
  const snapTotal200 = sizes.reduce((a, b) => a + b, 0) / sizes.length * 200;
  return { lines: sizes.length, avgSnap: Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length),
           maxSnap: Math.max(...sizes), snapTotal200: Math.round(snapTotal200),
           restoreMs: +rest.toFixed(2), texMB: +(texBytes / 1048576).toFixed(1), rawMB: +(rawBytes / 1048576).toFixed(1),
           assetCount: imgs.length, imgs };
}`);
console.log(JSON.stringify(r, null, 1));
