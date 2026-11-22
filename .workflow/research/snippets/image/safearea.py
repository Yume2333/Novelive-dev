"""Measurable check: is the subject inside the central 4:3 safe area of a 16:9 frame?

Proposal (to be added to visuals.md technical check):
  For a WxH 16:9 image, the 4:3 safe area is the central region of width 3*H/4
  (i.e. left=(W-3H/4)/2, right=W-(W-3H/4)/2). A generated image passes if
  'the fraction of salient-content pixels inside the safe area' >= T.

  Salient pixels = pixels where edge energy or local contrast exceeds a
  threshold (cheap proxy for "where things happen"). Pure-texture fill
  (floor, sky gradient) should not count; we therefore measure on the
  Laplacian-of-gray magnitude at stride 4 and use a percentile threshold.

Also report subject-side mass: if >50% of salient mass is in the OUTER
third columns, the prompt's "subject in 4:3" failed.
"""
import sys, json
from PIL import Image
import numpy as np

def saliency_inside(path, safe_ratio=4/3):
    im = Image.open(path).convert('L')
    a = np.asarray(im, np.float64)
    h, w = a.shape
    # safe area
    sw = int(round(h * safe_ratio))
    x0 = (w - sw) // 2
    # edge energy via 1-step gradients (cheap Laplacian substitute)
    gx = np.abs(np.diff(a, axis=1)); gy = np.abs(np.diff(a, axis=0))
    e = np.zeros_like(a)
    e[:, :-1] += gx; e[:-1, :] += gy
    # ignore smooth fill: threshold at 75th percentile of all energy
    t = np.percentile(e, 75)
    mask = e > t
    total = mask.sum()
    if total == 0:
        return {'pass': False, 'reason': 'no salient content'}
    inside = mask[:, x0:x0 + sw].sum()
    frac = inside / total
    # left/right outer columns each (w-sw)/2
    side = mask[:, :x0].sum() + mask[:, x0 + sw:].sum()
    return {
        'img': f'{w}x{h}',
        'safeW': sw, 'safeX0': x0,
        'salientTotal': int(total),
        'salientInside': int(inside),
        'insideFrac': round(frac, 3),
        'outerFrac': round(side / total, 3),
    }

if __name__ == '__main__':
    for p in sys.argv[1:]:
        print(p.split('/')[-1], json.dumps(saliency_inside(p)))
