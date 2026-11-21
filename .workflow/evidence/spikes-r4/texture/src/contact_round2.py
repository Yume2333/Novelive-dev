#!/usr/bin/env python3
"""Round-2 sheets for spikes-r4/texture (PNG, native pixels only).

contact/round2-T{n}.png: ONE row of 6 columns:
  F+X 上轮第1次 (existing F+X--r1-D1), F+X 上轮第2次 (r2-D1),
  F+X 本轮第1次 (r3-D1), F+X 本轮第2次 (r4-D1),
  F+X+N 第1次 (F+X+N--r1-D1), F+X+N 第2次 (r2-D1).
Every image pasted at native size; cell = largest image, smaller centered
on gray. Labels: caption + actual WxH.

Flip folders contact/round2-T{n}/ (D1) and contact/round2-T{n}-raw/ (raw),
same viewing order.
"""
import os
import shutil
from PIL import ImageFont, ImageDraw, Image

D = os.path.join(os.path.dirname(__file__), '..')
G = os.path.join(D, 'gen')
C = os.path.join(D, 'contact')
os.makedirs(C, exist_ok=True)
SCENES = ['T1', 'T3']

COLS = [
    ('F+X--r1', 'F+X 上轮第1次'),
    ('F+X--r2', 'F+X 上轮第2次'),
    ('F+X--r3', 'F+X 本轮第1次'),
    ('F+X--r4', 'F+X 本轮第2次'),
    ('F+X+N--r1', 'F+X+N 第1次'),
    ('F+X+N--r2', 'F+X+N 第2次'),
    ('F+X-med--r1', 'F+X medium 第1次'),
    ('F+X-med--r2', 'F+X medium 第2次'),
]
GRAY = (230, 230, 230)
BAR = 100
GAP = 20
CJK_FONT = '/usr/share/fonts/google-noto-sans-cjk-fonts/NotoSansCJK-Regular.ttc'

def cjk_font(px):
    return ImageFont.truetype(CJK_FONT, px)

def load(path):
    im = Image.open(path)
    if im.mode in ('RGBA', 'LA', 'P'):
        im = im.convert('RGBA')
        bg = Image.new('RGBA', im.size, GRAY + (255,))
        return Image.alpha_composite(bg, im).convert('RGB')
    return im.convert('RGB')

def img_path(scene, stem, d1=True):
    return os.path.join(G, f'{scene}--{stem}{"-D1" if d1 else ""}.png')

def make_sheet(skey):
    entries = []
    for stem, cap in COLS:
        p = img_path(skey, stem)
        im = load(p) if os.path.exists(p) else None
        entries.append((im, cap, stem))
    imgs = [e[0] for e in entries if e[0] is not None]
    cw = max(i.width for i in imgs)
    ch = max(i.height for i in imgs)
    W = len(entries) * cw + (len(entries) + 1) * GAP
    H = ch + BAR + 2 * GAP
    sheet = Image.new('RGB', (W, H), (255, 255, 255))
    d = ImageDraw.Draw(sheet)
    big, small = cjk_font(52), cjk_font(30)
    for ci, (im, cap, stem) in enumerate(entries):
        x = GAP + ci * (cw + GAP)
        y = GAP
        sheet.paste(Image.new('RGB', (cw, ch), GRAY), (x, y))
        if im is not None:
            sheet.paste(im, (x + (cw - im.width) // 2, y + (ch - im.height) // 2))
            en = f'{stem}  {im.width}x{im.height}'
        else:
            en = f'{stem}  缺图'
        d.text((x + 8, y + ch + 4), cap, font=big, fill=(20, 20, 20))
        d.text((x + 16 + d.textlength(cap, font=big), y + ch + 30), en, font=small, fill=(90, 90, 90))
    out = os.path.join(C, f'round2-{skey}.png')
    sheet.save(out, optimize=False, compress_level=3)
    print('wrote', out, W, 'x', H)

def make_flip(skey, d1, suffix):
    folder = os.path.join(C, f'round2-{skey}{suffix}')
    os.makedirs(folder, exist_ok=True)
    for i, (stem, cap) in enumerate(COLS, 1):
        src = img_path(skey, stem, d1)
        dst = os.path.join(folder, f'{i:02d}-{stem}.png')
        if os.path.exists(src):
            shutil.copyfile(src, dst)
        else:
            print('missing', src)
    print('flip folder', folder, f'{len(COLS)} slots')

if __name__ == '__main__':
    for skey in SCENES:
        make_sheet(skey)
        make_flip(skey, True, '')
        make_flip(skey, False, '-raw')
