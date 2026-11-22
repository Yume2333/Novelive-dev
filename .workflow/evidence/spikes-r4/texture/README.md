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

## Round 3（定稿末行 × 两个模型）

末行只用最终采用的 FXB（`docs/visuals.md` 2.4 第 7 条原文；`node src/run_round3.mjs --print`
打出 T1 全文可核对），场景、参考图、quality high、images.edit 同首版，每个模型每场景一次：

- `gpt-image-2.6-sunburst`：请求 1024x1536 / 1536x864（同首版）
- `gpt-image-2.6-sunburst-4k`：按最大输出请求 2336x3504 / 3840x2160

产物 `gen/round3/<scene>--FXB--{sunburst,4k}.png`，raw，不做后处理。
复跑：`node src/run_round3.mjs [sunburst,4k] [T1,T2,T3]`。

2026-11-22 首跑：sunburst 三张成功（返回 1024x1536 / 1536x1024 / 1536x1024，T1 带 alpha，
每张输出 6240 token）；4k 三张均 400（中转未放行该模型走 images 端点）。
中转配置修好后补跑 4k 三张，全部成功：返回尺寸与请求一致（2336x3504 带 alpha /
3840x2160 / 3840x2160），输出 97800 / 83400 / 83400 token，每张约 58 秒。

对照页：`.venv/bin/python src/contact_round3.py` → `contact/round3-T{n}.png`，一行三格
（参考图 | sunburst | sunburst-4k），统一缩到同一高度（Lanczos），透明立绘铺浅灰底，标注原生尺寸。

## Round 4（参考图色调外溢 A/B，sunburst）

Round 3 出图整体偏紫（白桌布发紫）。两臂都换成 `docs/visuals.md` 2.5 的拼装：画风参考声明句（单数）
+ 内容段 + 构图 + 每角色一句颜色锁定句 + FXB；内容段里 `as in Image 1` 的服装引用改成直写，A/B 相同。

- A：2.5 声明句原文（含 `overall color treatment`）
- B：声明句去掉 `overall color treatment`，颜色锁定句后加调色板句：
  `The palette comes from the description: time of day, weather, light sources and the stated colors of objects decide the colors; white objects stay white. Keep the style reference's way of coloring, not its color cast.`

T1/T2/T3 × A/B × r1/r2 = 12 次，全部成功。`node src/run_round4.mjs --print T3 B` 打出全文。
对照页 `.venv/bin/python src/contact_round4.py` → `contact/round4-T{n}.png`
（参考图 | round3 旧声明 | A r1 | A r2 | B r1 | B r2），色偏指标写在 `contact/round4-metrics.tsv`。

色偏指标 B−G = 不透明像素平均蓝减平均绿（T3 另量桌布带）：

| 场景 | round3 | A r1 / r2 | B r1 / r2 |
|------|--------|-----------|-----------|
| T1 | +54 | +39 / +36 | +42 / +40 |
| T2 | +56 | +56 / +44 | +53 / +50 |
| T3 全图 | +38 | +38 / +31 | +42 / +39 |
| T3 桌布 | +34 | +39 / +28 | +32 / +39 |

结论：B 和 A 没有可分辨的差别，同臂两次之间的差距比 A/B 之间还大；目测 B 的桌布、雨天天空仍是淡紫。
2.5 声明句（A）相对旧声明在 T1 上色偏小一些，T2/T3 看不出。调色板句不采用。
三个场景的角色都穿紫/薰衣草色，色偏来自参考图还是来自内容本身，这一轮分不开。

## Round 5（色偏来源：带参考图 vs 不带）

不含紫色的暖色场景 W（黄昏木屋、橘光、白桌布、铜红发、芥黄毛衣），sunburst，1536x864，high，各 2 次：

- ref：`images.edit` + `ref/kokomi.png`，Round 4 A 臂的拼法（2.5 声明句 + 内容 + 颜色锁定句 + FXB）
- noref：`images.generate`，同一提示词去掉所有提到 Image 1 / 参考图的部分

`node src/run_round5.mjs`（`--print ref|noref` 打全文），4 次全部成功。对照页 `contact/round5-W.png`。

| 图 | 全图 B−G | 全图 R−B | 桌布 B−G |
|----|----------|----------|----------|
| noref r1 | −33 | +87 | −46 |
| noref r2 | −39 | +111 | −52 |
| ref r1 | −23 | +79 | −42 |
| ref r2 | −17 | +73 | −31 |

结论：带参考图整体往冷、往粉彩方向移（全图 B−G 约 +16，桌布约 +12），但画面仍是暖色，没有变紫。
Round 3/4 的整体发紫主要来自内容本身（角色都穿紫、雨天），参考图只是加重。
更明显的是角色发色：ref 两张的铜红头发偏向参考图的粉色（r2 最明显），饱和度也降了，
属于颜色锁定句没完全挡住的角色色串色。
