#!/usr/bin/env python3
"""Fetch held-out corpus from zh.wikisource into corpus-heldout/.
Frozen rules are evaluated against these files only AFTER this runs.
"""
import html as htmlmod
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parent / "corpus-heldout"
OUT.mkdir(exist_ok=True)
UA = {"User-Agent": "Novelive-research/0.1 (held-out corpus)"}


def api(params, sleep=6.0):
    q = urllib.parse.urlencode({**params, "format": "json", "formatversion": "2"})
    req = urllib.request.Request("https://zh.wikisource.org/w/api.php?" + q, headers=UA)
    for a in range(6):
        try:
            r = json.load(urllib.request.urlopen(req, timeout=30))
            time.sleep(sleep)
            return r
        except Exception as e:
            w = sleep * (a + 2)
            print("  retry", a, e, "sleep", w)
            time.sleep(w)
    raise RuntimeError("api failed")


TPL = re.compile(r"\{\{[^{}]*\}\}")
LNK = re.compile(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]")


def clean(wt):
    # extract header section= as the page's own heading when present
    m = re.search(r"\|\s*section\s*=\s*([^\n|]+)", wt)
    sec_title = m.group(1).strip() if m else ""
    # strip == headings == but KEEP them as text lines (drama acts etc.)
    wt = re.sub(r"^={2,}\s*(.+?)\s*={2,}\s*$", r"\1", wt, flags=re.M)
    for _ in range(6):
        w2 = TPL.sub("", wt)
        if w2 == wt:
            break
        wt = w2
    wt = re.sub(r"\[\[category:[^\]]*\]\]", "", wt, flags=re.I)
    wt = LNK.sub(r"\1", wt)
    wt = re.sub(r"'''?", "", wt)
    wt = re.sub(r"</?(?:center|poem|blockquote|div|span|section|small|big|br|p)[^>]*>", "\n", wt, flags=re.I)
    wt = re.sub(r"<ref[^>]*>.*?</ref>", "", wt, flags=re.S)
    wt = re.sub(r"<ref[^>]*/>|<pages[^>]*/>|</?onlyinclude>|__TOC__", "", wt)
    wt = htmlmod.unescape(wt)
    out, blank = [], False
    for ln in (l.strip(" 　") for l in wt.split("\n")):
        if not ln:
            if not blank:
                out.append("")
            blank = True
            continue
        blank = False
        out.append(ln)
    body = "\n".join(out).strip("\n")
    return sec_title, body


def get(page):
    r = api({"action": "parse", "page": page, "prop": "wikitext", "redirects": 1})
    return clean(r["parse"]["wikitext"])


def build(fname, pages):
    """pages = list of (heading_line, page_title). heading_line None => use
    the page's section= title."""
    parts = []
    for heading, page in pages:
        try:
            sec, body = get(page)
        except Exception as e:
            print("FAIL", page, e)
            continue
        h = heading if heading is not None else sec
        if h:
            parts.append(h)
            parts.append("")
        parts.append(body)
        parts.append("")
    text = "\n".join(parts)
    (OUT / fname).write_text(text)
    print(fname, len(text), "chars")


# 1. 三國演義: 序 + 凡例 + 第001-006回 (irregular front matter + 回目)
build("h-sanguo.txt",
      [(None, "三國演義/序"), (None, "三國演義/凡例")] +
      [(None, f"三國演義/第{i:03d}回") for i in range(1, 7)])

# 2. 儒林外史: 8 回 (回目, another style)
build("h-rulin.txt", [(None, f"儒林外史/第{i:02d}回") for i in range(1, 9)])

# 3. 封神演義: 10 卷 pages (page-level 卷NNN in title; inner section= has 回 title)
build("h-fengshen.txt", [(None, f"封神演義/卷{i:03d}") for i in range(1, 11)])

# 4. 西廂記: 5 本 (第N本 volume + 楔子/第N折 acts inside)
build("h-xixiang.txt", [(None, f"西廂記/第{i}本") for i in range(1, 6)])

# 5. 警世通言: 5 卷 (第NN卷 top level)
build("h-jingshi.txt", [(None, "警世通言/序")] + [(None, f"警世通言/第{i:02d}卷") for i in range(1, 6)])

print("done")
