# spikes-r4/style-branch — S3/S4 分支细化与新方向

owner 结论：ref-transfer 中 **S3（成稿措辞）与 S4（S0+细节分主次）整体最好，
S4 尤佳**。本轮细化这两条分支并在 S4 之上试新方向。
固定配置同 ref-transfer：sunburst / quality high / images.edit / Image 1 =
`ref/R{n}.png` / 原生尺寸 / 每产出 D1（postproc.mjs 现只产 D1 并删除 work/
中间文件）。任务 = 每 ref 的 CLEAN + 同两个 TRANSFER（R1→C5,K8；R2→K6,C3；
R3→K1,K8；R4→C1,K6）。唯一改动：R2→K6 角色行改为指明"Image 1 左边女孩是
心海"（R2 为三人图，见下）。本目录只产图与对照表，不做画风评判。

## 文本件

- `S0`（现行句）= ref-transfer README 的 S0 全文（三段：keep 高光/渐变/色彩 →
  线稿干净 → 发丝成缎面/衣褶简化为几块形状）。
- `S3`（成稿措辞）= ref-transfer 的 S3 全文。
- `H` = `Put fine detail only on the face, eyes, hair ornaments and the main object of the scene; keep clothing folds, background and secondary areas simpler, with fewer lines.`
- `KEEP` = `Rendering: keep the reference's glossy layered hair highlights, soft gradients and color richness.`

## 臂（8；末行逐字，件与件之间一个空格）

| 臂 | 测什么 | 末行（逐字） |
|----|--------|--------------|
| S4 | 锚点重跑（量采样噪声） | S0 + ` ` + H |
| A | 只留保留句+主次 | KEEP + ` ` + H |
| B | 细节随距离递减 | S0 + ` Detail falls off with distance from the face, or from the main object when there is no character: the face, eyes and hair highlights carry the finest detail; ornaments and hands a little less; clothing folds are a few broad shapes; the background is the simplest, with large calm areas and few lines.` |
| C | 背景更柔更简 | S0 + ` ` + H + ` The background is painted softer and simpler than the characters, with fewer edges and lower contrast, so the characters have the crispest lines in the picture; when there is no character, the main object takes that role.` |
| S34 | 成稿 + 主次 | S3 + ` ` + H |
| M | 材质简化 | S0 + ` ` + H + ` Fabric, armor and other materials are flat color with a few shading shapes, without printed patterns, weave texture or tiny repeated marks.` |
| P | 按屏幕尺度限细节 | S0 + ` ` + H + ` The picture is viewed on a 1080p screen: the smallest details are still several pixels wide, and areas too small to read stay as plain color.` |
| E | 线条收尾 | S0 + ` ` + H + ` Every outline is one clean stroke, not several sketchy ones; hair strands end in clean tapered points; lines never break or wobble.` |

R2→K6 的角色行（替换 ROLE_KOKOMI）：`Image 1 is the style reference: draw in
exactly the same art style, line quality, coloring, shading and level of detail.
The girl on the left in Image 1 is Sangonomiya Kokomi; keep her face and hair
the same.`

## 运行

```bash
cd .workflow/evidence/spikes-r4/style-branch
source <env-file>            # NL_IMAGE_BASE_URL / NL_IMAGE_API_KEY
export REALESRGAN_BIN=<path-to>/realesrgan-ncnn-vulkan
export REALESRGAN_MODELS=<path-to>/models
node src/run.mjs             # 96 次 edit -> gen/<ref>-<task>--<arm>.png
node src/postproc.mjs        # -> -D1.png，删除 work/ 中间文件
.venv/bin/python src/contact.py
```

环境变量无默认值（同 ref-transfer/README）。

## 产物

- `gen/<ref>-<task>--<arm>.png` 原图 + `-D1.png`
- `contact/R{n}.jpg`：3 任务行 × (ref + S4上轮 + S4,A,B,C,S34,M,P,E 的 D1
  全图，中文小标题)；每行下方同一相对区域 512px crop 条
- `contact/overview-clean.jpg`、`contact/overview-transfer.jpg`
