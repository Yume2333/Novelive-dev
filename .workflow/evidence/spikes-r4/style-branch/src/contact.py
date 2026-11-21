#!/usr/bin/env python3
"""Contact sheets for spikes-r4/style-branch (JPEG q92).

Per ref R{n}.jpg — three task rows: CLEAN / TRANSFER-a / TRANSFER-b.
Each row: ref at left, then "S4上轮" (ref-transfer's S4 D1 for that task),
then S4, A, B, C, S34, M, P, E D1 with big Chinese captions.
Below each row: a strip of 512px crops at the same relative region
(hair+face on CLEAN rows; face crop on TRANSFER rows).

overview-clean.jpg:    rows = 4 refs' CLEAN tasks, cols = [ref + S4上轮 + 8].
overview-transfer.jpg: rows = 8 transfer tasks, cols = same.

Chinese captions via PIL + Noto Sans CJK SC. Sprites on light gray.
"""
import os
import numpy as np
import cv2
from PIL import ImageFont, ImageDraw, Image

D = os.path.join(os.path.dirname(__file__), '..')
G = os.path.join(D, 'gen')
C = os.path.join(D, 'contact')
RT_GEN = os.path.normpath(os.path.join(D, '..', 'ref-transfer', 'gen'))
os.makedirs(C, exist_ok=True)

REFKEYS = ['R1', 'R2', 'R3', 'R4']
# (col-id, caption): PREV = ref-transfer S4 D1
COLUMNS = [
    ('PREV', 'S4上轮'),
    ('S4', 'S4 重跑'),
    ('A', 'A 只留保留句'),
    ('B', 'B 细节递减'),
    ('C', 'C 背景更柔'),
    ('S34', 'S34 成稿加主次'),
    ('M', 'M 材质简化'),
    ('P', 'P 按屏幕尺度'),
    ('E', 'E 线条收尾'),
]
TASKS = {
    'R1': ['CLEAN', 'C5', 'K8'],
    'R2': ['CLEAN', 'K6', 'C3'],
    'R3': ['CLEAN', 'K1', 'K8'],
    'R4': ['CLEAN', 'C1', 'K6'],
}
GRAY = (230, 230, 230)
FONT = cv2.FONT_HERSHEY_SIMPLEX
BAR = 64
CROP = 512
FW, FH = 380, 500           # full-image cell (9 columns per row)
CW = 270                    # crop cell width
CJK_FONT = '/usr/share/fonts/google-noto-sans-cjk-fonts/NotoSansCJK-Regular.ttc'

# crop region per (ref,task) — same boxes as ref-transfer.
CROP_REL = {
    ('R1','CLEAN'): (0.10, 0.02, 0.50, 0.42),
    ('R1','C5'):    (0.20, 0.02, 0.55, 0.33),
    ('R1','K8'):    (0.05, 0.05, 0.30, 0.42),
    ('R2','CLEAN'): (0.65, 0.08, 0.26, 0.37),
    ('R2','K6'):    (0.28, 0.02, 0.29, 0.45),
    ('R2','C3'):    (0.21, 0.02, 0.54, 0.38),
    ('R3','CLEAN'): (0.25, 0.01, 0.21, 0.44),
    ('R3','K1'):    (0.30, 0.02, 0.42, 0.38),
    ('R3','K8'):    (0.05, 0.05, 0.30, 0.42),
    ('R4','CLEAN'): (0.26, 0.02, 0.26, 0.44),
    ('R4','C1'):    (0.23, 0.02, 0.46, 0.32),
    ('R4','K6'):    (0.28, 0.02, 0.29, 0.45),
}

def cjk_font(px):
    return ImageFont.truetype(CJK_FONT, px)

def draw_labels(canvas, en, zh):
    h, w = canvas.shape[:2]
    cv2.rectangle(canvas, (0, h-BAR), (w, h), (250,250,250), -1)
    cv2.putText(canvas, en, (8, h-BAR+22), FONT, 0.55, (20,20,20), 2)
    pil = Image.fromarray(canvas)
    ImageDraw.Draw(pil).text((8, h-BAR+28), zh, font=cjk_font(24), fill=(20,20,20))
    return np.asarray(pil)

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

def d1_path(rkey, task, col):
    if col == 'PREV':
        return os.path.join(RT_GEN, f'{rkey}-{task}--S4-D1.png')
    return os.path.join(G, f'{rkey}-{task}--{col}-D1.png')

def row_full(rkey, task):
    ref_im = load(os.path.join(D, 'ref', f'{rkey}.png'))
    cells = [cell(ref_im, FW, FH, 'ref', '参考图')]
    for col, cap in COLUMNS:
        p = d1_path(rkey, task, col)
        im = load(p) if os.path.exists(p) else None
        cells.append(cell(im, FW, FH, f'{rkey}-{task} {col}-D1', cap))
    return np.hstack(cells)

def row_strip(rkey, task, rel):
    ref_im = load(os.path.join(D, 'ref', f'{rkey}.png'))
    cells = [cell(crop_rel(ref_im, rel) if ref_im is not None else None, CW, CW+BAR, 'ref', '参考图')]
    for col, cap in COLUMNS:
        p = d1_path(rkey, task, col)
        im = load(p) if os.path.exists(p) else None
        cr = crop_rel(im, rel) if im is not None else None
        if cr is None:
            cr = np.full((CROP, CROP, 3), GRAY, np.uint8)
            cv2.putText(cr, 'n/a', (200, 260), FONT, 1.0, (120,120,120), 2)
        cells.append(cell(cr, CW, CW+BAR, col+'-D1', cap))
    return np.hstack(cells)

def pad_to(row, w):
    if row.shape[1] < w:
        row = np.hstack([row, np.full((row.shape[0], w-row.shape[1], 3), GRAY, np.uint8)])
    return row

def make_sheets():
    ROW_W = FW * (1 + len(COLUMNS))
    for rkey in REFKEYS:
        rows = []
        for task in TASKS[rkey]:
            rel = CROP_REL[(rkey, task)]
            rows.append(pad_to(row_full(rkey, task), ROW_W))
            rows.append(pad_to(row_strip(rkey, task, rel), ROW_W))
        rows = [pad_to(r, ROW_W) for r in rows]
        sheet = np.vstack(rows)
        out = os.path.join(C, f'{rkey}.jpg')
        cv2.imwrite(out, sheet, [cv2.IMWRITE_JPEG_QUALITY, 92])
        print('wrote', out, sheet.shape[1], 'x', sheet.shape[0])

    rows = [row_full(rkey, 'CLEAN') for rkey in REFKEYS]
    grid = np.vstack([pad_to(r, ROW_W) for r in rows])
    out = os.path.join(C, 'overview-clean.jpg')
    cv2.imwrite(out, grid, [cv2.IMWRITE_JPEG_QUALITY, 92])
    print('wrote', out, grid.shape[1], 'x', grid.shape[0])

    rows = []
    for rkey in REFKEYS:
        for task in TASKS[rkey]:
            if task != 'CLEAN':
                rows.append(row_full(rkey, task))
    grid = np.vstack([pad_to(r, ROW_W) for r in rows])
    out = os.path.join(C, 'overview-transfer.jpg')
    cv2.imwrite(out, grid, [cv2.IMWRITE_JPEG_QUALITY, 92])
    print('wrote', out, grid.shape[1], 'x', grid.shape[0])

if __name__ == '__main__':
    make_sheets()
