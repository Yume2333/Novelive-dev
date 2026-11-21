#!/usr/bin/env node
/* Aggregate measure/*.json → overflow table per script per viewport.
 * Criterion: rendered line count (ghost scrollHeight / line-height) exceeds
 * the box's 3-line capacity → the sentence does not fit the documented text box. */
const MEASURE = new URL("../measure", import.meta.url).pathname
import { readdirSync, readFileSync } from 'node:fs';
const dir = MEASURE;
const LINE_H = 48.6; // fs 30 × lh 1.62 @1080p; also at 720p same CSS px (box is vw-scaled, font fixed px)
const all = {};
for (const f of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
  const d = JSON.parse(readFileSync(dir + '/' + f, 'utf8'));
  const lines = d.rows.filter(r => r.kind !== 'cmd-only' && r.len > 0);
  const seen = new Set();
  const uniq = lines.filter(r => (seen.has(r.gidx) ? false : (seen.add(r.gidx), true)));
  for (const r of uniq) { r.rendered = Math.round(r.gh / LINE_H); r.over = r.gh > LINE_H * 3 + 2; }
  const over = uniq.filter(r => r.over);
  const lens = uniq.map(r => r.len).sort((a, b) => a - b);
  const err = (d.consoleErrors.match(/msgid=/g) || []).length;
  console.log(`${d.script.padEnd(26)} ${d.viewport}  lines=${uniq.length}  >3L=${over.length}  len p50=${lens[Math.floor(lens.length / 2)]} p90=${lens[Math.floor(lens.length * .9)]} max=${lens.at(-1)}  consoleErr=${err}`);
  all[`${d.script}@${d.viewport}`] = { total: uniq.length, over3: over.length, maxLen: lens.at(-1), maxRendered: Math.max(...uniq.map(r => r.rendered)) };
  for (const o of over) console.log(`    ${o.rendered}L len=${o.len} g${o.gidx} ${o.text}`);
}
