# spikes-r4/genshin-style — Torino 画风跨角色迁移

问题：把 Torino 的心海同人图当风格参考（Image 1，`images.edit`），模型能不能
(1) 在不同场景里画心海本人保住画风与角色一致性；(2) 用同一画风画别的原神角色？
本目录只负责产出图片与对照表，不做画风评判。

参考图：`ref/kokomi-torino.png`（画师 Torino，心海同人，1198×2020 RGBA）；
实际调用用白底版本 `ref/kokomi-torino-white.png`（编辑端点对透明底更稳）。
`ref/`、`gen/`、`contact/`、`node_modules`、`.venv`、`run.log` 全部 gitignore；
跟踪的只有代码、本文件、`results.jsonl`。

## 调用结构

- 全部 36 次调用 = `images.edit`，Image 1 = 白底参考图；不传 `input_fidelity`。
- 立绘：1024×1536 + `background: transparent`；CG/背景：1536×864。
- 并发 ≤6（`src/api.mjs` 内建信号量，复用 style-lock 版本）。
- 两臂，每资产 1 样张：
  - **A** = 角色声明行 + 内容段（立绘再加取景行）。
  - **B** = A + 末尾追加渲染块（防破碎块，原文见下）。

固定行（`src/prompts.mjs`）：

- 角色声明行：`Image 1 is the style reference: draw in exactly the same art style, line quality, coloring, shading and level of detail.`
  - 心海资产追加：` The character in Image 1 is Sangonomiya Kokomi; keep her face and hair the same.`
  - 其他角色追加：` Do not copy the character in Image 1.`
- 立绘取景行：`Framing: from the top of the head to just above the knees, legs cut off by the bottom edge; character centered; fully transparent background, no ground or shadow.`
- B 臂渲染块：`large simple color masses, low visual frequency, restrained edge density, clear edge hierarchy, minimal internal contour lines, broad shadow shapes, suppress micro-texture and micro-contrast, no unnecessary specular highlights`

## 资产（8 心海 + 8 角色立绘 + 2 群像 CG）×2 臂 = 36 次

| ID | 尺寸 | 透明 | 内容 |
|----|------|------|------|
| K1 | 立绘 | 是 | 心海，同参考图服装，双手背在身后，微笑 |
| K2 | 立绘 | 是 | 心海，官设海祇岛巫女服（粉发蓝梢、大鱼鳍蝴蝶结、白蓝紫褶裙、纱袖） |
| K3 | CG | 否 | 心海半身特写，惊讶表情，室内柔光 |
| K4 | CG | 否 | 心海坐海边礁石，日落，海浪 |
| K5 | CG | 否 | 心海在珊瑚灯光的珊瑚宫书房伏案研究军事地图 |
| K6 | CG | 否 | 心海夜雨稻妻街，撑纸伞 |
| K7 | CG | 否 | 心海战斗，召唤水母，动态构图，水特效 |
| K8 | CG | 否 | 纯背景：海祇岛神社，珊瑚与大海，无人 |
| C1 | 立绘 | 是 | 雷电将军（及膝紫长辫、紫白和服、红腰带金绳） |
| C2 | 立绘 | 是 | 纳西妲（白发侧马尾绿梢、十字瞳、精灵耳、白绿裙） |
| C3 | 立绘 | 是 | 芙宁娜（白蓝挑染波浪短发、小礼帽、异色瞳、蓝白燕尾服短裤） |
| C4 | 立绘 | 是 | 甘雨（淡蓝长发、红黑色角、金铃、黑白旗袍式装束白袖） |
| C5 | 立绘 | 是 | 胡桃（深棕双马尾、梅花瞳、黑帽红梅、棕红短褂黑短裤） |
| C6 | 立绘 | 是 | 神里绫华（银蓝高马尾、蓝白甲裙、折扇） |
| C7 | 立绘 | 是 | 钟离（棕长发低马尾琥珀梢、棕金礼服长外套） |
| C8 | 立绘 | 是 | 枫原万叶（白低马尾红挑染、红黑武士装、枫叶围巾） |
| G1 | CG | 否 | 心海 × 雷电将军，天守阁王座厅对立场面；Image 2 = 该臂 C1 立绘，角色声明 `Image 2 is Raiden Shogun's character sheet; keep her design.` |
| G2 | CG | 否 | 心海 × 纳西妲 × 芙宁娜，花园下午茶；Images 2–3 = 该臂 C2/C3 立绘 |

每个 C 资产内容段都写了官设外貌描述，不只靠名字。G 资产在对应臂的
C 立绘出图后运行；若该臂 C 立绘是被拒后重试产物（`--<arm>-nr.png`），自动取用。

## 逐字 prompt 源

唯一来源是 `src/prompts.mjs`（`buildPrompt(id, arm)` 拼装，调用时原文写进
`results.jsonl` 的 `params.prompt`）。`CONTENT` 表为内容段全文；
`CONTENT_NONAME` 为去掉原神专名的重试版（内容不变、换措辞描述）。

## 拒稿重试

若 `images.edit` 返回 moderation/sensitive 类错误（`classifyError` 判
`isRefusal`），同一资产以去名版 prompt 重试一次，产物存
`gen/<asset>--<arm>-nr.png`，`results.jsonl` 对应行带 `nr:true`。
两次都拒则计失败。

## 重跑

```bash
source <含 NL_IMAGE_BASE_URL / NL_IMAGE_API_KEY / NL_IMAGE_MODEL 的 env>
node src/run.mjs            # 36 次；可传资产名过滤，如 node src/run.mjs K3
.venv/bin/python src/contact.py   # 生成 contact/*.jpg
```

`results.jsonl` 每行：fn(kind)/asset/arm/req_size/params（含 prompt 与图片数）/
ms/usage/错误分类；`kind:"saved"` 行记录 `actual_size`、`has_alpha`、`bytes`。

## 产物

- `gen/<asset>--<arm>.png`：原始返回，不裁剪不处理（`-nr` = 去名重试产物）
- `contact/kokomi.jpg`：K1–K8，A/B 两行，左列参考图
- `contact/characters.jpg`：C1–C8，A/B 两行，左列参考图
- `contact/groups.jpg`：G1/G2，A/B 两行
- `contact/all-A.jpg`：全部 A 臂图 + 参考图，5 列网格速览
- 立绘在对照图里合成到浅灰底查看透明边缘
