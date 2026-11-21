#!/usr/bin/env python3
"""Contact sheets: one JPEG per asset (+ one for the KVs), arms as rows,
samples side by side. <=1600px long side, JPEG q82. Emits blinded sheets too
(code letters per arm, mapping -> metrics/blind-map.json).
Sprites composited onto mid gray for viewing.
"""
import glob, json, os
import numpy as np
import cv2

G = os.path.join(os.path.dirname(__file__), '..', 'gen')
C = os.path.join(os.path.dirname(__file__), '..', 'contact')
M = os.path.join(os.path.dirname(__file__), '..', 'metrics')
os.makedirs(C, exist_ok=True)
os.makedirs(M, exist_ok=True)

ARMS = ['B0', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8']
CELL_W, BAR = 560, 34
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


def sheet(rows_spec, blind_codes=None):
    """rows_spec: list of (label, [img names]). Returns composited image."""
    rows = []
    for label, names in rows_spec:
        imgs = [load(n) for n in names]
        imgs = [i for i in imgs if i is not None]
        if not imgs:
            continue
        cells = [cell(i, CELL_W) for i in imgs]
        ch = max(c.shape[0] for c in cells) + BAR
        row = np.full((ch, CELL_W * len(cells), 3), 32, np.uint8)
        for j, c in enumerate(cells):
            row[BAR:BAR + c.shape[0], j * CELL_W:j * CELL_W + c.shape[1]] = c
        lab = blind_codes.get(label, label) if blind_codes else label
        cv2.putText(row, lab, (10, 24), FONT, 0.8, (255, 255, 255), 2)
        rows.append(row)
    if not rows:
        return None
    w = max(r.shape[1] for r in rows)
    rows = [cv2.copyMakeBorder(r, 0, 0, 0, w - r.shape[1], cv2.BORDER_CONSTANT, value=(32, 32, 32)) for r in rows]
    img = np.vstack(rows)
    h, w = img.shape[:2]
    if max(h, w) > 1600:
        s = 1600 / max(h, w)
        img = cv2.resize(img, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA)
    return img


def main():
    assets = sorted({os.path.basename(p).split('--')[0] for p in glob.glob(os.path.join(G, '*--*.png'))})
    blind_map = {}
    for asset in assets:
        spec = [(arm, sorted(os.path.basename(p)[:-4] for p in glob.glob(os.path.join(G, f'{asset}--{arm}-s*.png'))))
                for arm in ARMS]
        img = sheet(spec)
        if img is not None:
            cv2.imwrite(os.path.join(C, f'{asset}.jpg'), img, [cv2.IMWRITE_JPEG_QUALITY, 82])
            print('wrote', asset, img.shape)
        rng = np.random.default_rng(abs(hash(asset)) % 2**31)
        codes = {a: k for a, k in zip(ARMS, rng.permutation(list('ABCDEFGHJ'))[:len(ARMS)])}
        blind_map[asset] = codes
        img = sheet(spec, blind_codes=codes)
        if img is not None:
            cv2.imwrite(os.path.join(C, f'{asset}-blind.jpg'), img, [cv2.IMWRITE_JPEG_QUALITY, 82])
    # KV sheet: kv-r3 + KV-O s1/s2 + KV-P s1/s2
    kvspec = [('kv-r3', ['kv-r3']), ('KV-O', ['KV-O-s1', 'KV-O-s2']), ('KV-P', ['KV-P-s1', 'KV-P-s2'])]
    img = sheet(kvspec)
    if img is not None:
        cv2.imwrite(os.path.join(C, 'keyvisuals.jpg'), img, [cv2.IMWRITE_JPEG_QUALITY, 82])
    with open(os.path.join(M, 'blind-map.json'), 'w') as f:
        json.dump(blind_map, f, indent=1)
    print('blind map:', blind_map)


if __name__ == '__main__':
    main()
