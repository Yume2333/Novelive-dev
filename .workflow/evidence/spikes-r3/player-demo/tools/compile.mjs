#!/usr/bin/env node
/* .nvs parser + compiler → JSON instruction list.
 * Grammar: docs/work-format.md §剧本语言 + out/grammar-draft.md (M1a 草案).
 * Diagnostics per docs/work-format.md:88-90: assets, #id uniqueness, source ranges,
 * inline-tag balance, command table, scene/source coverage.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const COMMANDS = {
  bg:       { kind: 'setting', req: ['asset'], opt: ['transition', 'duration'] },
  fg:       { kind: 'setting', req: ['asset'], opt: [] },
  show:     { kind: 'setting', req: ['asset', 'slot'], opt: [] },
  hide:     { kind: 'setting', req: ['slot'], opt: [] },
  move:     { kind: 'setting', req: ['slot', 'target'], opt: ['easing', 'duration'] },
  face:     { kind: 'setting', req: ['asset'], opt: [] },
  costume:  { kind: 'setting', req: ['asset'], opt: [] },
  cg:       { kind: 'setting', req: ['asset'], opt: [] },
  camera:   { kind: 'setting', req: [], opt: ['action', 'easing', 'duration'] },
  shake:    { kind: 'setting', req: [], opt: ['strength', 'duration'] },
  zoom:     { kind: 'setting', req: ['scale'], opt: ['duration', 'easing'] },
  particle: { kind: 'setting', req: ['name'], opt: ['intensity', 'speed', 'angle'] },
  mask:     { kind: 'setting', req: ['spec'], opt: [] },
  filter:   { kind: 'setting', req: ['name'], opt: ['value'] },
  caption:  { kind: 'text-ish', req: [], opt: ['text', 'wait'] },
  wait:     { kind: 'text-ish', req: [], opt: ['seconds'] },
};
const TRANSITIONS = new Set('fade dissolve wipe-left wipe-right wipe-up wipe-down slide push iris zoom none'.split(' '));
const EASINGS = new Set('linear ease ease-in ease-out ease-in-out'.split(' '));
const BUILTIN_TAGS = new Set('em b dim whisper shout glitch hl ruby wait speed'.split(' '));
const SLOTS = new Set('left center right far-left far-right'.split(' '));
const PARTICLES = new Set(['rain', 'snow', 'sakura', 'none']);
const FILTERS = new Set(['blur', 'brightness', 'sepia', 'glitch', 'none']);
const ASSET_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\/[a-z0-9-]+){0,3}$/;
const SPEAKER_RE = /^(?<asset>[a-z][a-z0-9]*(?:-[a-z0-9]+)*)(?:\s*\((?<paren>[^)]*)\))?(?:\s+as\s+(?<alias>.+?))?\s*:\s*(?<text>.*)$/;
const ID_RE = /\s#([0-9a-f]{4})$/;

function diag(code, line, col, message, hint = '') {
  return { code, line, col, message, hint };
}

/* ---------- inline tag parsing → segment list ---------- */
function parseInline(text, lineno, diags, customTags = []) {
  const segs = [];      // {text, marks:[], ruby?, wait?, speed?}
  const stack = [];     // open tag names
  const marks = () => stack.filter(s => typeof s === 'string');
  const speeds = () => stack.filter(s => typeof s === 'object' && s.speed).map(s => s.speed);
  let buf = '', i = 0;
  const pushBuf = () => {
    if (!buf) return;
    segs.push({ text: buf, marks: marks(), speed: speeds().length ? speeds().reduce((a, b) => a * b, 1) : 1 });
    buf = '';
  };
  while (i < text.length) {
    const c = text[i];
    if (c === '{') {
      if (text[i + 1] === '{') { buf += '{'; i += 2; continue; }
      const m = /^\{(\/[a-zA-Z][a-zA-Z0-9-]*|[a-zA-Z][a-zA-Z0-9-]*(?:\s+[^}]*)?)\}/.exec(text.slice(i));
      if (!m) {
        diags.push(diag('E_TAG_SYNTAX', lineno, i + 1, `malformed tag near ${JSON.stringify(text.slice(i, i + 16))}`));
        buf += c; i += 1; continue;
      }
      const inner = m[1];
      i += m[0].length;
      if (inner.startsWith('/')) {
        const name = inner.slice(1);
        const top = stack[stack.length - 1];
        const topName = typeof top === 'object' ? 'speed' : top;
        if (!stack.length || topName !== name) {
          diags.push(diag('E_TAG_MISMATCH', lineno, i, `closing {/${name}} without open`));
        } else stack.pop();
        continue;
      }
      const sp = inner.indexOf(' ');
      const name = (sp < 0 ? inner : inner.slice(0, sp)).trim();
      const arg = sp < 0 ? '' : inner.slice(sp + 1).trim();
      if (name === 'wait') {
        pushBuf();
        if (!/^\d+(\.\d+)?$/.test(arg)) diags.push(diag('E_TAG_ARG', lineno, i, '{wait} needs numeric seconds'));
        segs.push({ text: '', wait: parseFloat(arg) || 0 });
        continue;
      }
      if (name === 'ruby' && !arg) diags.push(diag('E_TAG_ARG', lineno, i, '{ruby} needs reading'));
      if (name === 'speed' && !/^\d+(\.\d+)?$/.test(arg)) diags.push(diag('E_TAG_ARG', lineno, i, '{speed} needs numeric factor'));
      if (!BUILTIN_TAGS.has(name) && !customTags.includes(name))
        diags.push(diag('W_TAG_UNKNOWN', lineno, i, `unknown tag ${JSON.stringify(name)} (custom tags must be registered)`));
      pushBuf();
      if (name === 'ruby') stack.push({ ruby: arg, name: 'ruby' });
      else if (name === 'speed') stack.push({ speed: parseFloat(arg) || 1, name: 'speed' });
      else stack.push(name);
      continue;
    }
    if (c === '}') { diags.push(diag('E_TAG_SYNTAX', lineno, i + 1, 'stray }')); buf += c; i += 1; continue; }
    buf += c; i += 1;
  }
  pushBuf();
  for (const t of stack) {
    const nm = typeof t === 'object' ? t.name : t;
    diags.push(diag('E_TAG_UNCLOSED', lineno, text.length, `{${nm}} not closed`));
  }
  // flatten ruby: mark segs inside ruby with reading
  const out = [];
  let rubyDepth = null;
  for (const s of segs) { out.push(s); }
  return segs;
}

/* ruby needs special handling: track which segs were inside {ruby} */
function parseInline2(text, lineno, diags, customTags = []) {
  // Same scan but annotate ruby. Simpler: re-run with a state machine.
  const segs = [];
  const stack = [];
  const isOpen = (n) => stack.some(t => (typeof t === 'object' ? t.name : t) === n);
  const marks = () => stack.filter(s => typeof s === 'string');
  const speedMul = () => stack.reduce((a, t) => a * (typeof t === 'object' && t.name === 'speed' ? t.arg : 1), 1);
  const rubyOf = () => { const r = stack.find(t => typeof t === 'object' && t.name === 'ruby'); return r ? r.arg : undefined; };
  let buf = '', i = 0;
  const pushBuf = () => {
    if (!buf) return;
    segs.push({ text: buf, marks: marks(), ruby: rubyOf(), speed: speedMul() });
    buf = '';
  };
  while (i < text.length) {
    const c = text[i];
    if (c === '{') {
      if (text[i + 1] === '{') { buf += '{'; i += 2; continue; }
      const m = /^\{(\/[a-zA-Z][a-zA-Z0-9-]*|[a-zA-Z][a-zA-Z0-9-]*(?:\s+[^}]*)?)\}/.exec(text.slice(i));
      if (!m) { diags.push(diag('E_TAG_SYNTAX', lineno, i + 1, `malformed tag near ${JSON.stringify(text.slice(i, i + 16))}`)); buf += c; i += 1; continue; }
      const inner = m[1]; i += m[0].length;
      if (inner.startsWith('/')) {
        const name = inner.slice(1);
        const idx = stack.map(t => (typeof t === 'object' ? t.name : t)).lastIndexOf(name);
        if (idx < 0 || idx !== stack.length - 1) {
          diags.push(diag('E_TAG_MISMATCH', lineno, i, `closing {/${name}} without open`));
          if (idx >= 0) stack.splice(idx, 1);
        } else stack.pop();
        continue;
      }
      const sp = inner.indexOf(' ');
      const name = (sp < 0 ? inner : inner.slice(0, sp)).trim();
      const arg = sp < 0 ? '' : inner.slice(sp + 1).trim();
      if (name === 'wait') {
        pushBuf();
        if (!/^\d+(\.\d+)?$/.test(arg)) diags.push(diag('E_TAG_ARG', lineno, i, '{wait} needs numeric seconds'));
        segs.push({ wait: parseFloat(arg) || 0 });
        continue;
      }
      if (name === 'ruby' && !arg) diags.push(diag('E_TAG_ARG', lineno, i, '{ruby} needs reading'));
      if (name === 'speed' && !/^\d+(\.\d+)?$/.test(arg)) diags.push(diag('E_TAG_ARG', lineno, i, '{speed} needs numeric factor'));
      if (!BUILTIN_TAGS.has(name) && !customTags.includes(name))
        diags.push(diag('W_TAG_UNKNOWN', lineno, i, `unknown tag ${JSON.stringify(name)} (custom tags must be registered)`));
      pushBuf();
      stack.push(name === 'ruby' || name === 'speed' ? { name, arg: name === 'speed' ? parseFloat(arg) || 1 : arg } : name);
      continue;
    }
    if (c === '}') { diags.push(diag('E_TAG_SYNTAX', lineno, i + 1, 'stray }')); buf += c; i += 1; continue; }
    buf += c; i += 1;
  }
  pushBuf();
  for (const t of stack) diags.push(diag('E_TAG_UNCLOSED', lineno, text.length, `{${typeof t === 'object' ? t.name : t}} not closed`));
  return segs;
}

export function compileNvs(src, { knownAssets = null, customTags = [], file = '<nvs>' } = {}) {
  const diags = [];
  const lines = src.split('\n');
  const scenes = [];
  const ids = new Map(); // id → line
  const assetsUsed = new Map(); // asset → line
  let cur = null;
  let stepIndex = -1;

  const reg = (asset, i) => {
    if (!assetsUsed.has(asset)) assetsUsed.set(asset, i);
    if (knownAssets && !knownAssets.has(asset))
      diags.push(diag('W_ASSET_UNKNOWN', i, 1, `asset ${JSON.stringify(asset)} not registered`));
  };
  const regId = (id, i) => {
    if (!id) return;
    if (ids.has(id)) diags.push(diag('E_ID_DUP', i, 1, `sentence id #${id} duplicated (first at line ${ids.get(id)})`));
    else ids.set(id, i);
  };

  for (let i = 1; i <= lines.length; i++) {
    const line = lines[i - 1].replace(/\s+$/, '');
    if (!line.trim()) continue;
    if (line.startsWith('scene ')) {
      cur = { title: line.slice(6).trim(), source: null, line: i, items: [] };
      scenes.push(cur);
      continue;
    }
    if (line.startsWith('source ')) {
      if (!cur) { diags.push(diag('E_SCENE_MISSING', i, 1, 'source before any scene header')); continue; }
      if (cur.source) diags.push(diag('E_SOURCE_DUP', i, 1, 'second source line in scene'));
      const spec = line.slice(7).trim();
      const m = /^p(\d{4})(?:-p(\d{4}))?$/.exec(spec);
      if (!m) diags.push(diag('E_SOURCE_SYNTAX', i, 1, `source range ${JSON.stringify(spec)} not pNNNN[-pNNNN]`));
      else {
        const a = +m[1], b = +(m[2] || m[1]);
        if (a > b) diags.push(diag('E_SOURCE_ORDER', i, 1, `source range reversed ${spec}`));
        cur.source = [a, b];
      }
      continue;
    }
    if (!cur) { diags.push(diag('E_SCENE_MISSING', i, 1, 'content before scene header')); continue; }
    if (line.startsWith('@')) {
      const sp2 = line.indexOf(' ');
      const cmd = sp2 < 0 ? line.slice(1) : line.slice(1, sp2);
      const argstr = sp2 < 0 ? '' : line.slice(sp2 + 1).trim();
      const spec = COMMANDS[cmd];
      if (!spec) { diags.push(diag('E_CMD_UNKNOWN', i, 1, `unknown command @${cmd}`)); continue; }
      stepIndex++;
      const item = { type: 'cmd', cmd, line: i };
      if (cmd === 'caption') {
        const wait = /\bwait$/.test(argstr);
        item.text = (wait ? argstr.replace(/\bwait$/, '') : argstr).trim();
        // trailing duration e.g. "@caption 三年 0.8": split last numeric token as fade duration
        const dm = /^(.*?)\s+(\d+(?:\.\d+)?)$/.exec(item.text);
        if (dm) { item.text = dm[1]; item.duration = +dm[2]; }
        item.wait = wait;
      } else {
        const args = argstr ? argstr.split(/\s+/) : [];
        if (args.length < spec.req.length)
          diags.push(diag('E_CMD_ARITY', i, 1, `@${cmd} needs ${spec.req.length} args, got ${args.length}`));
        item.args = args;
        if (['bg', 'fg', 'show', 'face', 'costume', 'cg'].includes(cmd) && args[0]) {
          if (!ASSET_RE.test(args[0])) diags.push(diag('E_ASSET_SYNTAX', i, 1, `asset ${JSON.stringify(args[0])} not lowercase-name/segments`));
          else reg(args[0], i);
        }
        if (cmd === 'show' && args[1] && !SLOTS.has(args[1]) && !/^\d/.test(args[1]))
          diags.push(diag('W_SLOT', i, 1, `slot ${JSON.stringify(args[1])} not in left|center|right|far-left|far-right`));
        if (cmd === 'hide' && args[0] && !SLOTS.has(args[0]) && !ASSET_RE.test(args[0]))
          diags.push(diag('W_SLOT', i, 1, `@hide arg ${JSON.stringify(args[0])} is neither slot nor asset id`));
        if (cmd === 'hide' && args[0] && ASSET_RE.test(args[0]) && !SLOTS.has(args[0])) reg(args[0], i); // @hide by asset id (ch23 uses it)
        if (cmd === 'bg' && args[1] && !TRANSITIONS.has(args[1]) && !/^\d/.test(args[1]))
          diags.push(diag('W_ARG', i, 1, `@bg transition ${JSON.stringify(args[1])} unknown`));
        if (cmd === 'particle' && args[0] && !PARTICLES.has(args[0]))
          diags.push(diag('W_PARTICLE', i, 1, `particle ${JSON.stringify(args[0])} not builtin`));
        if (cmd === 'filter' && args[0] && !FILTERS.has(args[0]))
          diags.push(diag('W_FILTER', i, 1, `filter ${JSON.stringify(args[0])} not builtin`));
        if (cmd === 'wait' && args[0] && !/^\d+(\.\d+)?$/.test(args[0]))
          diags.push(diag('E_CMD_ARG', i, 1, `@wait arg ${JSON.stringify(args[0])} not seconds`));
      }
      item.step = stepIndex;
      cur.items.push(item);
      continue;
    }
    // text line
    let sp, textpart;
    if (line.startsWith(': ')) {
      sp = { kind: 'narration' };
      textpart = line.slice(2);
    } else {
      const m = SPEAKER_RE.exec(line);
      if (!m) { diags.push(diag('E_LINE_SYNTAX', i, 1, `line matches neither speaker, narration, nor command: ${JSON.stringify(line.slice(0, 60))}`)); continue; }
      sp = { kind: 'dialogue', speaker: m.groups.asset, alias: m.groups.alias || null, inner: false };
      if (m.groups.paren) {
        for (const tok of m.groups.paren.split(/\s+/)) {
          if (tok === 'inner') { sp.inner = true; sp.kind = 'inner'; }
          else diags.push(diag('W_PAREN', i, 1, `unknown speaker modifier (${tok})`));
        }
      }
      if (!ASSET_RE.test(sp.speaker)) diags.push(diag('E_ASSET_SYNTAX', i, 1, `speaker ${JSON.stringify(sp.speaker)} not lowercase-name`));
      else reg(sp.speaker, i);
      textpart = m.groups.text;
    }
    // trailing tokens: "#id" last, "cont" before it (doc: cont 在句子 ID 前)
    let sid = null, cont = false;
    const idm = ID_RE.exec(textpart);
    if (idm) { sid = idm[1]; textpart = textpart.slice(0, idm.index); regId(sid, i); }
    else diags.push(diag('W_ID_MISSING', i, 1, 'text line has no #id (app assigns at save)'));
    if (/(\s|^)cont\s*$/.test(textpart)) { cont = true; textpart = textpart.replace(/(\s|^)cont\s*$/, ''); }
    const segs = parseInline2(textpart.trim(), i, diags, customTags);
    stepIndex++;
    cur.items.push({ type: 'line', ...sp, text: textpart.trim(), segs, id: sid, cont, line: i, step: stepIndex });
  }

  // source coverage
  const covered = new Map();
  for (const sc of scenes) {
    if (!sc.source) { diags.push(diag('W_SOURCE_MISSING', sc.line, 1, `scene ${JSON.stringify(sc.title)} has no source line`)); continue; }
    for (let p = sc.source[0]; p <= sc.source[1]; p++) {
      if (covered.has(p)) diags.push(diag('E_SOURCE_OVERLAP', sc.line, 1, `p${String(p).padStart(4, '0')} covered by both ${JSON.stringify(covered.get(p))} and ${JSON.stringify(sc.title)}`));
      else covered.set(p, sc.title);
    }
  }
  let gaps = [];
  if (scenes.length && covered.size) {
    const max = Math.max(...covered.keys());
    for (let p = 1; p <= max; p++) if (!covered.has(p)) gaps.push(p);
    if (gaps.length) diags.push(diag('W_SOURCE_GAP', scenes[0].line, 1, `paragraphs not covered: ${gaps.map(p => 'p' + String(p).padStart(4, '0')).join(' ')}`));
  }
  return { file, scenes, diags, stats: { lines: ids.size, assets: assetsUsed.size, scenes: scenes.length }, assetsUsed: [...assetsUsed.keys()], sourceGaps: gaps };
}

/* ---------- CLI ---------- */
if (process.argv[1] && process.argv[1].endsWith('compile.mjs')) {
  const dir = new URL('../public/scripts/', import.meta.url).pathname;
  const registryPath = new URL('../public/assets/registry.json', import.meta.url).pathname;
  let known = null;
  try { known = new Set(JSON.parse(readFileSync(registryPath, 'utf8')).map(r => r.id)); } catch {}
  const outDir = new URL('../src/compiled/', import.meta.url).pathname;
  mkdirSync(outDir, { recursive: true });
  const all = {};
  for (const f of readdirSync(dir).filter(f => f.endsWith('.nvs')).sort()) {
    const src = readFileSync(join(dir, f), 'utf8');
    const r = compileNvs(src, { knownAssets: known, file: f });
    all[f] = { scenes: r.scenes, stats: r.stats };
    writeFileSync(join(outDir, f.replace(/\.nvs$/, '.json')), JSON.stringify({ file: f, scenes: r.scenes }, null, 1));
    console.log(`\n=== ${f} — ${r.stats.scenes} scenes, ${r.stats.lines} ids, ${r.stats.assets} distinct assets, ${r.diags.length} diagnostics`);
    for (const d of r.diags) console.log(`  ${d.line}:${d.col} ${d.code} ${d.message}${d.hint ? ` (hint: ${d.hint})` : ''}`);
    if (r.sourceGaps.length) console.log('  gaps:', r.sourceGaps.join(','));
  }
}
