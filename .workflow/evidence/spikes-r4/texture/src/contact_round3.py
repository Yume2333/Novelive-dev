#!/usr/bin/env python3
"""Round-3 sheets for spikes-r4/texture.

contact/round3-T{n}.png: one row, 参考图 | sunburst | sunburst-4k, every image
scaled (Lanczos) to the same height H so they compare at equal display size.
Transparent sprites are flattened on a light gray. Labels: caption + native WxH.
"""
import os
from PIL import ImageFont, ImageDraw, Image

D = os.path.join(os.path.dirname(__file__), '..')
G = os.path.join(D, 'gen', 'round3')
C = os.path.join(D, 'contact')
os.makedirs(C, exist_ok=True)
H = 1200
BAR = 70
GAP = 16
BG = (230, 230, 230)
FONT = ImageFont.truetype('/usr/share/fonts/google-noto-sans-cjk-fonts/NotoSansCJK-Regular.ttc', 34)

COLS = [
    (os.path.join(D, 'ref', 'kokomi.png'), '参考图'),
    ('sunburst', 'sunburst'),
    ('4k', 'sunburst-4k'),
]


def load(path):
    im = Image.open(path)
    native = im.size
    if im.mode in ('RGBA', 'LA', 'P'):
        im = im.convert('RGBA')
        flat = Image.new('RGB', im.size, BG)
        flat.paste(im, mask=im.split()[3])
        im = flat
    else:
        im = im.convert('RGB')
    w = round(im.width * H / im.height)
    return im.resize((w, H), Image.LANCZOS), native


for scene in ('T1', 'T2', 'T3'):
    cells = []
    for src, label in COLS:
        path = src if os.path.isabs(src) else os.path.join(G, f'{scene}--FXB--{src}.png')
        im, native = load(path)
        cells.append((im, f'{label}  {native[0]}x{native[1]}'))
    width = sum(im.width for im, _ in cells) + GAP * (len(cells) + 1)
    sheet = Image.new('RGB', (width, H + BAR + GAP), (255, 255, 255))
    draw = ImageDraw.Draw(sheet)
    x = GAP
    for im, text in cells:
        draw.text((x, 14), text, fill=(20, 20, 20), font=FONT)
        sheet.paste(im, (x, BAR))
        x += im.width + GAP
    out = os.path.join(C, f'round3-{scene}.png')
    sheet.save(out)
    print(out, sheet.size)
