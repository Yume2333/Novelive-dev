# spikes-r4/single-ref — 单参考图：3 场景 × 8 末行 × 2 次

owner：上一轮差异太小看不清，怀疑测试例问题。本轮只放**一张参考图**
（`ref/kokomi.png`，第三方图，gitignore，不提交不写出处）跑 3 个场景，
沿用 style-branch 的 8 个末行臂，每格跑 2 次测重复性。
固定：`gpt-image-2.6-sunburst` / `quality:"high"` / `images.edit` /
Image 1 = `ref/kokomi.png`（单图）/ 原生尺寸 / 每产出 D1。拒绝时做一次
去名重试并记录。本目录只产图与对照表，不做画风评判。

## 场景（角色行 + 内容段 + FRAME_SPRITE(立绘) + 末行）

**T1 雷神立绘**（1024x1536，transparent）：
`Image 1 is the style reference: draw in exactly the same art style, line
quality, coloring, shading and level of detail. Do not copy the character in
Image 1.` + 内容（Raiden Shogun 立绘细节，逐字见 `src/run.mjs` SCENES.T1）
+ `FRAME_SPRITE` + 末行。

**T2 心海雨中持伞**（1536x864）：
同上角色行 + ` The character in Image 1 is Sangonomiya Kokomi; keep her
face, hair and outfit the same.` + 内容（珊瑚宫细雨参道、心海持伞，逐字见
`src/run.mjs` SCENES.T2）+ 末行。

**T3 心海草神雷神茶会**（1536x864）：
同上心海角色行 + 内容（三角色下午茶，逐字见 `src/run.mjs` SCENES.T3）+ 末行。

## 臂（8，末行逐字，与 style-branch 相同）

| 臂 | 末行 |
|----|------|
| S4 | S0 + ` Put fine detail only on the face, eyes, hair ornaments and the main object of the scene; keep clothing folds, background and secondary areas simpler, with fewer lines.` |
| A | `Rendering: keep the reference's glossy layered hair highlights, soft gradients and color richness.` + ` ` + H |
| B | S0 + ` Detail falls off with distance from the face, or from the main object when there is no character: the face, eyes and hair highlights carry the finest detail; ornaments and hands a little less; clothing folds are a few broad shapes; the background is the simplest, with large calm areas and few lines.` |
| C | S0 + H + ` The background is painted softer and simpler than the characters, with fewer edges and lower contrast, so the characters have the crispest lines in the picture; when there is no character, the main object takes that role.` |
| S34 | S3 + ` ` + H |
| M | S0 + H + ` Fabric, armor and other materials are flat color with a few shading shapes, without printed patterns, weave texture or tiny repeated marks.` |
| P | S0 + H + ` The picture is viewed on a 1080p screen: the smallest details are still several pixels wide, and areas too small to read stay as plain color.` |
| E | S0 + H + ` Every outline is one clean stroke, not several sketchy ones; hair strands end in clean tapered points; lines never break or wobble.` |

其中 S0 = `Rendering: keep the reference's glossy layered hair highlights, soft
gradients and color richness. Line art is clean, smooth and continuous, drawn
with confident strokes of even weight. Hair is grouped into clean ribbon-like
strands with smooth color transitions; skin and fabric surfaces are smooth and
clean, with folds drawn as a few clear shapes.`
S3 = `Finish this as a final, fully cleaned-up illustration: inked line art with
no sketch lines, stray hairs or broken strokes; flat base colors with smooth
airbrushed gradients; highlights placed as a few clean, deliberate shapes, as in
Image 1.`
H = `Put fine detail only on the face, eyes, hair ornaments and the main object
of the scene; keep clothing folds, background and secondary areas simpler, with
fewer lines.`

## 运行

```bash
cd .workflow/evidence/spikes-r4/single-ref
source <env-file>            # NL_IMAGE_BASE_URL / NL_IMAGE_API_KEY
export REALESRGAN_BIN=<path-to>/realesrgan-ncnn-vulkan
export REALESRGAN_MODELS=<path-to>/models
node src/run.mjs             # 48 次 edit -> gen/<scene>--<arm>--r{1,2}.png
node src/postproc.mjs        # -> -D1.png，删 work/ 中间文件
.venv/bin/python src/contact.py
```

环境变量无默认值。

## 产物（PNG，不重采样）

- `gen/<scene>--<arm>--r{1,2}.png` 原图 + `-D1.png`
- `contact/T{n}.png`：8 臂列 × 2 行（第 1 次/第 2 次），图按原始像素贴入
  最大格，小图居中，标 `臂名 + 实际尺寸`
- `contact/T{n}/`：D1 图按查看顺序改名 `01-S4-1.png, 02-S4-2.png,
  03-A-1.png …`，可在看图软件里同缩放逐张翻
- `contact/ref.png`：参考图副本
