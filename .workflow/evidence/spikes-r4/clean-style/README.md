# spikes-r4/clean-style — 保画风去纹理实验

问题（owner 结论）：genshin-style 的 A 臂（Torino 参考图风格迁移）画风对但有
「恶心的微观纹理、抖动/断续线条」（集中在头发与布料）；B 臂（A+反破碎渲染块）
压掉了纹理但也压平了画风（高光/渐变/色彩变 generic anime）。
本实验尝试在**保住 A 画风**的前提下去掉纹理/抖动/断线。
本目录只产图与对照表，不做画风评判。

## 资产

K1（心海立绘）、K4（海边日落 CG）、K6（夜雨街道 CG）、C1（雷电将军立绘）、
C3（芙宁娜立绘）、G2（心海×纳西妲×芙宁娜下午茶 CG，Image 2/3 = C2/C3 立绘，
非重跑臂用 A 立绘）。内容段全部复用 `../genshin-style/src/prompts.mjs` 的
`buildPrompt(id,'A')`。每资产 1 样张。

## 臂

| 臂 | 含义 | 调用 |
|----|------|------|
| A | genshin-style `gen/<asset>--A.png` 原样拷贝 | 0 |
| B | genshin-style `gen/<asset>--B.png` 原样拷贝 | 0 |
| C | A prompt + 定向渲染行（末行，原文见下） | edit |
| D1 | A → `realesrgan-x4plus-anime` ×4 → Lanczos3 缩回原尺寸 | 本地 |
| D2 | A → `realesr-animevideov3-x4` ×4 → Lanczos3 缩回原尺寸 | 本地 |
| E | edit 清理：Image1=A 图, Image2=Torino 参考, 清理 prompt（见下） | edit |
| F | A prompt + `quality:"high"`（A 臂无 quality 参数 = 默认） | edit |
| G | C prompt + `quality:"high"` | edit |
| H | A prompt + model=`gpt-image-2.6-sunburst`（先 probe） | edit |

API 调用均 `images.edit`，参考图 `ref/kokomi-torino-white.png`（白底版），
尺寸/transparent 与原资产一致；并发 ≤6；共最多 30 次。

## Prompt（除资产内容段外）

**C 臂追加行**（拼在 A prompt 最后，单独一行）：

```
Rendering: keep the reference's glossy layered hair highlights, soft gradients and color richness. Line art is clean, smooth and continuous, drawn with confident strokes of even weight. Hair is grouped into clean ribbon-like strands with smooth color transitions; skin and fabric surfaces are smooth and clean, with folds drawn as a few clear shapes.
```

**E 臂 prompt**（Image 1 = A 产物，Image 2 = 参考图）：

```
Image 1 is the illustration to clean up. Image 2 is the style reference. Redraw Image 1 with the same composition, characters, pose, colors, lighting and hair highlights, matching Image 2's rendering. Replace all wobbly, broken or sketchy lines with clean smooth continuous lines, and replace grainy or noisy texture in hair, skin and fabric with smooth clean color and gradients.
```

尺寸与 background 与该资产 A 调用一致（立绘 1024x1536+transparent，
CG 1536x864）。H 臂 prompt 与 A 逐字相同，仅 model 换成
`gpt-image-2.6-sunburst`。

## D 后处理

二进制与模型用 Real-ESRGAN ncnn-vulkan 发行版（github.com/xinntao/Real-ESRGAN-ncnn-vulkan，`$REALESRGAN_DIR` 指向解压目录，models 在其下）：

```bash
# D1
$REALESRGAN_DIR/realesrgan-ncnn-vulkan -i gen/<a>--A.png -o work/<a>-D1-up.png \
  -m $REALESRGAN_DIR/models -n realesrgan-x4plus-anime -s 4 -f png
# D2
$REALESRGAN_DIR/realesrgan-ncnn-vulkan -i gen/<a>--A.png -o work/<a>-D2-up.png \
  -m $REALESRGAN_DIR/models -n realesr-animevideov3-x4 -s 4 -f png
# 再 sharp lanczos3 resize 回 A 原始尺寸（见 src/postproc.mjs）
```

立绘 RGBA 作为单图输入，实测 RGBA→RGBA alpha 保留。

## 重跑

```bash
cd .workflow/evidence/spikes-r4/clean-style
source /tmp/nl-img/.env        # NL_IMAGE_BASE_URL/NL_IMAGE_API_KEY/NL_IMAGE_MODEL
node src/run.mjs               # C,E,F,G,H 五臂（含 sunburst probe）
node src/postproc.mjs          # D1/D2
.venv/bin/python src/contact.py
```

`results.jsonl` 每行：fn/kind/asset/arm/req_size/params(含 prompt)/ms/usage/
actual_size/has_alpha/错误分类；`kind:"postproc"` 行记 D 臂模型与耗时；
`kind:"probe"` 行记 sunburst 是否被接受。

## 产物

- `gen/<asset>--<arm>.png`：原始返回/后处理产物，不裁剪
- `contact/<asset>.jpg`：上行 = ref+A..H 全图；下行 = 各臂同一相对区域的
  512×512 100% crop（头发+脸，区域按 A 图相对坐标映射到各臂实际尺寸）
- `contact/crops-all.jpg`：仅 crop，行=资产，列=臂
- 立绘在对照图中合成到浅灰底
