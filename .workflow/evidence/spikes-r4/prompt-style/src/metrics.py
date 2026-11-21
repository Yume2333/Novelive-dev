#!/usr/bin/env python3
"""R4 A/B metrics. Reads gen/*.png -> metrics/metrics.jsonl + per-variant aggregates.

Preprocessing per assignment:
  - downscale so long side = 768 px (LANCZOS)
  - sprites (alpha<255 present): composite onto mid gray (128) for spatial metrics;
    spatial metrics restricted to the alpha bounding box; color-mass masked to alpha>0.

Metrics (formulas):
  edge_density   = #(Canny(gray, 100, 200) > 0) / #pixels   [fraction of edge pixels]
  hf_energy      = sum(|FFT(gray)|^2 for radius > Nyquist/4) / sum(|FFT(gray)|^2)
                   radius measured in normalized frequency units on fftshifted spectrum
  micro_contrast = mean(local_std(gray, 3x3)) / mean(local_std(gray, 15x15))
                   local_std = sqrt(E[x^2]-E[x]^2) via uniform_filter; ratio >1 => micro
                   contrast relatively strong vs broad-tonal structure
  color_mass     = mean area (px, on the 768-scale image) of connected components in
                   Lab k-means label map (k=12). Before connected components,
                   components smaller than 0.05% of pixels are merged into the
                   spatially-neighboring majority label ("small-region merge").
  specular_frac  = area fraction of specular pixels = HSV V>0.93 & S<0.12,
                   restricted to connected blobs of area < 0.05% of image pixels
                   (tiny bright glints), divided by total pixel count
  frag_per_mp    = #connected components of the Canny edge map, per megapixel
                   = components / (pixels/1e6)

"""
import json, glob, os, sys
import numpy as np
import cv2
from scipy import ndimage  # scikit-image depends on scipy; used for label/filters
G = os.path.join(os.path.dirname(__file__), '..', 'gen')
OUT = os.path.join(os.path.dirname(__file__), '..', 'metrics', 'metrics.jsonl')
LONG = 768
MID = 128


def load(path):
    im = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if im is None:
        raise ValueError(path)
    if im.shape[2] == 4:
        bgr, a = im[:, :, :3], im[:, :, 3]
    else:
        bgr, a = im[:, :, :3], np.full(im.shape[:2], 255, np.uint8)
    h, w = bgr.shape[:2]
    sc = LONG / max(h, w)
    bgr = cv2.resize(bgr, (round(w * sc), round(h * sc)), interpolation=cv2.INTER_LANCZOS4)
    a = cv2.resize(a, (round(w * sc), round(h * sc)), interpolation=cv2.INTER_LANCZOS4)
    return bgr, a


def local_std(x, k):
    x = x.astype(np.float32)
    m = cv2.blur(x, (k, k))
    m2 = cv2.blur(x * x, (k, k))
    return np.sqrt(np.maximum(m2 - m * m, 0))


def small_merge(labels, min_frac=0.0005):
    """Merge connected components smaller than min_frac into the majority label of
    their boundary neighbors (one pass)."""
    lab = labels.copy()
    npx = lab.size
    out = lab.copy()
    for v in np.unique(lab):
        mask = lab == v
        cc, n = ndimage.label(mask)
        objs = ndimage.find_objects(cc)
        for i, sl in enumerate(objs, 1):
            if sl is None:
                continue
            region = cc[sl] == i
            if region.sum() >= npx * min_frac:
                continue
            # dilate to find neighbor labels
            dil = ndimage.binary_dilation(region, iterations=2)
            nb = lab[sl][dil & ~region]
            if nb.size:
                vals, cnt = np.unique(nb, return_counts=True)
                out[sl][region] = vals[cnt.argmax()]
    return out


def color_mass(bgr, mask):
    labimg = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    px = labimg[mask].reshape(-1, 3)
    if len(px) > 20000:
        idx = np.random.default_rng(0).choice(len(px), 20000, replace=False)
        train = px[idx]
    else:
        train = px
    from sklearn.cluster import KMeans
    km = KMeans(n_clusters=min(12, len(train)), n_init=4, random_state=0).fit(train)
    labels = -np.ones(mask.shape, np.int32)
    # predict all pixels in chunks
    allidx = np.where(mask.ravel())[0]
    lab_flat = labimg.reshape(-1, 3)
    preds = km.predict(lab_flat[allidx])
    labels.ravel()[allidx] = preds
    # small-region merge only inside mask; outside stays -1
    inside = np.where(mask, labels, -1)
    merged = inside.copy()
    for v in np.unique(inside[inside >= 0]):
        m = inside == v
        cc, n = ndimage.label(m)
        objs = ndimage.find_objects(cc)
        for i, sl in enumerate(objs, 1):
            if sl is None:
                continue
            reg = cc[sl] == i
            if reg.sum() >= mask.sum() * 0.0005:
                continue
            dil = ndimage.binary_dilation(reg, iterations=2)
            nb = inside[sl][dil & ~reg]
            nb = nb[nb >= 0]
            if nb.size:
                vals, cnt = np.unique(nb, return_counts=True)
                merged[sl][reg] = vals[cnt.argmax()]
    ids = np.unique(merged[merged >= 0])
    sizes = np.bincount(merged.ravel()[merged.ravel() >= 0], minlength=int(ids.max()) + 1)[ids] if ids.size else ids
    return float(np.mean(sizes)) if np.size(sizes) else 0.0


def specular_frac(bgr):
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV).astype(np.float32) / 255.0
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    spec = (v > 0.93) & (s < 0.12)
    cc, n = ndimage.label(spec)
    objs = ndimage.find_objects(cc)
    total = spec.size
    glint = np.zeros_like(spec)
    for i, sl in enumerate(objs, 1):
        if sl is None:
            continue
        reg = cc[sl] == i
        if reg.sum() < total * 0.0005:
            glint[sl] |= reg
    return float(glint.sum() / total)


def metrics(path):
    bgr, a = load(path)
    has_alpha = (a < 250).any()
    mask = a > 127
    if has_alpha:
        # composite onto mid gray
        af = (a.astype(np.float32) / 255.0)[..., None]
        bgr = (bgr.astype(np.float32) * af + MID * (1 - af)).astype(np.uint8)
        ys, xs = np.where(mask)
        if len(ys):
            y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
            roi = bgr[y0:y1, x0:x1]
            roi_mask = mask[y0:y1, x0:x1]
        else:
            roi, roi_mask = bgr, mask
    else:
        roi, roi_mask = bgr, np.ones(mask.shape, bool)
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    npx = gray.size

    edges = cv2.Canny(gray, 100, 200)
    edge_density = float((edges > 0).sum() / npx)
    _, ncomp = ndimage.label(edges > 0)
    frag_per_mp = float(ncomp / (npx / 1e6))

    F = np.fft.fftshift(np.fft.fft2(gray.astype(np.float32)))
    P = np.abs(F) ** 2
    fy = np.fft.fftfreq(gray.shape[0])[:, None]
    fx = np.fft.fftfreq(gray.shape[1])[None, :]
    r = np.sqrt(fx ** 2 + fy ** 2)  # cycles/pixel; Nyquist = 0.5
    hf = float(P[r > 0.125].sum() / P.sum())  # radius > 1/4 Nyquist = 0.5/4

    s3 = local_std(gray, 3).mean()
    s15 = local_std(gray, 15).mean()
    micro = float(s3 / s15) if s15 > 0 else 0.0

    cm = color_mass(roi, roi_mask)
    spec = specular_frac(roi)

    return dict(edge_density=edge_density, hf_energy=hf, micro_contrast=micro,
                color_mass=cm, specular_frac=spec, frag_per_mp=frag_per_mp,
                has_alpha=bool(has_alpha), px=npx)


def main():
    rows = []
    for p in sorted(glob.glob(os.path.join(G, '*.png'))):
        name = os.path.basename(p)[:-4]
        # s3-...--Vn-sK
        sub, rest = name.split('--')
        var, samp = rest.rsplit('-s', 1)
        try:
            m = metrics(p)
        except Exception as e:
            m = {'error': str(e)}
        rows.append({'image': name, 'subject': sub, 'variant': var, 'sample': int(samp), **m})
        print(name, 'ok' if 'error' not in m else m['error'])
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        for r in rows:
            f.write(json.dumps(r) + '\n')
    # aggregate mean per subject x variant
    agg = {}
    for r in rows:
        if 'error' in r:
            continue
        k = (r['subject'], r['variant'])
        agg.setdefault(k, []).append(r)
    keys = ['edge_density', 'hf_energy', 'micro_contrast', 'color_mass', 'specular_frac', 'frag_per_mp']
    out = []
    for (sub, var), rs in sorted(agg.items()):
        out.append({'subject': sub, 'variant': var, 'n': len(rs),
                    **{k: float(np.mean([r[k] for r in rs])) for k in keys}})
    with open(OUT.replace('.jsonl', '-agg.json'), 'w') as f:
        json.dump(out, f, indent=1)
    print('wrote', OUT)


if __name__ == '__main__':
    main()
