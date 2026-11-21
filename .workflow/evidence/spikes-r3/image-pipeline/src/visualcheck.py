"""Visual review helper for sprites: bbox, scale, expression-region crop, checkerboard synth."""
import sys
from PIL import Image
import numpy as np

def alpha_bbox(path, thresh=16):
    im = Image.open(path).convert('RGBA')
    a = np.asarray(im)[:, :, 3]
    ys, xs = np.where(a > thresh)
    if len(xs) == 0:
        return None
    return (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()), im.size)

def subject_stats(path):
    """Return bbox + fill ratio + center offset of the alpha subject."""
    b = alpha_bbox(path)
    if not b:
        return None
    x0, y0, x1, y1, size = b
    w, h = size
    bw, bh = x1 - x0 + 1, y1 - y0 + 1
    a = np.asarray(Image.open(path).convert('RGBA'))[:, :, 3]
    return dict(bbox=[x0, y0, x1, y1], imgW=w, imgH=h,
                fillW=round(bw / w, 3), fillH=round(bh / h, 3),
                cx=round((x0 + x1) / 2 / w, 3), cy=round((y0 + y1) / 2 / h, 3),
                coverage=round((a > 16).mean(), 3))

def crop_face(src, dst, scale=1.0):
    """Crop the head/face region (top ~38% of subject bbox) to a file for judging."""
    im = Image.open(src).convert('RGBA')
    b = alpha_bbox(src)
    if not b:
        return False
    x0, y0, x1, y1, _ = b
    h = y1 - y0
    fy1 = y0 + int(h * 0.40)
    pad = int((x1 - x0) * 0.08)
    box = (max(0, x0 - pad), max(0, y0 - pad), min(im.width, x1 + pad), min(im.height, fy1))
    c = im.crop(box)
    # put on light grey so alpha edges are visible to the judge
    bg = Image.new('RGB', c.size, (230, 230, 235))
    bg.paste(c, mask=c.split()[3])
    bg.save(dst, 'PNG')
    return True

def paste_on(im_path, dst, bg=(250, 250, 252)):
    im = Image.open(im_path).convert('RGBA')
    bgim = Image.new('RGB', im.size, bg)
    bgim.paste(im, mask=im.split()[3])
    bgim.save(dst, 'PNG')

def make_fake_checker(dst, w=1024, h=1536, cell=64):
    """Synthesize the observed failure: opaque image painted with grey checkerboard."""
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    a = np.zeros((h, w), np.uint8) + 255
    rgb = np.zeros((h, w, 3), np.uint8)
    for y in range(0, h, cell):
        for x in range(0, w, cell):
            v = 204 if ((x // cell) + (y // cell)) % 2 == 0 else 164
            rgb[y:y+cell, x:x+cell] = v
    # a fake "subject" blob in middle
    rgb[h//3:2*h//3, w//3:2*w//3] = (140, 90, 80)
    out = np.dstack([rgb, a])
    Image.fromarray(out, 'RGBA').save(dst)

def ssim_gray(p1, p2):
    """Global SSIM on grayscale, same-size required."""
    a = np.asarray(Image.open(p1).convert('L'), np.float64)
    b = np.asarray(Image.open(p2).convert('L'), np.float64)
    C1, C2 = 6.5025, 58.5225
    mu_a, mu_b = a.mean(), b.mean()
    va = a.var(); vb = b.var(); cov = ((a - mu_a) * (b - mu_b)).mean()
    ssim = ((2 * mu_a * mu_b + C1) * (2 * cov + C2)) / ((mu_a**2 + mu_b**2 + C1) * (va + vb + C2))
    return round(ssim, 4)

def edge_map(path, dst=None, lo=60, hi=160):
    """Pure-numpy Canny-lite: Sobel threshold. Returns edge density + saves edge PNG."""
    im = Image.open(path).convert('L')
    a = np.asarray(im, np.float64)
    gx = np.zeros_like(a); gy = np.zeros_like(a)
    gx[:, 1:-1] = a[:, 2:] - a[:, :-2]
    gy[1:-1, :] = a[2:, :] - a[:-2, :]
    mag = np.hypot(gx, gy)
    e = (mag > hi).astype(np.uint8) * 255
    if dst:
        Image.fromarray(e).save(dst)
    return e

if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'stats':
        import json
        print(json.dumps(subject_stats(sys.argv[2])))
    elif cmd == 'face':
        print(crop_face(sys.argv[2], sys.argv[3]))
    elif cmd == 'paste':
        paste_on(sys.argv[2], sys.argv[3])
    elif cmd == 'fakecheck':
        make_fake_checker(sys.argv[2])
    elif cmd == 'ssim':
        print(ssim_gray(sys.argv[2], sys.argv[3]))
    elif cmd == 'edge':
        e = edge_map(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
        print(round((e > 0).mean(), 5))
