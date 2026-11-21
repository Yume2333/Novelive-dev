# spikes-r4/model-prompt — 模型 × 末行 2×2 对照实验

owner 结论：quality high 为新默认；clean-style G 臂（风格定向行 + high）观感好；
`gpt-image-2.6-sunburst` 比 flare 明显更好；D1/D2 后处理明显优于原图。
本实验把**模型**（flare vs sunburst）与**末行**（反破碎渲染块 vs 风格定向行）
做 2×2 交叉，全部 `images.edit`、`quality:"high"`、Image 1 = Torino 参考图，
角色线/构图/尺寸/透明立绘与 clean-style 完全一致。本目录只产图与对照表，
不做画风评判。

## 臂

| 臂 | 模型 | 末行 |
|----|------|------|
| FR | `gpt-image-2.6-flare`    | 反破碎渲染块（`RENDER`，见下） |
| FS | `gpt-image-2.6-flare`    | 风格定向行（clean-style C 臂原句，见下） |
| SR | `gpt-image-2.6-sunburst` | 反破碎渲染块 |
| SS | `gpt-image-2.6-sunburst` | 风格定向行 |

**RENDER（末行逐字）**：

```
large simple color masses, low visual frequency, restrained edge density, clear edge hierarchy, minimal internal contour lines, broad shadow shapes, suppress micro-texture and micro-contrast, no unnecessary specular highlights
```

**风格定向行（末行逐字，clean-style C 臂）**：

```
Rendering: keep the reference's glossy layered hair highlights, soft gradients and color richness. Line art is clean, smooth and continuous, drawn with confident strokes of even weight. Hair is grouped into clean ribbon-like strands with smooth color transitions; skin and fabric surfaces are smooth and clean, with folds drawn as a few clear shapes.
```

## 资产（10 个 × 4 臂 = 40 次调用，并发 ≤6，每资产 1 样张）

K1（心海立绘）、K4（海边 CG）、K6（夜雨 CG）、K7（战斗 CG）、K8（神社背景）、
C1 雷电将军、C2 纳西妲、C3 芙宁娜、C5 胡桃（均立绘 transparent）、
G2（下午茶 CG；Image 2/3 = **该臂自己的** C2/C3 立绘原图，G2 在同臂立绘之后跑）。
内容段全部复用 `src/prompts.mjs` 的 `buildPrompt(id,'A')` + 末行。

## 运行

```bash
cd .workflow/evidence/spikes-r4/model-prompt
source <env-file>            # NL_IMAGE_BASE_URL / NL_IMAGE_API_KEY
export REALESRGAN_BIN=<path-to>/realesrgan-ncnn-vulkan
export REALESRGAN_MODELS=<path-to>/models
node src/run.mjs             # 40 次 edit 调用 -> gen/<asset>--<arm>.png
node src/postproc.mjs        # 每个原图 -> -D1.png / -D2.png
.venv/bin/python src/contact.py
```

环境变量（**无默认值，必须显式设置**；密钥与 relay 地址只走 env，不落文件）：

- `NL_IMAGE_BASE_URL`、`NL_IMAGE_API_KEY`：图像 API 接入（openai SDK）。
- `REALESRGAN_BIN`：Real-ESRGAN ncnn-vulkan 可执行文件路径。
- `REALESRGAN_MODELS`：其 models 目录（含 realesrgan-x4plus-anime /
  realesr-animevideov3-x4 的 .bin/.param）。

`results.jsonl` 每行：fn/kind/asset/arm/model/req_size/params(含 prompt)/ms/
usage/actual_size/has_alpha/错误分类；`kind:"postproc"` 记 D1/D2 模型、耗时与
alpha 是否保留；`kind:"probe"` 记各模型探测结果。

## 后处理（每张原图两套，原图保留）

- `-D1` = `realesrgan-x4plus-anime` ×4 → sharp Lanczos3 缩回原尺寸
- `-D2` = `realesr-animevideov3-x4`   ×4 → sharp Lanczos3 缩回原尺寸

立绘 RGBA 作为单图输入，实测 RGBA→RGBA alpha 保留（results.jsonl 逐张记录）。

## 产物

- `gen/<asset>--<arm>.png`：原始返回；`gen/<asset>--<arm>-D1.png` / `-D2.png`：后处理
- `contact/<asset>.jpg`（JPEG q92）：左侧参考图；2×2 臂网格（行=flare/sunburst，
  列=渲染块/风格行，每格 D1 全图，标 FR-D1 等）；下方 crops 条 = 每臂
  raw/D1/D2 同一 512×512 头发+脸区域（相对坐标，按 FS 原图选区）共 12 格
- `contact/overview-D1.jpg`：行=资产，列=4 臂，D1 版本，左上角参考图
- `contact/crops-D1.jpg`：同布局，仅 D1 crops
- 立绘在对照图中合成到浅灰底
