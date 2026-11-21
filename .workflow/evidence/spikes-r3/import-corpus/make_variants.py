#!/usr/bin/env python3
import os
"""Synthetic corpus variants of luotuo-xiangzi.txt.

Writes corpus/*.txt (encoded variants) and extends corpus/manifest.json.
Run after fetch_corpus.py (or standalone — only needs the book TXT at $NL_BOOK..
"""
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "corpus"
BOOK = Path(os.environ.get("NL_BOOK", "book/luotuo-xiangzi.txt"))
text = BOOK.read_text(encoding="utf-8")

manifest_path = OUT / "manifest.json"
manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else []


def save_bytes(name, data, meta):
    (OUT / name).write_bytes(data)
    manifest.append({"file": name, "bytes": len(data), **meta})
    print(name, len(data), "bytes")


def save_text(name, s, enc, meta):
    save_bytes(name, s.encode(enc), {"chars": len(s), "encoding": enc, **meta})


base_meta = {"source": "<book luotuo-xiangzi.txt> (老舍, PD)",
             "style": "第N章 (bare)", "script": "simplified"}

# --- encoding variants (straight re-encode) ---
save_bytes("luotuo-utf8.txt", text.encode("utf-8"), {**base_meta, "encoding": "utf-8", "chars": len(text)})
save_bytes("luotuo-utf8bom.txt", b"\xef\xbb\xbf" + text.encode("utf-8"), {**base_meta, "encoding": "utf-8-bom", "chars": len(text)})
save_bytes("luotuo-gbk.txt", text.encode("gb18030"), {**base_meta, "encoding": "gb18030", "chars": len(text)})
save_bytes("luotuo-utf16le-bom.txt", text.encode("utf-16"), {**base_meta, "encoding": "utf-16le-bom", "chars": len(text)})
save_bytes("luotuo-utf16le-nobom.txt", text.encode("utf-16-le"), {**base_meta, "encoding": "utf-16le", "chars": len(text)})
save_bytes("luotuo-utf16be-bom.txt", b"\xfe\xff" + text.encode("utf-16-be"), {**base_meta, "encoding": "utf-16be-bom", "chars": len(text)})
save_bytes("luotuo-utf16be-nobom.txt", text.encode("utf-16-be"), {**base_meta, "encoding": "utf-16be", "chars": len(text)})

# --- Big5 traditional: converted with OpenCC via wikisource-style table.
# No opencc installed; approximate s2t using a small built-in map is wrong
# for a whole book. Use iconv if available? iconv has no s2t.
# Fallback: mark as planned; generated later by gen_big5.py if s2t map exists.
s2t_map_path = HERE / "s2t.json"
if s2t_map_path.exists():
    s2t = json.loads(s2t_map_path.read_text())
    trad = "".join(s2t.get(ch, ch) for ch in text)
    save_bytes("luotuo-big5.txt", trad.encode("big5", errors="replace"), {**base_meta, "encoding": "big5", "script": "traditional"})
    print("big5 built")
else:
    print("s2t.json missing; big5 skipped for now")

# --- CRLF variant ---
crlf = text.replace("\n", "\r\n")
save_bytes("luotuo-crlf.txt", crlf.encode("utf-8"), {**base_meta, "encoding": "utf-8", "lineend": "CRLF"})

# --- mixed line endings ---
lines = text.split("\n")
mixed = []
for i, ln in enumerate(lines):
    eol = "\r\n" if i % 3 == 0 else ("\r" if i % 7 == 0 else "\n")
    mixed.append(ln + eol)
save_bytes("luotuo-mixed-eol.txt", "".join(mixed).encode("utf-8"), {**base_meta, "encoding": "utf-8", "lineend": "mixed CRLF/CR/LF"})

# --- full-width indent variant: prefix every body line with 　　 ---
indented = "\n".join(("　　" + ln) if ln.strip() and not ln.startswith("第") else ln for ln in text.split("\n"))
save_bytes("luotuo-fwindent.txt", indented.encode("utf-8"), {**base_meta, "encoding": "utf-8", "layout": "full-width indent"})

# --- webnovel noise variant ---
noise_lines = text.split("\n")
out = []
ch = 0
for i, ln in enumerate(noise_lines):
    m = re.match(r"^第(\d+)章$", ln.strip())
    if m:
        ch = int(m.group(1))
        out.append("━━━━━━━━━━━━━━━━")
        out.append(f"本书首发于某某小说网，请收藏 www.example{ch}.com")
        out.append(ln)
    elif ln.strip() == "" and i > 4:
        out.append(ln)
    else:
        out.append(ln)
        if ch and len(out) % 47 == 0:
            out.append("（本章未完，请翻页）")
            out.append("求月票！求推荐票！")
        if ch and re.search(r"想马上穿起衣裳就下地", ln or ""):
            pass
# trailing ads
out += ["", "（本章完）", "手机用户请浏览 m.example.com 阅读，更优质的阅读体验。"]
save_bytes("luotuo-webnoise.txt", "\n".join(out).encode("utf-8"), {**base_meta, "encoding": "utf-8", "layout": "webnovel ads/noise"})

# --- false-positive headings inside body text ---
fp = text.split("\n")
inject_at = {"第5章": "后来人们传说，这一带出过一本书，书里写着“第十八章 梦醒”，说的就是那晚的事。",
             "第12章": "他想起小时候念过的私塾，先生讲的是“第三章 论礼”，其实与此刻的窘迫毫无关系。",
             "第19章": "邻桌有人翻着一本旧杂志，封面上印着“第二卷 夏季号”，油墨味很浓。"}
out = []
for ln in fp:
    m = re.match(r"^第(\d+)章$", ln.strip())
    out.append(ln)
    if m:
        key = f"第{int(m.group(1))}章"
        if key in inject_at:
            out.append(inject_at[key])
            out.append("")
save_bytes("luotuo-falsepos.txt", "\n".join(out).encode("utf-8"), {**base_meta, "encoding": "utf-8", "layout": "in-body false headings"})

# --- no-blank-lines variant: headings and paragraphs separated by single \n ---
noblank = "\n".join(ln for ln in text.split("\n") if ln.strip() != "")
save_bytes("luotuo-noblank.txt", noblank.encode("utf-8"), {**base_meta, "encoding": "utf-8", "layout": "no blank lines"})

# --- chapter-title style variant: rename 第N章 -> 第N章 <中文題名> ---
titles = {1:"洋车夫",2:"两起两落",3:"骆驼的来历",4:"人和车厂",5:"虎妞",6:"第一次打击",7:"杨宅拉包月",8:"曹先生",9:"高妈的主意",10:"老马小马",11:"孙侦探",12:"无路可走",13:"回厂",14:"寿宴",15:"婚事",16:"虎妞的家",17:"重新拉车",18:"烈日暴雨",19:"病",20:"夏宅",21:"又一辆车",22:"小福子",23:"最后的希望",24:"堕落"}
out = []
for ln in text.split("\n"):
    m = re.match(r"^第(\d+)章$", ln.strip())
    if m:
        out.append(f"第{m.group(1)}章　{titles[int(m.group(1))]}")
    else:
        out.append(ln)
save_bytes("luotuo-titled.txt", "\n".join(out).encode("utf-8"), {**base_meta, "encoding": "utf-8", "layout": "第N章 + 标题"})

# --- CN-numeral chapter style ---
cn = "零一二三四五六七八九"
def to_cn(n):
    if n < 10: return cn[n]
    if n < 20: return "十" + (cn[n-10] if n>10 else "")
    return cn[n//10] + "十" + (cn[n%10] if n%10 else "")
out = []
for ln in text.split("\n"):
    m = re.match(r"^第(\d+)章$", ln.strip())
    if m:
        out.append(f"第{to_cn(int(m.group(1)))}章")
    else:
        out.append(ln)
save_bytes("luotuo-cnnum.txt", "\n".join(out).encode("utf-8"), {**base_meta, "encoding": "utf-8", "layout": "第N章 汉字数字"})

# --- numeric-only heading style ---
out = []
for ln in text.split("\n"):
    m = re.match(r"^第(\d+)章$", ln.strip())
    if m:
        out.append(m.group(1))
    else:
        out.append(ln)
save_bytes("luotuo-numonly.txt", "\n".join(out).encode("utf-8"), {**base_meta, "encoding": "utf-8", "layout": "bare number headings"})

# --- volume+chapter two-level: 3 卷 x 8 章 ---
out = []
for ln in text.split("\n"):
    m = re.match(r"^第(\d+)章$", ln.strip())
    if m and int(m.group(1)) in (1, 9, 17):
        vol = (int(m.group(1)) - 1) // 8 + 1
        out.append(f"第{to_cn(vol)}卷")
        out.append("")
        out.append(ln)
    else:
        out.append(ln)
save_bytes("luotuo-volumes.txt", "\n".join(out).encode("utf-8"), {**base_meta, "encoding": "utf-8", "layout": "第N卷 + 第N章"})

# --- 序章/楔子/番外/尾声 wrapper ---
out = ["骆驼祥子", "老舍", "", "序章", "", "这是一个关于车夫的故事。", "", "楔子",
       "", "北平城的夏天来得早。", ""]
out += text.split("\n")[3:]  # skip original 书名/作者/first blank
out += ["", "番外篇", "", "若干年后，有人还记得那匹骆驼。", "", "尾声", "", "故事到此为止。", "", "后记", "", "老舍记于北平。"]
save_bytes("luotuo-extra.txt", "\n".join(out).encode("utf-8"), {**base_meta, "encoding": "utf-8", "layout": "序章+楔子+番外+尾声+后记"})

manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1))
print("done")
