#!/usr/bin/env python3
"""Contact sheets for spikes-r4/single-ref (PNG, native pixels only).

Per scene contact/T{n}.png: 8 arm columns x 2 rows (第 1 次 / 第 2 次).
Every image is pasted at its own native size; cell = largest image in the
sheet, smaller images centered on gray. No resampling at all. No ref in the
sheet. Label bar under each cell: arm caption + actual WxH.

Flip folders contact/T{n}/: copies of the D1 files renamed in viewing order
(01-S4-1.png, 02-S4-2.png, 03-A-1.png, ...) so the owner can arrow through
them at the same zoom in an image viewer.

Also contact/ref.png (copy of the reference).
"""
import os
import shutil
import numpy as np
import cv2
from PIL import ImageFont, ImageDraw, Image

D = os.path.join(os.path.dirname(__file__), '..')
G = os.path.join(D, 'gen')
C = os.path.join(D, 'contact')
REF = os.path.join(D, 'ref', 'kokomi.png')
os.makedirs(C, exist_ok=True)

SCENES = ['T1', 'T2', 'T3']
ARMS = ['S4', 'A', 'B', 'C', 'S34', 'M', 'P', 'E']
CAPTIONS = {
    'S4': 'S4 重跑', 'A': 'A 只留保留句', 'B': 'B 细节递减', 'C': 'C 背景更柔',
    'S34': 'S34 成稿加主次', 'M': 'M 材质简化', 'P': 'P 按屏幕尺度', 'E': 'E 线条收尾',
}
RUNS = [('r1', '第 1 次'), ('r2', '第 2 次')]
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

def d1_path(scene, arm, run):
    return os.path.join(G, f'{scene}--{arm}--{run}-D1.png')

def make_sheet(skey):
    entries = []   # rows x cols of (im, caption, en)
    for run, runlab in RUNS:
        row = []
        for arm in ARMS:
            p = d1_path(skey, arm, run)
            im = load(p) if os.path.exists(p) else None
            row.append((im, CAPTIONS[arm], f'{arm}-{run[-1]}'))
        entries.append(row)
    imgs = [e[0] for row in entries for e in row if e[0] is not None]
    cw = max(i.width for i in imgs)
    ch = max(i.height for i in imgs)
    W = len(ARMS) * cw + (len(ARMS) + 1) * GAP
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
        # row label at far right? keep simple: run label in first cell already via en
    out = os.path.join(C, f'{skey}.png')
    sheet.save(out, optimize=False, compress_level=3)
    print('wrote', out, W, 'x', H)

def make_flip(skey):
    folder = os.path.join(C, skey)
    os.makedirs(folder, exist_ok=True)
    # viewing order: arm-major so flipping steps through arms per run pair
    # 01-S4-1, 02-S4-2, 03-A-1, 04-A-2, ...
    i = 0
    for arm in ARMS:
        for run, _ in RUNS:
            i += 1
            src = d1_path(skey, arm, run)
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
        make_flip(skey)
