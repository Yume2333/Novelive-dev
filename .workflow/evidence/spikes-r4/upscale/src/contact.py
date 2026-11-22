#!/usr/bin/env python3
"""Contact sheets + metrics for spikes-r4/upscale.

Reference column: Lanczos straight from the source to the target size ("后处理关").
Metrics per output (final image at target size):
  back_psnr  - output Lanczos-downscaled to the source size vs the source (dB); how much
               the model changed the picture's content at source scale
  dL         - mean luminance shift at source scale vs source (0-255)
  sharp      - mean Sobel gradient at target size / same for the Lanczos reference
  flat_noise - std of luminance (image - 3x3 box blur) over flat pixels (Lanczos ref gradient < 4);
               texture/noise left in flat colour areas (0-255 scale)
  red_fringe - % of edge pixels (Lanczos ref gradient > 25) where R-max(G,B) rose by > 30
               vs the Lanczos reference; the red halo ESRGAN-anime draws along line art
Sheets: contact/<img>-p1.png (all models, pass 1), contact/<img>-passes.png (p1..p3).
Usage: python src/contact.py [model,...]   (default: every model that has gen/<img>--<m>--p1.png)
"""
import glob, os, sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

D = os.path.join(os.path.dirname(__file__), '..')
G, C, IN = (os.path.join(D, x) for x in ('gen', 'contact', 'in'))
os.makedirs(C, exist_ok=True)
FONT = ImageFont.truetype('/usr/share/fonts/google-noto-sans-cjk-fonts/NotoSansCJK-Regular.ttc', 22)

IMAGES = {  # src file, target, crop boxes at target size (x, y, w, h)
    'W': ('W.png', (2560, 1440), [(1130, 300, 480, 360), (470, 880, 480, 360)]),
    'T3': ('T3.png', (2560, 1707), [(1110, 560, 480, 360), (180, 1360, 480, 300)]),
    'T1': ('T1.png', (2048, 3072), [(800, 520, 480, 360), (430, 1500, 480, 360)]),
}
BG = (200, 200, 200)


def flat(im):
    if im.mode != 'RGBA':
        return im.convert('RGB')
    b = Image.new('RGB', im.size, BG)
    b.paste(im, mask=im.split()[3])
    return b


def lum(a):
    return a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114


def grad(l):
    gx = np.abs(np.diff(l, axis=1))[:-1, :]
    gy = np.abs(np.diff(l, axis=0))[:, :-1]
    return gx + gy


def redness(a):
    return a[..., 0] - np.maximum(a[..., 1], a[..., 2])


def metrics(out, src, ref, ref_grad, flat_mask):
    o = np.asarray(flat(out), dtype=np.float32)
    back = np.asarray(flat(out.resize(src.size, Image.LANCZOS)), dtype=np.float32)
    s = np.asarray(flat(src), dtype=np.float32)
    mse = ((back - s) ** 2).mean()
    g = grad(lum(o))
    blur = np.asarray(flat(out).filter(ImageFilter.BoxBlur(1)), dtype=np.float32)
    hf = lum(o - blur)[:-1, :-1]
    edge = np.zeros(ref.shape[:2], bool)
    edge[:-1, :-1] = ref_grad > 25
    return {
        'back_psnr': 10 * np.log10(255 ** 2 / mse),
        'dL': float(lum(back).mean() - lum(s).mean()),
        'sharp': float(g.mean() / ref_grad.mean()),
        'flat_noise': float(hf[flat_mask].std()),
        'red_fringe': float(100 * ((redness(o) - redness(ref))[edge] > 30).mean()),
    }


def label(im, text):
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, im.width, 30), fill=(255, 255, 255))
    d.text((6, 2), text, fill=(20, 20, 20), font=FONT)
    return im


def grid(cells, cols, out):
    w, h = cells[0].size
    rows = (len(cells) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * (w + 8) + 8, rows * (h + 8) + 8), (255, 255, 255))
    for i, c in enumerate(cells):
        sheet.paste(c, (8 + (i % cols) * (w + 8), 8 + (i // cols) * (h + 8)))
    sheet.save(out)
    return sheet.size


def main():
    want = sys.argv[1].split(',') if len(sys.argv) > 1 else None
    rows = ['image\tmodel\tpass\tback_psnr\tdL\tsharp\tflat_noise\tred_fringe']

    def row(ik, m, p, r):
        rows.append(f"{ik}\t{m}\t{p}\t{r['back_psnr']:.1f}\t{r['dL']:+.2f}\t{r['sharp']:.2f}"
                    f"\t{r['flat_noise']:.2f}\t{r['red_fringe']:.2f}")
    for ik, (fn, target, boxes) in IMAGES.items():
        src = Image.open(os.path.join(IN, fn))
        src.load()
        ref = src.resize(target, Image.LANCZOS)
        ref_a = np.asarray(flat(ref), dtype=np.float32)
        ref_l = lum(ref_a)
        ref_grad = grad(ref_l)
        flat_mask = ref_grad < 4
        models = sorted({os.path.basename(p).split('--')[1] for p in glob.glob(os.path.join(G, f'{ik}--*--p1.png'))})
        if want:
            models = [m for m in want if m in models]
        row(ik, 'lanczos', '-', metrics(ref, src, ref_a, ref_grad, flat_mask))
        p1cells = [[] for _ in boxes]
        pcells = [[] for _ in boxes]
        for bi, (x, y, w, h) in enumerate(boxes):
            p1cells[bi].append(label(flat(ref.crop((x, y, x + w, y + h))), 'lanczos (后处理关)'))
        for m in models:
            for p in (1, 2, 3):
                f = os.path.join(G, f'{ik}--{m}--p{p}.png')
                if not os.path.exists(f):
                    continue
                out = Image.open(f)
                out.load()
                row(ik, m, p, metrics(out, src, ref_a, ref_grad, flat_mask))
                for bi, (x, y, w, h) in enumerate(boxes):
                    c = label(flat(out.crop((x, y, x + w, y + h))), f'{m} p{p}')
                    if p == 1:
                        p1cells[bi].append(c)
                    pcells[bi].append(c)
        for bi in range(len(boxes)):
            print(grid(p1cells[bi], 3, os.path.join(C, f'{ik}-c{bi}-p1.png')))
            print(grid(pcells[bi], 3, os.path.join(C, f'{ik}-c{bi}-passes.png')))
    with open(os.path.join(C, 'metrics.tsv'), 'w') as f:
        f.write('\n'.join(rows) + '\n')
    print('\n'.join(rows))


if __name__ == '__main__':
    main()
