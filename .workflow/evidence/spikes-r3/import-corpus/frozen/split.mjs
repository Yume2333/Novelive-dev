// Normalize + chapter/volume splitting.
// ChapterRule[] data model follows TRNovel: {name, pattern, kind:
// "chapter"|"volume"|"exclude", example, enable}. Rule *content* is a fresh
// semantic rewrite informed by legado's default-rule ideas — no legado text
// is copied.

// ---- normalize (legacy PD-1: CRLF/CR->LF, strip one BOM, NFC) ----
export function normalizeText(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return text.normalize("NFC");
}

// Lines for heading scanning: trim each line's leading/trailing whitespace
// INCLUDING full-width space so indented headings still match.
export function scanLines(text) {
  return text.split("\n").map((raw, i) => ({
    index: i,
    raw,
    trimmed: raw.replace(/^[ 　\t]+|[ 　\t]+$/g, ""),
  }));
}

// ---- fixed purify step (creation-pipeline.md:7) ----
// Built-in watermark/noise regexes; works may add custom ones. Applied to
// whole lines before heading detection. Each rule is {name, pattern}.
export const PURIFY_RULES = [
  { name: "html-annotation", pattern: /<ref\b[^>]*>.*?<\/ref>|<ref\b[^>]*\/>|<pages\b[^>]*\/>|<!\[CDATA\[|\]\]>/gs },
  { name: "html-tag", pattern: /<\/?(?:u|b|i|em|strong|ruby|rt|rp|small|big|mark|span|font|sub|sup|del|ins)[^>]*>/g },
  { name: "url", pattern: /(?:https?:\/\/|www\.)[^\s　]{4,}/g },
  { name: "domain-line", pattern: /^[^\n]{0,40}(?:\.com|\.net|\.org|\.cc|\.xyz|\.top|\.vip|\.me)[^\n]{0,20}$/gm },
  { name: "source-claim", pattern: /^.{0,30}(?:本书?首发于|本书?来自|来源[:：]|本站地址|书友群|讨论群|Q群|微信公众号).{0,40}$/gm },
  { name: "vote-ad", pattern: /^.{0,20}(?:求月票|求推荐票|求收藏|求打赏|月票支持|推荐票支持).{0,20}$/gm },
  { name: "page-flip", pattern: /^(?:（\s*)?本[章节回]\s*(?:未完|完|终)\s*(?:[,，、].{0,20})?[）)]?$/gm },
  { name: "decor-sep", pattern: /^[─━═━\-—_*＊#＃·•◆◇]{4,}$/gm },
];

export function purifyText(text) {
  for (const { pattern } of PURIFY_RULES) {
    text = text.replace(pattern, "");
  }
  // collapse >2 consecutive blank lines to 1
  return text.replace(/\n[ 　\t]*\n(?:[ 　\t]*\n)+/g, "\n\n");
}

// CN numerals incl. full-width digits in one shared class. Used inside the
// rule patterns; written once here.
const NUM = "[0-9０-９零〇一二三四五六七八九十百千萬万两壹贰叁肆伍陆柒捌玖拾佰仟]+";
const SEP = "[ 　]*(?:[：:、．.\\-—~]+)?[ 　]*";

// The default ChapterRule set. Order matters only for readability: the
// engine trials every enabled rule and picks the one with the most hits.
export const DEFAULT_CHAPTER_RULES = [
  // volume-level -------------------------------------------------------
  {
    name: "v-第N卷/部/篇/辑/部",
    pattern: `^第${NUM}卷(?=$|[ 　：:、．.\\-—]|[^章节回卷部篇辑集])|^第${NUM}[部篇辑集](?=$|[ 　：:、．.\\-—])`,
    kind: "volume", example: "第二卷 / 第三部", enable: true,
  },
  {
    name: "v-卷N",
    pattern: `^卷${NUM}(?=$|[ 　：:、．.\\-—])`,
    kind: "volume", example: "卷三", enable: true,
  },
  {
    name: "v-上中下卷",
    pattern: `^[上中下](?:卷|部|册|冊)(?=$|[ 　：:、．.\\-—])`,
    kind: "volume", example: "上卷 / 中部", enable: true,
  },
  // chapter-level ------------------------------------------------------
  {
    name: "c-回目",
    pattern: `^第${NUM}回(?=$|[ 　：:、．.\\-—])`,
    kind: "chapter", example: "第一回 甄士隱夢幻識通靈", enable: true,
  },
  {
    name: "c-第N章",
    pattern: `^第${NUM}章(?=$|[ 　：:、．.\\-—]|[^节節])`,
    kind: "chapter", example: "第十二章 / 第3章 虎妞", enable: true,
  },
  {
    name: "c-第N节",
    pattern: `^第${NUM}[节節](?=$|[ 　：:、．.\\-—])`,
    kind: "chapter", example: "第五节", enable: true,
  },
  {
    name: "c-序/楔子/引子/前言",
    pattern: `^(?:序章|序|序言|楔子|引子|引言|前言|自序|自敘|题记|題記|题记|卷首语|卷首語)(?=$|[ 　：:、．.\\-—])`,
    kind: "chapter", example: "序章 / 楔子", enable: true,
  },
  {
    name: "c-尾声/番外/后记",
    pattern: `^(?:尾声|尾聲|终章|終章|后記|后记|跋|番外|番外篇|外传|外傳|附录|附錄)(?:${NUM})?(?=$|[ 　：:、．.\\-—])`,
    kind: "chapter", example: "尾声 / 番外篇 / 后记", enable: true,
  },
  {
    name: "c-Chapter N",
    pattern: `^chapter${SEP}${NUM}(?=$|[ 　：:、．.\\-—])`,
    kind: "chapter", example: "Chapter 12", enable: true,
  },
  {
    name: "c-数字标题",
    pattern: `^[0-9０-９]{1,4}[.、．]?$`,
    kind: "chapter", example: "12 / 3.", enable: true,
  },
  {
    name: "c-汉字数字标题",
    pattern: `^[一二三四五六七八九十]{1,3}$`,
    kind: "chapter", example: "一 / 三 (沉沦-style)", enable: true,
  },
  // exclude rules: matched lines are removed from candidate hits --------
  {
    name: "x-书源广告",
    pattern: `(?:本书?首发|请收藏|求月票|推荐票|推薦票|最新章节|最新章節|手机阅读|手機閱讀|m\\.|www\\.|\\.com|\\.net|\\.org|笔趣阁|筆趣閣|顶点小说)`,
    kind: "exclude", example: "本书首发于…网 求月票", enable: true,
  },
  {
    name: "x-翻页/分隔",
    pattern: `^(?:（?本章完[）]?|（?本章未完[）]?|（?未完待续[）]?|[-=─━~＊*]{4,}|【.*?】)$`,
    kind: "exclude", example: "（本章完） / ━━━━", enable: true,
  },
  {
    name: "x-正文内引用章节号",
    // A 第N章/回 marker buried in running prose. Two shapes:
    //  a) a non-punct char before the marker and 8+ chars of prose after
    //     (e.g. 书里写着第十八章梦醒说的就是…)
    //  b) an opening quote/bracket right before the marker
    // Bare “第N章 标题” headings start clean and are never excluded.
    pattern: `(?:^.{0,30}[\\w一-鿿].{0,10}第${NUM}[章节回卷][^：:、．.\\-— 　]{0,4}.{8,}|^.{0,30}['\"“”‘’《》〈〉（(\\[【]\\s*第${NUM}[章节回卷])`,
    kind: "exclude", example: "书里写着“第十八章 梦醒”", enable: true,
  },
];

// Maximum chars a heading line may have. 回目 couplets ~30 chars; webnovel
// titles rarely pass 40. A whole paragraph starting with 第N章 is a false
// positive, not a heading.
export const MAX_HEADING_LEN = 50;

function lineMatches(line, re) {
  return re.test(line.trimmed) && line.trimmed.length <= MAX_HEADING_LEN;
}

// Hits for every enabled rule of a kind: {best, others:[{rule,hits}]}.
function allRuleHits(lines, rules, kind) {
  const scored = [];
  for (const rule of rules) {
    if (rule.kind !== kind || !rule.enable) continue;
    const re = new RegExp(rule.pattern, "i");
    const hits = [];
    for (const line of lines) {
      if (lineMatches(line, re)) hits.push({ lineIndex: line.index, text: line.trimmed, ruleName: rule.name });
    }
    scored.push({ rule, hits });
  }
  scored.sort((a, b) => b.hits.length - a.hits.length);
  return { best: scored[0] ?? null, others: scored.slice(1), all: scored };
}

// Trial every enabled rule of a kind; pick the rule with most hits.
// Returns {hits: [{lineIndex, text, ruleName}], rule}.
function bestRule(lines, rules, kind) {
  let best = null;
  for (const rule of rules) {
    if (rule.kind !== kind || !rule.enable) continue;
    const re = new RegExp(rule.pattern, "i");
    const hits = [];
    for (const line of lines) {
      if (lineMatches(line, re)) hits.push({ lineIndex: line.index, text: line.trimmed, ruleName: rule.name });
    }
    if (best === null || hits.length > best.hits.length) best = { rule, hits };
  }
  return best;
}

// Apply exclude rules to a set of hits.
function applyExcludes(lines, hits, excludeRules) {
  const res = excludeRules.filter(r => r.enable).map(r => ({ r, re: new RegExp(r.pattern, "i") }));
  return hits.filter(h => {
    const line = lines.find(l => l.index === h.lineIndex);
    return !res.some(({ re }) => re.test(line.raw));
  });
}

// Filter hits that sit inside body text: a real heading line is (nearly)
// alone on its line — already guaranteed — and is not wrapped in quotes.
// Extra guard: the line must end at or near the match end (i.e. title after
// number is fine; a long sentence after is not).
export function splitChapters(text, rules = DEFAULT_CHAPTER_RULES) {
  const norm = purifyText(normalizeText(text));
  const lines = scanLines(norm);

  const excludeRules = rules.filter(r => r.kind === "exclude");

  // Primary rule = enabled chapter rule with the most hits. Auxiliary
  // rules (序章/番外/后记 etc.) union their hits on top: they are sparse,
  // non-numbered headings that coexist with the numbered series.
  const chapterScored = allRuleHits(lines, rules, "chapter");
  const volumeBest = bestRule(lines, rules, "volume");
  // Fallback rules (bare-number headings) only eligible at >=3 hits: a
  // stray "1" inside prose is not a chapter heading.
  const FALLBACK_MIN_HITS = 3;
  const eligible = chapterScored.all.filter(({ rule, hits }) =>
    /数字标题/.test(rule.name) ? hits.length >= FALLBACK_MIN_HITS : true);
  eligible.sort((a, b) => b.hits.length - a.hits.length);
  const chapterBest = eligible[0] ?? null;

  const auxNames = new Set(["c-序/楔子/引子/前言", "c-尾声/番外/后记"]);
  let chapterHits = chapterBest?.hits ?? [];
  const chapterLines = new Set(chapterHits.map(h => h.lineIndex));
  for (const { rule, hits } of eligible.slice(1)) {
    if (!auxNames.has(rule.name)) continue;
    for (const h of hits) {
      if (!chapterLines.has(h.lineIndex)) {
        chapterHits.push(h);
        chapterLines.add(h.lineIndex);
      }
    }
  }

  let chapters = applyExcludes(lines, chapterHits, excludeRules);
  let volumes = volumeBest ? applyExcludes(lines, volumeBest.hits, excludeRules) : [];

  // A volume level only counts if it yields >=2 hits; a lone "卷一" line in
  // a book with no other volume markers is a false positive.
  if (volumes.length < 2) volumes = [];

  // De-dup: a line matching both chapter and volume rules keeps the volume
  // role (volumes are sparser).
  const volLines = new Set(volumes.map(v => v.lineIndex));
  chapters = chapters.filter(c => !volLines.has(c.lineIndex));

  // Assemble chapter list with front-matter chapter.
  const total = norm.length;
  const out = [];
  let prevEnd = 0;
  const lineStart = (idx) => {
    // byte offset of line idx in norm
    let off = 0, i = 0;
    for (let n = 0; n < idx; n++) off = norm.indexOf("\n", off) + 1;
    return off;
  };
  // faster: precompute
  const offs = new Int32Array(lines.length);
  { let off = 0; for (let i = 0; i < lines.length; i++) { offs[i] = off; off += lines[i].raw.length + 1; } }

  const boundaries = [
    ...volumes.map(v => ({ ...v, kind: "volume" })),
    ...chapters.map(c => ({ ...c, kind: "chapter" })),
  ].sort((a, b) => a.lineIndex - b.lineIndex);

  for (let i = 0; i < boundaries.length; i++) {
    const b = boundaries[i];
    const start = offs[b.lineIndex];
    const endLine = i + 1 < boundaries.length ? boundaries[i + 1].lineIndex : lines.length;
    const end = endLine >= lines.length ? total : offs[endLine];
    out.push({ kind: b.kind, title: b.text, rule: b.ruleName, lineIndex: b.lineIndex, start, end, text: norm.slice(start, end) });
  }
  if (out.length === 0) {
    // No headings at all: whole text is one implicit 正文 unit — never
    // dropped (docs: “第一个标题之前的内容当前言章”, extended to the
    // degenerate no-title case).
    out.push({ kind: "chapter", title: "正文", rule: "implicit-single", lineIndex: 0, start: 0, end: total, text: norm });
  }
  return {
    frontMatter: boundaries.length && boundaries[0].lineIndex > 0 ? norm.slice(0, offs[boundaries[0].lineIndex]) : "",
    units: out,
    ruleUsed: chapterBest?.rule?.name ?? null,
    volumeRuleUsed: volumeBest?.rule?.name ?? null,
  };
}

// ---- oversized chapter re-split (creation-pipeline.md:7 “超长章按段落边
// 界再分”) ----
// Docs give no numeric cap; this is a tunable. 20k chars ≈ a full preview
// chunk for a fast model.
export const MAX_CHAPTER_CHARS = 20000;

export function splitOversized(units, maxChars = MAX_CHAPTER_CHARS) {
  const out = [];
  for (const u of units) {
    if (u.kind !== "chapter" || u.text.length <= maxChars) { out.push(u); continue; }
    const paras = u.text.split(/\n[ 　\t]*\n/);
    let buf = "", part = 1;
    const flush = () => {
      if (!buf.trim()) return;
      out.push({ ...u, title: part === 1 ? u.title : `${u.title}（${part}）`, text: buf, splitPart: part });
      part++; buf = "";
    };
    for (const p of paras) {
      if (buf && buf.length + p.length + 2 > maxChars) flush();
      buf = buf ? buf + "\n\n" + p : p;
    }
    flush();
  }
  return out;
}

