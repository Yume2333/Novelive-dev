#!/usr/bin/env node
/* Asset bridge: map script asset names → R3 image pipeline files, generate
 * documented placeholders (gray + icon + 需要处理) for anything missing.
 * Emits public/assets/registry.json — the Bible-style asset registry.
 *
 * Naming mismatch is itself the finding: scripts say `beijing-street`,
 * `xiangzi/ragged-white-jacket/plain`; pipeline produced `bg-beiping-street`,
 * `sprite-xiangzi-puller`, `expr-xiangzi-puller-*`. In production both sides
 * read ONE registry; here we hand-write the equivalence.
 */


import { readdirSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import sharp from 'sharp';

const IMG = process.env.NL_IMG_OUT ?? new URL('../../image-pipeline/out', import.meta.url).pathname;
const OUT = new URL('../public/assets/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const files = new Set(readdirSync(IMG).filter(f => f.endsWith('.webp') && !f.includes('thumb')));

/* hand-written mapping: script asset id → pipeline file */
const MAP = {
  // ch01
  'beijing-street':                       'bg-beiping-street.webp',
  'beijing-street/dusk':                  'bg-beiping-street-dusk.webp',
  'beijing-street/rain':                  'bg-beiping-street-rain.webp',
  'hutong-courtyard':                     'bg-renhe-yard.webp',          // closest courtyard bg
  'rickshaw-shop':                        null,
  'notes-paper':                          null,
  'xiangzi/ragged-white-jacket':          'sprite-xiangzi-puller.webp',
  'xiangzi/ragged-white-jacket/plain':    'sprite-xiangzi-puller.webp',
  'xiangzi/ragged-white-jacket/happy':    'expr-xiangzi-puller-happy.webp',
  'xiangzi/ragged-white-jacket/sad':      'expr-xiangzi-puller-sad.webp',
  'xiangzi/ragged-white-jacket/sly':      'expr-xiangzi-puller-surprised.webp', // no sly drawn → nearest
  'xiangzi/ragged-white-jacket/angry':    'expr-xiangzi-puller-angry.webp',
  'xiangzi/ragged-white-jacket/surprised':'expr-xiangzi-puller-surprised.webp',
  'rickshaw-shop-owner/default/plain':    null,
  'xiangzi-new-rickshaw':                 null,
  // ch02
  'beiping/street-day':                   'bg-beiping-street.webp',
  'beiping/street-day/tense':             'bg-beiping-street-night.webp',
  'beiping/west-street':                  'bg-beiping-street-dusk.webp',
  'beiping/xizhimen-gate':                'bg-beiping-street-night.webp',
  'beiping/outside-road':                 'bg-beiping-street-rain.webp',
  'army-camp/night':                      'bg-renhe-yard-night.webp',
  'mountain-camp/night':                  'bg-renhe-yard-night.webp',
  'mountain-camp/night/shellfire':        'cg-cg-escape-camels.webp', // repurposed: shows camels at night
  'xiangzi/new-outfit':                   'sprite-xiangzi-puller.webp',
  'xiangzi/new-outfit/plain':             'sprite-xiangzi-puller.webp',
  'xiangzi/new-outfit/happy':             'expr-xiangzi-puller-happy.webp',
  'bald-rickshawman/default/plain':       null,
  // ch23
  'street-chaokou':                       'bg-beiping-street.webp',
  'xizhimen-wasteland':                   'bg-beiping-street-dusk.webp',
  'baifangzi-room':                       'bg-renhe-yard-night.webp',
  'graveyard-pines':                      null,
  'hutong-winter':                        'bg-beiping-street-night.webp',
  'tianqiao':                             'bg-beiping-street-rain.webp',
  'demo-street':                          'bg-beiping-street.webp',
  'xiaoma-grandpa/default/plain':         null,
  'xiaoma-grandpa/default/sad':           null,
  'baimian-koudai/default/plain':         'sprite-huniu-home.webp',   // only adult-woman sprite drawn
  'gao-ma/default/surprised':             'expr-huniu-home-surprised.webp',
  // shorthand face ids `char/expr` (omit costume) — resolve like base costume's expr
  'xiangzi/happy':                        'expr-xiangzi-puller-happy.webp',
  'xiangzi/sad':                          'expr-xiangzi-puller-sad.webp',
  'xiangzi/angry':                        'expr-xiangzi-puller-angry.webp',
  'xiangzi/surprised':                    'expr-xiangzi-puller-surprised.webp',
  'xiangzi/sly':                          'expr-xiangzi-puller-surprised.webp',
  'xiangzi/plain':                        'sprite-xiangzi-puller.webp',
  'xiaoma-grandpa/sad':                   null,
  'xiaoma-grandpa/plain':                 null,
  'gao-ma/plain':                         'sprite-huniu-home.webp',
  'gao-ma/default/plain':                 'sprite-huniu-home.webp',
  'hanging-woods':                        null,
};

function kind(id) {
  const seg = id.split('/').length;
  if (id.startsWith('xiangzi') || id.includes('rickshawman') || id.includes('grandpa') || id.includes('koudai') || id.includes('gao-ma') || id.includes('owner') || id.includes('huniu') || id.includes('xiaoma') || id.includes('baimian') || id.includes('bald')) return 'sprite';
  if (id === 'hanging-woods' || id === 'xiangzi-new-rickshaw') return 'cg';
  return seg === 1 || seg === 2 || seg === 3 ? 'background' : 'sprite';
}
/* classify from the compiler's asset list instead of heuristics: sprites are
   char/costume[/expr] (3 segs or char name first), cg from manifest type. */
const CG_IDS = new Set(['xiangzi-new-rickshaw', 'hanging-woods']);
const SPRITE_CHARS = new Set(['xiangzi', 'rickshaw-shop-owner', 'bald-rickshawman', 'xiaoma-grandpa', 'baimian-koudai', 'gao-ma']);
function classify(id) {
  if (CG_IDS.has(id)) return 'cg';
  if (SPRITE_CHARS.has(id.split('/')[0])) return 'sprite';
  return 'background';
}

async function placeholder(kind, label) {
  const W = kind === 'sprite' ? 1024 : 1920, H = kind === 'sprite' ? 1536 : 1080;
  const icon =
    kind === 'sprite'   ? `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 24 24" fill="none" stroke="#8a8a8a" stroke-width="1.6"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg>`
    : kind === 'cg'     ? `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 24 24" fill="none" stroke="#8a8a8a" stroke-width="1.6"><rect x="3" y="4" width="18" height="14" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M3 16l5-4 4 3 5-5 4 4"/></svg>`
    :                     `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 24 24" fill="none" stroke="#8a8a8a" stroke-width="1.6"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M3 14l4-3 4 3 5-4 5 4"/><circle cx="9" cy="8" r="1.4"/></svg>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="${kind === 'sprite' ? '#4a4a4a' : '#555'}"/>
    ${kind === 'sprite' ? `<rect width="${W}" height="${H}" fill="none"/>` : ''}
    <g transform="translate(${W / 2 - 80}, ${H / 2 - 110})">${icon}</g>
    <text x="${W / 2}" y="${H / 2 + 60}" font-size="${kind === 'sprite' ? 40 : 56}" fill="#b0b0b0" text-anchor="middle" font-family="sans-serif">需要处理</text>
    <text x="${W / 2}" y="${H / 2 + (kind === 'sprite' ? 110 : 130)}" font-size="22" fill="#7d7d7d" text-anchor="middle" font-family="sans-serif">${label}</text>
  </svg>`;
  const buf = await sharp(Buffer.from(svg), { density: 96 })
    .webp({ quality: 90 })
    .toBuffer();
  if (kind === 'sprite') {
    // sprites need alpha: cut icon area? spec says transparent — keep gray figure
    // on transparent bg: rebuild with transparent canvas
    const svgT = svg.replace(`<rect width="${W}" height="${H}" fill="#4a4a4a"/>`, `<rect width="${W}" height="${H}" fill="#4a4a4a" fill-opacity="0.55" rx="24"/>`);
    return sharp(Buffer.from(svgT)).webp({ quality: 90 }).toBuffer();
  }
  return buf;
}

/* compile every script, union asset ids */
const { compileNvs } = await import('./compile.mjs');
const scriptDir = new URL('../public/scripts/', import.meta.url).pathname;
const used = new Map(); // id → kind
for (const f of readdirSync(scriptDir).filter(f => f.endsWith('.nvs'))) {
  const r = compileNvs(readFileSync(join(scriptDir, f), 'utf8'), { file: f });
  for (const a of r.assetsUsed) {
    // only stage assets matter (bg/show/face/costume/cg/fg args) — collect from items
  }
  for (const sc of r.scenes) for (const it of sc.items) {
    if (it.type === 'cmd' && ['bg', 'fg', 'show', 'face', 'costume', 'cg', 'hide'].includes(it.cmd) && it.args?.[0]) {
      const id = it.args[0];
      if (/^[a-z]/.test(id) && !['left', 'center', 'right', 'far-left', 'far-right'].includes(id))
        used.set(id, it.cmd === 'cg' || CG_IDS.has(id) ? 'cg' : classify(id));
    }
    if (it.type === 'line' && it.speaker) used.set(it.speaker, 'speaker');
  }
}

const registry = [];
let mapped = 0, ph = 0;
for (const id of [...used.keys()].sort()) {
  const kind = used.get(id) === 'speaker' ? 'speaker' : used.get(id);
  const file = MAP[id];
  const entry = { id, kind: kind === 'speaker' ? 'speaker' : kind };
  if (file && files.has(file)) {
    copyFileSync(join(IMG, file), join(OUT, file));
    entry.file = file; entry.status = 'mapped'; entry.sourceFile = file;
    mapped++;
  } else if (kind === 'speaker') {
    entry.status = 'speaker-only'; // not a stage asset
  } else {
    const name = `ph-${id.replaceAll('/', '-')}.webp`;
    writeFileSync(join(OUT, name), await placeholder(kind, id));
    entry.file = name; entry.status = 'placeholder';
    ph++;
  }
  registry.push(entry);
}

/* resolve sprite base for expression-only ids: xiangzi/x/y shows sprite-xiangzi-puller already via map */
writeFileSync(join(OUT, 'registry.json'), JSON.stringify(registry, null, 1));
console.log(`mapped=${mapped} placeholder=${ph} speakers=${registry.filter(r => r.status === 'speaker-only').length} total=${registry.length}`);
for (const r of registry) console.log(`  ${r.status.padEnd(12)} ${r.id} → ${r.file ?? '-'}`);
