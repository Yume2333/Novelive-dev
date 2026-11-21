#!/usr/bin/env python3
"""Generate anime-style test images for upscaler trials.

Creates 4 images under os.path.join(os.path.dirname(os.path.abspath(__file__)),"test-imgs"):
  bg_skyline_1024x576.png  - anime-ish background, gradients, soft clouds, hard edge buildings
  bg_forest_1024x576.png   - denser texture (foliage dithering) for noise/edge tests
  sprite_girl_768x1024.png - RGBA sprite: flat-color skin/clothes, gradient hair with soft alpha edges
  cg_scene_1280x720.png    - 16:9 CG-like composite with soft glow & noise

All synthesized locally with PIL/numpy; no external assets (license-clean by construction).
"""
import math, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

random.seed(42); np.random.seed(42)
import os
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test-imgs")

def to_img(arr):
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))

# ---------- 1) anime skyline background ----------
def skyline(w=1024, h=576):
    # vertical sky gradient: warm horizon -> deep blue top
    t = np.linspace(0, 1, h)[:, None]
    top = np.array([38, 60, 140.]); mid = np.array([110, 150, 210.]); hor = np.array([250, 200, 160.])
    sky = np.zeros((h, w, 3))
    for c in range(3):
        a = np.where(t < 0.6, top[c] + (mid[c]-top[c])*(t/0.6), mid[c] + (hor[c]-mid[c])*((t-0.6)/0.4))
        sky[:, :, c] = np.repeat(a, w, axis=1)
    img = to_img(sky)
    d = ImageDraw.Draw(img)
    # sun glow
    sun = Image.new("RGBA", (w, h), (0,0,0,0))
    sd = ImageDraw.Draw(sun)
    sd.ellipse([w*0.68-60, h*0.30-60, w*0.68+60, h*0.30+60], fill=(255,240,210,255))
    sun = sun.filter(ImageFilter.GaussianBlur(40))
    img = Image.alpha_composite(img.convert("RGBA"), sun).convert("RGB")
    d = ImageDraw.Draw(img)
    # clouds: soft ellipses
    cloud = Image.new("RGBA", (w, h), (0,0,0,0))
    cd = ImageDraw.Draw(cloud)
    for cx, cy, cw_, chh in [(0.2,0.22,300,60),(0.55,0.15,380,70),(0.85,0.28,260,50)]:
        for i in range(6):
            cd.ellipse([w*cx - cw_/2 + random.uniform(-60,60), h*cy - chh/2 + random.uniform(-15,15),
                        w*cx + cw_/2 + random.uniform(-60,60), h*cy + chh/2 + random.uniform(-15,15)],
                       fill=(255,255,255, int(150-i*18)))
    cloud = cloud.filter(ImageFilter.GaussianBlur(14))
    img = Image.alpha_composite(img.convert("RGBA"), cloud).convert("RGB")
    d = ImageDraw.Draw(img)
    # distant + near buildings (hard edges, flat fills - classic anime bg)
    rng = random.Random(7)
    yb = int(h*0.62)
    for layer,(col,alpha) in enumerate([((90,100,150),255), ((60,70,120),255), ((30,40,80),255)]):
        x = -20; ytop = yb + layer*40
        while x < w:
            bw = rng.randint(50, 150); bh = rng.randint(60, 220) + layer*40
            d.rectangle([x, h - bh, x + bw, h], fill=col)
            # windows
            if layer == 2:
                for wy in range(h-bh+12, h-8, 18):
                    for wx in range(x+8, x+bw-8, 16):
                        if rng.random() < 0.3:
                            d.rectangle([wx, wy, wx+6, wy+8], fill=(255, 220, 140))
            x += bw + rng.randint(4, 20)
    img.save(f"{OUT}/bg_skyline_1024x576.png")

# ---------- 2) forest background (texture-heavy) ----------
def forest(w=1024, h=576):
    t = np.linspace(0, 1, h)[:, None]
    top = np.array([30, 70, 60.]); bot = np.array([140, 190, 120.])
    sky = np.zeros((h, w, 3))
    for c in range(3):
        sky[:, :, c] = np.repeat((top[c] + (bot[c]-top[c])*t), w, axis=1)
    img = to_img(sky); d = ImageDraw.Draw(img)
    rng = random.Random(11)
    # foliage blobs, layered
    for i, shade in enumerate([(40,90,50),(55,110,60),(75,135,70),(95,160,80)]):
        for _ in range(140):
            x = rng.randint(0, w); y = rng.randint(0, int(h*0.7)); r = rng.randint(8, 30) + i*4
            d.ellipse([x-r, y-r, x+r, y+r], fill=shade)
    # trunks
    for _ in range(14):
        x = rng.randint(0, w); tw = rng.randint(10, 26)
        d.polygon([(x, h), (x+tw, h), (x+tw-4, int(h*0.35)), (x+4, int(h*0.35))], fill=(70, 50, 35))
    # ground
    d.rectangle([0, int(h*0.78), w, h], fill=(85, 120, 65))
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    # light shafts
    shaft = Image.new("RGBA", (w, h), (0,0,0,0))
    sd = ImageDraw.Draw(shaft)
    for x in [0.2, 0.5, 0.8]:
        sd.polygon([(w*x, 0), (w*x+120, 0), (w*x+300, h), (w*x+140, h)], fill=(255,255,220,40))
    shaft = shaft.filter(ImageFilter.GaussianBlur(20))
    img = Image.alpha_composite(img.convert("RGBA"), shaft).convert("RGB")
    img.save(f"{OUT}/bg_forest_1024x576.png")

# ---------- 3) RGBA sprite with soft hair edges ----------
def sprite(w=768, h=1024):
    """Girl bust: flat color clothes/skin, gradient hair, feathered alpha at edges."""
    img = Image.new("RGBA", (w, h), (0,0,0,0))
    d = ImageDraw.Draw(img)
    cx = w//2
    # hair back (big blob, gradient fill via mask)
    hair_mask = Image.new("L", (w, h), 0)
    hd = ImageDraw.Draw(hair_mask)
    hd.ellipse([cx-200, 60, cx+200, 760], fill=255)
    hd.rectangle([cx-200, 400, cx+200, 900], fill=255)
    # gradient hair color: pink -> purple
    yy = np.linspace(0, 1, h)[:, None]
    c1 = np.array([255, 150, 190.]); c2 = np.array([150, 80, 200.])
    grad = np.zeros((h, w, 3))
    for c in range(3):
        grad[:, :, c] = np.repeat(c1[c] + (c2[c]-c1[c])*yy, w, axis=1)
    hair = Image.fromarray(grad.astype(np.uint8)).convert("RGBA")
    hair.putalpha(hair_mask)
    # feather the hair alpha slightly at edges -> soft edge for alpha test
    a = hair.getchannel("A").filter(ImageFilter.GaussianBlur(2))
    hair.putalpha(a)
    img = Image.alpha_composite(img, hair)
    # body / sailor uniform
    d = ImageDraw.Draw(img)
    d.ellipse([cx-160, 560, cx+160, 1100], fill=(245, 245, 250, 255))   # blouse
    d.polygon([(cx-160, 700), (cx+160, 700), (cx+140, 560), (cx-140, 560)], fill=(60, 80, 160, 255))  # collar
    d.polygon([(cx-30, 620), (cx+30, 620), (cx+18, 760), (cx-18, 760)], fill=(200, 50, 60, 255))      # tie
    # neck + face
    d.rectangle([cx-40, 480, cx+40, 580], fill=(255, 222, 200, 255))
    d.ellipse([cx-130, 140, cx+130, 480], fill=(255, 228, 205, 255))
    # eyes (hard dark shapes + highlights)
    for ex in [-60, 60]:
        d.ellipse([cx+ex-30, 300, cx+ex+30, 380], fill=(60, 40, 90, 255))
        d.ellipse([cx+ex-18, 316, cx+ex+6, 352], fill=(140, 110, 220, 255))
        d.ellipse([cx+ex-12, 312, cx+ex+4, 330], fill=(255, 255, 255, 255))
        d.arc([cx+ex-34, 292, cx+ex+34, 384], 200, 340, fill=(30, 20, 20, 255), width=5)  # eyeliner
    # brows, mouth, blush
    for ex in [-60, 60]:
        d.arc([cx+ex-36, 258, cx+ex+36, 300], 200, 340, fill=(120, 80, 60, 255), width=5)
    d.arc([cx-24, 400, cx+24, 436], 20, 160, fill=(180, 80, 80, 255), width=4)
    for ex in [-95, 95]:
        b = Image.new("RGBA", (w, h), (0,0,0,0))
        bd = ImageDraw.Draw(b); bd.ellipse([cx+ex-24, 384, cx+ex+24, 412], fill=(255, 160, 170, 120))
        img = Image.alpha_composite(img, b.filter(ImageFilter.GaussianBlur(6)))
        d = ImageDraw.Draw(img)
    # hair front (bangs) - over face, gradient, feathered
    bangs_mask = Image.new("L", (w, h), 0)
    bd = ImageDraw.Draw(bangs_mask)
    bd.polygon([(cx-190, 220), (cx+190, 220), (cx+150, 330), (cx+80, 290), (cx+40, 340),
                (cx-20, 295), (cx-80, 345), (cx-130, 290), (cx-190, 330)], fill=255)
    bd.rectangle([cx-195, 60, cx+195, 240], fill=255)
    bangs = Image.fromarray(grad.astype(np.uint8)).convert("RGBA")
    ba = bangs_mask.filter(ImageFilter.GaussianBlur(1.5))
    bangs.putalpha(ba)
    img = Image.alpha_composite(img, bangs)
    # ahoge (hair strand)
    d = ImageDraw.Draw(img)
    d.arc([cx-8, 40, cx+70, 140], 90, 320, fill=(255, 160, 200, 255), width=7)
    # subtle outline (dark) around silhouette via alpha edge — skip; keep it clean
    img.save(f"{OUT}/sprite_girl_768x1024.png")

# ---------- 4) CG 16:9 composite ----------
def cg(w=1280, h=720):
    t = np.linspace(0, 1, h)[:, None]
    top = np.array([18, 24, 60.]); bot = np.array([90, 60, 120.])
    sky = np.zeros((h, w, 3))
    for c in range(3):
        sky[:, :, c] = np.repeat(top[c] + (bot[c]-top[c])*t, w, axis=1)
    img = to_img(sky); d = ImageDraw.Draw(img)
    rng = random.Random(3)
    for _ in range(300):
        x, y = rng.randint(0, w), rng.randint(0, int(h*0.6))
        r = rng.choice([1,1,1,2])
        d.ellipse([x-r, y-r, x+r, y+r], fill=(255,255,255))
    # moon glow
    moon = Image.new("RGBA", (w, h), (0,0,0,0))
    md = ImageDraw.Draw(moon)
    md.ellipse([w*0.75-70, h*0.22-70, w*0.75+70, h*0.22+70], fill=(255,250,235,255))
    moon = moon.filter(ImageFilter.GaussianBlur(26))
    img = Image.alpha_composite(img.convert("RGBA"), moon).convert("RGB")
    d = ImageDraw.Draw(img)
    # silhouette hills + torii
    d.polygon([(0, h), (0, int(h*0.55)), (w*0.4, int(h*0.7)), (w*0.7, int(h*0.5)), (w, int(h*0.65)), (w, h)], fill=(14, 18, 40))
    d.rectangle([w*0.55, int(h*0.42), w*0.57, int(h*0.55)], fill=(20, 10, 10))
    d.rectangle([w*0.68, int(h*0.42), w*0.70, int(h*0.55)], fill=(20, 10, 10))
    d.rectangle([w*0.53, int(h*0.42), w*0.72, int(h*0.45)], fill=(20, 10, 10))
    img.save(f"{OUT}/cg_scene_1280x720.png")

if __name__ == "__main__":
    import os; os.makedirs(OUT, exist_ok=True)
    skyline(); forest(); sprite(); cg()
    print("done")
