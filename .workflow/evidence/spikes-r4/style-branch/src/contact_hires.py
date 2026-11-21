"""Full-resolution contact sheets for style-branch, written to contact-hires/.

Every image is pasted at its native pixels: no resizing, no aspect change.
Cells are sized to the largest image of the task; smaller or differently
shaped images are centered on gray. Crops are 1:1 pixel windows of fixed
size around the same relative point. Output is PNG (no JPEG artifacts).

Per task: <ref>-<task>.png (5x2 grid of ref + 9 columns) and
<ref>-<task>-crop.png (same grid, crops). Usage: python src/contact_hires.py
"""
import os
import numpy as np
from PIL import Image, ImageDraw
import contact as c

OUT = os.path.join(c.D, 'contact-hires')
os.makedirs(OUT, exist_ok=True)
GRAY = (230, 230, 230)
BAR = 96
GAP = 16
COLS = 5
CROP_PX = 640


def load(path):
    if not os.path.exists(path):
        return None
    im = Image.open(path)
    if im.mode in ('RGBA', 'LA', 'P'):
        im = im.convert('RGBA')
        bg = Image.new('RGBA', im.size, GRAY + (255,))
        return Image.alpha_composite(bg, im).convert('RGB')
    return im.convert('RGB')


def items(rkey, task):
    out = [(cap, f'{rkey}-{task} {col}', load(c.d1_path(rkey, task, col))) for col, cap in c.COLUMNS]
    ref = load(os.path.join(c.D, 'ref', f'{rkey}.png'))
    # The ref only goes in when it fits the outputs' cell; a portrait ref in a
    # landscape task (or the reverse) would blow every cell up with gray.
    imgs = [e[2] for e in out if e[2] is not None]
    if ref.width <= max(i.width for i in imgs) and ref.height <= max(i.height for i in imgs):
        out.insert(0, ('参考图', f'ref {rkey}', ref))
    return out


def crop(im, rel):
    x, y, cw, ch = rel
    cx, cy = (x + cw / 2) * im.width, (y + ch / 2) * im.height
    half = CROP_PX // 2
    x0 = int(min(max(cx - half, 0), max(im.width - CROP_PX, 0)))
    y0 = int(min(max(cy - half, 0), max(im.height - CROP_PX, 0)))
    return im.crop((x0, y0, min(x0 + CROP_PX, im.width), min(y0 + CROP_PX, im.height)))


def grid(entries):
    imgs = [e[2] for e in entries if e[2] is not None]
    cw = max(i.width for i in imgs)
    ch = max(i.height for i in imgs)
    rows = -(-len(entries) // COLS)
    W = COLS * cw + (COLS + 1) * GAP
    H = rows * (ch + BAR) + (rows + 1) * GAP
    sheet = Image.new('RGB', (W, H), (255, 255, 255))
    d = ImageDraw.Draw(sheet)
    big, small = c.cjk_font(60), c.cjk_font(34)
    for k, (cap, en, im) in enumerate(entries):
        x = GAP + (k % COLS) * (cw + GAP)
        y = GAP + (k // COLS) * (ch + BAR + GAP)
        sheet.paste(Image.new('RGB', (cw, ch), GRAY), (x, y))
        if im is not None:
            sheet.paste(im, (x + (cw - im.width) // 2, y + (ch - im.height) // 2))
            en = f'{en}  {im.width}x{im.height}'
        else:
            en = f'{en}  缺图'
        d.text((x + 8, y + ch + 6), cap, font=big, fill=(20, 20, 20))
        d.text((x + 16 + d.textlength(cap, font=big), y + ch + 30), en, font=small, fill=(90, 90, 90))
    return sheet


for rkey in c.REFKEYS:
    for task in c.TASKS[rkey]:
        es = items(rkey, task)
        rel = c.CROP_REL[(rkey, task)]
        crops = [(cap, en, crop(im, rel) if im is not None else None) for cap, en, im in es]
        for name, entries in ((f'{rkey}-{task}.png', es), (f'{rkey}-{task}-crop.png', crops)):
            s = grid(entries)
            s.save(os.path.join(OUT, name), optimize=False, compress_level=3)
            print('wrote', name, s.width, 'x', s.height)
