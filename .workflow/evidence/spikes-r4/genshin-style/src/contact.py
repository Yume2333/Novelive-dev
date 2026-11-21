#!/usr/bin/env python3
"""Contact sheets for spikes-r4/genshin-style.

Layout: reference image always in the left column; each generated asset gets a
labeled cell. kokomi.jpg / characters.jpg: rows A,B x 8 assets; groups.jpg:
rows A,B x G1,G2; all-A.jpg: every arm-A image in a grid.
Sprites (RGBA) are composited on light gray. Output JPEG q90, <=2400 px wide.
"""
import os, glob
import numpy as np
import cv2

D = os.path.join(os.path.dirname(__file__), '..')
G = os.path.join(D, 'gen')
C = os.path.join(D, 'contact')
REF = os.path.join(D, 'ref', 'kokomi-torino.png')
os.makedirs(C, exist_ok=True)

GRAY = (230, 230, 230)
BAR = 34
FONT = cv2.FONT_HERSHEY_SIMPLEX


def load(path):
    im = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if im is None:
        return None
    if im.shape[2] == 4:
        a = im[:, :, 3:4].astype(np.float32) / 255.0
        bg = np.full_like(im[:, :, :3], GRAY, dtype=np.float32)
        im = (im[:, :, :3].astype(np.float32) * a + bg * (1 - a)).astype(np.uint8)
    return im[:, :, :3]


def cell(im, w, h, label):
    """Fit im inside w x h box on gray, label bar at bottom."""
    canvas = np.full((h, w, 3), GRAY, np.uint8)
    if im is not None:
        ih, iw = im.shape[:2]
        s = min((w - 8) / iw, (h - BAR - 8) / ih)
        nw, nh = max(1, round(iw * s)), max(1, round(ih * s))
        fit = cv2.resize(im, (nw, nh), interpolation=cv2.INTER_AREA)
        y = (h - BAR - nh) // 2
        x = (w - nw) // 2
        canvas[y:y + nh, x:x + nw] = fit
    else:
        cv2.putText(canvas, 'MISSING', (10, h // 2), FONT, 0.7, (40, 40, 200), 2, cv2.LINE_AA)
    cv2.rectangle(canvas, (0, h - BAR), (w, h), (24, 24, 24), -1)
    cv2.putText(canvas, label, (8, h - 9), FONT, 0.6, (255, 255, 255), 1, cv2.LINE_AA)
    return canvas


def img_for(asset, arm):
    for suf in ('', '-nr'):
        p = os.path.join(G, f'{asset}--{arm}{suf}.png')
        if os.path.exists(p):
            return load(p), suf
    return None, ''


def sheet_grid(rows, path, cw, ch, ref_label='ref'):
    """rows: list of (row_label, [(asset, arm), ...])."""
    ref = load(REF)
    out_rows = []
    for rlabel, items in rows:
        cells = [cell(ref, cw, ch, ref_label)]
        for asset, arm in items:
            im, suf = img_for(asset, arm)
            cells.append(cell(im, cw, ch, f'{rlabel} {asset}{suf}'))
        out_rows.append(np.hstack(cells))
    img = np.vstack(out_rows)
    img = shrink(img)
    cv2.imwrite(path, img, [cv2.IMWRITE_JPEG_QUALITY, 90])
    print(f'wrote {path} {img.shape[1]}x{img.shape[0]}')


def shrink(img, maxw=2400):
    h, w = img.shape[:2]
    if w <= maxw:
        return img
    s = maxw / w
    return cv2.resize(img, (maxw, round(h * s)), interpolation=cv2.INTER_AREA)


def main():
    K = [f'K{i}' for i in range(1, 9)]
    CS = [f'C{i}' for i in range(1, 9)]
    # kokomi.jpg: ref + 8 cells per row, rows A and B
    sheet_grid(
        [('A', [(a, 'A') for a in K]), ('B', [(a, 'B') for a in K])],
        os.path.join(C, 'kokomi.jpg'), 300, 400, 'ref Torino')
    sheet_grid(
        [('A', [(a, 'A') for a in CS]), ('B', [(a, 'B') for a in CS])],
        os.path.join(C, 'characters.jpg'), 300, 400, 'ref Torino')
    # groups.jpg: ref + 2 landscape cells per row
    sheet_grid(
        [('A', [(a, 'A') for a in ('G1', 'G2')]), ('B', [(a, 'B') for a in ('G1', 'G2')])],
        os.path.join(C, 'groups.jpg'), 700, 560, 'ref Torino')
    # all-A.jpg: every arm-A image, ref first, grid 5 cols
    allids = K + CS + ['G1', 'G2']
    cw, ch = 480, 430
    ref = load(REF)
    cells = [cell(ref, cw, ch, 'ref Torino')]
    for a in allids:
        im, suf = img_for(a, 'A')
        cells.append(cell(im, cw, ch, f'A {a}{suf}'))
    ncols = 5
    while len(cells) % ncols:
        cells.append(np.full((ch, cw, 3), GRAY, np.uint8))
    grid = np.vstack([np.hstack(cells[i:i + ncols]) for i in range(0, len(cells), ncols)])
    grid = shrink(grid)
    cv2.imwrite(os.path.join(C, 'all-A.jpg'), grid, [cv2.IMWRITE_JPEG_QUALITY, 90])
    print(f'wrote {os.path.join(C, "all-A.jpg")} {grid.shape[1]}x{grid.shape[0]}')


if __name__ == '__main__':
    main()
