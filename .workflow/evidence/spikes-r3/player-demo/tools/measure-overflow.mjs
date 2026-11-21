#!/usr/bin/env node
/* Measure text overflow WITHOUT playing: inject a probe with the exact
 * textbox CSS, render every line's compiled segments, read scrollHeight.
 * One CDP eval per script. */
const MEASURE = new URL("../measure", import.meta.url).pathname
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const CD = 'chrome-devtools';
const args = process.argv.slice(2);
const script = args[0] ?? 'ch01.nvs';
const pageId = args[1] ?? '4';
const W = +(args.find(a => a.startsWith('w='))?.slice(2) ?? 1920);
const FS = +(args.find(a => a.startsWith('fs='))?.slice(3) ?? 30);

const cd = (...a) => execFileSync(CD, a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const cdp = (expr) => {
  const out = cd('evaluate_script', expr, '--pageId', pageId);
  const m = out.match(/```json\n([\s\S]*?)\n```/) || out.match(/```\n([\s\S]*?)\n```/);
  return m ? JSON.parse(m[1]) : out.trim();
};

cd('resize_page', pageId, String(W), '1080');
await new Promise(r => setTimeout(r, 500));

const r = cdp(`async () => {
  const src = await fetch('/scripts/${script}').then(r => r.text());
  // use the app's compiler via dynamic import
  const mod = await import('/src/compiler.ts');
  const steps = mod.compile(src);
  const FS = ${FS};
  const probe = document.createElement('div');
  probe.className = 'vn-text';
  probe.style.cssText = 'position:fixed;left:-9999px;top:0;visibility:hidden;' +
    'width:min(78%,1500px) + ' + 'px';
  // real box inner width: min(78vw,1500px) minus 2×(1.1em padding) and borders
  const boxW = Math.min(${W} * 0.78, 1500);
  probe.style.width = boxW + 'px';
  probe.style.fontSize = FS + 'px';
  probe.style.lineHeight = '1.62';
  probe.style.fontFamily = '"Noto Serif SC","Noto Sans SC",serif';
  probe.style.padding = (FS*0.75) + 'px ' + (FS*1.1) + 'px';
  probe.style.boxSizing = 'border-box';
  document.body.appendChild(probe);
  const inner = document.createElement('div');
  probe.appendChild(inner);
  const rows = [];
  for (const s of steps) {
    if (s.kind !== 'line') continue;
    inner.innerHTML = '';
    for (const seg of s.segs) {
      if (seg.wait !== undefined) continue;
      const el = document.createElement('span');
      if (seg.ruby) { el.innerHTML = '<ruby>' + seg.text + '<rt>' + seg.ruby + '</rt></ruby>'; }
      else el.textContent = seg.text;
      inner.appendChild(el);
    }
    const h = inner.scrollHeight;
    rows.push({ idx: s.idx, kind: s.inner ? 'inner' : s.speaker ? 'dialogue' : 'narration',
      len: (s.text ?? '').length, h, lines: Math.round(h / (FS * 1.62) * 10) / 10,
      text: (s.text ?? '').slice(0, 24) });
  }
  probe.remove();
  return rows;
}`);
mkdirSync(MEASURE, { recursive: true });
const tag = `${script.replace(/\W+/g, '_')}-probe-${W}x1080-fs${FS}`;
writeFileSync(`${MEASURE}/${tag}.json`, JSON.stringify({ script, viewport: `${W}x1080`, fontSize: FS, rows: r }, null, 1));
const over3 = r.filter(x => x.lines > 3.02);
console.log(`${script} w=${W} fs=${FS}  lines=${r.length}  >3L=${over3.length}  maxLines=${Math.max(...r.map(x => x.lines))}  maxLen=${Math.max(...r.map(x => x.len))}`);
for (const o of over3) console.log(`  ${o.lines}L len=${o.len} ${o.kind} ${o.text}`);
