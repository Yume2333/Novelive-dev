# R3 实图管线试验报告（image-pipeline）

日期 2026-11-21。测试用书《骆驼祥子》1–6 章素材（祥子、虎妞、人和车厂、北平街道），图片模型 `gpt-image-2.6-flare`（OpenAI 兼容接口，`NL_IMAGE_*` 环境变量提供），最大并发 4。工作目录 `.workflow/evidence/spikes-r3/image-pipeline/`，原始记录 `results.jsonl`（43 次调用，全成功、0 拒绝），证据拼图 `contact/s1–s8.jpg`，成品在 `out/`。

## 1. 结论（按重要性）

1. **方法 A 表情派生的主要失败模式稳定复现：12 张首画失败 4 张（33%），全部是同一种——返回 RGB 无 alpha、把灰白"假透明棋盘格"画进像素。** 与上一轮 20% 失败率吻合；技术检查按 alpha 通道分布就能 100% 拦下（`noAlpha`），根本不需要跑假棋盘格检测器。文档把"假棋盘格"当像素图案问题处理低估了它——它其实以"无 alpha 通道"的形式出现。
2. **反馈重画循环有效：4 张失败图在尾部追加一句固定反馈后全部在 ≤3 次重画内修好（3 张第 2 次、1 张第 3 次）。** 但 r2 里那张 `expr-huniu-home-happy-r2` 的视觉审核 confidence 仍只有 0.73–0.88，反馈句子对 alpha 这类"接口参数问题"有效，对画风漂移类问题未必够——反馈要分失败类型（alpha 失败给"必须输出真 alpha"句，identity 失败给锚点句）。
3. **背景变体（白天/夜晚/雨天/黄昏）从基准图编辑派生这条路能走通：构图在视觉上完全对齐**（judge 复核 6/6 判定"同一构图"、contact sheet 也可见），但**像素级 SSIM 很低（0.12–0.74）**——亮度重映射让全局 SSIM 失去意义。要数值门槛就用边缘图 IoU（实测 0.02–0.31），更稳的口径是"大结构块对齐"而不是像素相似。建议文档把"构图稳定"定义成结构边对齐 + judge 复核，别用 SSIM。
4. **内容审核 0 拒绝（3 条最黑暗的提示词都出了图）**，但模型会**静默收敛**：祥子被打、难产的提示词照样出图（还相当直白），上吊场景则被自动改写成"女子蹲在门口+一只鞋"的去直白化版本。docs 里"降敏改写一次"的流程没机会实测——**真正的风险不是拒绝而是"你以为画到了、其实没画到"**，需要视觉审核去查"剧情要素在不在"，而不只查画风。
5. **安全区基本可靠：4 张 16:9 图（2 背景+2 CG）主体全部落在中央 4:3 内**，judge 复核 CG 人物+骆驼都完整在安全区里。可以量化检查：显著性像素（梯度 75 分位以上）落在安全区的比例实测 0.69–0.82，外侧占比 0.18–0.31——建议技术检查加一条"主体显著性 ≥70% 在 4:3 安全区"的硬门槛。
6. **M3 放大决策在真实 AI 图上维持 `realesrgan-x4plus-anime`：alpha 直通无串色，整图 RGBA 进模型、resample 后 alpha MAE 0.06/255（边缘区 3.18）、无白边**；快速档 `realesr-animevideov3` 在同一真图上快 3.5×（6.6s vs 23.4s，1792×1008→4x）但输出明显更软（差异均值 3.81 灰度级，视觉可辨）。文档里"再带一个快速档"的取舍建议改成：**默认 x4plus-anime，低性能机用快速档**。
7. **成本实测比 R2 估算便宜**：本端点 1024×1536 立绘 ≈ ¥0.35/张（$0.049）、1792×1008 场景 ≈ ¥0.41/张（$0.057），42 次调用共 ¥20（$2.88）。一本 100 章书若按文档预估 470–530 张图 ≈ **¥165–215（$23–30）**，比想象可控；但失败重画会再加 ~30–70%（本批 42 次调用产出 25 张可用图，1.68 次/张）。
8. **尺寸提示词必须写明像素**：我首轮误传 `1536x1024` 拿到 3:2 不是 16:9——接口只按 `size` 字段出比例，提示词里写"16:9"没用。适配层一定要把 `size` 吸附到 16 的倍数（1792×1008 可用），且生成时别让模型自己挑比例。
9. **视觉审核 judge 有用但要拆成逐项检查**：单一"整体通过吗"会把"表情到位但锚点丢了"误判成通过（实测 `expr-xiangzi-winter-sad` 锚点 0.03、总分却被 expression 0.46 拉过线）。按 visuals.md:104 的 `{pass, failedChecks, feedback}` 拆成 identity / anchor / expression / framing / style / artifacts 六项分别打，每项阈值独立。

## 2. 实测

### 2.1 生成（42 次调用）

| 阶段 | 数量 | 方法 | 成功 | 失败 |
|---|---|---|---|---|
| 角色设定图 | 2 | T2I | 2 | 0 |
| 造型基准图（立绘） | 3 | B 参考重画（设定图→1024×1536 RGBA） | 3 | 0 |
| 表情差分 | 12 | A 编辑派生（同造型基准图） | 8 首过 +4 重画后过 | 4 首败全为 noAlpha |
| 背景基准 | 2 | T2I 1792×1008 | 2 | 0 |
| 背景变体（夜/雨/黄昏） | 6 | 编辑派生 | 6 | 0 |
| CG | 2 | T2I 1792×1008 | 2 | 0 |
| 内容审核探针 | 6 | T2I | 6 | 0 拒绝 |

延迟：min 23.6s / p50 36.8s / p90 50.4s / max 109s（编辑调用比生成略慢，编辑 ~35–45s）。token：立绘 1584、横版 1848、部分编辑 3168/4752（重画时 input_fidelity 高）。

### 2.2 技术检查（docs/visuals.md §4 五项的实现）

`src/techcheck.mjs` 实测结果：

| 检查项 | 拦下的图 | 判定依据 |
|---|---|---|
| undecodable | 0/43 | sharp metadata |
| wrongSize | 0/43 | 派生图=基准图 1024×1536 / 1792×1008 全部一致 |
| 主体完整（subjectCut） | 0 | alpha bbox `fillH` 全部 ≥0.99、cx≈0.50 |
| noAlpha / alphaNotTransparent | **4/43**（全在表情派生） | hasAlpha=false 或 alpha<16 像素占比 <0.5% |
| fakeChecker | 4/43 合成样例能拦 | 真实失败全部是"无 alpha"先于"画棋盘格"被拦——**真图里 fakeChecker 一次都没单独触发**，因为没 alpha 的图根本到不了查像素那步 |

补充：4 张 RGB 失败图角部采样确认是把灰白棋盘格画进了像素（`gen/expr-*.png` + vision 判定 "digital transparency grid"）。**alpha 检查先于棋盘格检查就能拦下所有实测失败**；`fakeChecker` 检测器只在"有 alpha 但像素里还是画了棋盘格"这种更怪的情形才有用，本批未遇到（合成样例验证 detector 能工作）。

### 2.3 视觉审核（judge，三项图片输入：基准脸部裁切 / 候选脸部裁切 / 候选整体贴白底）

按 `{pass, failedChecks, feedback}` 拆成 6 个 bool：identity / anchor / expression / framing / style / artifacts。12 张首画图 + 5 张重画图 + 6 张背景变体的判定见 `work/` 里 `vrb-*/vrc-*/vfull-*` 输入图与上方 judge_batch 结果。要点：

- identity 判定准确：winter 系 4 张被判 0.35–0.53（低分），人眼复核脸其实没变、是围巾和棉帽遮挡导致 judge 怀疑"换人"——**identity 阈值建议 ≥0.6 才判 fail，或把冬季造型的 keep-list 加"帽子围巾"让 judge 不算成换人**。
- anchor（疤痕）判定单独拆开后比"全部锚点一起"可靠：冬季祥子 4 张的 anchorScar 0.52–0.69 vs 合并问的 0.03–0.06。
- framing 用 bool 判一直飘在 0.4–0.6，**不该交给 judge**——直接用 alpha bbox 数值（`fillW/fillH/cx/cy`）更准（本批全部 fillH≈0.994、cx≈0.503，和基准差 <0.01）。
- expression 判定可信：happy/angry/surprised 0.8–0.96，sad 两张只有 0.46–0.52（"眉蹙、视线落斜下方"这个描述在正脸立绘上确实不显眼，judge 打了半分）。

### 2.4 背景变体数值

| 对 | SSIM | 边缘 IoU（2px 容差） | judge 构图同 | judge 变体判定 |
|---|---|---|---|---|
| renhe-yard night | 0.117 | 0.016 | 0.80 | night ✓ |
| renhe-yard rain | 0.713 | 0.250 | 0.78 | rain ✓ |
| renhe-yard dusk | 0.696 | 0.305 | 0.87 | dusk ✓ |
| beiping-street night | 0.127 | 0.026 | 0.85 | night ✓ |
| beiping-street rain | 0.744 | 0.271 | 0.87 | rain ✓ |
| beiping-street dusk | 0.675 | 0.254 | 0.86 | dusk ✓ |

**解读**：夜景把整体亮度结构打翻（SSIM/IoU 崩到接近 0），但人眼和 judge 都确认是同一构图——**SSIM 不能当"构图稳定"的判据**，文档/代码若给数值门槛要用"大结构边重叠 + judge 复核"，或者干脆只看 judge。建议规格写作：技术检查只卡尺寸一致，构图稳定由视觉审核的 `framing`/`description` 项负责。

### 2.5 CG 安全区

4 张图 `insideFrac`（显著性像素在中央 4:3 内的比例）：renhe-yard 0.734、beiping-street 0.687、cg-first-rain 0.784、cg-escape-camels 0.815。judge 复核 CG 人物+骆驼完整在安全区。提议的检查：`insideFrac ≥ 0.70` 为硬门槛（本批 4/4 过）；同时提示词要写"主体落在画面中央 4:3 区域（约中间 1440×1080）"这句（已写进 `src/briefs.mjs` 的 CG/BG 提示词）。

### 2.6 审核探针

3 条按美术导演口吻写的黑暗场景提示词（上吊 / 兵痞抢车打人 / 难产）**全部生成成功、0 拒绝**，错误分类器没机会触发。但：

- 上吊图被**静默收敛**——出的不是"上吊"是"蹲坐门口的伤心女子+一只鞋"；文字要素丢了但画面完全合法。这是视觉审核该管的：`description` 检查项要核对"剧本要点是否在图里"。
- 兵痞打人、难产两张相当直白（兵、血、产妇），没触发拒绝。说明该端点的输入侧审核对"文学场景叙述"很宽松。
- 降敏改写后的 3 张（全走光影/剪影）也全部出图，且 judge 判"更传达悲剧气氛"的是降敏版 3/3——**降敏版不是兜底，它本来就更像好的 CG 语言**。建议：美术导演画 CG 时本来就该按"光影/剪影/留白"写，把直白血腥留给小说文本。

### 2.7 放大 + WebP（真实输出上的 M3 复测）

upscayl-bin `-g1`（Radeon 780M 核显）+ `realesrgan-x4plus-anime` x4 → sharp lanczos3 重采样：

| 输入 | 4x 输出 | 最终 | 放大耗时 | peak RSS | WebP q90 | 缩略图 480×270 |
|---|---|---|---|---|---|---|
| bg 1792×1008 ×6 | 7168×4032 PNG ~40MB | 2560×1440 | 21.6–24.2s | ~558MB | 481–802KB | 20–37KB |
| cg ×2 | 同上 | 2560×1440 | 22.3–23.7s | ~550MB | 282–507KB | 12–31KB |
| sprite 1024×1536 ×2 | 4096×6144 PNG ~20–25MB | 2048×3072 | 20.4–20.9s | ~540MB | 490–533KB | ~11KB |
| expr ×12（animevideov3 快档） | 4096×6144 | 2048×3072 | ~6.4s | ~380MB | ~430KB | ~10KB |
| bg 快档对照 | 7168×4032 | – | 6.6s | 380MB | – | – |

alpha：sprite RGBA 整图进 x4plus-anime → 2048×3072 webp 后 alpha 透明像素占比 45.45%（原图 45.47%），与原图 resample 对比 alpha MAE 0.06/255、边缘带 MAE 3.18。**"整图 RGBA 直通"结论在真实立绘上成立**。

快档 `animevideov3` 3.5× 快但出图明显更软（与 x4plus-anime 逐点差 3.81 灰度级，裁切对比软边/线稿发虚）。**默认档应坚持 x4plus-anime，快档只作低性能机兜底**——与文档现状一致，但"快档可选"这点值得写进设置页文案，因为它省 3.5× 时间的代价是肉眼可辨的画质损失。

### 2.8 成本与图量

本端点（OpenAI `gpt-image-2.6-flare`，经中转）usage：每张立绘 1584 output token、横版 1848、部分重画 3168/4752。按官方定价 $8/M in + $30/M out：立绘 ≈ $0.049/张、场景 ≈ $0.057/张；42 次调用总 $2.88。R2 估的 470–530 张/100 章在本试验口径下 ≈ **$23–30（¥165–215）**；加 ~50% 失败重画 ≈ **$35–45**。单图 ~35–45s 的延迟意味着一章十几张图要排队几分钟——`同时出图数` 默认 8 合理。

## 3. 与现有文档/决策的冲突或缺口

1. `docs/visuals.md:102`「把棋盘格图案直接画进图里」——实测真失败是**返回 RGB 无 alpha、像素里才是棋盘格**。技术检查只要先卡 `hasAlpha && alpha<16 占比≥0.5%` 就能拦下全部实测；`fakeChecker` 像素检测只在"有 alpha 还画棋盘格"时才有意义。建议改写该句为：「透明底是否有效：要求带 alpha 通道且全透明像素占比 ≥0.5%（按 alpha 通道分布判断，不看像素）；出现过无 alpha、把灰白棋盘格画进像素的失败，此时由 noAlpha 拦下」。
2. `docs/visuals.md:104`「视觉审核输出 `{pass, failedChecks, feedback}`」——`framing` 一项不该交给视觉模型判断：judge bool 在 0.4–0.6 漂移，数值（alpha bbox fillW/fillH/cx/cy 与基准差）更准更便宜。建议把 `framing` 从 failedChecks 挪到技术检查（派生图与基准图的 alpha bbox 差超阈值即拦）；视觉审核的 failedChecks 留 identity/anchors/description/style/artifacts。
3. `docs/visuals.md:63`「主体在 4:3 安全区」——可以量化：显著性像素（梯度 75 分位以上）落在中央 4:3 的比例 ≥0.70。本批 4/4 满足。建议在 visuals.md §3.1 或 §4 加这条作为技术检查第六项。
4. `docs/visuals.md:46` 降敏规则——实测 0 拒绝所以该流程没触发；但发现**静默收敛**：模型不拒绝也不画"上吊"，直接改构图。这暴露了 `description` 检查要管的不只是"画风对不对"，还有"剧情要素画没画到"。建议在视觉审核 checklist 里明确："description 不通过"应覆盖"画面缺了提示词指定的关键要素"。
5. `decisions.md`（放大用 realesrgan-x4plus-anime + 快速档 animevideov3）——真实立绘/背景上**维持 x4plus-anime 作默认正确**，但快档 3.5× 快的代价是明显偏软，建议设置页把快档文案写成"低性能机用（画质下降）"，不是中性备选。
6. `docs/visuals.md:57`「默认把图放大到 2560×1440，立绘按同样倍数放大」——"同样倍数"在 1024×1536 立绘上歧义：×4 得 4096×6144 远超 2K。我按"放大到与 2K 背景同级精细度"取 2048×3072。建议措辞改成「立绘放大到其宽度约 2048 像素（约 2×），或按作品设置的目标清晰度同档」。
7. `decisions.md:605`「图片调用用 openai SDK 默认重试」——本端点所有调用成功、无 429/5xx，SDK 重试未被触发；但 p50 36.8s + 有调用 109s，超过默认 timeout 的调用要用 `timeout:600_000` 显式放大（已做）。
8. `docs/visuals.md:69`「填地址时按域名自动套预设」——本端点是个 new-api 系中转（`<中转域名>`），域名匹配不到预设，**必须支持"未识别域名→通用 OpenAI 兼容声明"路径**。本试验就是用通用声明（支持 edits+transparent+任意 WxH）跑通的，验证了这条 fallback 的必要性。

## 4. 需要所有者取舍的事

1. **背景变体是否仍走"编辑派生"**：实测构图完全稳（judge 6/6），像素级却差异很大——若播放器打算做变体间 crossfade，像素漂移会闪；若是硬切换则完全没问题。**我的建议：保留编辑派生**（构图稳是唯一硬需求，见 visuals.md:55），但 M3 播放器联调时优先做"硬切换"，crossfade 留到有人实测再决定。
2. **`framing` 归属**：建议从技术/视觉检查间挪——数值 bbox 进技术检查（便宜、确定），judge 只管 identity/anchors/description/style/artifacts。成本：judge 每图一次多问题 ~$0.0002，可忽略。
3. **快档是否进包**：animevideov3 只 1.2MB，建议进包作为"低性能机"档位，但 UI 写明画质下降。
4. **降敏策略要不要前置**：实测直白提示词也能过（该端点审核宽松），但降敏版在 3/3 上反而更符合"好的 CG 语言"。**建议把"光影/剪影优先"写进场景画师的内置提示词**（不是兜底，是默认风格），降敏规则继续当审核失败后的改写兜底——两套各归其位。
5. **每图重试预算**：实测 4 张失败都在 ≤3 次内修好，默认 3 合理；但 `expr-xiangzi-puller-happy` 第 3 次才过——若把上限砍到 2 会多 1 张占位图。**维持默认 3**。

## 5. 可直接拿去用的产物

| 路径 | 内容 |
|---|---|
| `/tmp/nl-r3/R3ImagePipeline/out/` (未归档) | 最终 WebP+缩略图（立绘 14、背景 7、CG 2、立绘基准 3）+ `README.md` 清单，M1/M3 播放器 demo 直接用 |
| `/tmp/nl-r3/R3ImagePipeline/gen/` (未归档) | 全部原始 PNG（含失败稿和重画稿），视觉审核测试集 |
| `.workflow/evidence/spikes-r3/image-pipeline/contact/s1–s8.jpg` | 8 张证据拼图（≤1600px） |
| `.workflow/evidence/spikes-r3/image-pipeline/src/api.mjs` | OpenAI 兼容接口客户端：并发 4、错误分类（moderation_blocked/火山 Sensitive*/invalid_request_error/422/关键字）— draw_image 适配层雏形 |
| `.workflow/evidence/spikes-r3/image-pipeline/src/techcheck.mjs` | 技术检查实现（undecodable/wrongSize/subjectCut/noAlpha/alphaNotTransparent/fakeChecker），可直接翻成 TS |
| `.workflow/evidence/spikes-r3/image-pipeline/src/visualcheck.py` + `src/visualreview.py` | alpha bbox、脸部裁切、judge 输入打包——视觉审核输入侧实现 |
| `.workflow/evidence/spikes-r3/image-pipeline/src/safearea.py` | 4:3 安全区数值检查（insideFrac），可并入技术检查 |
| `.workflow/evidence/spikes-r3/image-pipeline/src/briefs.mjs` | 美术导演级的角色/服装/表情/地点/CG 提示词集合（含"表情→眉眼嘴动作"展开、keep-list、安全区句） |
| `.workflow/evidence/spikes-r3/image-pipeline/src/upscale.mjs` + `src/finalize-expr.mjs` | ncnn 放大 + sharp resample + WebP q90 + 480×270 缩略图全链 |
| `.workflow/evidence/spikes-r3/image-pipeline/results.jsonl` | 42 次调用的结构化日志（latency/usage/meta/error 分类），用量统计 schema 参考 |

复跑命令：`cd .workflow/evidence/spikes-r3/image-pipeline/ && source $NL_IMG_ENV （含 NL_IMAGE_BASE_URL/NL_IMAGE_API_KEY 的 .env） && node src/p1-designs.mjs && node src/p1b-16x9.mjs && node src/p2-outfits.mjs && node src/p3-expressions.mjs && node src/p4-variants.mjs && node src/p5-moderation.mjs {raw|desens} && node src/upscale.mjs bg cg sprite && node src/finalize-expr.mjs`（judge 审核走 eval kernel 的 `judge_batch`，输入打包脚本 `src/visualreview.py`）。
## 追加：CG 身份与跨类型画风

针对 Main 提出的两处联系图问题做的补充实验（`src/p6-cgidentity.mjs`、`src/p7-style.mjs`、`src/p7b-style.mjs`，11 张新图，证据 `contact/s9-consistency.jpg`）。

### CG 身份（结论：纯文本必翻车，参考图是硬需求）

同一 CG 场景三种画法的 identity 判定（judge 拿立绘脸部裁切对比 CG 全图）：

| 方法 | scene | identity | shavedHead | build | 备注 |
|---|---|---|---|---|---|
| a 纯文本（含外貌字段） | rain | 0.87 | 0.95 | 0.57 | 文字描述够用，但没锚定 |
| a 纯文本 | camels | 0.86 | 0.97 | 0.58 | 同上 |
| b edit + 立绘基准图 | rain | **0.89** | 0.95 | 0.50 | 疤也画出来了 |
| b edit + 立绘基准图 | camels | 0.71 | 0.95 | 0.53 | 体型略瘦 |
| c edit + 立绘+地点两张参考 | rain | **0.87** | 0.96 | 0.42 | 街道布局也借了基准图 |
| c edit + 立绘+设定图 | camels | **0.88** | 0.97 | 0.64 | 荒野场景无地点基准时拿设定图顶第二张 |

对比之下 v1 旧 CG（纯文本+无外貌字段）：`cg-cg-first-rain` identity **0.12**、`cg-cg-escape-camels` **0.07**——长发动漫头、体型偏瘦。judge 复核 v2（方法 c）两个 CG：剃头、疤、壮实体型全部画对。

**现有审核抓得住吗？**——抓不住。`failedChecks` 枚举里没有"CG 角色身份"这一项；v1 两张在 style 0.12–0.14、artifacts 0.46–0.54 上会给信号，但那是画风项不是身份项。建议给场景画师加一条：CG 图若出现已登记角色，`identity` 检查必须拿该角色造型基准图作参考图对比（不是拿"角色设定图"——玩家看到的是立绘脸，对比基准应该是立绘）；文案：`CG 含已登记角色时，identity = judge(sprite.base, cg)`。

### 跨类型画风（结论：主视觉参考图有效，纯文本风格块不够）

`bible/style.json` 里存了主视觉参考图但**没有一条文档说画图时要带上它**——这是真缺口。judge pairwise sameStyle（0–1）：

| 对 | sameStyle |
|---|---|
| 旧 CG v1 vs 主视觉 | **0.06**（v1 是高光动漫风，主视觉是厚涂水彩） |
| 旧 CG v1 vs 旧背景 | 0.24 |
| 旧立绘 vs 旧背景 | 0.23（三种资产三种画风） |
| 新 CG（带主视觉参考） vs 主视觉 | **0.85** |
| 新背景（带主视觉参考） vs 主视觉 | **0.91** |
| 新背景（带主视觉参考） vs 新背景（只带风格文字） | 0.88 |
| 新背景（带主视觉参考） vs 旧背景 | 0.76 |

结论：风格文字块只有 0.33–0.41，**主视觉参考图能把 CG/背景拉回同一画风（0.85–0.91）**，且带参考图的背景 vs 只带文字的背景之间 0.88 说明风格描述词本身也一致。

### 需要改的文档行

- `docs/visuals.md:36`（三画师分工）——场景画师画 CG 时**必须传参考图**：CG 含已登记角色 → 角色造型基准图 + 地点基准图（若有）；CG 含地点 → 地点基准图。立绘画师画造型基准图参考角色设定图（已有）。差分画师从基准图编辑派生（已有）。**新增："画师的内置提示词里写"必须用参考图""**——不是可选，v1 就是"提示词没说要参考"翻的车。
- `docs/visuals.md:37`（出图分工表）——场景画师参考图列表：主视觉（风格）+ 角色造型基准图（身份）+ 地点基准图（布局），三选其多，最多 16 张（接口上限内）。
- `docs/visuals.md:104`（视觉审核 failedChecks）——`identity` 一项的判定基准需要明确："CG 对照所含角色的造型基准图"，不是对照设定图。
- `docs/bible.md:90`（风格字段）——`style.json` 的 `main-visual.webp` 字段目前是死数据，文档应写明"所有画师出图都带主视觉作参考图"（不是只存档）。
- `.workflow/research/handoff-defaults.md:42`（主视觉条目）——补一句"主视觉存 `assets/style/main-visual.webp` 后，场景/差分画师所有调用都把它列为参考图之一"。

### 取舍

- **多参考图上限**：edit 最多 16 张，一张 CG 最多会带（主视觉+地点基准+N 个角色基准）≈4–6 张，上限不是问题。
- **Seedream 5.0 透明图参考限制**（input 带 alpha 限 1 张）：CG 是横版不透明图、立绘基准是带 alpha 的——若用户图片模型是 Seedream 5.0 pro/flash 这条路径会卡住，适配层 profile 需加 `transparentEditMaxRefs` 字段并退化到"只用首图参考"。
- **重跑成本**：v1 两张 CG 作废重画 ≈ $0.11，可忽略。

### 新产物

| 路径 | 内容 |
|---|---|
| `gen/cgid-{rain,camels}-{a,b,c}.png` | 6 张方法对比 CG |
| `gen/style-{mainvisual,cg-text,cg-ref,bg-ref,bg-text}.png` | 5 张风格锁实验图 |
| `out/cg-cg-first-rain.webp` `out/cg-cg-escape-camels.webp` | v2 成品（方法 c），旧版改存 `*-v1.webp` |
| `contact/s9-consistency.jpg` | 12 格联系图：立绘基准 / v1 CG / 三种画法 / 风格锁实验 |
| `src/p6-cgidentity.mjs` `src/p7-style.mjs` `src/p7b-style.mjs` | 实验脚本 |
