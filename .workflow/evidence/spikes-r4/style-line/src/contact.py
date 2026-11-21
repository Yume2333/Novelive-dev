#!/usr/bin/env python3
"""Contact sheets for spikes-r4/style-line (JPEG q92).

Columns (8): "S0上轮" = model-prompt's existing <asset>--SS-D1 (previous round's
pick), then this round's S0..S6, each showing the D1 version.
Per asset <asset>.jpg: ref at left, one row of the 8 columns, then a strip of
same-region 512px hair+face crops for the same 8 images.
overview.jpg: rows = assets, cols = 8 columns, D1 versions, ref top-left.
crops.jpg:    same layout, crops only.
Chinese caption under each column (PIL + Noto Sans CJK SC; cv2 has no CJK).
Sprites (RGBA) composited on light gray.
"""
import os
import numpy as np
import cv2
from PIL import ImageFont, ImageDraw, Image

D = os.path.join(os.path.dirname(__file__), '..')
G = os.path.join(D, 'gen')
C = os.path.join(D, 'contact')
MP_GEN = os.path.normpath(os.path.join(D, '..', 'model-prompt', 'gen'))
REF = os.path.join(D, 'ref', 'kokomi-torino-white.png')
os.makedirs(C, exist_ok=True)

IDS = ['K1', 'K4', 'K7', 'C3', 'G2']
# (gen-file-arm, caption) — 'PREV' = model-prompt SS-D1
COLUMNS = [
    ('PREV', 'S0上轮'),
    ('S0', 'S0 现行句'),
    ('S1', 'S1 极简'),
    ('S2', 'S2 只要干净'),
    ('S3', 'S3 成稿措辞'),
    ('S4', 'S4 细节分主次'),
    ('S5', 'S5 写明画风'),
    ('S6', 'S6 放在前面'),
]
GRAY = (230, 230, 230)
FONT = cv2.FONT_HERSHEY_SIMPLEX
BAR = 64                    # label band height (en + zh caption)
CROP = 512
FW, FH = 430, 560           # full-image cell
CJK_FONT = '/usr/share/fonts/google-noto-sans-cjk-fonts/NotoSansCJK-Regular.ttc'

def cjk_font(px):
    return ImageFont.truetype(CJK_FONT, px)

def draw_labels(canvas, en, zh):
    """White label band at bottom: en (cv2) + zh caption (PIL CJK)."""
    h, w = canvas.shape[:2]
    cv2.rectangle(canvas, (0, h-BAR), (w, h), (250,250,250), -1)
    cv2.putText(canvas, en, (8, h-BAR+22), FONT, 0.65, (20,20,20), 2)
    pil = Image.fromarray(canvas)
    ImageDraw.Draw(pil).text((8, h-BAR+28), zh, font=cjk_font(26), fill=(20,20,20))
    return np.asarray(pil)

# (x, y, w, h) relative to each image's own size; box picked on this round's S0 raw.
CROP_REL = {
    'K1': (0.30, 0.00, 0.42, 0.38),   # Kokomi sprite head (S0 hair is very wide)
    'K4': (0.32, 0.00, 0.42, 0.40),   # seated Kokomi head
    'K7': (0.22, 0.02, 0.30, 0.43),   # Kokomi head, battle CG
    'C3': (0.21, 0.00, 0.54, 0.38),   # Furina head+hat
    'G2': (0.67, 0.00, 0.29, 0.45),   # Furina (right girl) head+hat
}

def load(path):
    im = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if im is None:
        return None
    if im.shape[2] == 4:
        a = im[:, :, 3:4].astype(np.float32) / 255.0
        rgb = im[:, :, :3].astype(np.float32)
        gray = np.full_like(rgb, 230)
        im = (rgb * a + gray * (1 - a)).astype(np.uint8)
    return im[:, :, :3]

def cell(im, w, h, en, zh=''):
    canvas = np.full((h, w, 3), GRAY, np.uint8)
    if im is not None:
        ih, iw = im.shape[:2]
        s = min((w - 8) / iw, (h - BAR - 8) / ih)
        nw, nh = max(1, round(iw * s)), max(1, round(ih * s))
        r = cv2.resize(im, (nw, nh), interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_CUBIC)
        y, x = (h - BAR - nh) // 2, (w - nw) // 2
        canvas[y:y+nh, x:x+nw] = r
    else:
        cv2.putText(canvas, 'n/a', (w//2 - 30, (h-BAR)//2), FONT, 1.0, (120,120,120), 2)
    return draw_labels(canvas, en, zh)

def crop_rel(im, rel):
    h, w = im.shape[:2]
    x, y, cw, ch = rel
    x0, y0 = int(x*w), int(y*h)
    x1, y1 = min(w, int((x+cw)*w)), min(h, int((y+ch)*h))
    c = im[y0:y1, x0:x1]
    if c.size == 0:
        return None
    return cv2.resize(c, (CROP, CROP), interpolation=cv2.INTER_CUBIC)

def d1_path(asset, col):
    if col == 'PREV':
        return os.path.join(MP_GEN, f'{asset}--SS-D1.png')
    return os.path.join(G, f'{asset}--{col}-D1.png')

def make_sheets():
    ref = load(REF)
    crop_d1 = {}
    for aid in IDS:
        rel = CROP_REL[aid]
        topcells = [cell(ref, FW, FH, 'ref', '参考图')]
        cropcells = [cell(crop_rel(ref, rel) if ref is not None else None, 300, 300+BAR, 'ref', '参考图')]
        crop_d1[aid] = {}
        for col, cap in COLUMNS:
            p = d1_path(aid, col)
            im = load(p) if os.path.exists(p) else None
            topcells.append(cell(im, FW, FH, f'{aid} {col}-D1', cap))
            cr = crop_rel(im, rel) if im is not None else None
            crop_d1[aid][col] = cr
            if cr is None:
                cr = np.full((CROP, CROP, 3), GRAY, np.uint8)
                cv2.putText(cr, 'n/a', (200, 260), FONT, 1.0, (120,120,120), 2)
            cropcells.append(cell(cr, 300, 300+BAR, col+'-D1', cap))
        top = np.hstack(topcells)
        strip = np.hstack(cropcells)
        if top.shape[1] < strip.shape[1]:
            top = np.hstack([top, np.full((top.shape[0], strip.shape[1]-top.shape[1], 3), GRAY, np.uint8)])
        elif strip.shape[1] < top.shape[1]:
            strip = np.hstack([strip, np.full((strip.shape[0], top.shape[1]-strip.shape[1], 3), GRAY, np.uint8)])
        sheet = np.vstack([top, strip])
        out = os.path.join(C, f'{aid}.jpg')
        cv2.imwrite(out, sheet, [cv2.IMWRITE_JPEG_QUALITY, 92])
        print('wrote', out, sheet.shape[1], 'x', sheet.shape[0])

    # overview.jpg: ref top-left, header row, rows = assets
    header = [cell(ref, 380, 480, 'ref', '参考图')]
    for col, cap in COLUMNS:
        header.append(cell(None, 380, 480, col, cap))
    rows = [np.hstack(header)]
    for aid in IDS:
        rowcells = [cell(None, 380, 480, aid)]
        for col, cap in COLUMNS:
            p = d1_path(aid, col)
            im = load(p) if os.path.exists(p) else None
            rowcells.append(cell(im, 380, 480, f'{aid} {col}', cap))
        rows.append(np.hstack(rowcells))
    grid = np.vstack(rows)
    out = os.path.join(C, 'overview.jpg')
    cv2.imwrite(out, grid, [cv2.IMWRITE_JPEG_QUALITY, 92])
    print('wrote', out, grid.shape[1], 'x', grid.shape[0])

    # crops.jpg: rows = assets, cols = 8 columns, D1 crops
    rows = []
    for aid in IDS:
        rowcells = [cell(None, 120, CROP+BAR, aid)]
        for col, cap in COLUMNS:
            rowcells.append(cell(crop_d1[aid].get(col), CROP, CROP+BAR, col+'-D1', cap))
        rows.append(np.hstack(rowcells))
    grid = np.vstack(rows)
    out = os.path.join(C, 'crops.jpg')
    cv2.imwrite(out, grid, [cv2.IMWRITE_JPEG_QUALITY, 92])
    print('wrote', out, grid.shape[1], 'x', grid.shape[0])

if __name__ == '__main__':
    make_sheets()
