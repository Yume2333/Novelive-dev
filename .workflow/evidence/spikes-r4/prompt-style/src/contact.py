#!/usr/bin/env python3
"""Contact sheets: one JPEG per subject, variants as rows (V0..V5), samples side
by side, labels drawn. <=1600px long side, quality 82.
Also emits blinded sheets (same layout, code names A..F per subject, mapping saved
to metrics/blind-map.json) for vision judging.
Sprites are composited onto mid gray for viewing.
"""
import glob, json, os
import numpy as np
import cv2

G = os.path.join(os.path.dirname(__file__), '..', 'gen')
C = os.path.join(os.path.dirname(__file__), '..', 'contact')
M = os.path.join(os.path.dirname(__file__), '..', 'metrics')
os.makedirs(C, exist_ok=True)
os.makedirs(M, exist_ok=True)

VARS = ['V0', 'V1', 'V2', 'V3', 'V4', 'V5']
CELL_W, LABEL_W = 560, 90
BAR = 34
FONT = cv2.FONT_HERSHEY_SIMPLEX


def load(name):
    p = os.path.join(G, name + '.png')
    im = cv2.imread(p, cv2.IMREAD_UNCHANGED)
    if im is None:
        return None
    if im.shape[2] == 4:
        a = im[:, :, 3].astype(np.float32) / 255.0
        im = (im[:, :, :3].astype(np.float32) * a[..., None] + 128 * (1 - a[..., None])).astype(np.uint8)
    return im


def cell(im, w):
    h, ww = im.shape[:2]
    s = w / ww
    return cv2.resize(im, (w, round(h * s)), interpolation=cv2.INTER_AREA)


def sheet(sub, blind=False, codes=None):
    files = {}
    for v in VARS:
        files[v] = sorted(glob.glob(os.path.join(G, f'{sub}--{v}-s*.png')))
    ns = max(len(v) for v in files.values())
    if ns == 0:
        return
    rows = []
    for v in VARS:
        imgs = [load(os.path.basename(f)[:-4]) for f in files[v]]
        imgs = [i for i in imgs if i is not None]
        if not imgs:
            continue
        cw = CELL_W if not blind else CELL_W  # same
        cells = [cell(i, cw) for i in imgs]
        ch = max(c.shape[0] for c in cells) + BAR
        row = np.full((ch, cw * ns, 3), 32, np.uint8)
        for j, c in enumerate(cells):
            row[BAR:BAR + c.shape[0], j * cw:j * cw + c.shape[1]] = c
        lab = (codes[v] if blind else v)
        cv2.putText(row, lab, (10, 24), FONT, 0.8, (255, 255, 255), 2)
        for j in range(ns):
            if not blind:
                cv2.putText(row, f's{j+1}', (j * cw + 8, 24), FONT, 0.6, (200, 200, 200), 1)
        rows.append(row)
    if not rows:
        return
    w = max(r.shape[1] for r in rows)
    rows = [cv2.copyMakeBorder(r, 0, 0, 0, w - r.shape[1], cv2.BORDER_CONSTANT, value=(32, 32, 32)) for r in rows]
    img = np.vstack(rows)
    h, w = img.shape[:2]
    if max(h, w) > 1600:
        s = 1600 / max(h, w)
        img = cv2.resize(img, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA)
    return img


def main():
    subs = sorted({os.path.basename(p).split('--')[0] for p in glob.glob(os.path.join(G, '*.png'))})
    blind_map = {}
    for sub in subs:
        img = sheet(sub)
        if img is not None:
            cv2.imwrite(os.path.join(C, f'{sub}.jpg'), img, [cv2.IMWRITE_JPEG_QUALITY, 82])
            print('wrote', sub, img.shape)
        # blinded version with shuffled code letters
        rng = np.random.default_rng(abs(hash(sub)) % 2**31)
        codes = {v: k for v, k in zip(VARS, rng.permutation(list('ABCDEF'))[:len(VARS)])}
        blind_map[sub] = codes
        img = sheet(sub, blind=True, codes=codes)
        if img is not None:
            cv2.imwrite(os.path.join(C, f'{sub}-blind.jpg'), img, [cv2.IMWRITE_JPEG_QUALITY, 82])
    with open(os.path.join(M, 'blind-map.json'), 'w') as f:
        json.dump(blind_map, f, indent=1)
    print('blind map:', blind_map)


if __name__ == '__main__':
    main()
