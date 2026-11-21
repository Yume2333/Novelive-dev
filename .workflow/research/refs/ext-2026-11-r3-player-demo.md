# R3 播放器 demo：文档设计撞上真剧本和真素材

日期 2026-11-21。目标：按 `docs/player.md`、`docs/work-format.md`、`decisions.md` 已定的方案做一个最小真播放器，跑通 R3 文本/图像两条管线在《骆驼祥子》上的真实产出，看哪里断。

产物全在 `.workflow/evidence/spikes-r3/player-demo/`：`npm run dev` → `http://localhost:5419/?script=ch01.nvs`（`?script=` 换章）。Chromium 实测播完 ch01（84 组）、ch02、ch23，console 0 错误。

## 结论

1. **文档定的那套架构直接可行**：纯 JSON 快照 + 命令式 Pixi 舞台 + DOM 文本层，快照恢复、回滚跳回、存读档都按文档语义工作。快照 380–490B/句，200 句约 76KB（player.md:95 的估计量级正确）；`restore()` 实测 0.1ms。
2. **素材命名是真实的系统裂缝**：剧本写 `beijing-street`、`xiangzi/ragged-white-jacket/plain`，图像管线产出 `bg-beiping-street`、`sprite-xiangzi-puller`、`expr-xiangzi-puller-*`——两套命名在同一部作品里不一致。45 个被引用的素材只有 32 个能映射到真图，13 个落占位图。生产里必须写手和出图共用一份 Bible 素材注册表（见“需要所有者取舍”）。
3. **行宽容量证伪了“faithful ≤120 字”这条线**：文档没写文本框容量。实测默认字号 30px、盒宽 78%（1920×1080 ≈ 1430px 内宽）≈ 47 字/行 × 3 行 ≈ 141 CJK 字符；1280×720 时内宽 930px ≈ 31 字/行 × 3 行 ≈ 93 字符。**faithful ≤120 在 720p 必爆**（实测 1280px 下 ch01.nvs 27/78 行 >3 行），即使 1080p 也只剩 ~17% 余量；balanced ≤90 在 720p 擦边（ch23 实测 7/97 行 >3 行）；lean ≤60 全分辨率安全。而 ch01.nvs 未按强度切句（最长 190 字），6/78 行在 1080p 超 3 行、最长 5 行。
4. **VN 感成立**：judge（jev-1.14.0，带图）6 张截图 readsAsVN 全部 ≈2.9/3（“unmistakably”），styleMatch 2.2–2.6/3。立绘按文档“膝上/半身、底缘贴齐”摆位（高 82% 屏高、anchor(0.5,1) 贴底）是成立的。
5. **真图只覆盖 ch01 的一部分**：图像管线实际只画了 beiping-street（4 变体）+ renhe-yard（3 变体）+ xiangzi-puller/winter + huniu-home 系列 + 2 张 CG。剧本需要 22 个独立场景/立绘组合，其余 13 个全是占位图——**占位图路径是真被踩到的**，不是理论分支。

## 实测

### 编译诊断（`npm run compile`，全量 7 个 .nvs）

| 文件 | 场景 | 句 id | 去重素材 | 诊断 |
|---|---|---|---|---|
| ch01.nvs | 10 | 78 | 14 | **0** |
| ch02.nvs | 8 | 88 | 17 | **0** |
| ch23.nvs | 9 | 97 | 22 | **0** |
| ch01.balanced-v2.nvs | 11 | 0 | 5 | 56 条 W_ID_MISSING（未过“保存时补 id”） |
| ch01.faithful/balanced/lean.nvs | 12/11/8 | 0 | 5/5/5 | 54–121 条 W_ID_MISSING，无其他错误 |

三个主剧本 **0 错误**：`#id` 全部唯一、`source` 段落覆盖完整无缺无叠、素材名全部合语法、行内标签全部配对、指令全集内。strength 三档和 balanced-v2 没有行尾 id——语法表注明“模型不写、保存时补”，所以这只是“未过保存工序”的状态，不是错。播放器载入时补 `auto-xxxx` 占位 id。

附带发现的两个语法事实，记为 grammar-draft.md 的实证：
- `@face xiangzi/sly`：模型确实会写 `char/expr` 两段式省略 costume（ch01 有 `@face xiangzi/happy`、`xiangzi/sly`、`xiangzi/plain`），grammar-draft.md §3 的参数行 `<char/costume/expr>` 没写这个省略形态。
- `@hide xiaoma-grandpa`（ch23:46）：模型对 `@hide` 传角色 id 而不是槽位，文档只写 `@hide <slot>`——ch23 实测两种都出现（`@hide right`、`@hide baimian-koudai`、`@hide xiaoma-grandpa`、`@hide gao-ma`）。解析器要么收两种，要么写手退回改。

### 素材桥

`tools/prepare-assets.mjs` 把 4 个剧本引用的 45 个素材 id 过一遍：**32 映射到真图，13 占位图，3 个 speaker-only**（`xiangzi`、`rickshaw-shop-owner`、`bald-rickshawman` 这三个只当说话人名，不当舞台素材——解析器需要把“说话人”和“素材”分开管，文档语法把两者都写成 asset-id，这里有个小缺口）。

映射是手写的等价表（`MAP`），不是规则推导——`beijing-street`→`bg-beiping-street`、`xiangzi/ragged-white-jacket`→`sprite-xiangzi-puller` 这种只能靠语义对齐。**这正是注册表缺失的证明**：文本写手按 bible 的角色/造型 id 写剧本，美术导演按“地点+变体”出图，两边没有一个公共键。占位图（sharp 生成，灰底+图标+“需要处理”+id 名）正常工作：背景/CG 1920×1080、立绘 1024×1536 透明，截图 ev-05/10-ch23-cg 可见。

### 播放器实测（Chromium，1920×1080）

- **ch01 全程 84 组播完**：console error = 0。字幕 “北平 · 二十年代” 居中、sepia 0.4 滤镜、淡入黑场转场、立绘上/下/换表情（同尺寸 2048×3072 走 200ms 交叉淡化，`@face` 省略槽位正确找到 center 槽）、zoom 1.08、雨粒子+亮度滤镜、`@cg` 占位图、存读档恢复（step/bg/sprites/filter 逐项一致）、记录屏跳回 step 1。
- **ch23 103 组播完**：0 console error；`@hide` 角色 id 形式生效；`@shake`、`cont` 连播、`{em}` `{b}` `{dim}` 标记正常渲染。
- **ch02 88 组**：`@camera sway`、`@camera push-in`、`wipe-left`/`wipe-right`（按交叉淡化近似）、`@zoom` 两种词序（`center 1.08 1.0 ease-out` 与 `1.1 ease-out 0.4`）都被宽容解析——grammar-draft.md §4.1 的词序未定问题在真实数据里确实出现。
- **存读档**：localStorage `{snap,gidx,backlog,read}` 序列化恢复，恢复后立绘/背景/滤镜/粒子逐项一致，实测 step 40 恢复 bg=`beijing-street/dusk`、center 槽立绘在场。
- **快照**：均值 381B、最大 488B（只存素材 id 引用，player.md:81 语义正确），200 句 ≈ 76KB。`restore()` 中位 0.1ms。
- **纹理内存**：ch01 一章 11 个唯一文件（6 张 2560×1440 背景/CG + 5 张 2048×3072 立绘 + 占位图）= 46.25Mpx → RGBA8 176MB、含 mipmap ≈ 235MB。与调研估计（2K 一幕 ~103–232MB）一致；**player.md:103 的“100–300MB 必须按引用计数卸载”被证实不是夸张**——全 45 素材（4 章合集）937MB。
- **自动播放**：`1.2s + 0.08s×字符数` 实现并生效（未做倍率滑块，demo 里只有文字速度滑块 0–153ms/字）。

### 文本框容量（overflow 表）

判据：渲染行数 > 3 行 = 超出文档对话框（盒宽 min(78%,1500px)，字号 30px，line-height 1.62）。探测工具直接渲染每句编译结果到等宽探针（`tools/measure-overflow.mjs`），另用逐句播放法独立复核（ch01 1080p 两种方法同样 6 行超标，一致）。

| 脚本 | 1920×1080 >3行 | 1280×720 >3行 | 最长句 | 说明 |
|---|---|---|---|---|
| ch01.nvs（faithful 强度，未切句） | **6/78** | **27/78** | 190 字 / 5 行 | 写手没遵守强度切句；文档也没给切句工具 |
| ch01.balanced-v2.nvs | 0/56 | 0/56 | 82 字 / 3 行 | balanced ≤90 达标 |
| ch02.nvs | 0/88 | **8/88** | 110 字 / 4 行 | ≤120 擦线，720p 超 |
| ch23.nvs | 0/97 | **7/97** | 132 字 / 5 行 | ≤120 擦线，720p 超 |
| ch01.faithful.nvs（按 ≤120 重写） | 0/121 | 0/121 | 90 字 / 3 行 | ≤120 在 1080p 成立、720p 勉强 |
| ch01.lean.nvs（≤60） | 0/54 | 0/54 | 33 字 | 全安全 |

**文档缺口实证**：`docs/player.md` 全文没写文本框该装几个字；“per-strength 行上限”（faithful ≤120 / balanced ≤90 / lean ≤60 CJK 字符）只在任务侧存在，文档没有。实测容量 = 3 行 × 每行字数，每行字数随盒宽和字号变：1080p/30px ≈ 47 字/行（≈141/句），720p/30px ≈ 31 字/行（≈93/句）。**faithful ≤120 只有在 ≥1440p 或字号 ≤24px 时才稳**。ev-06-overflow.jpg 是 190 字 5 行的实拍。

### judge 结果（jev-1.14.0，6 图）

| 截图 | readsAsVN /3 | styleMatch /3 | spriteScale P(ok) |
|---|---|---|---|
| 字幕（sepia） | 2.94 | 2.18 | 0.26 |
| 立绘+背景 | 2.90 | 2.63 | 0.52 |
| 换表情 | 2.93 | 2.64 | 0.58 |
| 雨景 | 2.92 | 2.57 | 0.54 |
| CG 占位 | 2.91 | 1.07 | 0.15 |
| 夜景 CG（骆驼出逃，当 bg 用） | 2.94 | 2.56 | 0.34 |

**我自己的判断**：读起来确实是 galgame——底栏对话框、居中字幕、立绘居中、快进按钮，柚子社式构图没问题。两个真实折扣：(a) 立绘 2048×3072 以高 82% 贴底，画的是膝上像，人物头顶到屏幕上部 1/5 处，比商业 VN 偏小一点点，但因为素材本身是“膝上或半身”规范，这是文档选择的结果不是 bug；(b) 立绘是赛璐璐赛璐璐干净赛璐璐，背景是厚涂/油画感，judge styleMatch 2.6/3 说明可接受但不顶级，和 R3 图像实验“风格一致性”项的发现一致。CG 占位图那一张（1.07/3）证明占位图在“是 VN”维度上没问题（2.91）但视觉上立刻穿帮——这符合文档定位（“标需要处理也能玩”）。

## 与文档冲突/缺口

| 位置 | 现状 | 实测证据 | 建议改法 |
|---|---|---|---|
| work-format.md:76 槽位规则 | `@hide` 只写 `<slot>` | ch23 实测 `@hide xiaoma-grandpa`（角色 id）与 `@hide right` 混用 | 改成“`@hide <slot\|角色id>`：传角色 id 时隐去该角色所在槽位” |
| work-format.md:70 / grammar-draft §3 `@face` | 参数写 `<char/costume/expr>` | ch01 实测 `@face xiangzi/happy`、`xiangzi/plain`、`xiangzi/sly` 两段式 | 参数表写 `<char/expr>` 或 `<char/costume/expr>`，两段式按“当前槽位 costume”解析 |
| work-format.md 文本行表 | 说话人写 `<asset-id>` | `xiangzi` 这种一级 id 只当 speaker，不是舞台素材；编译器把它当素材查注册表会全报 unknown | 区分“speaker id”与“素材 id”：speaker 查 bible 角色表，素材查素材注册表 |
| work-format.md:82 `@wait` | “用 @wait 显式等点击” | 实测 `{wait 0.4}` 句内停顿与裸 `@wait` 等点击都存在；`@wait` 带秒数是定时（模型未产出但语法表允许） | 明确：裸 `@wait` = 等点击；`@wait N` = 定时推进 |
| player.md 整篇 | 无文本框容量/行上限 | 实测 3 行容量：1080p ≈141 字、720p ≈93 字 | 在 player.md “文本的实现”补一句“对话框按 3 行设计，逐句上限按字号折算；faithful ≤120 只保 1080p” |
| work-format.md:72 转场表 | `slide/push` 等有枚举 | 模型产出 `wipe-left`/`wipe-right`；slide/push/iris 未出现 | 枚举本身够；播放器里 wipe 按交叉淡化近似即可，shader 转场以后再说 |
| grammar-draft §4.1 `@zoom` 词序 | 未定 | ch02 同章出现 `center 1.08 1.0 ease-out` 和 `1.1 ease-out 0.4` 两种 | 定死 `@zoom [target] <倍率> [时长] [easing]`，解析器对纯数字开头的写法做兼容归一 |
| player.md:97 活动演出清单 | 文档列了字段 | demo 快照 `activePerforms` 只恢复 hold-on（sway），转场/zoom/shake 这类一次性演出恢复时不重播——符合“意图型幂等、累积型跳过” | 文档已覆盖，实测语义可行 |
| player.md:11 快照字段 | 列了 8 个字段 | demo 按此实现，388B 平均 | 无冲突；`activePerforms` 实测只在 hold-on 演出时非空 |

## 需要所有者取舍

1. **素材注册表是硬需求，不是改进项**。本次 45 个引用只有 32 个能对上真图——不是因为图没画完，而是命名系统平行演化。注册表至少要含：`id`（剧本和出图共用的键）、`kind`（bg/sprite/cg/speaker）、`char/costume/expr` 或 `place/variant` 分解、`sourceFile`、`status`（drawn/placeholder/missing）、`aliases`（`xiangzi/sly`→`expr-xiangzi-puller-surprised` 这种同义合并登记处，visuals.md §2.1 的表情同义合并落点）。写手 agent、美术导演、播放器三方都读它，不然每个项目都要手写一张 MAP。
2. **行上限要按分辨率+字号定，不能写死 120**。实测表建议：文档写“对话框 3 行容量”，强度上限按 `floor(每行字数×3 × 0.9)` 由编译器算，faithful ≤120 → 1080p 成立、720p 建议 ≤90 或字号降到 24px。否则“faithful 档”在 720p 上 35% 的句子超框。
3. **占位图的视觉代价**：13/45 个槽位是灰块，对白密集的段落（ch23 小马祖父全程）观感直接垮。是接受（文档已定“需要处理也能玩”）还是让美术清单必须覆盖全部引用素材，需要所有者拍板；本次实测：占位图在 VN 识别度上没问题（judge 2.91/3），在风格一致上 1.07/3。

## 产物

- `.workflow/evidence/spikes-r3/player-demo/` — Vite 工程（`npm run dev` 播 ch01）。
- `tools/compile.mjs`（编译器+诊断）、`tools/prepare-assets.mjs`（素材桥+占位图）、`tools/drive.mjs` / `tools/measure-overflow.mjs` / `tools/measure-memory.mjs` / `tools/overflow-report.mjs`（实测工具）。
- `src/` — `compiler.ts`、`stage.ts`、`PlayerApp.tsx`（命令式 Pixi 舞台 + DOM 覆盖层，共 ~800 行）。
- `public/assets/registry.json` — 45 条注册表样例（映射/占位/speaker 三类 status）。
- `shots/*.jpg` — 8 张证据图 ≤1600px：字幕、立绘、换表情、雨、CG 占位、超长句、读档恢复、ch23 CG 占位、ch02 夜 CG（9 张）。`shots/*.png` 全尺寸原始截图。
- `measure/*.json` — 逐句 overflow 与快照尺寸原始数据。

未实现且 4 个剧本未用的指令（按要求只 stub）：`@fg` `@move` `@costume` `@mask`；`wipe/slide/push/iris` 转场以交叉淡化近似；`snow/sakura` 粒子未实现（`rain` 已实现）；`@camera` 只实现 sway/push-in。
