#!/usr/bin/env python3
"""R4 round-2 (style-ref) metrics. Reads gen/*.png -> metrics/metrics.jsonl +
per-(asset, arm) aggregates.

Preprocessing (same as round-1 script):
  - downscale so long side = 768 px (LANCZOS)
  - sprites (alpha<255 present): composite onto mid gray (128); spatial metrics
    restricted to the alpha bounding box; color-mass masked to alpha>0.

Metrics per image:
  edge_density   = #(Canny(gray,100,200)>0) / #pixels
  hf_energy      = FFT power with normalized radius > 1/4 Nyquist / total power
  micro_contrast = mean(local_std 3x3) / mean(local_std 15x15)
  color_mass     = mean component area (px at 768-scale) of Lab k-means (k=12)
                   label map after small-region merge (<0.05% of masked px)
  specular_frac  = fraction of tiny (<0.05% px) connected blobs with V>0.93,S<0.12
  frag_per_mp    = #connected components of the Canny map per megapixel
  alpha_cov      = alpha>127 coverage fraction (sprites only; validity check)

Style match vs the arm's key visual (gen/<kv>-s1.png or gen/kv-r3.png):
  style_vec_dist = euclidean distance between z-normalized metric vectors
                   (edge_density, hf_energy, micro_contrast, color_mass,
                   specular_frac, frag_per_mp; z over all measured images)
  pal_emd        = Lab histogram EMD distance to the KV (8x8x8 bins)
  pal_chi2       = chi-square distance between the same histograms
  KV row itself gets 0/self-distances; key visuals are compared to themselves
  only implicitly (KVs have no reference).
"""
import json, glob, os
import numpy as np
import cv2
from scipy import ndimage

G = os.path.join(os.path.dirname(__file__), '..', 'gen')
OUT = os.path.join(os.path.dirname(__file__), '..', 'metrics', 'metrics.jsonl')
LONG = 768
MID = 128
KEYS = ['edge_density', 'hf_energy', 'micro_contrast', 'color_mass', 'specular_frac', 'frag_per_mp']

# arm -> KV file stem (without -s1 suffix handling below)
ARM_KV = {'B0': 'kv-r3.png', 'B1': 'KV-O-s1.png', 'B2': 'KV-P-s1.png',
          'B3': 'KV-P-s1.png', 'B4': 'KV-P-s1.png', 'B5': 'KV-P-s1.png',
          'B6': 'KV-P-s1.png', 'B7': 'KV-O-s1.png', 'B8': 'KV-O-s1.png'}
REQUESTED = {'cg-first-rain': (1536, 864), 'dazayuan': (1536, 864), 'xiangzi-puller': (1024, 1536)}


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
    allidx = np.where(mask.ravel())[0]
    lab_flat = labimg.reshape(-1, 3)
    preds = km.predict(lab_flat[allidx])
    labels.ravel()[allidx] = preds
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


def prep(path):
    """Returns (roi_bgr, roi_mask, has_alpha, alpha_cov, out_size, bbox_h_ratio, fringe)."""
    im = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    oh, ow = im.shape[:2]
    bgr, a = load(path)
    has_alpha = (a < 250).any()
    mask = a > 127
    alpha_cov = float(mask.sum() / mask.size)
    bbox_h_ratio = None
    fringe = None
    if has_alpha:
        ys, xs = np.where(mask)
        if len(ys):
            bbox_h_ratio = float((ys.max() + 1 - ys.min()) / a.shape[0])
        # fringe ring: pixels with 10 < alpha < 245, vs opaque interior
        ring = (a > 10) & (a < 245)
        interior = a >= 245
        if ring.sum() > 50 and interior.sum() > 50:
            hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV).astype(np.float32)
            rh = hsv[..., 0][ring]
            rs = hsv[..., 1][ring]
            ih = hsv[..., 0][interior]
            isat = hsv[..., 1][interior]
            fringe = dict(ring_sat=float(rs.mean()), interior_sat=float(isat.mean()),
                          ring_redbrown=float(((rh < 20) | (rh > 160)).mean()),
                          interior_redbrown=float(((ih < 20) | (ih > 160)).mean()),
                          ring_px=int(ring.sum()))
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
    return roi, roi_mask, has_alpha, alpha_cov, (ow, oh), bbox_h_ratio, fringe


def spatial_metrics(roi):
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
    r = np.sqrt(fx ** 2 + fy ** 2)
    hf = float(P[r > 0.125].sum() / P.sum())
    s3 = local_std(gray, 3).mean()
    s15 = local_std(gray, 15).mean()
    micro = float(s3 / s15) if s15 > 0 else 0.0
    return dict(edge_density=edge_density, hf_energy=hf, micro_contrast=micro,
                specular_frac=specular_frac(roi), frag_per_mp=frag_per_mp)


def lab_hist(bgr, mask):
    labimg = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
    h = cv2.calcHist([labimg], [0, 1, 2], mask.astype(np.uint8) if mask is not None else None,
                     [8, 8, 8], [0, 256, 0, 256, 0, 256])
    h = h.flatten().astype(np.float32)
    s = h.sum()
    return h / s if s > 0 else h


def metrics(path):
    roi, roi_mask, has_alpha, alpha_cov, out_size, bbox_h_ratio, fringe = prep(path)
    d = spatial_metrics(roi)
    d['color_mass'] = color_mass(roi, roi_mask)
    d['has_alpha'] = bool(has_alpha)
    d['alpha_cov'] = alpha_cov
    d['out_w'], d['out_h'] = out_size
    if bbox_h_ratio is not None:
        d['bbox_h_ratio'] = bbox_h_ratio
    if fringe is not None:
        d.update(fringe)
    return d


def emd(h1, h2, dim=8):
    """approx EMD between two flattened Lab histograms via cv2.EMD on bin centers."""
    bins = np.indices((dim, dim, dim)).reshape(3, -1).T.astype(np.float32)
    # scale L/a/b to comparable ranges
    bins[:, 0] *= 256.0 / dim
    bins[:, 1] *= 256.0 / dim
    bins[:, 2] *= 256.0 / dim
    d = np.sqrt(((bins[:, None, :] - bins[None, :, :]) ** 2).sum(-1)).astype(np.float32)
    sig1 = np.column_stack([h1, np.ones_like(h1)]).astype(np.float32)  # weight + dummy
    # cv2.EMD wants signatures: rows=features, cols = dims+1 (weight first)
    s1 = np.column_stack([h1, bins]).astype(np.float32)
    s2 = np.column_stack([h2, bins]).astype(np.float32)
    s1 = s1[s1[:, 0] > 0]
    s2 = s2[s2[:, 0] > 0]
    if len(s1) == 0 or len(s2) == 0:
        return float('nan')
    return float(cv2.EMD(s1, s2, cv2.DIST_USER, d[np.ix_(np.where(h1 > 0)[0], np.where(h2 > 0)[0])])[0])


def main():
    files = sorted(glob.glob(os.path.join(G, '*.png')))
    rows = []
    hists = {}
    vecs = {}
    for p in files:
        name = os.path.basename(p)[:-4]
        try:
            m = metrics(p)
            roi, roi_mask = prep(p)[:2]
            hists[name] = lab_hist(roi, roi_mask)
        except Exception as e:
            m = {'error': str(e)}
        row = {'image': name, **m}
        # classify: 'KV-X-sN' key visual | '<asset>--<arm>-sN' phase-B | 'kv-r3' baseline KV
        if name == 'kv-r3':
            row.update(kind='kv', variant='kv-r3')
        elif name.startswith('KV-'):
            var, samp = name.rsplit('-s', 1)
            row.update(kind='kv', variant=var, sample=int(samp))
        else:
            sub, rest = name.split('--')
            var, samp = rest.rsplit('-s', 1)
            row.update(kind='asset', asset=sub, variant=var, sample=int(samp))
        rows.append(row)
        print(name, 'ok' if 'error' not in m else m['error'])

    # z-normalize metric vectors over all measured images
    valid = [r for r in rows if 'error' not in r]
    arr = {k: np.array([r[k] for r in valid]) for k in KEYS}
    mu = {k: arr[k].mean() for k in KEYS}
    sd = {k: arr[k].std() or 1.0 for k in KEYS}
    for r in valid:
        vecs[r['image']] = np.array([(r[k] - mu[k]) / sd[k] for k in KEYS])

    # style-match distances to arm KV
    kv_ref = {'kv-r3': 'kv-r3', 'KV-O': 'KV-O-s1', 'KV-P': 'KV-P-s1'}
    for r in rows:
        if r.get('kind') != 'asset' or 'error' in r:
            continue
        kvimg = ARM_KV[r['variant']][:-4]  # strip .png
        if kvimg in vecs:
            r['style_vec_dist'] = float(np.linalg.norm(vecs[r['image']] - vecs[kvimg]))
        if r['image'] in hists and kvimg in hists:
            r['pal_emd'] = emd(hists[r['image']], hists[kvimg])
            r['pal_chi2'] = float(cv2.compareHist(hists[r['image']].astype(np.float32),
                                                hists[kvimg].astype(np.float32),
                                                cv2.HISTCMP_CHISQR))
    # also measure KV-O/KV-P sample2 -> sample1 distance (KV internal consistency)
    for var in ('KV-O', 'KV-P'):
        a, b = f'{var}-s1', f'{var}-s2'
        for r in rows:
            if r['image'] == b and a in vecs:
                r['style_vec_dist_to_s1'] = float(np.linalg.norm(vecs[b] - vecs[a]))
                r['pal_emd_to_s1'] = emd(hists[b], hists[a])

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        for r in rows:
            f.write(json.dumps(r) + '\n')

    # aggregate mean per asset x arm
    agg = {}
    for r in valid:
        if r.get('kind') != 'asset':
            continue
        agg.setdefault((r['asset'], r['variant']), []).append(r)
    keys = KEYS + ['style_vec_dist', 'pal_emd', 'pal_chi2', 'alpha_cov', 'bbox_h_ratio',
                   'ring_sat', 'interior_sat', 'ring_redbrown', 'interior_redbrown']
    out = []
    for (sub, var), rs in sorted(agg.items()):
        o = {'asset': sub, 'arm': var, 'n': len(rs)}
        for k in keys:
            vals = [r[k] for r in rs if k in r]
            o[k] = float(np.mean(vals)) if vals else None
        out.append(o)
    with open(OUT.replace('.jsonl', '-agg.json'), 'w') as f:
        json.dump(out, f, indent=1)
    print('wrote', OUT)


if __name__ == '__main__':
    main()
