#!/usr/bin/env python3
"""Contact sheets for spikes-r4/texture (PNG, native pixels only).

Per scene contact/T{n}.png: arm columns x 2 rows (第 1 次 / 第 2 次).
T1 has an extra OLD column (control: original single-ref content).
Every image pasted at native size; cell = largest image, smaller centered
on gray. No resampling. Labels: caption + actual WxH.

Flip folders contact/T{n}/    — D1 files, viewing order.
              contact/T{n}-raw/ — raw (pre-D1) files, same order.
Also contact/ref.png.
"""
import os
import shutil
import cv2
from PIL import ImageFont, ImageDraw, Image

D = os.path.join(os.path.dirname(__file__), '..')
G = os.path.join(D, 'gen')
C = os.path.join(D, 'contact')
REF = os.path.join(D, 'ref', 'kokomi.png')
os.makedirs(C, exist_ok=True)

SCENES = ['T1', 'T2', 'T3']
# (arm-id, caption) — OLD only for T1
ARMS = [
    ('F', 'F 融合版'),
    ('F+R', 'F+R 表面压纹理'),
    ('F+N', 'F+N 点名鱼鳞纹'),
    ('F+X', 'F+X 渲染块加例外'),
    ('F+R+N', 'F+R+N 两句都加'),
]
OLD = ('OLD', 'OLD 旧内容段')
RUNS = [('r1', '第 1 次'), ('r2', '第 2 次')]
GRAY = (230, 230, 230)
BAR = 100
GAP = 20
CJK_FONT = '/usr/share/fonts/google-noto-sans-cjk-fonts/NotoSansCJK-Regular.ttc'

def cjk_font(px):
    return ImageFont.truetype(CJK_FONT, px)

def arms_for(skey):
    return ARMS + ([OLD] if skey == 'T1' else [])

def load(path):
    im = Image.open(path)
    if im.mode in ('RGBA', 'LA', 'P'):
        im = im.convert('RGBA')
        bg = Image.new('RGBA', im.size, GRAY + (255,))
        return Image.alpha_composite(bg, im).convert('RGB')
    return im.convert('RGB')

def img_path(scene, arm, run, d1=True):
    return os.path.join(G, f'{scene}--{arm}--{run}{"-D1" if d1 else ""}.png')

def make_sheet(skey):
    cols = arms_for(skey)
    entries = []
    for run, runlab in RUNS:
        row = []
        for arm, cap in cols:
            p = img_path(skey, arm, run)
            im = load(p) if os.path.exists(p) else None
            row.append((im, cap, f'{arm}-{run[-1]}'))
        entries.append(row)
    imgs = [e[0] for row in entries for e in row if e[0] is not None]
    cw = max(i.width for i in imgs)
    ch = max(i.height for i in imgs)
    W = len(cols) * cw + (len(cols) + 1) * GAP
    H = len(RUNS) * (ch + BAR) + (len(RUNS) + 1) * GAP
    sheet = Image.new('RGB', (W, H), (255, 255, 255))
    d = ImageDraw.Draw(sheet)
    big, small = cjk_font(52), cjk_font(30)
    for ri, row in enumerate(entries):
        for ci, (im, cap, en) in enumerate(row):
            x = GAP + ci * (cw + GAP)
            y = GAP + ri * (ch + BAR + GAP)
            sheet.paste(Image.new('RGB', (cw, ch), GRAY), (x, y))
            if im is not None:
                sheet.paste(im, (x + (cw - im.width) // 2, y + (ch - im.height) // 2))
                en = f'{en}  {im.width}x{im.height}'
            else:
                en = f'{en}  缺图'
            d.text((x + 8, y + ch + 4), cap, font=big, fill=(20, 20, 20))
            d.text((x + 16 + d.textlength(cap, font=big), y + ch + 30), en, font=small, fill=(90, 90, 90))
    out = os.path.join(C, f'{skey}.png')
    sheet.save(out, optimize=False, compress_level=3)
    print('wrote', out, W, 'x', H)

def make_flip(skey, d1, suffix):
    folder = os.path.join(C, skey + suffix)
    os.makedirs(folder, exist_ok=True)
    i = 0
    for arm, _ in arms_for(skey):
        for run, _ in RUNS:
            i += 1
            src = img_path(skey, arm, run, d1)
            dst = os.path.join(folder, f'{i:02d}-{arm}-{run[-1]}.png')
            if os.path.exists(src):
                shutil.copyfile(src, dst)
            else:
                print('missing', src)
    print('flip folder', folder, f'{i} slots')

if __name__ == '__main__':
    shutil.copyfile(REF, os.path.join(C, 'ref.png'))
    for skey in SCENES:
        make_sheet(skey)
        make_flip(skey, True, '')       # contact/T{n}/    D1 files
        make_flip(skey, False, '-raw')  # contact/T{n}-raw/ raw files
