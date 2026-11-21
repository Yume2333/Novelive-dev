#!/usr/bin/env python3
"""Contact sheets for spikes-r4/ref-transfer (JPEG q92).

Per ref R{n}.jpg — three rows: CLEAN / TRANSFER-a / TRANSFER-b.
Each row: ref at left, then N, S0..S5 D1 with big Chinese captions.
Below each row: a strip of 512px crops at the SAME relative region
(hair+face on CLEAN rows so line cleanup is directly comparable to the ref;
face crop on TRANSFER rows).

overview-clean.jpg:   rows = 4 refs' CLEAN tasks, cols = [ref + N + S0..S5].
overview-transfer.jpg: rows = 8 transfer tasks (ref,task), cols = [ref + 7].

Chinese captions via PIL + Noto Sans CJK SC. Sprites on light gray.
"""
import os
import numpy as np
import cv2
from PIL import ImageFont, ImageDraw, Image

D = os.path.join(os.path.dirname(__file__), '..')
G = os.path.join(D, 'gen')
C = os.path.join(D, 'contact')
os.makedirs(C, exist_ok=True)

REFKEYS = ['R1', 'R2', 'R3', 'R4']
ARMS = ['N', 'S0', 'S1', 'S2', 'S3', 'S4', 'S5']
CAPTIONS = {
    'N': 'N 无固定句', 'S0': 'S0 现行句', 'S1': 'S1 极简', 'S2': 'S2 只要干净',
    'S3': 'S3 成稿措辞', 'S4': 'S4 细节分主次', 'S5': 'S5 写明画风',
}
TASKS = {
    'R1': [('CLEAN', 'CLEAN'), ('C5', 'TRANSFER-a'), ('K8', 'TRANSFER-b')],
    'R2': [('CLEAN', 'CLEAN'), ('K6', 'TRANSFER-a'), ('C3', 'TRANSFER-b')],
    'R3': [('CLEAN', 'CLEAN'), ('K1', 'TRANSFER-a'), ('K8', 'TRANSFER-b')],
    'R4': [('CLEAN', 'CLEAN'), ('C1', 'TRANSFER-a'), ('K6', 'TRANSFER-b')],
}
GRAY = (230, 230, 230)
FONT = cv2.FONT_HERSHEY_SIMPLEX
BAR = 64
CROP = 512
FW, FH = 400, 520           # full-image cell
CW = 280                    # crop cell width
CJK_FONT = '/usr/share/fonts/google-noto-sans-cjk-fonts/NotoSansCJK-Regular.ttc'

# crop region per (ref,task): CLEAN rows = face/hair on the REF ITSELF so the
# redraw is directly comparable; transfer rows = face of the new character.
CROP_REL = {
    ('R1','CLEAN'): (0.10, 0.02, 0.50, 0.42),   # Raiden head (sprite, head left-ish)
    ('R1','C5'):    (0.20, 0.02, 0.55, 0.33),   # Hu Tao head+hat
    ('R1','K8'):    (0.05, 0.05, 0.30, 0.42),   # shrine detail corner
    ('R2','CLEAN'): (0.65, 0.08, 0.26, 0.37),   # Furina head on ref
    ('R2','K6'):    (0.28, 0.02, 0.29, 0.45),   # Kokomi head under umbrella
    ('R2','C3'):    (0.21, 0.02, 0.54, 0.38),   # Furina head+hat
    ('R3','CLEAN'): (0.25, 0.01, 0.21, 0.44),   # Kokomi head on ref
    ('R3','K1'):    (0.30, 0.02, 0.42, 0.38),   # Kokomi sprite head
    ('R3','K8'):    (0.05, 0.05, 0.30, 0.42),   # shrine detail corner
    ('R4','CLEAN'): (0.26, 0.02, 0.26, 0.44),   # Kokomi head on ref
    ('R4','C1'):    (0.23, 0.02, 0.46, 0.32),   # Raiden head
    ('R4','K6'):    (0.28, 0.02, 0.29, 0.45),   # Kokomi head
}

def cjk_font(px):
    return ImageFont.truetype(CJK_FONT, px)

def draw_labels(canvas, en, zh):
    h, w = canvas.shape[:2]
    cv2.rectangle(canvas, (0, h-BAR), (w, h), (250,250,250), -1)
    cv2.putText(canvas, en, (8, h-BAR+22), FONT, 0.6, (20,20,20), 2)
    pil = Image.fromarray(canvas)
    ImageDraw.Draw(pil).text((8, h-BAR+28), zh, font=cjk_font(25), fill=(20,20,20))
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

def d1_path(rkey, task, arm):
    return os.path.join(G, f'{rkey}-{task}--{arm}-D1.png')

def row_strip(rkey, task, rel):
    """ref cell + 7 arm cells of crops at `rel` (mapped to each image's own size)."""
    ref_im = load(os.path.join(D, 'ref', f'{rkey}.png'))
    cells = [cell(crop_rel(ref_im, rel) if ref_im is not None else None, CW, CW+BAR, 'ref', '参考图')]
    for arm in ARMS:
        p = d1_path(rkey, task, arm)
        im = load(p) if os.path.exists(p) else None
        cr = crop_rel(im, rel) if im is not None else None
        if cr is None:
            cr = np.full((CROP, CROP, 3), GRAY, np.uint8)
            cv2.putText(cr, 'n/a', (200, 260), FONT, 1.0, (120,120,120), 2)
        cells.append(cell(cr, CW, CW+BAR, f'{arm}-D1', CAPTIONS[arm]))
    return np.hstack(cells)

def row_full(rkey, task):
    """ref cell + 7 arm cells of D1 full images."""
    ref_im = load(os.path.join(D, 'ref', f'{rkey}.png'))
    cells = [cell(ref_im, FW, FH, 'ref', '参考图')]
    for arm in ARMS:
        p = d1_path(rkey, task, arm)
        im = load(p) if os.path.exists(p) else None
        cells.append(cell(im, FW, FH, f'{rkey}-{task} {arm}-D1', CAPTIONS[arm]))
    return np.hstack(cells)

def pad_to(row, w):
    if row.shape[1] < w:
        row = np.hstack([row, np.full((row.shape[0], w-row.shape[1], 3), GRAY, np.uint8)])
    return row

def make_sheets():
    for rkey in REFKEYS:
        rows = []
        for task, label in TASKS[rkey]:
            rel = CROP_REL[(rkey, task)]
            rows.append(pad_to(row_full(rkey, task), 8*FW + FW))
            rows.append(pad_to(row_strip(rkey, task, rel), 8*FW + FW))
        # normalize widths
        W = max(r.shape[1] for r in rows)
        rows = [pad_to(r, W) for r in rows]
        sheet = np.vstack(rows)
        out = os.path.join(C, f'{rkey}.jpg')
        cv2.imwrite(out, sheet, [cv2.IMWRITE_JPEG_QUALITY, 92])
        print('wrote', out, sheet.shape[1], 'x', sheet.shape[0])

    # overview-clean: 4 rows (R1..R4 CLEAN), cols ref+7
    rows = []
    for rkey in REFKEYS:
        rows.append(row_full(rkey, 'CLEAN'))
    W = max(r.shape[1] for r in rows)
    grid = np.vstack([pad_to(r, W) for r in rows])
    out = os.path.join(C, 'overview-clean.jpg')
    cv2.imwrite(out, grid, [cv2.IMWRITE_JPEG_QUALITY, 92])
    print('wrote', out, grid.shape[1], 'x', grid.shape[0])

    # overview-transfer: 8 rows (ref,transfer task)
    rows = []
    for rkey in REFKEYS:
        for task, label in TASKS[rkey]:
            if task != 'CLEAN':
                rows.append(row_full(rkey, task))
    W = max(r.shape[1] for r in rows)
    grid = np.vstack([pad_to(r, W) for r in rows])
    out = os.path.join(C, 'overview-transfer.jpg')
    cv2.imwrite(out, grid, [cv2.IMWRITE_JPEG_QUALITY, 92])
    print('wrote', out, grid.shape[1], 'x', grid.shape[0])

if __name__ == '__main__':
    make_sheets()
