# spikes-r4/texture — 抑制"鱼鳞纹"（层叠斑驳色块）且不失质感

owner：产物大面积区域（布料、皮肤、墙、天、地）出现层叠斑驳/重复点触的
"鱼鳞纹"，但丝缎光泽、褶皱、布料量感要保留，画风也不能丢。
同 single-ref 的固定配置（`ref/kokomi.png` 单图、sunburst、quality high、
images.edit、原生尺寸、每产出 D1、拒绝去名重试一次）。
场景沿用 single-ref T1/T2/T3，仅两处内容改动：
- T1：`long wide sleeves in pale lavender with a faint purple pattern`
  → `long wide sleeves in pale lavender silk`
- T3：`a green leaf-pattern capelet and gold trim`
  → `a green capelet with leaf-shaped edges and gold trim`
本目录只产图与对照表，不做画风评判。

## 文本件

- `S3`、`H`、`E` = style-branch README 逐字（E 仅那句附加句）。
- `F` = S3 + ` ` + H + ` ` + E
- `RENDER` = model-prompt 的反破碎块逐字：`large simple color masses, low
  visual frequency, restrained edge density, clear edge hierarchy, minimal
  internal contour lines, broad shadow shapes, suppress micro-texture and
  micro-contrast, no unnecessary specular highlights`
- `R` = `On large surfaces — fabric, skin, walls, sky and ground — keep large simple color masses with low visual frequency, and suppress micro-texture and micro-contrast inside them; show the material through sheen, folds and soft gradients instead. Hair highlights, eyes and the gradients of Image 1 stay as they are.`
- `N` = `Fabric still reads as its material — silk sheen, soft folds, the weight of the cloth — but no surface carries mottled, layered fish-scale smudges, repeated dabs or crackle marks; each area of color is one continuous, smooth gradient.`
- `X` = RENDER + `, except that hair highlights, eyes and the gradients of Image 1 stay exactly as in Image 1.`

## 臂（末行，件间一个空格）

| 臂 | 末行 | 测什么 |
|----|------|--------|
| F | S3 + H + E | 融合版基线 |
| F+R | F + R | 正面写"大面低压纹理 + 材质靠光泽/褶皱/渐变" |
| F+N | F + N | 直接点名鱼鳞纹/斑驳/龟裂，同时声明材质保留 |
| F+X | F + X | 整段反破碎块 + 例外（高光/眼睛/参考图渐变除外） |
| F+R+N | F + R + N | R 与 N 两句都加 |

对照：**OLD** = 仅 T1，F + 旧内容段（`faint purple pattern`），2 次，
测改动前后同一句式的差异。

## 运行

```bash
cd .workflow/evidence/spikes-r4/texture
source <env-file>            # NL_IMAGE_BASE_URL / NL_IMAGE_API_KEY
export REALESRGAN_BIN=<path-to>/realesrgan-ncnn-vulkan
export REALESRGAN_MODELS=<path-to>/models
node src/run.mjs             # 32 次 edit -> gen/<scene>--<arm>--r{1,2}.png（OLD->--OLD--）

node src/postproc.mjs        # -> -D1.png，删 work/ 中间文件
.venv/bin/python src/contact.py
```

环境变量无默认值。

## 产物（PNG，不重采样）

- `gen/…` 原图 + `-D1.png`
- `contact/T{n}.png`：臂列 × 2 行（T1 多一列 OLD），标 `中文标题 + 实际尺寸`
- `contact/T{n}/`：D1 图查看顺序 `01-F-1 …`；`contact/T{n}-raw/`：同名 raw 图
- `contact/ref.png`

## Round 2（补跑）

首版之上追加 T1/T3：`F+X` 两次（`--r3`/`--r4`，与上轮 r1/r2 区分）与新臂
`F+X+N` 两次（`--r1`/`--r2`）。`F+X+N` 末行 = F + ` ` + X + ` ` + N
（N 全文见上表）。对照页 `contact/round2-T{n}.png`（一行 6 格：F+X 上轮
两次、F+X 本轮两次、F+X+N 两次，全 D1，原像素）；翻页目录
`contact/round2-T{n}/`（D1）与 `contact/round2-T{n}-raw/`（raw）。
复跑命令：`node src/run.mjs 'F+X' 'T1,T3' 'r3,r4'` 与
`node src/run.mjs 'F+X+N' 'T1,T3' 'r1,r2'`，再 `node src/postproc.mjs`、
`.venv/bin/python src/contact_round2.py`。
