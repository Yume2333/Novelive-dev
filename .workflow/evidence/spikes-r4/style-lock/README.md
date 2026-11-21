# spikes-r4/style-lock — 参考图能否锁住画风？

问题：生产管线把主视觉作为 Image 1 传给 `images.edit`，画风到底锁不锁得住？
本轮用一张第三方同人图（`ref/kokomi-torino.png`，画师 とりの / Torino，
《原神》心海同人，1198×2020 RGBA）当「主视觉」，测 5 种提示词臂。

**图片不入库**：参考图是第三方画作，`ref/`、`gen/`、`contact/`、`run.log`
全部 gitignore；只有代码、本文件、`results.jsonl`（参数/延迟/usage/实际尺寸/错误）
被跟踪。

## 臂位（每资产 2 样张，并发 ≤6）

| 臂 | 调用 | 提示词内容 |
|----|------|-----------|
| T0 | `generate`（无参考） | 素材类型句 + 内容段 + 取景/约束 + S |
| R0 | `edit`，Image 1 = 参考图 | 参考图声明句 + 类型句 + 内容段 + 取景/约束（无 S、无渲染块） |
| R1 | `edit` | R0 + S + 渲染块（当前管线形态） |
| R2 | `edit` | R0 + S（无渲染块） |
| R3 | `edit` | R0 + 渲染块（无 S） |

固定句（`src/prompts.mjs` 原文）：

- 参考图声明句：`Image 1 is the style reference: match its rendering, line quality, palette treatment and level of detail; do not copy its character, outfit or pose.`
- S（看参考图自写的画风描述，≤50 词）：`Style: soft anime illustration; thin colored line art; airy pastel lavender-blue palette; smooth airbrushed gradient shading; glossy layered hair highlights; large detailed eyes with bright iris reflections; soft glowing light effects.`
- 渲染块：`large simple color masses, low visual frequency, restrained edge density, clear edge hierarchy, minimal internal contour lines, broad shadow shapes, suppress micro-texture and micro-contrast, no unnecessary specular highlights`

## 资产

| 资产 | 尺寸 | 透明底 | 内容段 |
|------|------|--------|--------|
| a1-sprite | 1024×1536 | 是 | 原创现代少女：黑色短波波头、琥珀色眼、米色风衣罩白毛衣、手拿纸杯咖啡；头顶到膝上、腿被底边裁断 |
| a2-xiangzi | 1024×1536 | 是 | 祥子（《骆驼祥子》车夫短打，外貌原文取自 r3 `briefs.mjs` CHAR.xiangzi/OUTFITS.puller），同一取景 |
| a3-seaside | 1536×864 | 否 | 傍晚海滨小镇空街，无人，主体在中央 4:3 区 |
| a4-cafe-cg | 1536×864 | 否 | A1 同一人雨夜坐咖啡馆窗边望窗外，主体中央 4:3 区 |

## 精确提示词

`src/prompts.mjs` 是唯一 prompt 源；拼装顺序 = 参考图声明句 →
素材类型句 → 内容段 → 取景/约束 → S → 渲染块（按臂裁剪）。逐字文本：

### a1-sprite

类型句：`Asset type: character base sprite for a visual novel.`

内容段：`An original modern girl in her late teens: short black bob with straight bangs, amber eyes, gentle calm face. She wears a beige trench coat over a white sweater, dark trousers, and holds a paper coffee cup in one hand. Natural standing pose, quiet expression.`

尾段：`Framing: from the top of the head to just above the knees, legs cut off by the bottom edge; character centered, small headroom margin, vertical orientation. Fully transparent background; no ground, no shadow, no border, no text; semi-transparent edge pixels carry colors continuous with the adjacent cloth or skin.`

- **T0**：类型句 → 尾段前的「内容段 → 尾段」→ S（顺序：type / content / tail / S，见下）
  ```
  Asset type: character base sprite for a visual novel.
  <内容段>
  <尾段>
  <S>
  ```
- **R0**：
  ```
  <参考图声明句>
  Asset type: character base sprite for a visual novel.
  <内容段>
  <尾段>
  ```
- **R1** = R0 + `\n<S>\n<渲染块>`；**R2** = R0 + `\n<S>`；**R3** = R0 + `\n<渲染块>`。

### a2-xiangzi

类型句同 a1。内容段（中文）：
`祥子，年轻男性人力车夫，二十来岁，乡下进城的壮实青年。个子高大，肩背宽厚，圆眼，肉鼻，眉毛短而粗，剃得发亮的平头，脸上气色红润，右耳和颧骨之间有一道明显的旧疤（被驴啃的）。神情憨厚沉默、有倔劲。服装：民国时期人力车夫的粗布短打——洗旧的白布对襟短褂，肥大的黑布裤，裤脚用布带扎紧，脚穿千层底布鞋，肩上搭一条擦汗的白毛巾。站姿自然，两手垂在身侧，表情平静。`
尾段同 a1。臂拼装同上。

### a3-seaside

类型句：`Asset type: background (空景) for a visual novel scene.`
内容段：`A quiet seaside town street at late afternoon: a narrow sloping lane of small houses with tiled roofs and wooden facades leading down toward the sea, a few shop awnings and potted plants along the walls, telephone poles and wires, warm low sunlight casting long shadows, the sea and pale sky visible at the end of the street. Empty street, no people.`
尾段：`Composition: the main subject stays inside the central 4:3 area; left and right sides only extend the scenery. Constraints: no people, no text, no watermark.`

### a4-cafe-cg

类型句：`Asset type: CG illustration for a visual novel.`
内容段：`The same girl — short black bob, amber eyes, beige trench coat over a white sweater — sitting at a wooden table by a cafe window on a rainy evening, turned sideways toward the glass, one hand around a warm paper cup, raindrops running down the window, warm lamplight inside, blurred rainy street lights outside.`
尾段：`Composition: the main subject stays inside the central 4:3 area; left and right sides only extend the scenery. Constraints: no text, no watermark.`

## 重跑

```bash
source <含 NL_IMAGE_BASE_URL/NL_IMAGE_API_KEY/NL_IMAGE_MODEL 的 .env>
cp <参考图.png> ref/kokomi-torino.png
magick ref/kokomi-torino.png -background white -alpha remove -alpha off ref/kokomi-torino-white.png
node src/run.mjs                # 40 次调用；可传资产名过滤
.venv/bin/python src/contact.py # 对照图 → contact/
```

`results.jsonl` 每次调用记录：fn/臂/样张/请求尺寸/参数（不含图像）/ms/usage/
实际返回尺寸（`kind:"saved"` 行的 `actual_size`、`has_alpha`）/错误分类。

## 产物

- `gen/<asset>--<arm>-s<n>.png`：原始输出，不裁剪不处理
- `contact/<asset>.jpg`：每资产一张对照图，左列参考图，逐行 T0–R3 两行样张，
  行标注 = 臂码 + 该臂提示词一句话描述
- `contact/overview.jpg`：全部资产 × 臂的样张 1 总览
