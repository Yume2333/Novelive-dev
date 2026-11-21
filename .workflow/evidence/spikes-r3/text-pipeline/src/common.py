import os
import pathlib
"""Shared helpers: book import per docs, paragraph normalization, token estimation."""
import json, re, unicodedata, os, hashlib

BOOK = os.environ.get('NL_BOOK', 'book/luotuo-xiangzi.txt')  # 书文不入库，运行时给路径
ROOT = os.environ.get('NL_TP_ROOT', str(pathlib.Path(__file__).resolve().parent.parent))
OUT = f'{ROOT}/out'
WORK = f'{ROOT}/work'

# k: CJK chars * k + non-CJK bytes / 4, per provider (pi-scaffolding.md 通用层6 / zh-tokens)
K_TABLE = {
    'anthropic': 1.0, 'openai_o200k': 0.91, 'openai_cl100k': 1.35,
    'qwen': 0.76, 'kimi': 0.76, 'deepseek': 0.69, 'glm': 0.73,
    'google': 0.81, 'llama': 0.93, 'default': 0.9,
}
# eval model we actually run on: devin-swe-2 (Claude-family) -> anthropic coefficient
EVAL_K = 1.0

CJK_RE = re.compile(r'[㐀-䶿一-鿿豈-﫿]')

def est_tokens(text: str, k: float = EVAL_K) -> int:
    """CJK chars * k + non-CJK utf-8 bytes / 4."""
    cjk = len(CJK_RE.findall(text))
    non_cjk_bytes = len(CJK_RE.sub('', text).encode('utf-8'))
    return int(cjk * k + non_cjk_bytes / 4 + 0.5)

def load_book():
    """TXT import per creation-pipeline.md: normalize, chapter heads, paragraphs pNNNN (1-based per chapter)."""
    raw = open(BOOK, encoding='utf-8').read()
    raw = raw.lstrip('﻿').replace('\r\n', '\n').replace('\r', '\n')
    raw = unicodedata.normalize('NFC', raw)
    lines = raw.split('\n')
    heads = [i for i, l in enumerate(lines) if re.match(r'^第\d+章\s*$', l.strip())]
    chapters = []
    for ci, h in enumerate(heads):
        end = heads[ci + 1] if ci + 1 < len(heads) else len(lines)
        title = lines[h].strip()
        m = re.match(r'^第(\d+)章', title)
        cid = f"ch{int(m.group(1)):02d}"
        paras = []
        pi = 0
        for ln, line in enumerate(lines[h + 1:end], start=h + 2):
            t = line.strip()
            if not t:
                continue
            pi += 1
            paras.append({'pid': f'p{pi:04d}', 'line': ln, 'text': t})
        chapters.append({'chapterId': cid, 'title': title, 'paras': paras,
                         'chars': sum(len(p['text']) for p in paras)})
    return chapters

def chapter_text(ch, with_pids=False):
    if with_pids:
        return '\n'.join(f"[{p['pid']}] {p['text']}" for p in ch['paras'])
    return '\n\n'.join(p['text'] for p in ch['paras'])

def save_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)

def load_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)

def sha(s: str) -> str:
    return hashlib.sha256(s.encode('utf-8')).hexdigest()[:12]

# Ledger: every model call appended as JSONL {stage, chapter, role, model, sys_chars, in_chars, out_chars, in_tok, out_tok, sys_tok}
LEDGER = f'{WORK}/usage.jsonl'

def ledger(**kw):
    kw['in_tok'] = est_tokens(kw.get('system', '') + kw.get('prompt', ''))
    kw['out_tok'] = est_tokens(kw.get('out', ''))
    kw['sys_tok'] = est_tokens(kw.get('system', ''))
    kw['prefix_tok'] = est_tokens(kw.get('cacheable_prefix', ''))
    kw['ts'] = __import__('time').time()
    with open(LEDGER, 'a', encoding='utf-8') as f:
        f.write(json.dumps(kw, ensure_ascii=False) + '\n')
