#!/usr/bin/env node
/* Drive the player: walk every group, complete text instantly, record
 * per-line overflow + console errors. One CDP eval per group.
 * Usage: node tools/drive.mjs <script> <pageId> [w=1920 h=1080] [shot:step=path]...
 */
const MEASURE = new URL("../measure", import.meta.url).pathname
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const CD = 'chrome-devtools';
const args = process.argv.slice(2);
const script = args[0] ?? 'ch01.nvs';
const pageId = args[1] ?? '4';
const W = +(args.find(a => a.startsWith('w='))?.slice(2) ?? 1920);
const H = +(args.find(a => a.startsWith('h='))?.slice(2) ?? 1080);
const shotSpecs = args.filter(a => a.startsWith('shot:')).map(a => a.slice(5));
const maxG = +(args.find(a => a.startsWith('max='))?.slice(4) ?? 1e9);

const cd = (...a) => execFileSync(CD, a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const cdp = (expr) => {
  const out = cd('evaluate_script', expr, '--pageId', pageId);
  const m = out.match(/```json\n([\s\S]*?)\n```/) || out.match(/```\n([\s\S]*?)\n```/);
  return m ? JSON.parse(m[1]) : out.trim();
};

cd('navigate_page', pageId, '--url', `http://localhost:5419/?script=${script}`);
await new Promise(r => setTimeout(r, 4000));
cd('resize_page', pageId, String(W), String(H));
await new Promise(r => setTimeout(r, 1200));

const ready = cdp(`() => !!window.__player`);
if (!ready) { console.error('player not ready'); process.exit(1); }
const groupCount = Math.min(cdp(`() => window.__player.groupCount`), maxG);
console.log(`script=${script} groups=${groupCount} viewport=${W}x${H}`);

const rows = [];
for (let gi = 0; gi < groupCount; gi++) {
  const st = cdp(`async () => {
    const P = window.__player;
    P.setCharDelay(0);
    await P.goto(${gi});
    // complete line
    P.advance();
    await new Promise(r => setTimeout(r, 60));
    const s = P.state();
    const tb = document.querySelector('[data-testid="textbox"]');
    const ghost = tb ? tb.querySelector('.ghost') : null;
    return {
      gidx: s.snap.step,
      kind: s.snap.text?.kind ?? (s.snap.caption ? 'caption' : 'cmd-only'),
      len: (s.snap.text?.text ?? '').length,
      text: (s.snap.text?.text ?? s.snap.caption ?? '').slice(0, 30),
      overflow: ghost ? (ghost.scrollHeight > ghost.clientHeight + 2 || ghost.scrollWidth > ghost.clientWidth + 2) : null,
      gh: ghost?.scrollHeight ?? 0, ghh: ghost?.clientHeight ?? 0,
      gw: ghost?.scrollWidth ?? 0, gww: ghost?.clientWidth ?? 0,
      snapBytes: JSON.stringify(s.snap).length,
      sprites: Object.values(s.snap.sprites).map(v => v.asset),
      bg: s.snap.bg, cg: s.snap.cg, particle: s.snap.particle, filter: s.snap.filter,
      zoom: s.snap.camera.zoom,
    };
  }`);
  rows.push(st);
  const spec = shotSpecs.find(s => +s.split('=')[0] === gi);
  if (spec) { cd('take_screenshot', pageId, '--filePath', spec.split('=')[1]); console.log('  shot', spec); }
  if (gi % 20 === 0) process.stderr.write(`  g${gi}\n`);
}

const errs = cd('list_console_messages', pageId, '--types', 'error');
mkdirSync(MEASURE, { recursive: true });
const tag = `${script.replace(/\W+/g, '_')}-${W}x${H}`;
writeFileSync(`${MEASURE}/${tag}.json`, JSON.stringify({ script, viewport: `${W}x${H}`, rows, consoleErrors: errs }, null, 1));
const lines = rows.filter(r => r.kind !== 'cmd-only' && r.len > 0);
const over = lines.filter(r => r.overflow);
console.log(`lines=${lines.length} overflow=${over.length} consoleErr=${(errs.match(/msgid=/g) || []).length} snapAvg=${Math.round(rows.reduce((a, r) => a + r.snapBytes, 0) / rows.length)}B`);
for (const o of over) console.log(`  OVERFLOW g${o.gidx} ${o.kind} len=${o.len} ${o.gh}x${o.gw} > ${o.ghh}x${o.gww} ${o.text}`);
