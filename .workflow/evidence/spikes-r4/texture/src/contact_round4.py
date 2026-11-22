#!/usr/bin/env python3
"""Round-4 sheets for spikes-r4/texture (palette leak A/B).

contact/round4-T{n}.png: one row per scene:
  参考图 | round3 sunburst (old role line) | A r1 | A r2 | B r1 | B r2
all scaled (Lanczos) to the same height; transparent sprites flattened on gray.
Labels carry the color-cast metric B−G (mean blue minus mean green over opaque
pixels); T3 also prints B−G over the tablecloth band.
Also writes contact/round4-metrics.tsv.
"""
import os
from PIL import ImageFont, ImageDraw, Image

D = os.path.join(os.path.dirname(__file__), '..')
G = os.path.join(D, 'gen')
C = os.path.join(D, 'contact')
os.makedirs(C, exist_ok=True)
H = 900
BAR = 92
GAP = 14
BG = (230, 230, 230)
FONT = ImageFont.truetype('/usr/share/fonts/google-noto-sans-cjk-fonts/NotoSansCJK-Regular.ttc', 28)
TABLECLOTH = (0.30, 0.88, 0.70, 0.99)  # T3 lower-center band, fractions of W/H


def cast(im, box=None):
    im = im.convert('RGBA')
    if box:
        w, h = im.size
        im = im.crop((int(box[0] * w), int(box[1] * h), int(box[2] * w), int(box[3] * h)))
    im = im.resize((256, max(1, round(256 * im.height / im.width))))
    px = [p for p in im.get_flattened_data() if p[3] > 128]
    g = sum(p[1] for p in px) / len(px)
    b = sum(p[2] for p in px) / len(px)
    return b - g


def flat(im):
    im = im.convert('RGBA')
    out = Image.new('RGB', im.size, BG)
    out.paste(im, mask=im.split()[3])
    return out


def cols(scene):
    yield os.path.join(D, 'ref', 'kokomi.png'), '参考图'
    yield os.path.join(G, 'round3', f'{scene}--FXB--sunburst.png'), 'round3 旧声明'
    for arm in ('A', 'B'):
        for run in ('r1', 'r2'):
            yield os.path.join(G, 'round4', f'{scene}--{arm}--{run}.png'), f'{arm} {run}'


rows = ['scene\tcolumn\tB-G_whole\tB-G_tablecloth']
for scene in ('T1', 'T2', 'T3'):
    cells = []
    for path, label in cols(scene):
        if not os.path.exists(path):
            continue
        src = Image.open(path)
        whole = cast(src)
        cloth = cast(src, TABLECLOTH) if scene == 'T3' and label != '参考图' else None
        rows.append(f'{scene}\t{label}\t{whole:+.0f}\t{"" if cloth is None else f"{cloth:+.0f}"}')
        line2 = f'B−G {whole:+.0f}' + ('' if cloth is None else f'  桌布 {cloth:+.0f}')
        im = flat(src)
        im = im.resize((round(im.width * H / im.height), H), Image.LANCZOS)
        cells.append((im, label, line2))
    width = sum(im.width for im, _, _ in cells) + GAP * (len(cells) + 1)
    sheet = Image.new('RGB', (width, H + BAR + GAP), (255, 255, 255))
    draw = ImageDraw.Draw(sheet)
    x = GAP
    for im, label, line2 in cells:
        draw.text((x, 8), label, fill=(20, 20, 20), font=FONT)
        draw.text((x, 46), line2, fill=(90, 90, 90), font=FONT)
        sheet.paste(im, (x, BAR))
        x += im.width + GAP
    out = os.path.join(C, f'round4-{scene}.png')
    sheet.save(out)
    print(out, sheet.size)

with open(os.path.join(C, 'round4-metrics.tsv'), 'w') as f:
    f.write('\n'.join(rows) + '\n')
print('\n'.join(rows))
