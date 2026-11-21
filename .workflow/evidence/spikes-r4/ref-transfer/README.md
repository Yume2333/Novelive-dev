# spikes-r4/ref-transfer — 换参考图：自产参考图的风格迁移与清理

owner 更换参考图：弃用 Torino，改用 4 张上一轮自产图作 Image 1
（`ref/R1..R4.png`，拷贝自 model-prompt 产出，均 gitignore）。
固定：model `gpt-image-2.6-sunburst`、`quality:"high"`、`images.edit`、
Image 1 = 该 ref（单图，无角色参考）、原生尺寸（1536x864 / 1024x1536）、
每个产出过 D1（realesrgan-x4plus-anime ×4 → Lanczos3 回原尺寸）。
本目录只产图与对照表，不做画风评判。

## 参考图（ref/，均为本仓库前一轮自产）

| ref | 来源 | 内容 | 尺寸/alpha |
|-----|------|------|-----------|
| R1 | model-prompt `gen/C1--SS-D1.png` | 雷电将军立绘 | 1024x1536 RGBA |
| R2 | model-prompt `gen/G2--FR-D1.png` | 心海×纳西妲×芙宁娜下午茶 | 1536x1024 RGB |
| R3 | model-prompt `gen/K4--FR-D1.png` | 心海海边日落 CG | 1672x941 RGB |
| R4 | model-prompt `gen/K7--SS-D2.png` | 心海水母战斗 CG | 1672x941 RGB |

## 每 ref 两个任务（共 3 张 × 7 臂 × 4 ref = 84 次调用）

**CLEAN**（重画 ref 本身 —— 测能否清掉 ref 自身的断线/噪点）：
prompt =
`Redraw Image 1 as the same picture: the same characters, pose, expression,
composition, colors and framing.`（R1 追加 `Fully transparent background,
no ground or shadow.`）+ 末行。尺寸 = ref 纵横（R1 1024x1536，余 1536x864）。

**TRANSFER**（真实管线用法：ref 只当画风，画新内容）：
角色行 = `ROLE_BASE` +（目标与 ref 都是心海时 `ROLE_KOKOMI`，否则
`ROLE_OTHER`）+ `CONTENT[id]`（+ 立绘 `FRAME_SPRITE`）+ 末行。

| ref | TRANSFER-a | TRANSFER-b |
|-----|-----------|-----------|
| R1 | C5 胡桃立绘 | K8 珊瑚宫背景 |
| R2 | K6 心海雨夜 | C3 芙宁娜立绘 |
| R3 | K1 心海立绘 | K8 珊瑚宫背景 |
| R4 | C1 雷电将军立绘 | K6 心海雨夜 |

## 臂（末行；N = 无末行）

| 臂 | 末行（逐字；S5 每 ref 不同，见下） |
|----|----------------------------------|
| N | —（不加末行） |
| S0 | `Rendering: keep the reference's glossy layered hair highlights, soft gradients and color richness. Line art is clean, smooth and continuous, drawn with confident strokes of even weight. Hair is grouped into clean ribbon-like strands with smooth color transitions; skin and fabric surfaces are smooth and clean, with folds drawn as a few clear shapes.` |
| S1 | `Finish: the same rendering as Image 1, cleanly finished.` |
| S2 | `Line art is clean, smooth and continuous, drawn with confident strokes of even weight. Hair is grouped into clean ribbon-like strands with smooth color transitions; skin and fabric surfaces are smooth and clean, with folds drawn as a few clear shapes.` |
| S3 | `Finish this as a final, fully cleaned-up illustration: inked line art with no sketch lines, stray hairs or broken strokes; flat base colors with smooth airbrushed gradients; highlights placed as a few clean, deliberate shapes, as in Image 1.` |
| S4 | S0 全文 + ` Put fine detail only on the face, eyes, hair ornaments and the main object of the scene; keep clothing folds, background and secondary areas simpler, with fewer lines.` |
| S5 | `<本 ref 的画风描述>` + S2 全文 |

### S5 每 ref 的画风描述（逐字，写在 S2 之前）

- **R1**：`Rendering as in Image 1: soft anime illustration, delicate thin colored line art, purple-lavender palette with gold accents, smooth painterly gradient shading, diffuse violet-blue sheen along the hair strands, detailed violet eyes with glossy catchlights, soft diffused frontal light. `
- **R2**：`Rendering as in Image 1: soft anime illustration, very fine low-contrast colored line art, bright pastel palette, smooth gradients with soft-edge cel shading, glowing translucent hair highlights, jewel-like detailed eyes, diffused bright daylight. `
- **R3**：`Rendering as in Image 1: soft anime illustration, extremely thin soft colored line art, pastel sunset palette, smooth airbrushed gradient shading, diffused hair sheen, detailed blue-violet eyes, warm golden-hour backlight. `
- **R4**：`Rendering as in Image 1: soft anime illustration, very fine tinted line art, cool indigo-cyan palette, smooth airbrushed gradients with glowing accents, crisp cyan light streaks in the hair, intricate violet eyes, ethereal bioluminescent light. `

## 运行

```bash
cd .workflow/evidence/spikes-r4/ref-transfer
source <env-file>            # NL_IMAGE_BASE_URL / NL_IMAGE_API_KEY
export REALESRGAN_BIN=<path-to>/realesrgan-ncnn-vulkan
export REALESRGAN_MODELS=<path-to>/models
node src/run.mjs             # 84 次 edit -> gen/<ref>-<task>--<arm>.png
node src/postproc.mjs        # -> -D1.png（同时产 -D2，对照只用 D1）
.venv/bin/python src/contact.py
```

环境变量无默认值（同 style-line/README）。`results.jsonl` 行格式同前
（meta 含 ref/task/arm/prompt）。

## 产物

- `gen/<ref>-<task>--<arm>.png` 原图 + `-D1.png` / `-D2.png`
- `contact/R{n}.jpg`：3 行（CLEAN / TRANSFER-a / TRANSFER-b），每行
  左 ref + N,S0..S5 D1 全图（中文小标题）；每行下方为同一相对区域
  512px 脸/头发 crop 条（CLEAN 行用 ref 自身的脸区，直接对照清理效果）
- `contact/overview-clean.jpg`：4 ref 的 CLEAN 行
- `contact/overview-transfer.jpg`：8 个 transfer 行
- 立绘合成到浅灰底
