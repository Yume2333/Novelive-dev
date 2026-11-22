// Minimal EPUB chapter extraction implementing the documented fallback
// chain: nav (EPUB3) -> NCX (EPUB2) -> h1/h2+keyword inside spine docs ->
// each spine entry = one chapter. No external epub lib: zip.js for the
// archive, regex-free-but-simple XML handling.
import { ZipReader, BlobReader, TextWriter } from "@zip.js/zip.js";

async function unzip(bytes) {
  const zr = new ZipReader(new BlobReader(new Blob([bytes])));
  const entries = await zr.getEntries();
  const files = new Map();
  for (const e of entries) {
    if (e.directory) continue;
    files.set(e.filename, await e.getData(new TextWriter()));
  }
  await zr.close();
  return files;
}

const strip = (s) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, " ").trim();

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return m ? m[1] : "";
};

function resolvePath(base, href) {
  // base = dir of referencing file; href may be ../x or x#frag
  const h = href.split("#")[0];
  if (!h) return null;
  const parts = (base + "/" + h).split("/");
  const out = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}
const dirOf = (p) => p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";

function parseContainer(files) {
  const c = files.get("META-INF/container.xml");
  if (!c) throw new Error("no container.xml");
  const m = c.match(/full-path\s*=\s*["']([^"']+)["']/);
  if (!m) throw new Error("no rootfile");
  return m[1];
}

function parseOpf(opfText) {
  const manifest = new Map();
  for (const m of opfText.matchAll(/<item\b[^>]*>/g)) {
    const t = m[0];
    manifest.set(attr(t, "id"), { href: attr(t, "href"), media: attr(t, "media-type"), props: attr(t, "properties") });
  }
  const spine = [];
  for (const m of opfText.matchAll(/<itemref\b[^>]*>/g)) {
    spine.push({ idref: attr(m[0], "idref") });
  }
  const tocId = (opfText.match(/<spine[^>]*toc=["']([^"']+)["']/) || [])[1];
  return { manifest, spine, tocId };
}

// nav.xhtml: <nav epub:type="toc"><ol><li><a href="...">label</a> (nested
// <ol> = volume level). Returns flat item list with depth.
function parseNav(text, navPath) {
  const m = text.match(/<nav[^>]*epub:type\s*=\s*["']toc["'][^>]*>([\s\S]*?)<\/nav>/i)
    || text.match(/<nav[^>]*>([\s\S]*?)<\/nav>/i);
  if (!m) return [];
  const body = m[1];
  const items = [];
  // walk <li> with depth tracking
  let depth = 0, i = 0;
  const re = /<(ol|li|a|span)\b[^>]*>|<\/(ol|li)>/gi;
  let cur = null;
  while (true) {
    const mm = re.exec(body);
    if (!mm) break;
    const tag = mm[0];
    if (/^<ol/i.test(tag)) depth++;
    else if (/^<\/ol/i.test(tag)) depth = Math.max(0, depth - 1);
    else if (/^<li/i.test(tag)) { cur = { depth, href: null, label: "" }; items.push(cur); }
    else if (/^<a\b/i.test(tag) && cur) {
      if (!cur.href) {
        cur.href = resolvePath(dirOf(navPath), attr(tag, "href"));
        // text until </a>
        const end = body.indexOf("</a>", re.lastIndex);
        cur.label = strip(body.slice(re.lastIndex, end));
      }
    } else if (/^<span/i.test(tag) && cur && !cur.href) {
      const end = body.indexOf("</span>", re.lastIndex);
      if (!cur.label) cur.label = strip(body.slice(re.lastIndex, end));
    }
  }
  return items.filter(x => x.label || x.href);
}

function parseNcx(text, ncxPath) {
  const items = [];
  for (const m of text.matchAll(/<navPoint\b[^>]*>([\s\S]*?)<\/navPoint>/g)) {
    const label = (m[1].match(/<text[^>]*>([\s\S]*?)<\/text>/) || [null, ""])[1];
    const src = (m[1].match(/<content[^>]*src=["']([^"']+)["']/) || [null, ""])[1];
    items.push({ label: strip(label), href: src ? resolvePath(dirOf(ncxPath), src) : null, depth: 1 });
  }
  return items;
}

function textFromXhtml(text) {
  // strip head/script/style; paragraphs = <p>/<br>/<h*>/block close
  let t = text.replace(/<head[\s\S]*?<\/head>/i, "").replace(/<(script|style)[\s\S]*?<\/\1>/gi, "");
  t = t.replace(/<\/(p|div|h[1-6]|li|section|article|blockquote|tr)>/gi, "\n");
  t = t.replace(/<br[^>]*>/gi, "\n");
  return strip(t).replace(/[ \t]+/g, " ");
}
const parasOf = (text) => textFromXhtml(text).split(/\n+/).map(s => s.trim()).filter(Boolean);

const HEADING_KEYWORD = /^.{0,40}(?:第.{0,8}[章节回卷]|chapter|序|楔子|尾[聲声]|番外|后[記记])/i;

export async function extractEpub(bytes) {
  const files = await unzip(bytes);
  const opfPath = parseContainer(files);
  const opfDir = dirOf(opfPath);
  const { manifest, spine, tocId } = parseOpf(files.get(opfPath) || "");

  // spine entries with text
  const entries = spine.map(({ idref }) => {
    const it = manifest.get(idref);
    if (!it) return null;
    const path = resolvePath(opfDir, it.href);
    const raw = files.get(path);
    return raw === undefined ? null : { path, idref, paras: parasOf(raw), raw };
  }).filter(Boolean);
  // body paragraph offset per entry
  let cursor = 0;
  const span = new Map();
  for (const e of entries) { span.set(e.path, { start: cursor, end: cursor + e.paras.length }); cursor += e.paras.length; }

  const toChapters = (items, source) => {
    const seen = new Set();
    const chs = [];
    for (const it of items) {
      if (!it.href || seen.has(it.href)) continue;
      const s = span.get(it.href);
      if (!s) continue;
      seen.add(it.href);
      chs.push({ title: it.label || it.href, range: s, source, depth: it.depth });
    }
    chs.sort((a, b) => a.range.start - b.range.start);
    return chs;
  };

  // 1) EPUB3 nav
  const navItem = [...manifest.values()].find(v => /(^|\s)nav(\s|$)/.test(v.props));
  if (navItem) {
    const navPath = resolvePath(opfDir, navItem.href);
    const navText = files.get(navPath);
    if (navText) {
      const items = parseNav(navText, navPath);
      const chs = toChapters(items.filter(i => i.href), "nav");
      if (chs.length) return { chapters: chs, method: "nav", volumes: items.filter(i => !i.href && i.label).map(i => i.label), entries };
    }
  }
  // 2) NCX
  const ncxItem = tocId ? manifest.get(tocId) : [...manifest.values()].find(v => v.media === "application/x-dtbncx+xml");
  if (ncxItem) {
    const ncxPath = resolvePath(opfDir, ncxItem.href);
    const ncxText = files.get(ncxPath);
    if (ncxText) {
      const chs = toChapters(parseNcx(ncxText, ncxPath), "ncx");
      if (chs.length) return { chapters: chs, method: "ncx", volumes: [], entries };
    }
  }
  // 3) h1/h2 + keyword inside spine docs
  {
    const chs = [];
    for (const e of entries) {
      const h = e.raw.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/i);
      const label = h ? strip(h[1]) : "";
      const s = span.get(e.path);
      chs.push({ title: label || e.path, range: s, source: "h1h2", depth: 1, kw: HEADING_KEYWORD.test(label) });
    }
    // accept when at least half the entries carry keyword-y h1/h2
    const kwCount = chs.filter(c => c.kw).length;
    if (chs.length && kwCount >= Math.max(1, chs.length / 2)) {
      return { chapters: chs.map(({ kw, ...c }) => c), method: "h1h2", volumes: [], entries };
    }
  }
  // 4) spine entry per chapter
  return {
    chapters: entries.map(e => ({ title: e.path, range: span.get(e.path), source: "spine", depth: 1 })),
    method: "spine", volumes: [], entries,
  };
}
