// Encoding detection: closed label set, BOM first, then fatal-decode +
// script-density scoring. No chardet/iconv-lite — Node TextDecoder only.
// Labels cover creation-pipeline.md:7 — utf-8 | gb18030 | big5 | shift_jis |
// utf-16le | utf-16be.
export const ENCODING_LABELS = ["utf-8", "gb18030", "big5", "shift_jis", "utf-16le", "utf-16be"];

const BOM_TABLE = [
  { bytes: [0xef, 0xbb, 0xbf], label: "utf-8" },
  { bytes: [0xff, 0xfe, 0x00, 0x00], label: "utf-32le" },
  { bytes: [0xff, 0xfe], label: "utf-16le" },
  { bytes: [0xfe, 0xff], label: "utf-16be" },
  { bytes: [0x00, 0x00, 0xfe, 0xff], label: "utf-32be" },
];

export function detectBom(bytes) {
  for (const { bytes: sig, label } of BOM_TABLE) {
    if (bytes.length >= sig.length && sig.every((b, i) => bytes[i] === b)) return label;
  }
  return null;
}

export function fatalDecode(label, bytes) {
  try {
    return new TextDecoder(label, { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

// ---- quality gate (ported from legacy quality.ts thresholds) ----
const MAX_NUL_RATIO = 0.02;
const MAX_CONTROL_RATIO = 0.05;
const MIN_TEXT_DENSITY = 0.8;

function isControl(cp) {
  return (cp < 0x20 && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d) ||
    cp === 0x7f || (cp >= 0x80 && cp <= 0x9f);
}
function isNoncharacter(cp) {
  return (cp & 0xfffe) === 0xfffe || (cp >= 0xfdd0 && cp <= 0xfdef);
}

export function assessQuality(text) {
  let total = 0, nul = 0, control = 0, printable = 0, nonWs = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    total++;
    if (cp === 0) nul++;
    if (isControl(cp) || isNoncharacter(cp)) control++;
    const ws = /\s/u.test(ch);
    if (!ws) nonWs++;
    if (!ws && !isControl(cp) && !isNoncharacter(cp) && !(cp >= 0xd800 && cp <= 0xdfff)) printable++;
  }
  const evidence = [];
  if (total === 0) return { pass: false, evidence: ["empty"] };
  if (nul / total > MAX_NUL_RATIO) evidence.push("nul-heavy");
  if (control / total > MAX_CONTROL_RATIO) evidence.push("control-heavy");
  if (nonWs > 0 && printable / nonWs < MIN_TEXT_DENSITY) evidence.push("low-density");
  if (text.includes("�")) evidence.push("replacement-char");
  return { pass: evidence.length === 0, evidence };
}

// ---- script-density scoring ----
// Score = fraction of non-ASCII, non-whitespace chars that fall in the
// expected Unicode ranges for that encoding family. Wrong-decoding a CJK
// byte stream smears across rare blocks (Hangul Jamo, Cyrillic ext,
// fullwidth forms, private use, obsolete scripts); the right decoding
// clusters in the target script.
function classify(cp) {
  if (cp >= 0x4e00 && cp <= 0x9fff) return "han";
  if (cp >= 0x3400 && cp <= 0x4dbf) return "han-ext";
  if (cp >= 0x3000 && cp <= 0x303f) return "cjk-punct";
  if (cp >= 0xff00 && cp <= 0xffef) return "fullwidth";
  if (cp >= 0x3040 && cp <= 0x30ff) return "kana";        // ひらがな/カタカナ (full-width)
  if (cp >= 0x2000 && cp <= 0x206f) return "gen-punct";
  if (cp >= 0x0000 && cp <= 0x007f) return "ascii";
  if (cp >= 0x0080 && cp <= 0x00ff) return "latin1";
  if (cp === 0xfffd) return "replacement";
  return "other";
}

function scriptScore(text, label) {
  let nonWsNonAscii = 0, good = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (/\s/u.test(ch) || cp < 0x80) continue;
    nonWsNonAscii++;
    const c = classify(cp);
    switch (label) {
      case "gb18030":
        if (c === "han" || c === "han-ext" || c === "cjk-punct" || c === "fullwidth" || c === "gen-punct") good++;
        break;
      case "big5":
        // big5 wrong-decodes smear heavily into hangul/latin1/other
        if (c === "han" || c === "cjk-punct" || c === "fullwidth" || c === "gen-punct" || c === "bopomofo" || c === "bopomofo-ext") good++;
        break;
      case "shift_jis":
        // Half-width katakana (FF61-FF9F) is the classic sjis-smear
        // signature: real JP text uses full-width kana. Count it as miss.
        if (cp >= 0xff61 && cp <= 0xff9f) break;
        if (c === "kana" || c === "han" || c === "cjk-punct" || c === "fullwidth") good++;
        break;
      default:
        if (c !== "other" && c !== "replacement") good++;
    }
  }
  return nonWsNonAscii === 0 ? 1 : good / nonWsNonAscii;
}

const UTF16LE_MARK = Symbol.for("nl.utf16le");

// Byte-level UTF-16 sniff: CJK utf-16 puts the high byte in 0x30-0x9f range
// and every other unit is an ASCII newline in the 0x000a zone.
function sniffUtf16(bytes) {
  if (bytes.length < 40) return null;
  const n = Math.min(bytes.length, 4000);
  let leHigh = 0, beHigh = 0, pairs = 0;
  for (let i = 0; i + 1 < n; i += 2) {
    const lo = bytes[i], hi = bytes[i + 1];
    pairs++;
    if (hi >= 0x2e && hi <= 0x9f && lo !== 0x00) leHigh++;        // CJK unit LE
    if (lo >= 0x2e && lo <= 0x9f && hi !== 0x00) beHigh++;        // CJK unit BE
  }
  const le = leHigh / pairs, be = beHigh / pairs;
  if (le > 0.5 && le > be * 2) return "utf-16le";
  if (be > 0.5 && be > le * 2) return "utf-16be";
  return null;
}

// Real CJK prose is highly repetitive: the top-8 most common CJK chars in
// 中文小说 usually cover 15-40% of all CJK chars (的了是在我他这不一…).
// Random byte-pair gibberish spreads almost uniformly. Threshold is
// deliberately low so it only rejects smear, never real text.
function looksLikeCjkProse(text) {
  const freq = new Map();
  let cjk = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if ((cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf)) {
      cjk++;
      freq.set(ch, (freq.get(ch) ?? 0) + 1);
    }
  }
  if (cjk < 20) return true; // too little CJK to judge
  const top = [...freq.values()].sort((a, b) => b - a).slice(0, 8).reduce((a, b) => a + b, 0);
  return top / cjk >= 0.08;
}

export function detectEncoding(bytes, { explicit } = {}) {
  const result = (label, evidence, text) => ({ label, evidence, text });
  if (bytes.byteLength === 0) throw new Error("SOURCE_EMPTY");

  if (explicit) {
    if (!ENCODING_LABELS.includes(explicit)) throw new Error("invalid-label");
    const bom = detectBom(bytes);
    if (bom && bom !== explicit) throw new Error("bom-conflict");
    const t = fatalDecode(explicit, bytes);
    if (t === null) throw new Error("decode-failed");
    return result(explicit, ["explicit"], t);
  }

  const bom = detectBom(bytes);
  if (bom) {
    if (bom === "utf-32le" || bom === "utf-32be") throw new Error("unsupported-bom:" + bom);
    const t = fatalDecode(bom, bytes);
    if (t === null) throw new Error("decode-failed");
    return result(bom, ["bom"], t);
  }

  // pure ASCII -> utf-8
  if (bytes.every((b) => b < 0x80)) {
    return result("utf-8", ["ascii-invariant"], new TextDecoder("utf-8").decode(bytes));
  }

  // utf-16 sniff first: without it random bytes pair-decode into gibberish
  // CJK that passes the code-point quality gate.
  const u16 = sniffUtf16(bytes);
  const order = [];
  if (u16) order.push(u16);
  for (const l of ENCODING_LABELS) if (!order.includes(l)) order.push(l);

  const viable = [];
  for (const label of order) {
    // utf-16 without BOM is only admitted when the byte-sniff matched —
    // random non-UTF-16 bytes pair-decode into gibberish CJK that passes
    // the code-point quality gate.
    if ((label === "utf-16le" || label === "utf-16be") && label !== u16) continue;
    const t = fatalDecode(label, bytes);
    if (t === null) continue;
    const q = assessQuality(t);
    if (!q.pass) continue;
    // Gibberish guard for CJK labels: real prose is highly repetitive. A
    // decode whose top-8 chars cover <10% of CJK chars is random smear
    // (e.g. latin-1 pairs decoded as utf-16).
    const score = scriptScore(t, label);
    if (/^(gb18030|big5|shift_jis|utf-16)/.test(label) && !looksLikeCjkProse(t)) continue;
    viable.push({ label, text: t, score });
  }
  if (viable.length === 0) throw new Error("no-surviving-decoder");
  viable.sort((a, b) => b.score - a.score || order.indexOf(a.label) - order.indexOf(b.label));
  const top = viable[0];
  const second = viable[1];
  const ambiguous = second && top.score - second.score < 0.15 && second.score > 0.5;
  return {
    label: top.label,
    evidence: ambiguous ? ["ambiguous", "candidates:" + viable.slice(0, 3).map(v => `${v.label}@${v.score.toFixed(2)}`).join(",")] : ["detected"],
    text: top.text,
    candidates: viable.slice(0, 3).map(v => ({ label: v.label, score: v.score })),
    ambiguous: !!ambiguous,
  };
}
