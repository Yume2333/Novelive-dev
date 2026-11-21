"""High-resolution contact sheets for style-branch, written to contact-hires/.

Same layout as contact.py, but full-image cells are at the image's native
size (1:1 pixels) and crops are 1024px. Overviews use half-size cells so
they stay openable. Usage: python src/contact_hires.py
"""
import os
import numpy as np
import cv2
from PIL import Image, ImageDraw
import contact as c

c.C = os.path.join(c.D, 'contact-hires')
os.makedirs(c.C, exist_ok=True)
c.BAR = 120
c.CROP = 1024
c.CW = 1024


def draw_labels(canvas, en, zh):
    h, w = canvas.shape[:2]
    cv2.rectangle(canvas, (0, h - c.BAR), (w, h), (250, 250, 250), -1)
    pil = Image.fromarray(canvas)
    d = ImageDraw.Draw(pil)
    d.text((16, h - c.BAR + 4), zh, font=c.cjk_font(64), fill=(20, 20, 20))
    d.text((16 + d.textlength(zh, font=c.cjk_font(64)) + 32, h - c.BAR + 30), en,
           font=c.cjk_font(40), fill=(90, 90, 90))
    return np.asarray(pil)


c.draw_labels = draw_labels


def native_size(rkey, task):
    for col, _ in c.COLUMNS:
        p = c.d1_path(rkey, task, col)
        im = c.load(p) if os.path.exists(p) else None
        if im is not None:
            return im.shape[1], im.shape[0]
    raise FileNotFoundError(f'{rkey}-{task}')


def row_full(rkey, task, scale=1.0):
    w, h = native_size(rkey, task)
    fw, fh = round(w * scale) + 8, round(h * scale) + 8 + c.BAR
    ref_im = c.load(os.path.join(c.D, 'ref', f'{rkey}.png'))
    cells = [c.cell(ref_im, fw, fh, 'ref', '参考图')]
    for col, cap in c.COLUMNS:
        p = c.d1_path(rkey, task, col)
        im = c.load(p) if os.path.exists(p) else None
        cells.append(c.cell(im, fw, fh, f'{rkey}-{task} {col}', cap))
    return np.hstack(cells)


def write(name, rows):
    width = max(r.shape[1] for r in rows)
    sheet = np.vstack([c.pad_to(r, width) for r in rows])
    out = os.path.join(c.C, name)
    cv2.imwrite(out, sheet, [cv2.IMWRITE_JPEG_QUALITY, 95])
    print('wrote', out, sheet.shape[1], 'x', sheet.shape[0])


for rkey in c.REFKEYS:
    for task in c.TASKS[rkey]:
        write(f'{rkey}-{task}.jpg', [row_full(rkey, task),
                                      c.row_strip(rkey, task, c.CROP_REL[(rkey, task)])])

write('overview-clean.jpg', [row_full(r, 'CLEAN', 0.5) for r in c.REFKEYS])
write('overview-transfer.jpg', [row_full(r, t, 0.5) for r in c.REFKEYS
                                for t in c.TASKS[r] if t != 'CLEAN'])
