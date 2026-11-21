#!/usr/bin/env python3
"""Generate a higher-fidelity anime-style test image resembling gpt-image output.
Adds fine line-art, hair strands, eye detail, gradient sky, and subtle texture
that upscalers must preserve/sharpen — far closer to real AI illustration than
flat shapes."""
import numpy as np, random, math
from PIL import Image, ImageDraw, ImageFilter
random.seed(5); np.random.seed(5)
import os
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test-imgs")

def img(a): return Image.fromarray(np.clip(a,0,255).astype(np.uint8))

# ---------- anime sprite with LINE ART + hair strands (RGBA) ----------
def sprite(w=1024,h=1280):
    im=Image.new("RGBA",(w,h),(0,0,0,0))
    cx=w//2
    # hair back layer with strands
    hb=Image.new("RGBA",(w,h),(0,0,0,0)); d=ImageDraw.Draw(hb)
    # base silhouette
    d.ellipse([cx-240,80,cx+240,820],fill=(120,70,160,255))
    d.rectangle([cx-240,380,cx+240,980],fill=(120,70,160,255))
    # hair strands: many thin darker/lighter arcs
    for i in range(140):
        x0=cx-240+random.uniform(0,480); y0=random.uniform(60,140)
        length=random.uniform(300,760); sway=random.uniform(-60,60)
        pts=[(x0+math.sin(t/120)*sway*(t/700), y0+t) for t in range(0,int(length),12)]
        col=(95,50,140,255) if i%3 else (165,110,210,255)
        d.line(pts,fill=col,width=random.choice([2,2,3]))
    im=Image.alpha_composite(im,hb.filter(ImageFilter.GaussianBlur(0.4)))
    d=ImageDraw.Draw(im)
    # body sailor uniform w/ folds
    d.ellipse([cx-170,600,cx+170,1300],fill=(248,248,252,255))
    for i in range(9):  # cloth fold lines
        x=cx-150+i*38; d.line([(x,760),(x+random.randint(-8,8),1100)],fill=(225,228,240,255),width=3)
    d.polygon([(cx-170,760),(cx+170,760),(cx+140,600),(cx-140,600)],fill=(52,72,150,255))
    d.polygon([(cx-32,660),(cx+32,660),(cx+18,820),(cx-18,820)],fill=(196,46,58,255))
    # neck, face
    d.rectangle([cx-44,520,cx+44,620],fill=(255,224,203,255))
    d.ellipse([cx-140,150,cx+140,540],fill=(255,230,208,255))
    # ---- LINE ART: dark outline strokes (the fidelity test) ----
    ink=(40,30,55,255)
    d.arc([cx-140,150,cx+140,540],300,240,fill=ink,width=4)      # face outline
    for ex in [-62,62]:                                          # eyes w/ detail
        d.ellipse([cx+ex-34,330,cx+ex+34,420],fill=(50,36,86,255))
        d.ellipse([cx+ex-22,344,cx+ex+8,392],fill=(120,95,210,255))
        d.ellipse([cx+ex-14,340,cx+ex+6,366],fill=(255,255,255,255))
        d.ellipse([cx+ex-4,372,cx+ex+10,388],fill=(210,225,255,255))
        d.arc([cx+ex-38,320,cx+ex+38,424],195,345,fill=ink,width=5)  # upper lash thick
        for l in range(3):  # lower lashes
            d.line([(cx+ex-20+l*14,412),(cx+ex-22+l*14,424)],fill=ink,width=2)
        d.arc([cx+ex-40,282,cx+ex+40,324],200,340,fill=(110,72,52,255),width=5)  # brow
    d.arc([cx-26,450,cx+26,490],15,165,fill=(175,80,82,255),width=4)  # mouth
    # blush
    for ex in [-100,100]:
        b=Image.new("RGBA",(w,h),(0,0,0,0)); bd=ImageDraw.Draw(b)
        bd.ellipse([cx+ex-26,430,cx+ex+26,458],fill=(255,150,160,110))
        im=Image.alpha_composite(im,b.filter(ImageFilter.GaussianBlur(6))); d=ImageDraw.Draw(im)
    # front bangs w/ strand line-art
    fm=Image.new("L",(w,h),0); fd=ImageDraw.Draw(fm)
    fd.polygon([(cx-205,235),(cx+205,235),(cx+160,360),(cx+88,310),(cx+44,368),
                (cx-22,315),(cx-84,372),(cx-138,312),(cx-205,360)],fill=255)
    fd.rectangle([cx-208,80,cx+208,250],fill=255)
    bang=np.zeros((h,w,4),np.uint8); yy=np.linspace(0,1,h)[:,None]
    for c,(a1,a2) in enumerate([(150,110),(95,60),(200,150),(255,255)]):
        bang[:,:,c]=np.repeat(a1+(a2-a1)*yy,w,axis=1) if c<3 else 255
    bangs=Image.fromarray(bang); bangs.putalpha(fm.filter(ImageFilter.GaussianBlur(1.2)))
    # strand lines on bangs
    bl=Image.new("RGBA",(w,h),(0,0,0,0)); bd=ImageDraw.Draw(bl)
    for i in range(70):
        x=cx-190+random.uniform(0,380); y0=random.uniform(90,240)
        length=random.uniform(80,180); pts=[(x+math.sin(t/60)*8,y0+t) for t in range(0,int(length),10)]
        bd.line(pts,fill=(95,55,140,200),width=2)
    im=Image.alpha_composite(im,bangs); im=Image.alpha_composite(im,bl.filter(ImageFilter.GaussianBlur(0.5)))
    im.save(f"{OUT}/sprite_hd_1024x1280.png")

# ---------- detailed anime background (line art + gradient + foliage) ----------
def bg(w=1280,h=720):
    t=np.linspace(0,1,h)[:,None]
    top=np.array([64,110,180.]); mid=np.array([150,180,220.]); hor=np.array([255,225,185.])
    sky=np.zeros((h,w,3))
    for c in range(3):
        a=np.where(t<0.55, top[c]+(mid[c]-top[c])*(t/0.55), mid[c]+(hor[c]-mid[c])*((t-0.55)/0.45))
        sky[:,:,c]=np.repeat(a,w,axis=1)
    im=img(sky)
    # sun + rays
    sun=Image.new("RGBA",(w,h),(0,0,0,0)); sd=ImageDraw.Draw(sun)
    sd.ellipse([w*.74-55,h*.26-55,w*.74+55,h*.26+55],fill=(255,246,220,255))
    im=Image.alpha_composite(im.convert("RGBA"),sun.filter(ImageFilter.GaussianBlur(30))).convert("RGB")
    d=ImageDraw.Draw(im)
    # detailed clouds (many arcs = line work)
    cl=Image.new("RGBA",(w,h),(0,0,0,0)); cd=ImageDraw.Draw(cl)
    for cx,cy,cw in [(0.18,0.2,340),(0.55,0.13,420),(0.86,0.24,300)]:
        for i in range(9):
            r=cw/2*random.uniform(.5,1); x=w*cx+random.uniform(-cw/3,cw/3); y=h*cy+random.uniform(-20,20)
            cd.ellipse([x-r,y-r*.55,x+r,y+r*.55],fill=(255,255,255,235-i*8))
    im=Image.alpha_composite(im.convert("RGBA"),cl.filter(ImageFilter.GaussianBlur(9))).convert("RGB")
    d=ImageDraw.Draw(im)
    rng=random.Random(9)
    # distant mountains (line art ridges)
    for layer,col in enumerate([(120,150,190),(85,120,165)]):
        pts=[(0,h*.62)]
        x=0
        while x<w:
            x+=rng.randint(60,140); pts.append((x, h*.62-rng.randint(0,90)+layer*30))
        pts+= [(w,h*.62),(w,h),(0,h)]
        d.polygon(pts,fill=col)
    # detailed houses/trees foreground (fine linework)
    yb=int(h*.68)
    d.rectangle([0,yb,w,h],fill=(120,140,95))
    for hx in range(40,w-80,rng.randint(120,200)):
        hw,hh=rng.randint(70,110),rng.randint(50,80)
        d.rectangle([hx,yb-hh,hx+hw,yb],fill=(235,225,205))
        d.polygon([(hx-8,yb-hh),(hx+hw+8,yb-hh),(hx+hw//2,yb-hh-rng.randint(30,50))],fill=(150,80,60))
        # window grid = fine detail
        for wy in range(yb-hh+10,yb-10,16):
            for wx in range(hx+8,hx+hw-10,18):
                d.rectangle([wx,wy,wx+9,wy+11],outline=(60,60,80),fill=(200,215,235) if rng.random()<.7 else (255,235,160))
    # tree line w/ individual canopy strokes
    for tx in range(10,w,rng.randint(60,110)):
        th=rng.randint(60,110); tw2=rng.randint(40,70)
        d.line([(tx,yb),(tx,yb-th)],fill=(80,60,40),width=6)
        for i in range(14):
            r=tw2/2*random.uniform(.5,1); ang=random.uniform(0,6.28); rr=random.uniform(0,tw2/2)
            x,y=tx+math.cos(ang)*rr, yb-th-15+math.sin(ang)*rr*.6
            d.ellipse([x-r,y-r*.7,x+r,y+r*.7],outline=(50,95,55),fill=(70,125,70) if i%2 else (90,150,80))
    im.save(f"{OUT}/bg_hd_1280x720.png")

sprite(); bg()
print("done")
