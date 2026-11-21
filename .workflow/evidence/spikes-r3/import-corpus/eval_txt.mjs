// Evaluate encoding detection + chapter split on corpus/.
// Legacy equivalent: chardet ranking + fatal decode + quality gate
// (3 labels only) and family-mutual-exclusion 第N章/Chapter N detection.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyse } from "chardet";
import { detectEncoding, detectBom, fatalDecode, assessQuality } from "./src/detect.mjs";
import { splitChapters, normalizeText, DEFAULT_CHAPTER_RULES, scanLines } from "./src/split.mjs";

const CORPUS = new URL("./corpus/", import.meta.url).pathname;

// ---------- legacy implementations ----------
const LEGACY_LABELS = ["utf-8", "gb18030", "shift_jis"];
const SUPPORTED = { "UTF-8": "utf-8", GB18030: "gb18030", Shift_JIS: "shift_jis" };

function legacyEncoding(bytes) {
  const bom = detectBom(bytes);
  if (bom) {
    if (bom === "utf-8") {
      const t = fatalDecode("utf-8", bytes);
      if (t && assessQuality(t).pass) return { label: "utf-8", text: t };
      return null;
    }
    return null; // unsupported-bom -> error
  }
  if (bytes.every(b => b < 0x80)) return { label: "utf-8", text: new TextDecoder().decode(bytes) };
  const best = new Map();
  for (const m of analyse(bytes)) {
    const enc = SUPPORTED[m.name];
    if (!enc) continue;
    if (!best.has(enc) || m.confidence > best.get(enc)) best.set(enc, m.confidence);
  }
  const ranked = [...best.entries()].sort((a, b) => b[1] - a[1]);
  for (const [label] of ranked) {
    const t = fatalDecode(label, bytes);
    if (t && assessQuality(t).pass) return { label, text: t };
  }
  return null;
}

const LEGACY_CN = /^第\s*([零〇一二三四五六七八九十百千万]+)\s*章/;
const LEGACY_CN_D = /^第\s*([0-9]+)\s*章/;
const LEGACY_EN = /^chapter\s*([0-9]+|[ivxlcdm]+)/i;

function legacyChapters(text) {
  // legacy normalizes to paragraphs on blank lines, then requires marker at
  // paragraph-start, single family, sequential numbering — else warns only.
  const norm = normalizeText(text);
  const paras = norm.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const markers = [];
  paras.forEach((p, pi) => {
    const line = p.split("\n")[0].trim();
    let m = line.match(LEGACY_CN_D);
    if (m) return markers.push({ pi, family: "cn-digit", seq: parseInt(m[1], 10), text: line });
    m = line.match(LEGACY_CN);
    if (m) return markers.push({ pi, family: "cn-ideograph", seq: cnNum(m[1]), text: line });
    m = line.match(LEGACY_EN);
    if (m) return markers.push({ pi, family: "en", seq: parseInt(m[1], 10), text: line });
  });
  if (markers.length === 0) return { chapters: [], warning: "no-chapter-markers" };
  if (new Set(markers.map(m => m.family)).size > 1) return { chapters: [], warning: "conflicting-chapter-titles" };
  const seq = markers.every((m, i) => m.seq === i + 1);
  if (!seq) return { chapters: [], warning: "abnormal-chapter-count", count: markers.length };
  return { chapters: markers.map(m => ({ pi: m.pi, title: m.text })) };
}
const CN = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function cnNum(s) {
  let r = 0, sec = 0;
  for (const ch of s) {
    if (CN[ch] !== undefined) sec = CN[ch];
    else if (ch === "十") { r += sec * 10 || 10; sec = 0; }
    else if (ch === "百") { r += sec * 100; sec = 0; }
    else if (ch === "千") { r += sec * 1000; sec = 0; }
    else if (ch === "万" || ch === "萬") { r = (r + sec) * 10000; sec = 0; }
  }
  return r + sec;
}

// ---------- ground truth ----------
// For luotuo variants: 24 chapters `第N章` (or restyled). For fetched
// files we annotate expected chapter titles after inspection.
const EXPECTED_REAL = {
  "hongloumeng.txt": { enc: "utf-8", chapters: 10, vols: 0, rule: "c-回目" },
  "laocan.txt": { enc: "utf-8", chapters: 21, vols: 0, rule: "c-回目" },
  "jinghuayuan.txt": { enc: "utf-8", chapters: 8, vols: 0, rule: "c-回目" },
  "liaozhai.txt": { enc: "utf-8", chapters: 2, vols: 0, rule: "c-回目" }, // 第NN卷 demoted post-fix
  "chenlun.txt": { enc: "utf-8", chapters: 8, vols: 0, rule: "c-汉字数字标题" },
};
const EXPECTED = {
  "luotuo-utf8.txt": { enc: "utf-8", chapters: 24, vols: 0 },
  "luotuo-utf8bom.txt": { enc: "utf-8", chapters: 24, vols: 0 },
  "luotuo-gbk.txt": { enc: "gb18030", chapters: 24, vols: 0 },
  "luotuo-big5.txt": { enc: "big5", chapters: 24, vols: 0 },
  "luotuo-trad-utf8.txt": { enc: "utf-8", chapters: 24, vols: 0 },
  "luotuo-utf16le-bom.txt": { enc: "utf-16le", chapters: 24, vols: 0 },
  "luotuo-utf16le-nobom.txt": { enc: "utf-16le", chapters: 24, vols: 0 },
  "luotuo-utf16be-bom.txt": { enc: "utf-16be", chapters: 24, vols: 0 },
  "luotuo-utf16be-nobom.txt": { enc: "utf-16be", chapters: 24, vols: 0 },
  "luotuo-crlf.txt": { enc: "utf-8", chapters: 24, vols: 0 },
  "luotuo-mixed-eol.txt": { enc: "utf-8", chapters: 24, vols: 0 },
  "luotuo-fwindent.txt": { enc: "utf-8", chapters: 24, vols: 0 },
  "luotuo-webnoise.txt": { enc: "utf-8", chapters: 24, vols: 0 },
  "luotuo-falsepos.txt": { enc: "utf-8", chapters: 24, vols: 0 },
  "luotuo-noblank.txt": { enc: "utf-8", chapters: 24, vols: 0 },
  "luotuo-titled.txt": { enc: "utf-8", chapters: 24, vols: 0 },
  "luotuo-cnnum.txt": { enc: "utf-8", chapters: 24, vols: 0 },
  "luotuo-numonly.txt": { enc: "utf-8", chapters: 24, vols: 0 },
  "luotuo-volumes.txt": { enc: "utf-8", chapters: 24, vols: 3 },
  "luotuo-extra.txt": { enc: "utf-8", chapters: 29, vols: 0 }, // 序章+楔子+24+番外+尾声+后记
};

const files = readdirSync(CORPUS).filter(f => f.endsWith(".txt")).sort();
const rows = [];
for (const f of files) {
  const bytes = readFileSync(join(CORPUS, f));
  const row = { file: f, bytes: bytes.length };

  // encoding: new
  try {
    const d = detectEncoding(new Uint8Array(bytes));
    row.encNew = d.label + (d.ambiguous ? "(ambig:" + d.candidates.map(c=>c.label+"@"+c.score.toFixed(2)).join("/") + ")" : "");
  } catch (e) { row.encNew = "ERR:" + e.message; }
  // encoding: legacy
  try {
    const l = legacyEncoding(new Uint8Array(bytes));
    row.encLegacy = l ? l.label : "FAIL";
  } catch (e) { row.encLegacy = "ERR:" + e.message; }

  // decode with new result for chapter eval
  let text = null;
  try { text = detectEncoding(new Uint8Array(bytes)).text; } catch {}
  if (text) {
    const s = splitChapters(text);
    const chs = s.units.filter(u => u.kind === "chapter");
    const vls = s.units.filter(u => u.kind === "volume");
    row.newChapters = chs.length;
    row.newVols = vls.length;
    row.newTitles = chs.slice(0, 6).map(c => c.title.slice(0, 14)).join(" | ");
    row.rule = s.ruleUsed;
    row.vrule = s.volumeRuleUsed;
    const l = legacyChapters(text);
    row.legacyChapters = l.chapters.length + (l.warning ? "(" + l.warning + ")" : "");
  }
  const exp = EXPECTED[f] ?? EXPECTED_REAL[f];
  if (exp) {
    row.encOk = row.encNew.startsWith(exp.enc) ? "y" : "N(exp " + exp.enc + ")";
    row.chOk = row.newChapters === exp.chapters ? "y" : `N(exp ${exp.chapters})`;
    row.vOk = row.newVols === exp.vols ? "y" : `N(exp ${exp.vols})`;
  }
  rows.push(row);
}
console.log(JSON.stringify(rows, null, 1));
