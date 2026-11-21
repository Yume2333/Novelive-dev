#!/usr/bin/env python3
"""Build a labelled 100%-crop comparison grid for one test image.
Usage: make_grid.py <src_img> <crop_box_src_coords> <out_grid.png> <model:path> ...
Each model path is a 4x output; we crop the matching 4x region, downscale crop
to a fixed tile, and lay out columns labelled at top."""
import sys
from PIL import Image, ImageDraw, ImageFont

src_path, crop_box, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
cols = [c.split(':',1) for c in sys.argv[4:]]
x0,y0,x1,y1 = [int(v) for v in crop_box.split(',')]
TILE = 360; PAD = 6; LABEL_H = 28

# load
src = Image.open(src_path)
src_crop = src.crop((x0,y0,x1,y1))
scale = 4  # models are 4x

tiles = [('SRC(bicubic)', src_crop.resize((TILE,TILE), Image.BICUBIC).convert('RGB'))]
for name,path in cols:
    try:
        im = Image.open(path)
        # crop corresponding 4x region
        c = im.crop((x0*scale, y0*scale, x1*scale, y1*scale)).resize((TILE,TILE), Image.LANCZOS).convert('RGB')
    except Exception as e:
        c = Image.new('RGB',(TILE,TILE),(200,40,40))
    tiles.append((name,c))

W = len(tiles)*(TILE+PAD)+PAD
H = TILE + PAD*2 + LABEL_H
g = Image.new('RGB',(W,H),(20,20,24))
d = ImageDraw.Draw(g)
try: font = ImageFont.truetype("/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",16)
except: font = ImageFont.load_default()
for i,(name,t) in enumerate(tiles):
    x = PAD+i*(TILE+PAD)
    d.text((x+4, 6), name, fill=(255,255,120), font=font)
    g.paste(t,(x, LABEL_H))
g.save(out_path)
print("wrote", out_path, g.size)
