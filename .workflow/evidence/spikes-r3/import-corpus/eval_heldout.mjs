// Held-out evaluation: run the FROZEN src copies (frozen/*.mjs, hashes in
// frozen/SHA256.txt) against corpus-heldout/. No rule tuning allowed
// before this first run.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectEncoding } from "./src/detect.mjs";
import { splitChapters } from "./src/split.mjs";

const DIR = new URL("./corpus-heldout/", import.meta.url).pathname;

// Ground truth per file: regex over raw text lines marking true headings.
const GT = {
  "h-sanguo.txt": /^(?:第[一二三四五六七八九十]+回|序|凡例)/m,
  "h-rulin.txt": /^第[一二三四五六七八九十]+回/m,
  "h-fengshen.txt": /^第[一二三四五六七八九十]+回/m,
  "h-xixiang.txt": /^(?:第[一二三四五六七八九十]+[折摺]|楔子)/m,
  "h-jingshi.txt": /^(?:第[一二三四五六七八九十]+卷|序)/m,
  "h-tocblock.txt": /^第\d+章$/m,
  "h-wrapped.txt": /^第\d+章$/m,
  "h-fullwidth.txt": /^第[０-９]+章$/m,
  "h-ads-inline.txt": /^第\d+章$/m,
};

const files = readdirSync(DIR).filter(f => f.endsWith(".txt")).sort();
const rows = [];
for (const f of files) {
  const bytes = readFileSync(join(DIR, f));
  const row = { file: f, bytes: bytes.length };
  let d;
  try { d = detectEncoding(new Uint8Array(bytes)); row.enc = d.label; }
  catch (e) { row.enc = "ERR:" + e.message; rows.push(row); continue; }
  const s = splitChapters(d.text);
  row.rule = s.ruleUsed; row.vrule = s.volumeRuleUsed;
  row.ch = s.units.filter(u => u.kind === "chapter").length;
  row.v = s.units.filter(u => u.kind === "volume").length;
  row.titles = s.units.slice(0, 40).map(u => u.kind + ":" + u.title.slice(0, 20));
  // heading-level P/R against GT regex
  const gtRe = GT[f];
  if (gtRe) {
    const truthLines = new Set();
    d.text.split("\n").forEach((l) => { if (gtRe.test(l.trim())) truthLines.add(l.trim()); });
    const det = new Set(s.units.filter(u => u.kind !== "volume").map(u => u.title));
    const tp = [...det].filter(t => truthLines.has(t)).length;
    row.truth = truthLines.size;
    row.tp = tp;
    row.P = det.size ? +(tp / det.size * 100).toFixed(1) : 0;
    row.R = truthLines.size ? +(tp / truthLines.size * 100).toFixed(1) : 0;
    row.FP = [...det].filter(t => !truthLines.has(t));
    row.FN = [...truthLines].filter(t => !det.has(t)).slice(0, 10);
  }
  rows.push(row);
}
console.log(JSON.stringify(rows, null, 1));
