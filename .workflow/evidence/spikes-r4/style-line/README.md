# spikes-r4/style-line — 末行（风格定向句）措辞优化

owner 结论：采用 model-prompt 的 **SS + D1**（sunburst + 风格定向行 + high + D1 后处理）。
本轮只改**最后一行**的措辞，其它全部固定：model `gpt-image-2.6-sunburst`、
`quality:"high"`、`images.edit`、Image 1 = Torino 参考图、角色线 + 内容段 +
构图行与 model-prompt SS 逐字相同、原生尺寸（CG 1536x864 / 立绘 1024x1536）、
G2 的 Image 2/3 固定为 model-prompt 已生成的 `C2--SS.png` / `C3--SS.png`
（拷入 `ref/C2.png` `ref/C3.png`，各臂同一对）。每个产出过 D1
（realesrgan-x4plus-anime ×4 → Lanczos3 回原尺寸）。本目录只产图与对照表，
不做画风评判。

## 资产（5 × 7 = 35 次调用，并发 ≤6，每资产 1 样张）

K1（心海立绘）、K4（海边 CG）、K7（战斗 CG）、C3（芙宁娜立绘）、
G2（下午茶 CG）。

## 臂（仅末行不同；S6 位置不同）

| 臂 | 测什么 | 末行（逐字） |
|----|--------|--------------|
| S0 | 基线/采样噪声（与上轮 SS 同 prompt） | `Rendering: keep the reference's glossy layered hair highlights, soft gradients and color richness. Line art is clean, smooth and continuous, drawn with confident strokes of even weight. Hair is grouped into clean ribbon-like strands with smooth color transitions; skin and fabric surfaces are smooth and clean, with folds drawn as a few clear shapes.` |
| S1 | 极简收尾指令 | `Finish: the same rendering as Image 1, cleanly finished.` |
| S2 | S0 去掉首句（只留"干净"指令） | `Line art is clean, smooth and continuous, drawn with confident strokes of even weight. Hair is grouped into clean ribbon-like strands with smooth color transitions; skin and fabric surfaces are smooth and clean, with folds drawn as a few clear shapes.` |
| S3 | "成稿/清稿"措辞 | `Finish this as a final, fully cleaned-up illustration: inked line art with no sketch lines, stray hairs or broken strokes; flat base colors with smooth airbrushed gradients; highlights placed as a few clean, deliberate shapes, as in Image 1.` |
| S4 | 细节分主次 | S0 全文 + ` Put fine detail only on the face, eyes, hair ornaments and the main object of the scene; keep clothing folds, background and secondary areas simpler, with fewer lines.` |
| S5 | 具体画风描述 + S2 | `Rendering as in Image 1: soft anime illustration, thin colored line art, airy pastel palette, smooth airbrushed gradient shading, glossy layered hair highlights, large eyes with bright iris reflections, soft glowing light. ` + S2 全文 |
| S6 | 位置：风格句放在角色行之后（内容段之前），末尾不加 | —（S0 文本插到 buildPrompt 第二行） |

## 运行

```bash
cd .workflow/evidence/spikes-r4/style-line
source <env-file>            # NL_IMAGE_BASE_URL / NL_IMAGE_API_KEY
export REALESRGAN_BIN=<path-to>/realesrgan-ncnn-vulkan
export REALESRGAN_MODELS=<path-to>/models
node src/run.mjs             # 35 次 edit 调用 -> gen/<asset>--<arm>.png
node src/postproc.mjs        # 每个原图 -> -D1.png（脚本同时产 -D2，对照只用 D1）
.venv/bin/python src/contact.py
```

环境变量（无默认值）：`NL_IMAGE_BASE_URL`、`NL_IMAGE_API_KEY`、`REALESRGAN_BIN`、
`REALESRGAN_MODELS`（同 model-prompt/README）。

`results.jsonl` 行格式同 model-prompt；`kind:"postproc"` 记 D1/D2 模型、耗时、
alpha 保留。

## 产物

- `gen/<asset>--<arm>.png` 原图；`-D1.png` / `-D2.png` 后处理
- `contact/<asset>.jpg`：左 = 参考图；一行 8 列 = S0上轮（model-prompt SS-D1）+
  S0..S6 的 D1 全图，中文小标题；下方 crops 条 = 同 8 列同一相对区域
  512×512 头发+脸 crop
- `contact/overview.jpg`：行 = 资产，列 = 8 列，D1 版本，左上参考图
- `contact/crops.jpg`：同布局仅 crops
- 立绘合成到浅灰底
