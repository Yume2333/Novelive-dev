// Generate test EPUBs under corpus/:
//  A) epub3-nav-flat.epub — EPUB 3, <nav epub:type="toc"> flat, chapters
//     in separate files (Gutenberg-style).
//  B) epub2-ncx.epub — EPUB 2 with NCX navigation only.
//  C) epub3-nested-vol.epub — EPUB 3 nav with nested volumes (卷) > chapters.
//  D) epub3-nonav.epub — no nav/ncx at all; relies on h1/h2 fallback.
// Usage: node make_epubs.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { ZipWriter, BlobWriter, TextWriter, BlobReader } from "@zip.js/zip.js";

const BOOK = process.env.NL_BOOK ?? "book/luotuo-xiangzi.txt";
const raw = readFileSync(BOOK, "utf-8");

// split into 24 chapters on ^第N章
const lines = raw.split("\n");
const chapters = [];
let cur = null;
for (const ln of lines) {
  const m = ln.trim().match(/^第(\d+)章$/);
  if (m) {
    cur = { n: +m[1], title: `第${m[1]}章`, body: [] };
    chapters.push(cur);
  } else if (cur) cur.body.push(ln);
}
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const xhtml = (title, paras) =>
  `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh"><head><title>${esc(title)}</title></head><body><h1>${esc(title)}</h1>${paras.map(p => p.trim() ? `<p>${esc(p)}</p>` : "").join("\n")}</body></html>`;

async function zip(entries) {
  const w = new ZipWriter(new BlobWriter("application/epub+zip"), { bufferedWrite: true });
  await w.add("mimetype", new BlobReader(new Blob(["application/epub+zip"])), { level: 0 });
  for (const [name, text, level = 9] of entries) {
    await w.add(name, new BlobReader(new Blob([text])), { level });
  }
  const blob = await w.close();
  return Buffer.from(await blob.arrayBuffer());
}

const container = (opfPath) =>
  `<?xml version="1.0"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="${opfPath}" media-type="application/oebps-package+xml"/></rootfiles></container>`;

// ---------- A: EPUB3 flat nav ----------
{
  const files = [];
  const manifest = chapters.map((c) => `<item id="c${c.n}" href="text/c${c.n}.xhtml" media-type="application/xhtml+xml"/>`).join("");
  const spine = chapters.map((c) => `<itemref idref="c${c.n}"/>`).join("");
  const navLis = chapters.map((c) => `<li><a href="text/c${c.n}.xhtml">${esc(c.title)}</a></li>`).join("");
  const opf = `<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">x1</dc:identifier><dc:title>骆驼祥子</dc:title><dc:language>zh</dc:language><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata><manifest>${manifest}<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine>${spine}</spine></package>`;
  const nav = `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目次</title></head><body><nav epub:type="toc"><ol>${navLis}</ol></nav></body></html>`;
  files.push(["OEBPS/content.opf", opf], ["OEBPS/nav.xhtml", nav]);
  for (const c of chapters) files.push([`OEBPS/text/c${c.n}.xhtml`, xhtml(c.title, c.body)]);
  files.push(["META-INF/container.xml", container("OEBPS/content.opf")]);
  writeFileSync("corpus/epub3-nav-flat.epub", await zip(files));
  console.log("epub3-nav-flat.epub done");
}

// ---------- B: EPUB2 NCX ----------
{
  const files = [];
  const manifest = chapters.map((c) => `<item id="c${c.n}" href="text/c${c.n}.xhtml" media-type="application/xhtml+xml"/>`).join("");
  const spine = chapters.map((c) => `<itemref idref="c${c.n}"/>`).join("");
  const navPoints = chapters.map((c) => `<navPoint id="np${c.n}" playOrder="${c.n}"><navLabel><text>${esc(c.title)}</text></navLabel><content src="text/c${c.n}.xhtml"/></navPoint>`).join("");
  const opf = `<?xml version="1.0"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">x2</dc:identifier><dc:title>骆驼祥子</dc:title><dc:language>zh</dc:language></metadata><manifest>${manifest}<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine toc="ncx">${spine}</spine></package>`;
  const ncx = `<?xml version="1.0"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head/><docTitle><text>骆驼祥子</text></docTitle><navMap>${navPoints}</navMap></ncx>`;
  files.push(["OEBPS/content.opf", opf], ["OEBPS/toc.ncx", ncx]);
  for (const c of chapters) files.push([`OEBPS/text/c${c.n}.xhtml`, xhtml(c.title, c.body)]);
  files.push(["META-INF/container.xml", container("OEBPS/content.opf")]);
  writeFileSync("corpus/epub2-ncx.epub", await zip(files));
  console.log("epub2-ncx.epub done");
}

// ---------- C: EPUB3 nested volumes ----------
{
  const vols = [
    { n: 1, name: "第一卷　奋斗", ch: chapters.slice(0, 8) },
    { n: 2, name: "第二卷　挣扎", ch: chapters.slice(8, 16) },
    { n: 3, name: "第三卷　堕落", ch: chapters.slice(16, 24) },
  ];
  const files = [];
  const manifest = chapters.map((c) => `<item id="c${c.n}" href="text/c${c.n}.xhtml" media-type="application/xhtml+xml"/>`).join("");
  const spine = chapters.map((c) => `<itemref idref="c${c.n}"/>`).join("");
  const navLis = vols.map(v => `<li><span>${esc(v.name)}</span><ol>${v.ch.map(c => `<li><a href="text/c${c.n}.xhtml">${esc(c.title)}</a></li>`).join("")}</ol></li>`).join("");
  const opf = `<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">x3</dc:identifier><dc:title>骆驼祥子</dc:title><dc:language>zh</dc:language><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata><manifest>${manifest}<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine>${spine}</spine></package>`;
  const nav = `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目次</title></head><body><nav epub:type="toc"><ol>${navLis}</ol></nav></body></html>`;
  files.push(["OEBPS/content.opf", opf], ["OEBPS/nav.xhtml", nav]);
  for (const c of chapters) files.push([`OEBPS/text/c${c.n}.xhtml`, xhtml(c.title, c.body)]);
  files.push(["META-INF/container.xml", container("OEBPS/content.opf")]);
  writeFileSync("corpus/epub3-nested-vol.epub", await zip(files));
  console.log("epub3-nested-vol.epub done");
}

// ---------- D: EPUB3 no nav, h1 fallback ----------
{
  const files = [];
  const manifest = chapters.map((c) => `<item id="c${c.n}" href="text/c${c.n}.xhtml" media-type="application/xhtml+xml"/>`).join("");
  const spine = chapters.map((c) => `<itemref idref="c${c.n}"/>`).join("");
  const opf = `<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">x4</dc:identifier><dc:title>骆驼祥子</dc:title><dc:language>zh</dc:language><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata><manifest>${manifest}</manifest><spine>${spine}</spine></package>`;
  files.push(["OEBPS/content.opf", opf]);
  for (const c of chapters) files.push([`OEBPS/text/c${c.n}.xhtml`, xhtml(c.title, c.body)]);
  files.push(["META-INF/container.xml", container("OEBPS/content.opf")]);
  writeFileSync("corpus/epub3-nonav.epub", await zip(files));
  console.log("epub3-nonav.epub done");
}
