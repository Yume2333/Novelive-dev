#!/usr/bin/env python3
"""Contact sheets for owner eyeball review.

Per asset: one JPEG with the reference image in the first column of every row,
then one row per arm (T0/R0/R1/R2/R3) with both samples, row label = arm code +
one-line description of that arm's prompt.
Plus overview.jpg: sample 1 of every arm x asset, grouped per asset.
Transparent images composited on mid gray. <=2400px wide, JPEG q90.
"""
import os, glob
import numpy as np
import cv2

D = os.path.join(os.path.dirname(__file__), '..')
G, C, REF = (os.path.join(D, p) for p in ('gen', 'contact', 'ref/kokomi-torino.png'))
os.makedirs(C, exist_ok=True)

ARMS = ['T0', 'R0', 'R1', 'R2', 'R3']
DESC = {
    'T0': 'text-only: content + S, no reference',
    'R0': 'ref only: image role line + type + content',
    'R1': 'pipeline: R0 + S + render block',
    'R2': 'R0 + S, no render block',
    'R3': 'R0 + render block, no S',
}
CELL_W, BAR, PAD = 460, 40, 8
FONT = cv2.FONT_HERSHEY_SIMPLEX


def load(path, gray=128):
    im = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if im is None:
        return None
    if im.shape[2] == 4:
        a = im[:, :, 3].astype(np.float32) / 255.0
        im = (im[:, :, :3].astype(np.float32) * a[..., None] + gray * (1 - a[..., None])).astype(np.uint8)
    return im[:, :, :3]


def fit(im, w, maxh=None):
    h, ww = im.shape[:2]
    s = w / ww
    nh = round(h * s)
    if maxh and nh > maxh:
        s = maxh / h
        nh = maxh
    return cv2.resize(im, (round(ww * s), nh), interpolation=cv2.INTER_AREA)


def label_row(text, w):
    bar = np.full((BAR, w, 3), 24, np.uint8)
    cv2.putText(bar, text, (10, 28), FONT, 0.75, (255, 255, 255), 1, cv2.LINE_AA)
    return bar


def asset_sheet(asset):
    ref = load(REF)
    rows = []
    for arm in ARMS:
        names = sorted(glob.glob(os.path.join(G, f'{asset}--{arm}-s*.png')))
        cells = [load(p) for p in names]
        cells = [c for c in cells if c is not None]
        # cell heights differ across portrait/landscape; use per-asset max height
        if cells:
            maxh = max(round(c.shape[0] * CELL_W / c.shape[1]) for c in cells)
            refc = fit(ref, CELL_W, maxh)
            cells = [fit(c, CELL_W, maxh) for c in cells]
            ch = max([refc.shape[0]] + [c.shape[0] for c in cells])
            allc = [refc] + cells
        else:
            refc = fit(ref, CELL_W)
            ch = refc.shape[0]
            allc = [refc]
        w = CELL_W * 3  # ref + 2 samples
        row = np.full((ch + BAR, w, 3), 40, np.uint8)
        for j, c in enumerate(allc):
            x = j * CELL_W + (CELL_W - c.shape[1]) // 2
            row[BAR:BAR + c.shape[0], x:x + c.shape[1]] = c
        row[0:BAR] = label_row(f'{arm}  {DESC[arm]}' + ('   [left col = reference]' if arm == 'T0' else ''), w)
        rows.append(row)
    if not rows:
        return None
    img = np.vstack(rows)
    h, w = img.shape[:2]
    if w > 2400:
        s = 2400 / w
        img = cv2.resize(img, (2400, round(h * s)), interpolation=cv2.INTER_AREA)
    return img


def overview(assets):
    blocks = []
    for asset in assets:
        ref = load(REF)
        row_cells = [fit(ref, CELL_W)]
        ok = False
        for arm in ARMS:
            p = os.path.join(G, f'{asset}--{arm}-s1.png')
            im = load(p) if os.path.exists(p) else None
            if im is None:
                im = np.full((10, 10, 3), 60, np.uint8)
            else:
                ok = True
            row_cells.append(fit(im, CELL_W))
        if not ok:
            continue
        ch = max(c.shape[0] for c in row_cells)
        w = CELL_W * (len(ARMS) + 1)
        row = np.full((ch + BAR, w, 3), 40, np.uint8)
        for j, c in enumerate(row_cells):
            row[BAR:BAR + c.shape[0], j * CELL_W:j * CELL_W + c.shape[1]] = c
        row[0:BAR] = label_row(f'{asset}   |   col1=ref  then  ' + '  '.join(ARMS) + '  (sample 1)', w)
        blocks.append(row)
    if not blocks:
        return None
    img = np.vstack(blocks)
    h, w = img.shape[:2]
    if w > 2400:
        s = 2400 / w
        img = cv2.resize(img, (2400, round(h * s)), interpolation=cv2.INTER_AREA)
    return img


def main():
    assets = sorted({os.path.basename(p).split('--')[0] for p in glob.glob(os.path.join(G, '*--*.png'))})
    print('assets:', assets)
    for a in assets:
        img = asset_sheet(a)
        if img is not None:
            cv2.imwrite(os.path.join(C, f'{a}.jpg'), img, [cv2.IMWRITE_JPEG_QUALITY, 90])
            print('wrote', a, img.shape)
    img = overview(assets)
    if img is not None:
        cv2.imwrite(os.path.join(C, 'overview.jpg'), img, [cv2.IMWRITE_JPEG_QUALITY, 90])
        print('wrote overview', img.shape)


if __name__ == '__main__':
    main()
