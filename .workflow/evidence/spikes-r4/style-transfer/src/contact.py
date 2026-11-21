"""Contact sheets for brushwork, native pixels only (no resizing).

contact/<ref>.png: row 1 = sprites, row 2 = CGs; columns = 4 arms x 2 runs (D1).
contact/<ref>/ and contact/<ref>-raw/: flip folders, 00-ref then sprites, then CGs,
in column order. Usage: python src/contact.py
"""
import os
import shutil
from PIL import Image, ImageDraw, ImageFont

D = os.path.join(os.path.dirname(__file__), '..')
G = os.path.join(D, 'gen')
C = os.path.join(D, 'contact')
FONT = '/usr/share/fonts/google-noto-sans-cjk-fonts/NotoSansCJK-Regular.ttc'
GRAY = (230, 230, 230)
BAR, GAP = 96, 16
REFS = ['A', 'C']
KINDS = [('sprite', '立绘'), ('cg', 'CG')]
ARMS = [('FX', 'FX 现行'), ('FXB', 'FXB 例外加笔触'), ('FXBM', 'FXBM 加媒介句'), ('NXBM', 'NXBM 去掉平涂喷枪')]
RUNS = ['r1', 'r2']
COLS = [(arm, cap, i, run) for arm, cap in ARMS for i, run in enumerate(RUNS)]


def load(path):
    if not os.path.exists(path):
        return None
    im = Image.open(path)
    if im.mode in ('RGBA', 'LA', 'P'):
        im = im.convert('RGBA')
        bg = Image.new('RGBA', im.size, GRAY + (255,))
        return Image.alpha_composite(bg, im).convert('RGB')
    return im.convert('RGB')


def sheet(rows):
    cw = max(im.width for row in rows for _, im in row if im)
    chs = [max(im.height for _, im in row if im) for row in rows]
    ncol = max(len(r) for r in rows)
    W = ncol * cw + (ncol + 1) * GAP
    H = sum(h + BAR + GAP for h in chs) + GAP
    out = Image.new('RGB', (W, H), (255, 255, 255))
    d = ImageDraw.Draw(out)
    big, small = ImageFont.truetype(FONT, 52), ImageFont.truetype(FONT, 32)
    y = GAP
    for row, ch in zip(rows, chs):
        for k, (cap, im) in enumerate(row):
            x = GAP + k * (cw + GAP)
            out.paste(Image.new('RGB', (cw, ch), GRAY), (x, y))
            info = '缺图'
            if im:
                out.paste(im, (x + (cw - im.width) // 2, y + (ch - im.height) // 2))
                info = f'{im.width}x{im.height}'
            d.text((x + 8, y + ch + 4), cap, font=big, fill=(20, 20, 20))
            d.text((x + 8, y + ch + 60), info, font=small, fill=(90, 90, 90))
        y += ch + BAR + GAP
    return out


os.makedirs(C, exist_ok=True)
for ref in REFS:
    rows = [[(f'{zh} {cap} 第{i + 1}次', load(os.path.join(G, f'{ref}-{kind}--{arm}--{run}-D1.png')))
             for arm, cap, i, run in COLS] for kind, zh in KINDS]
    s = sheet(rows)
    s.save(os.path.join(C, f'{ref}.png'), compress_level=3)
    print('wrote', f'{ref}.png', s.width, 'x', s.height)
    for suffix, folder in (('-D1', ref), ('', f'{ref}-raw')):
        fd = os.path.join(C, folder)
        shutil.rmtree(fd, ignore_errors=True)
        os.makedirs(fd)
        shutil.copy(os.path.join(D, 'ref', f'{ref}.png'), os.path.join(fd, '00-ref.png'))
        n = 1
        for kind, _ in KINDS:
            for arm, _, i, run in COLS:
                src = os.path.join(G, f'{ref}-{kind}--{arm}--{run}{suffix}.png')
                if os.path.exists(src):
                    shutil.copy(src, os.path.join(fd, f'{n:02d}-{kind}-{arm}-{i + 1}.png'))
                n += 1
