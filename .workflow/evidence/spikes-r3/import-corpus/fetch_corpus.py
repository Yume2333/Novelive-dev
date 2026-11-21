#!/usr/bin/env python3
"""Build the import test corpus in corpus/. Never commit to the repo.

Usage: python3 fetch_corpus.py
Fetches public-domain zh novels from zh.wikisource (4s/page rate limit)
and writes corpus/*.txt plus corpus/manifest.json.
"""
import html as htmlmod
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "corpus"
OUT.mkdir(exist_ok=True)

UA = {"User-Agent": "Novelive-research/0.1 (local corpus building)"}


def api(params, sleep=6.0):
    q = urllib.parse.urlencode({**params, "format": "json", "formatversion": "2"})
    req = urllib.request.Request("https://zh.wikisource.org/w/api.php?" + q, headers=UA)
    for attempt in range(6):
        try:
            r = json.load(urllib.request.urlopen(req, timeout=30))
            time.sleep(sleep)
            return r
        except Exception as e:
            wait = sleep * (attempt + 2)
            print("  retry", attempt, e, "sleep", wait)
            time.sleep(wait)
    raise RuntimeError("api failed")


def wikitext(page):
    r = api({"action": "parse", "page": page, "prop": "wikitext", "redirects": 1})
    return r["parse"]["wikitext"]


_TEMPLATE_RE = re.compile(r"\{\{[^{}]*\}\}")
_LINK_RE = re.compile(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]")


def clean_wikitext(wt):
    """Very rough wikitext -> plain text."""
    # drop navigation/header/categories/templates
    for _ in range(6):
        wt2 = _TEMPLATE_RE.sub("", wt)
        if wt2 == wt:
            break
        wt = wt2
    wt = re.sub(r"\[\[category:[^\]]*\]\]", "", wt, flags=re.I)
    wt = _LINK_RE.sub(r"\1", wt)
    wt = re.sub(r"'''?", "", wt)
    wt = re.sub(r"</?(?:center|poem|blockquote|div|span|section|small|big|br|p)[^>]*>", "\n", wt, flags=re.I)
    wt = re.sub(r"^[-=]{2,}.*$", "", wt, flags=re.M)
    wt = htmlmod.unescape(wt)
    lines = [ln.strip(" 　") for ln in wt.split("\n")]
    # drop empty runs >1, drop bullet-only TOC lines
    out, blank = [], False
    for ln in lines:
        if not ln:
            if not blank:
                out.append("")
            blank = True
            continue
        blank = False
        out.append(ln)
    return "\n".join(out).strip("\n")


def fetch_iknow_fetch(page):
    """Return cleaned plain text of one wikisource page, or '' on failure."""
    try:
        return clean_wikitext(wikitext(page))
    except Exception as e:  # noqa: BLE001
        print("  FAIL", page, e)
        return ""


def grab(prefix_pages, title_header=None):
    parts = []
    for label, page in prefix_pages:
        txt = fetch_iknow_fetch(page)
        if not txt:
            continue
        if title_header:
            parts.append(title_header(label))
        else:
            parts.append(label)
        parts.append("")
        parts.append(txt)
        parts.append("")
    return "\n".join(parts)


manifest = []

def save(name, text, meta):
    p = OUT / name
    p.write_text(text, encoding="utf-8")
    manifest.append({"file": name, "bytes": len(text.encode()), "chars": len(text), **meta})
    print(f"{name}: {len(text)} chars")


# ---- 1. 紅樓夢 (回目 style: 第一回 <title>) — first 10 回, traditional from wikisource
pages = [(f"第{i:02d}回", f"紅樓夢/第{i:03d}回") for i in range(1, 11)]
# keep the 回 heading line inside each page (it's in the wikitext as {{center|'''第一回 ...'''}})
save("hongloumeng.txt", grab(pages), {
    "source": "zh.wikisource 紅樓夢/第001-010回",
    "style": "回目 第一回 甄士隱夢幻識通靈…",
    "script": "traditional"})

# ---- 2. 老殘遊記: 自敘 + 20 回 (回目 + 自敘 preface)
pages = [("自敘", "老殘遊記/自敘")] + [(f"第{i:02d}回", f"老殘遊記/第{i:02d}回") for i in range(1, 21)]
save("laocan.txt", grab(pages), {
    "source": "zh.wikisource 老殘遊記 自敘+第01-20回",
    "style": "自敘 + 回目",
    "script": "traditional"})

# ---- 3. 聊齋志異 卷一+卷二 (卷 as volume, inner short-story headings 兩級)
pages = [(f"第{i:02d}卷", f"聊齋志異/第{i:02d}卷") for i in range(1, 3)]
save("liaozhai.txt", grab(pages), {
    "source": "zh.wikisource 聊齋志異/第01-02卷",
    "style": "第N卷 卷内短故事標題",
    "script": "traditional"})

# ---- 4. 阿Q正傳 single page with 第N章 inner headings (魯迅, 1921 public domain)
txt = fetch_iknow_fetch("阿Q正傳")
save("aq.txt", "阿Q正傳\n魯迅\n\n" + txt, {
    "source": "zh.wikisource 阿Q正傳 (single page)",
    "style": "第N章 序/第一章…第九章",
    "script": "traditional"})

# ---- 5. 圍城? not PD. Use 鏡花緣 第1-6回 (回目 with different heading shape) — check pages exist
pages = [(f"第{i:02d}回", f"鏡花緣/第{i:02d}回") for i in range(1, 7)]
save("jinghuayuan.txt", grab(pages), {
    "source": "zh.wikisource 鏡花緣/第01-06回",
    "style": "回目",
    "script": "traditional"})

(OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1))
print("done")
