#!/usr/bin/env python3
"""Contact sheets for spikes-r4/model-prompt (JPEG q92).

Per asset <asset>.jpg:
  left column = Torino reference (full + its crop-mapped cell),
  then a 2x2 grid of arms: rows flare/sunburst, cols render-block/style-fix.
  Each cell shows the D1 version full image, labelled FR-D1/FS-D1/SR-D1/SS-D1.
  Below: a crops strip — the same 512x512 hair+face region (relative coords
  picked from the FS raw) for every arm in raw / D1 / D2 (12 crops, labelled).

overview-D1.jpg: rows=assets, cols=4 arms, D1 versions, reference top-left.
crops-D1.jpg:   rows=assets, cols=4 arms, crops of the D1 versions only.

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

IDS = ['K1', 'K4', 'K6', 'K7', 'K8', 'C1', 'C2', 'C3', 'C5', 'G2']
ARMS = ['FR', 'FS', 'SR', 'SS']
GRID = [['FR', 'FS'], ['SR', 'SS']]          # rows=model, cols=last line
CROP_ARMS = ['FR', 'FS', 'SR', 'SS']
CROP_VERSIONS = ['', '-D1', '-D2']           # raw / D1 / D2
GRAY = (230, 230, 230)
FONT = cv2.FONT_HERSHEY_SIMPLEX
BAR = 34
CROP = 512
FW, FH = 420, 560                            # full-image cell size in per-asset sheet

# (x, y, w, h) relative to each image's own size; box picked on the FS raw
# per asset (hair+face of the main character; K8 = detail-rich shrine corner).
CROP_REL = {
    'K1': (0.28, 0.00, 0.44, 0.35),   # Kokomi sprite head
    'K4': (0.30, 0.00, 0.20, 0.40),   # seated Kokomi head
    'K6': (0.28, 0.00, 0.29, 0.48),   # Kokomi head under umbrella
    'K7': (0.28, 0.02, 0.22, 0.33),   # Kokomi head, battle CG
    'K8': (0.00, 0.00, 0.30, 0.40),   # shrine detail corner (no people)
    'C1': (0.23, 0.00, 0.46, 0.32),   # Raiden head/hair
    'C2': (0.34, 0.00, 0.40, 0.38),   # Nahida head (excl. far ponytail)
    'C3': (0.25, 0.02, 0.50, 0.31),   # Furina head+hat
    'C5': (0.18, 0.02, 0.57, 0.31),   # Hu Tao head+hat
    'G2': (0.68, 0.03, 0.26, 0.40),   # Furina (right girl) head+hat
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
    if c.size == 0:
        return None
    return cv2.resize(c, (CROP, CROP), interpolation=cv2.INTER_CUBIC)

def img_path(asset, arm, ver=''):
    return os.path.join(G, f'{asset}--{arm}{ver}.png')

def pick_crop_rel(aid):
    """Return the rel box for this asset, re-centered on the FS raw's opaque
    content when the tuned box would clip (sprites only)."""
    rel = CROP_REL[aid]
    p = img_path(aid, 'FS')
    if not os.path.exists(p):
        return rel
    im = cv2.imread(p, cv2.IMREAD_UNCHANGED)
    if im is None or im.shape[2] != 4:
        return rel
    a = im[:, :, 3]
    ys, xs = np.where(a > 8)
    if len(xs) == 0:
        return rel
    h, w = a.shape
    x, y, cw, ch = rel
    x0, y0, x1, y1 = x*w, y*h, (x+cw)*w, (y+ch)*h
    # keep the box inside the opaque bbox horizontally, allow top=0
    bx0, bx1 = xs.min(), xs.max()
    bw = x1 - x0
    if x0 < bx0: x0, x1 = bx0, bx0 + bw
    if x1 > bx1: x1, x0 = bx1, bx1 - bw
    return (max(0.0, x0/w), max(0.0, y0/h), (x1-x0)/w, (y1-y0)/h)

def make_sheets():
    ref = load(REF)
    crop_d1 = {}   # asset -> {arm: D1 crop} for crops-D1.jpg
    for aid in IDS:
        rel = pick_crop_rel(aid)
        # top: ref cell spanning the crops-strip height conceptually -> keep a
        # single ref column at left of the 2x2 grid.
        grid_rows = []
        for r in GRID:
            rowcells = []
            for arm in r:
                im = load(img_path(aid, arm, '-D1'))
                rowcells.append(cell(im, FW, FH, f'{aid} {arm}-D1'))
            grid_rows.append(np.hstack(rowcells))
        grid = np.vstack(grid_rows)
        refcell = cell(ref, FW, grid.shape[0], 'ref')
        top = np.hstack([refcell, grid])

        # crops strip: 4 arms x 3 versions
        cropcells = []
        crop_d1[aid] = {}
        for arm in CROP_ARMS:
            for ver in CROP_VERSIONS:
                p = img_path(aid, arm, ver)
                im = load(p) if os.path.exists(p) else None
                cr = crop_rel(im, rel) if im is not None else None
                if ver == '-D1':
                    crop_d1[aid][arm] = cr
                if cr is None:
                    cr = np.full((CROP, CROP, 3), GRAY, np.uint8)
                    cv2.putText(cr, 'n/a', (200, 260), FONT, 1.0, (120,120,120), 2)
                cropcells.append(cell(cr, 300, 300+BAR, f'{arm}{ver or "-raw"}'))
        strip = np.hstack(cropcells)
        # pad top to strip width
        if top.shape[1] < strip.shape[1]:
            pad = np.full((top.shape[0], strip.shape[1]-top.shape[1], 3), GRAY, np.uint8)
            top = np.hstack([top, pad])
        elif strip.shape[1] < top.shape[1]:
            pad = np.full((strip.shape[0], top.shape[1]-strip.shape[1], 3), GRAY, np.uint8)
            strip = np.hstack([strip, pad])
        sheet = np.vstack([top, strip])
        out = os.path.join(C, f'{aid}.jpg')
        cv2.imwrite(out, sheet, [cv2.IMWRITE_JPEG_QUALITY, 92])
        print('wrote', out, sheet.shape[1], 'x', sheet.shape[0])

    # overview-D1: ref top-left, rows=assets, cols=arms
    rows = []
    header = [cell(ref, 380, 480, 'ref')]
    for arm in ARMS:
        header.append(cell(None, 380, 480, arm + '-D1'))
    rows.append(np.hstack(header))
    for aid in IDS:
        rowcells = [cell(None, 380, 480, aid)]
        for arm in ARMS:
            im = load(img_path(aid, arm, '-D1'))
            rowcells.append(cell(im, 380, 480, f'{aid} {arm}-D1'))
        rows.append(np.hstack(rowcells))
    grid = np.vstack(rows)
    out = os.path.join(C, 'overview-D1.jpg')
    cv2.imwrite(out, grid, [cv2.IMWRITE_JPEG_QUALITY, 92])
    print('wrote', out, grid.shape[1], 'x', grid.shape[0])

    # crops-D1: rows=assets, cols=arms, D1 crops only
    rows = []
    for aid in IDS:
        rowcells = [cell(None, 120, CROP+BAR, aid)]
        for arm in ARMS:
            rowcells.append(cell(crop_d1[aid].get(arm), CROP, CROP+BAR, f'{arm}-D1'))
        rows.append(np.hstack(rowcells))
    grid = np.vstack(rows)
    out = os.path.join(C, 'crops-D1.jpg')
    cv2.imwrite(out, grid, [cv2.IMWRITE_JPEG_QUALITY, 92])
    print('wrote', out, grid.shape[1], 'x', grid.shape[0])

if __name__ == '__main__':
    make_sheets()
