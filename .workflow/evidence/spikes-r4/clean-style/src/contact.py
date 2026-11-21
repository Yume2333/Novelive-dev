#!/usr/bin/env python3
"""Contact sheets for spikes-r4/clean-style.

Per asset <asset>.jpg:
  row 1 = full images: ref, A, B, C, D1, D2, E, F, G, H (missing arms = gray 'n/a')
  row 2 = 512x512 100% crops of the same hair+face region per arm.
  The region is picked once per asset from arm A by RELATIVE coordinates
  (CROP_REL below), then mapped onto each arm's actual pixel size.
crops-all.jpg: crops only, assets as rows, arms as columns.
Sprites (RGBA) are composited on light gray.
"""
import os
import numpy as np
import cv2

D = os.path.join(os.path.dirname(__file__), '..')
G = os.path.join(D, 'gen')
C = os.path.join(D, 'contact')
REF = os.path.join(D, 'ref', 'kokomi-torino-white.png')
os.makedirs(C, exist_ok=True)

IDS = ['K1', 'K4', 'K6', 'C1', 'C3', 'G2']
ARMS = ['A', 'B', 'C', 'D1', 'D2', 'E', 'F', 'G', 'H']
GRAY = (230, 230, 230)
FONT = cv2.FONT_HERSHEY_SIMPLEX
BAR = 34
CROP = 512

# (x, y, w, h) in relative coords of arm-A image; tuned per asset by viewing A.
CROP_REL = {
    'K1': (0.32, 0.06, 0.40, 0.40),   # face+hair of Kokomi sprite
    'K4': (0.30, 0.00, 0.32, 0.42),   # face+hair of seated Kokomi
    'K6': (0.25, 0.02, 0.23, 0.38),   # face+hair under umbrella
    'C1': (0.35, 0.06, 0.40, 0.40),   # Raiden head/hair
    'C3': (0.34, 0.01, 0.40, 0.40),   # Furina head/hair
    'G2': (0.63, 0.00, 0.31, 0.48),   # right girl (Furina) face+hat
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

def cell(im, w, h, label):
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
    cv2.rectangle(canvas, (0, h-BAR), (w, h), (250,250,250), -1)
    cv2.putText(canvas, label, (8, h-9), FONT, 0.7, (20,20,20), 2)
    return canvas

def crop_rel(im, rel):
    h, w = im.shape[:2]
    x, y, cw, ch = rel
    x0, y0 = int(x*w), int(y*h)
    x1, y1 = min(w, int((x+cw)*w)), min(h, int((y+ch)*h))
    c = im[y0:y1, x0:x1]
    return cv2.resize(c, (CROP, CROP), interpolation=cv2.INTER_CUBIC)

def img_path(asset, arm):
    return os.path.join(G, f'{asset}--{arm}.png')

def make_sheets():
    ref = load(REF)
    crop_cells = {}  # asset -> {arm: crop}
    for aid in IDS:
        a = load(img_path(aid, 'A'))
        rel = CROP_REL[aid]
        row_full = [cell(ref, 340, 520, 'ref')]
        row_crop = [cell(crop_rel(ref, rel) if ref is not None else None, 340, CROP+BAR, 'ref crop')]
        crop_cells[aid] = {}
        for arm in ARMS:
            p = img_path(aid, arm)
            im = load(p) if os.path.exists(p) else None
            row_full.append(cell(im, 340, 520, f'{aid} {arm}'))
            cr = crop_rel(im, rel) if im is not None else None
            if im is None:
                cr = np.full((CROP, CROP, 3), GRAY, np.uint8)
                cv2.putText(cr, 'n/a', (200, 260), FONT, 1.0, (120,120,120), 2)
            crop_cells[aid][arm] = cr
            row_crop.append(cell(cr, 340, CROP+BAR, f'{arm} crop'))
        sheet = np.vstack([np.hstack(row_full), np.hstack(row_crop)])
        out = os.path.join(C, f'{aid}.jpg')
        cv2.imwrite(out, sheet, [cv2.IMWRITE_JPEG_QUALITY, 92])
        print('wrote', out, sheet.shape[1], 'x', sheet.shape[0])

    # crops-all: rows=assets, cols=arms (+ label column)
    rows = []
    for aid in IDS:
        cells = [cell(None, 120, CROP+BAR, aid)]
        for arm in ARMS:
            cells.append(cell(crop_cells[aid].get(arm), CROP, CROP+BAR, arm))
        rows.append(np.hstack(cells))
    grid = np.vstack(rows)
    out = os.path.join(C, 'crops-all.jpg')
    cv2.imwrite(out, grid, [cv2.IMWRITE_JPEG_QUALITY, 92])
    print('wrote', out, grid.shape[1], 'x', grid.shape[0])

if __name__ == '__main__':
    make_sheets()
