from pathlib import Path
import json, re, time
import importlib.util
spec = importlib.util.spec_from_file_location("fc", Path(__file__).with_name("fetch_corpus.py"))
# don't exec (it would refetch everything); reuse functions manually
import urllib.parse, urllib.request, html as htmlmod
UA={"User-Agent":"Novelive-research/0.1 (local corpus building)"}
def api(params, sleep=6.0):
    q=urllib.parse.urlencode({**params,"format":"json","formatversion":"2"})
    req=urllib.request.Request("https://zh.wikisource.org/w/api.php?"+q,headers=UA)
    for a in range(6):
        try:
            r=json.load(urllib.request.urlopen(req,timeout=30)); time.sleep(sleep); return r
        except Exception as e:
            w=sleep*(a+2); print("  retry",a,e,"sleep",w); time.sleep(w)
    raise RuntimeError("api failed")
TPL=re.compile(r"\{\{[^{}]*\}\}"); LNK=re.compile(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]")
def clean(wt):
    for _ in range(6):
        w2=TPL.sub("",wt)
        if w2==wt: break
        wt=w2
    wt=re.sub(r"\[\[category:[^\]]*\]\]","",wt,flags=re.I)
    wt=LNK.sub(r"\1",wt); wt=re.sub(r"'''?","",wt)
    wt=re.sub(r"</?(?:center|poem|blockquote|div|span|section|small|big|br|p)[^>]*>","\n",wt,flags=re.I)
    wt=re.sub(r"^[-=]{2,}.*$","",wt,flags=re.M); wt=htmlmod.unescape(wt)
    out,blank=[],False
    for ln in (l.strip(" 　") for l in wt.split("\n")):
        if not ln:
            if not blank: out.append("")
            blank=True; continue
        blank=False; out.append(ln)
    return "\n".join(out).strip("\n")
def get(page):
    r=api({"action":"parse","page":page,"prop":"wikitext","redirects":1})
    return clean(r["parse"]["wikitext"])

import sys
# laocan missing 6-10
from pathlib import Path
OUT=Path(__file__).parent/"corpus"
lac=(OUT/"laocan.txt").read_text()
for i in range(6,11):
    t=get(f"老殘遊記/第{i:02d}回")
    lac=lac.rstrip("\n")+f"\n\n第{i:02d}回\n\n"+t+"\n"
(OUT/"laocan.txt").write_text(lac)
print("laocan",len(lac))
# liaozhai 卷1-2
parts=[]
for i in (1,2):
    t=get(f"聊齋志異/第{i:02d}卷")
    parts+= [f"第{i:02d}卷","",t,""]
(OUT/"liaozhai.txt").write_text("\n".join(parts))
print("liaozhai",sum(len(p) for p in parts))
# aq
t=get("阿Q正傳")
(OUT/"aq.txt").write_text("阿Q正傳\n魯迅\n\n"+t)
print("aq",len(t))
# jinghuayuan
parts=[]
for i in range(1,7):
    try: t=get(f"鏡花緣/第{i:02d}回")
    except Exception as e: print("jhy fail",i,e); t=""
    parts+=[f"第{i:02d}回","",t,""]
(OUT/"jinghuayuan.txt").write_text("\n".join(parts))
print("jinghuayuan",sum(len(p) for p in parts))
