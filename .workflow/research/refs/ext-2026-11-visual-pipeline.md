# 调研：视觉出图管线与视觉小说运行时

2026-11-21。两部分：(A) 角色一致性出图管线与图片 QA；(B) VN 运行时与剧本格式。每个条目给出来源、许可、拿什么、落到哪、结论。先读的内部文档：`character-consistency.md`（A 编辑派生 / B 参考重画已定）、`refs/image-libs.md`（openai SDK 已定）、`docs/visuals.md`、`docs/work-format.md`、`docs/player.md`、`handoff-defaults.md`（放大选型已定）。

本次实际读源码的项目：WebGAL（克隆 `/tmp/webgal`，MPL-2.0）、consistgen（`/tmp/consistgen`，Apache-2.0）、AI4VisualNovel（`/tmp/AI4VisualNovel`，Apache-2.0）、Monogatari（`/tmp/monogatari`，MIT）、pixi-vn（`/tmp/pixi-vn`，LGPL-2.1）、Hongyang（`/tmp/hongyang`，无 LICENSE 文件）。

---

# A. 图片生成管线与 QA

## A1. 逐条评估

### 1. GenerativeAIPub 表情差分实验（PixAI/Tsubaki.3，2026-11）

- 来源：https://www.generativeaipub.com/p/ai-character-expression-sheets-one（文章，无代码）
- 实测结论，和我们 `character-consistency.md` 的 A/B 实验**互相印证且更细**：
  - **单图编辑派生 > 整版表情 sheet**：sheet 一次出 6 张表情更生动、便宜，但裁切分辨率低、无透明底、单张脸坏了没法单独修。独立编辑一次一张，表情强度可控，坏一张重画一张。
  - **永远从基准图编辑，不链式编辑**（edit-of-edit 漂移会累积）。我们队列里“差分从基准图派生”已经对了，要防的是把“从上一张差分再派生”写进画师提示词。
  - **表情描述写五官动作，不写情绪单词**：“happy”→“张嘴露上齿大笑、脸颊上抬、眼睛弯成弧、眉毛放松上挑”。这是最重要的提示词技巧，应直接写进差分画师内置提示词模板：画师负责把 `angry` 翻译成“眉下压聚拢、眼睛眯起瞪视、咬紧牙关”。
  - **keep-list 显式枚举**：“只改表情。保持脸型、发型、瞳色、泪痣、发卡、服装、姿势、取景、画风、背景完全一致”。和我们试验的“只改表情或服装，其余保持”同方向但更明确——把设定集外貌字段拆成 keep-list 逐条列出，比一句“其余保持”更稳。
  - **锚点细节**：挑 2-3 个易核对的特征（痣、发卡）当漂移检查点——可直接给视觉审核用：审核先看锚点在不在，再看整体。
- 落点：差分画师内置提示词、视觉审核提示词。**移植改写**——方法验证一致，模板文字照抄框架填我们的字段。

### 2. AI4VisualNovel（ttsmallHot，Apache-2.0，克隆已读）

- 与 Novelive 最同构的项目：多 agent（Producer/Writer/Actor/Artist）、角色立绘 + 背景 + Ren'Py 导出。
- `agents/config.py` `IMAGE_PROMPT_TEMPLATE`：竖版、单人、腰以上、正面、**纯白底 #FFFFFF**（供背景移除）、“不要只改表情，给动态姿势和手势”。我们不做姿势变化（换表情不跳位置优先），这句**不要**。
- `agents/artist_agent.py::_remove_background`：`rembg` + `isnet-anime` 会话 + `alpha_matting=True`（fg 阈值 200 / bg 阈值 20 / erode 10 / base_size 0 保原分辨率）。我们已定“透明底由图片模型直接输出，不做色键抠图”——这条是**模型不支持透明底时的兜底路径**，visuals.md 说“不支持时只提示不兜底”，维持不兜底，但参数组合值得记进文档防以后改主意。
- `agents/actor_agent.py::critique_visual` + `IMAGE_CRITIQUE_PROMPT`：**第一人称角色视角审核自己的立绘**，非 neutral 表情时附 neutral 基准图，输出 `{decision: PASS|REVISE, feedback}`；feedback 追加进下一轮 prompt 的 “IMPORTANT CORRECTIONS” 段（`artist_agent.py:212-214`）。
  - 拿：审核 prompt 的**结构化 PASS/REVISE + 可执行修改点**协议、审核时附基准图的做法、feedback→prompt 追加的位置（最后，前缀不动）。不拿：第一人称角色扮演（装饰性，不增加信号）。
- `agents/artist_agent.py::_call_image_api`：`images.edit` 传多参考图时的 prompt 头——“You will receive reference images in order. The first N images are references of the same character. Use them only to preserve identity...”——**多图输入时在 prompt 里声明每张图的角色**，值得抄进我们 draw_image 的 prompt 拼装（设定图 vs 上一造型 vs 基准图角色不同）。
- 落点：差分画师提示词、视觉审核协议、draw_image 内部参考图声明。**移植改写**。

### 3. consistgen（melodic-lab，Apache-2.0，克隆已读）

- `review.py`：批量图一致性 QA。**SigLIP 算每图 embedding → 对批次质心余弦相似度（风格离群检测，阈值 0.82）+ CLIP 算每图 vs 角色参考图余弦（身份漂移，阈值 0.80）**；不过 → LangGraph 换 seed 重画，上限 3 次。
- 对我们的价值：视觉审核现在是“视觉模型看图判断”，consistgen 证明**纯 embedding 分数就能当廉价一票否决**——但要在本地跑 torch/transformers，和我们“Python 进程只放大降噪”的边界冲突，且二次元角色 CLIP 分数阈值需要重新标定。**只参考**：若视觉模型审核反复放跑“画成别人”，可在 Python 进程里加一个可选的 embedding 一致性通道（SigLIP 对基准图），作为审核之外的硬阈值。现在不加。
- retry 循环结构（生成→审→换 seed 重试≤3）和我们「生图失败重试次数」=3 一致，**确认现有设计**。

### 4. WebGAL 立绘差分混合（MPL-2.0，`packages/webgal`，已读源码）

- `dev-docs/立绘差分切换.md` + `figureDiff.ts` + `syncPixiStageState.ts:194-235`：换表情（changeFigureDiff）时若**源图与目标图宽高、像素密度完全一致、GPU 资源就绪、基准位置未变**，复用容器做 **200ms 互补 RGBA 混合**；否则退回旧图淡出+新图淡入。
- 对我们的直接约束：**差分图必须和基准图同尺寸同构图，播放器才能无跳变混合**。A 编辑派生天然满足（试验已验证外框差几十像素）。给技术检查加一条：**派生图与基准图同尺寸**（尺寸不符直接拦下重画），以及视觉审核看“外框位移”。同时播放器换表情做短 crossfade（100-200ms）比硬切更像商业 VN。
- `figureAssociatedAnimation.ts`：静态图口型/眨眼帧（mouthOpen/Close/Half、eyesOpen/Close 整图替换）。我们不做 Live2D，但这是**纯图片方案的口型眨眼**：给关键表情多画张嘴/半张嘴两张差分，播放器按语音/节奏切图。**只参考**，记入“以后可能做”，不做第一版。
- 落点：技术检查（同尺寸）、播放器（换表情 crossfade）、差分画师（同构图约束）。**只参考**（MPL-2.0 文件级 copyleft，读设计不拷代码）。

### 5. Ren'Py 与 Ren'Py 生态惯例（MIT，文档已读）

- `lin-xiao/uniform/angry` 这种 `角色/造型/表情` 命名就是 Ren'Py `show eileen happy uniform` 的 image-tag 体系：`show <tag> <属性...>`，tag 决定谁、属性决定用哪张图、同 tag 自动替换。我们素材命名层级和它一致，**确认现有设计**。
- `with dissolve/fade/moveinright/ease/vpunch/hpunch` 转场枚举 + `ATL transform`（线性/并行/循环插值 + warper 缓动名）。我们的 `@bg ... fade 1.5` 参数覆盖 + 编译器默认值方向一致；转场枚举表（dissolve/fade/wipe/slide/push/iris/pixellate/zoom/vpunch/hpunch）可作为 `@bg`/`@cg` 过渡名的初始集合，**移植改写**进 work-format 指令表。
- 口型/眨眼：Ren'Py `MouthSpread` 类同理是静态图切换，同 4。

### 6. Gemini image（Nano Banana）官方指南（文档已读）

- `deepmind.google/models/gemini-image/prompt-guide`：**多角色/多物体场景给每个实体起名字再在 prompt 里引用**、文字渲染用引号括原文、按用途声明画幅。我们的素材名（`lin-xiao`）正好能当这个名字——多参考图编辑时在 prompt 里写 “The character `lin-xiao`”，代码把素材名写进 prompt 前缀，**移植改写**。
- 只参考：我们的图片接口是 OpenAI 兼容，Gemini 指南只当提示词风格参考，不接它的 API（image-libs.md 已定）。

### 7. Flux Kontext / Qwen-Image-Edit（只查文档，不接）

- Flux Kontext（BFL 文档）：强项是“单变量编辑保人脸”——“一次只改一个变量”原则和我们差分画师“只改一处”一致，**确认现有设计**。多图编辑链官方建议从原图出发不链式，同 A1。
- Qwen-Image-Edit-2509/2511（HF，Apache-2.0 权重）：原生多图输入（≤3）、专为一致性编辑调优——**如果将来接本地/第三方端点，Qwen-Image-Edit 是最适合我们差分工位的开源模型**；但它不走 OpenAI images 协议的 images.edit 参数集，属于“换 provider”事项。记入备查，现在不改设计（图片模型只接 OpenAI 兼容已定）。
- **不要** StoryDiffusion/ComfyUI 系（自注意力一致性、LoRA 训练）：要 GPU、要 ComfyUI 运行时，超出 Electron 桌面应用边界；VNCCS（ComfyUI_VNCCS，MIT 但绑 ComfyUI）同理，仅其“角色设定卡→表情集”工作流概念可参考，已被 A1 覆盖。

### 8. 抠图/放大备查

- rembg：MIT，`isnet-anime` 会话 + alpha_matting 参数组（见 A2）。**只参考**（已定不抠图；模型不出透明底时我们按设定页三项测试“只提示不兜底”）。
- BiRefNet：MIT（ZhengPeng7/BiRefNet），高精度通用 matting，ToonOut 是其动漫微调。**只参考**，若哪天上抠图优先它（发发丝边缘比 u2net 系好）。
- 放大：已定 Real-ESRGAN `x4plus-anime-6B` + ncnn-vulkan（BSD-3，可随包分发）。备查：B 站 Real-CUGAN（ncnn-vulkan，对动漫降噪更强但权重许可链要再查）、`realesr-animevideov3`（小快、动漫向）。**维持已定**，M3 实测不达标再看 Real-CUGAN。

### 9. 视觉审核（LLM-as-judge）

- 外部做法汇总：consistgen 的 embedding 硬阈值（A3）；AI4VN 的“视觉模型+基准图对比+结构化 PASS/REVISE”（A2）；MLLM-judge 学术线（ViStoryBench 等）证明判断维度要**拆小问题**（身份像不像/风格对不对/主体完不完整/符合描述吗）分别问，比一句“好不好”准。
- 对我们视觉审核的具体建议（落地 `draw_image` 内部）：
  1. 输入固定三件套：**待审图 + 基准图（或设定图）+ 图清单那句描述**；
  2. 输出结构化 `{pass, failedChecks: [identity|framing|description|style|artifacts], feedback}`，feedback 直接喂回画师改 prompt（AI4VN 已验证这个闭环）；
  3. 表情差分额外查**锚点细节**（A1 的锚点清单由代码从外貌字段抽 2-3 个传给审核）。

## A2. 我们 painter + draw_image 设计的缺口

对照现有 `novelive-agent.md` §出图、`visuals.md`，发现这些缺口：

1. **表情描述粒度没定**：现在的流程是“美术导演给一句画面描述 → 画师写 prompt”。A1 证明情绪单词必须展开成五官动作描述，否则表情强度不可控。建议：美术导演的图清单描述照写意图（如“强忍怒意”），**差分画师内置提示词模板负责把表情名展开成眉/眼/嘴动作清单**（这正好是“模型填擅长的部分”）。
2. **keep-list 没有结构化来源**：差分派生要“其余保持”，但“其余”是什么应该由代码从角色外貌字段拆成清单传进上下文，不是让画师自己概括。外貌字段在 bible 里是自由文本，可在综合时给外貌加一个 `anchorFeatures`（锚点特征 2-3 个）子字段——确认点 1 定稿角色时顺手写，后面审核也用。
3. **多参考图的角色声明**：draw_image 内部会传设定图/上套造型/基准图，prompt 需要一句话说明每张图的角色（A2 的 “reference images in order” 模式），代码按派生类型生成这句，模型不写。
4. **派生图尺寸约束**：差分必须和基准图同尺寸（WebGAL 混合的前提），写进技术检查；目前技术检查只写“尺寸是否正确”，应明确“派生图 = 基准图同尺寸”。
5. **审核 feedback 回传**：visuals.md 只说“不通过和原因交回画师”，建议结构化 failedChecks，让画师改 prompt 时知道改什么——AI4VN 的 feedback 追加段是现成模式。
6. **换表情播放体验**：换表情 crossfade（100-200ms）没写进 player.md，硬切在逐字播放时会闪。写进播放器演出能力。
7. **审核拒绝后的“改含蓄”提示**：AI4VN 的 feedback 追加段同样适用于 moderation_blocked 重试——把“上一条被内容审核拒绝，请收敛描写”作为固定追加文本，现在是让画师自由改，可能反复踩同一处。

---

# B. VN 运行时与剧本格式

## B1. 引擎逐条评估

### 1. WebGAL（OpenWebGAL，MPL-2.0，克隆已读）——最重要的参考

**解析层**（`packages/parser`，MPL-2.0）：

- 语法：`命令:内容 -arg1 -arg2=val ;注释`。`命令` 缺省即 say，`说话人:` 走 say+speaker 参数（`scriptParser.ts`）；`-flag` 无值=true、`true/false` 转布尔、数字自动转型（`argsParser.ts`）；`;` 行内注释、`\;` 转义。
- `ADD_NEXT_ARG_LIST`（`scriptConfig.ts`）：**某几类命令自动追加 `next=true`**——bgm、粒子、滤镜、转场设置等“设置型”命令执行完自动接下一句，不用写手显式标。我们“写在一句话前面的指令和这句话同时生效”的语义更简，但“设置型指令默认不等点击”这条规则可以直接借：我们的 `@bg @show @camera @filter` 都该默认随行生效，只有 `@wait`/对白停点击——**当前 work-format 已隐含此语义，建议显式写成指令属性表**。
- 多行文本：`sceneTextPreProcessor.ts` 两遍处理把 `|`/`-` 开头的缩进续行折进上一行，保行号。我们的 `.nvs` 一句一行、行尾 ID，不需要续行机制——**不要**。
- `assetsScanner`/`subSceneScanner`：解析时收集每句携带的资源与子场景用于预载。我们编译时扫描素材名做缺失检查已覆盖，**确认现有设计**。

**运行时**（`packages/webgal`，MPL-2.0）——`SCRIPT_AUTHORING.md` 是全文最有价值的文档：

- **两态模型**：`calculationStageState`（演算态，命令执行时同步写，快速预览/回放/存档都读它）与 `viewStageState`（提交态，commit 后 Pixi/React 同步）分离；命令函数**只许顺序写演算态、返回 IPerform**，`startFunction` 只做运行时动作不写状态。**这套“状态变更与演出执行分离、统一 commit 点”的架构是我们播放器内核应抄的最大件**——它天然解决：快进预览不丢状态、存档=快照、回滚=恢复快照+重放演出。
- **IPerform 生命周期**：`{performName, duration, isHoldOn, startFunction, stopFunction, blockingNext, blockingAuto, blockingStateCalculation}`。三个 blocking 维度分开（阻塞点击 / 阻塞 auto / 阻塞状态演算）——我们的“文字在播点击补完、动画没播完不阻塞”只需 blockingNext 一档，但粒子/镜头演出要不要阻塞 auto 是同一问题，**设计照抄**。
- **存档结构**（`saveGame.ts`）：`{nowStageState(深拷贝), backlog[], sceneData{currentSentenceId, sceneStack, currentLocals}}` + WebP 缩略图。回滚=backlog 项本身就是舞台快照（`backlog.ts` 每句 say 存一份 stageState）——**我们的“回滚跨章”直接可用这个模型**：每句文字落点时存 (句子ID, 舞台状态快照)。注意 WebGAL backlog 上限 `backlog_size`，快照含立绘/背景 URL 引用不是图像本体，成本只是 JSON。
- **恢复演出**（`jumpFromBacklog.ts::restorePerform`）：恢复快照后**重放 PerformList 里的演出**，但三类特判——say 只重建演出不重跑（防 concat 重复追加）、相对动画 skip（防叠加）、其余 rerun。**这是“快照+选择性重放”模式**，比我们“重放从场景头到目标句”更省更准；`.nvs` 演出指令全部是幂等状态写入时可直接套用。
- **立绘槽位**（`changeFigure.ts`）：`fig-left/center/right` 位置槽 + `-id` 自由立绘；“身份=图片URL+基准位置”判定，身份未变不重置 transform/zIndex/blendMode（`postFigureStateSet`）。我们的 `@show lin-xiao/uniform/angry left` 就是位置槽模型，**确认现有设计**；“换表情不换图身份时保留一切舞台状态”要写进指令语义。
- **立绘差分**：同 A4，尺寸一致→200ms RGBA 混合，否则淡入淡出回退。
- **粒子**（`gameScripts/pixi/performs/{snow,rain,cherryBlossoms}.ts`）：每个 ~150-200 行，`registerPerform` 注册 fg/bg 双层容器，`Pixi.ParticleContainer` 手动逐帧更新（不依赖 emitter 库）。三个粒子实现**结构可直接移植改写**（雪=飘落+旋转+风速参数化、雨=密集直线、樱=飘落+摆动）；MPL-2.0 是文件级 copyleft——我们重写不拷文件（数学/参数思路不受版权保护），**移植改写**。雨樱雪正好覆盖 `@particle` 的第一批内置效果。
- **变量与条件**：`{var}` 插值、`-when` 条件、`setVar`/`if`/`callScene`/`jumpLabel`。我们第一版无分支变量，**不要**（以后加分支时再回来抄 `whenChecker`+场景栈）。
- `intro`（全屏居中大字，`|分隔多行，逐行淡入`）——就是我们 `@caption` 的重形态；`filmMode`（电影黑边模式）、`setTextbox hide`（隐藏对话框）我们已有对应。
- **避免**：Live2D/Spine 支持、`pixiPerform` 自定义 Pixi 特效（安全模型不适合我们）。

### 2. Ren'Py（MIT，文档已读）

- **剧本模型**：statement 序列 + label/call/return 场景栈；`say` 的 `interact` 是 checkpoint 点——**回滚日志=每个交互语句起点的快照**，`config.rollback_length` 限量。和 WebGAL backlog 同构，**确认方向**。
- **rollback 语义细节**：`renpy.checkpoint(hard)` 区分硬检查点（回滚停）和软检查点（路过不停）；`roll_forward_info` 支持回滚后快进（redo）——**我们“回滚可以跨章”+历史跳回后，前进（roll-forward）功能 player.md 没写**，这是缺口：Ren'Py 用户在历史里点回某句后能滚轮前滚回来到原位，值得加。
- **transition 枚举**（A5）+ `MoveTransition`（层内图片动了自动补间）——`move` 转场对应我们 `@move` 的自动补间，**移植改写**。
- **ATL**：`linear/parallel/loop/block + warper` 的小型时间线 DSL。我们的“指令写意图、参数编译器给默认”是刻意简化版；ATL 的 `warper` 缓动名表（ease/easein/easeout/linear）可以借作 `@move`/`@camera` 的 `ease` 参数枚举。**只参考**，不引 ATL 整块。
- **存档元数据**：`_save_name/_version/_game_runtime/_ctime/_screenshot` JSON 头 + 快照体——和我们“存档迁移按版本”需求一致，**移植改写**（作品版本号进存档元数据，player.md 已有迁移规则）。
- **不抄**：pickle 全量 Python 状态序列化（我们舞台状态是纯 JSON 可序列化，天然更稳）、`default` vs `define` 变量持久化规则（无变量系统）。

### 3. Naninovel（Unity 商业闭源，文档已读）——语法层最值得细看

- `.nani` 语法：`@command param:value`、`Author: text` 通用文本行、`;` 注释、`#` label。`Author.Appearance: text` = `@char Author.Appearance` + 对白合并写——**我们的 `lin-xiao (inner):` / `lin-xiao as 名:` 变体语法同构，确认现有设计**。
- **命令内联**：`[command]` 嵌入文本中间按揭示进度触发（“说到这个字时换表情”）。我们的行内标签只覆盖样式/停顿/变速，**不支持在行中间插演出指令**——这是真实缺口（剧本里“说到某字时背景震动”很常见）。参考它的语义：内联指令在字符播放到该位置时执行。建议 M2+ 评估加 `{cmd ...}` 或复用 `{wait}` 同语法。**只参考**，记录为缺口。
- `wait!` 布尔旗标、`params` 的 nameless 参数、命令标识大小写不敏感：细节设计可参考，**只参考**。
- 不抄：Unity 资源管线、printer（多个文本打印机）、`@group` 嵌套块。

### 4. Monogatari（MIT，克隆已读）

- `actions/` 每个动作实现 `willApply/apply/didApply` + `willRevert/revert/didRevert` 双向生命周期——回滚靠**每个动作自己实现逆操作**。我们状态快照方案更简单可靠（Monogatari 自己也为媒体状态打过迁移补丁），**不抄这套逆操作模型，抄 WebGAL 快照**。
- `Particles.ts`：粒子效果是**配置注册表**（`particles: {name: config}` 在配置里预定义，脚本 `show particles <name>` 引用）。我们的 `@particle rain` 应同此：**粒子=内置具名效果+少量参数，模型不写粒子物理参数**——确认现有“写意图”方向，粒子的可注册配置表可借。
- 其余（storage 状态、角色分层 `ShowCharacterLayer`）：**只参考**。

### 5. Yarn Spinner / Ink / Twine / Narrat / pixi-vn（快速评估）

- Yarn Spinner（MIT）：`#line:` 行尾本地化 ID 是和我们 `#a3f9` 完全同构的先例，**确认现有设计**；它的 line-ID 还证明了“存档/已读/本地化都挂行 ID”是成熟做法。它的 `<<command>>`、`->`选项缩进语法对我们无用（无分支）。**只参考**。
- Ink（inkle，MIT）：`knot/stitch/divert/weave` 全为分支叙事服务，我们无分支；`{~a|b}` 变体文本、打印控制 `{#}`标签有借鉴价值但非当前需求。**不要**（第一版）。
- Twine/SugarCube（GPL-3.0 部分组件）：段落(passage)模型，离线性最远。**不要**。
- Narrat（MIT）：RPG 向（技能判定、HUD、商店），save 是 {labelId+step} 重放制。**只参考**：它证明“存档=回放到第 N 步”在纯确定性脚本下可行，但快照更省。
- pixi-vn（DRincs，LGPL-2.1，克隆已读）：PixiJS+React 引擎、ink 剧本、step/history 管理与 GameUnifier 抽象。LGPL 文件只能动态链接不能拷；其历史管理设计（`HistoryManager` 按 label+step 记 diff）**只参考**。PixiJS 本身 MIT，播放器要用 canvas 层做粒子/滤镜时选 PixiJS 8 是合理技术选型（WebGAL、pixi-vn 都验证了此路线）；若只做 DOM/CSS 过渡，粒子仍需要 canvas——**建议播放器舞台层用 PixiJS**，三选一证据充分。
- TyranoScript（MIT-ish，日本 VN）：`[tag]`/`@tag` 层叠模型（message/fore/back 层 + 每页 layer）。**只参考**：层模型（前景层/立绘层/背景层分层管理）和我们“前景层”能力对应，语义已在 work-format 覆盖。
- Hongyang（无 license，hackathon 项目）：thin，character recall 用向量库存角色 profile。**不要**。

## B2. `.nvs` 与播放器的具体缺口

对照 `work-format.md`/`player.md`：

1. **转场名枚举未定**：`@bg classroom/dusk fade 1.5` 的 `fade` 有哪些合法值没写进 work-format（指令全集 M1a 定稿时需要）。建议初始集：`fade`(经黑场)、`dissolve`(交叉淡化)、`wipe左/右/上/下`、`slide`、`push`、`iris`(虹膜)、`zoom`、`none`——全部映射到 Pixi 滤镜或双图混合即可。
2. **缓动枚举未定**：`@move`/`@camera`/`@shake` 的缓动建议沿用 `linear|ease|ease-in|ease-out|ease-in-out` 五名（ATL warper 等价物）。
3. **roll-forward 缺失**：回滚后没有“回到最新点”的路径。player.md 补“回滚后前进（roll-forward）”，实现=backlog 栈不弹只移指针（WebGAL 是 pop——它只支持回退不支持 redo；Ren'Py roll_forward 支持，抄 Ren'Py 语义）。
4. **backlog 跳回的存档语义**：WebGAL 做法是 backlog 项含完整舞台快照，跳回=恢复快照+重放演出（restorePerform 三态特判）。我们“历史记录（可以跳回）”需要明确：跳回历史句=恢复该句快照。已读标记与回滚的关系（Ren'Py 把回滚过的句子算已读）要写进规则。
5. **行内演出指令**（Naninovel `[command]`）：缺口，建议以后加 `{@cmd}` 或扩展行内标签；现在可以先让美术导演把“说到一半要发生的演出”拆成两句（第一句后半截用 `notend` 类语义）——**`notend` 概念我们没有**：WebGAL `-notend` 表示这句播完不停点击直接接下句且不进 backlog。我们的 `@wait`/随行生效已覆盖大部分，但“一句对白播完不停顿直接接下句对白”（两人抢话）没有写法——建议给对白行加 `!cont` 或 `{cont}` 尾标，低成本覆盖。
6. **播放器的两态架构**：player.md 只写功能没写内核模型。规格里应写明：舞台演算态（纯 JSON：背景/立绘槽位/CG/前景/镜头/粒子/滤镜/文本快照）+ 提交渲染态，命令执行只写演算态，commit 同步视图——WebGAL 已证明这是回滚/存档/快进三合一的最简解。
7. **粒子实现**：`@particle` 首批内置 `rain|snow|sakura`（参数：强度、速度、风向角度），Pixi `ParticleContainer` 手写 ticker，各 ~150 行。美术导演只写意图名和强度，**粒子物理参数不出现在剧本里**——和现在设计一致。
8. **`as` 显示名 vs Ren'Py `Character` 动态名**：我们 `lin-xiao as 神秘少女:` 已覆盖，确认。
9. **立绘身份与入场**：`@show` 身份=素材名+位置槽；身份不变保留 transform/zIndex（WebGAL `isIdentityChanged` 逻辑），写进指令语义表。
10. **skip 已读 vs skip 全部**：player.md 写“跳过已读”，未写“强制跳过未读”（长按 Ctrl）；Ren'Py 有 `skip unseen` 开关。建议明确只做已读跳过（已读按句子 ID 集合，handoff 已定）。

---

# Top 15（按采纳价值排序）

| # | 来源(许可) | 拿什么 | 落点 | 判定 |
|---|---|---|---|---|
| 1 | WebGAL `SCRIPT_AUTHORING.md` + stage/backlog/save 源码 (MPL-2.0) | 两态模型 + IPerform 生命周期 + 快照存档/回滚/重放演出架构 | 播放器内核（pi-scaffolding 外的新层） | 只参考（重写，不拷） |
| 2 | GenerativeAIPub 表情实验（文章） | 表情=眉/眼/嘴动作清单、keep-list、锚点细节、不链式编辑 | 差分画师内置提示词 | 移植改写 |
| 3 | AI4VisualNovel (Apache-2.0) | 审核 PASS/REVISE+feedback 协议、feedback→prompt 追加段、多参考图“in order”角色声明头 | 视觉审核 + draw_image | 移植改写（Apache 可近抄） |
| 4 | Naninovel 文档 | `Author.Appearance:` 语法先例、命令内联 `[cmd]`、nameless 参数 | `.nvs` 语法（行内演出指令留缺口） | 只参考 |
| 5 | Ren'Py 文档 (MIT) | 转场枚举表、roll-forward、checkpoint 语义、存档元数据 | 播放器 + work-format 指令表 | 移植改写 |
| 6 | WebGAL 粒子 `rain/snow/cherryBlossoms.ts` (MPL-2.0) | 三粒子实现结构与参数化 | 播放器 `@particle` | 移植改写（重写数学） |
| 7 | WebGAL `立绘差分切换.md` + figureDiff (MPL-2.0) | 同尺寸→RGBA 混合换表情、fallback 淡入淡出 | 播放器换表情 + 技术检查同尺寸约束 | 只参考（重写） |
| 8 | WebGAL `argsParser/scriptConfig` (MPL-2.0) | `-flag`=true、true/false/数字自动转型、ADD_NEXT_ARG_LIST“设置型命令自动 next” | `.nvs` 参数解析 + 指令属性表 | 只参考 |
| 9 | Monogatari `Particles.ts` (MIT) | 粒子=具名预定义效果注册表 | 播放器粒子 + work-format | 移植改写 |
| 10 | consistgen (Apache-2.0) | SigLIP 批次风格 + CLIP 身份硬阈值、生成→审→换参重试闭环 | 视觉审核的可选增强通道（Python 进程） | 只参考 |
| 11 | Gemini image 官方指南 | 多实体起名、引号括文字、声明画幅 | draw_image prompt 前缀（素材名注入） | 移植改写 |
| 12 | WebGAL `figureAssociatedAnimation.ts` (MPL-2.0) | 静态图口型/眨眼帧（张嘴/半张嘴/闭眼三张差分） | “以后可能做”清单 | 只参考 |
| 13 | AI4VN `IMAGE_PROMPT_TEMPLATE` (Apache-2.0) | 立绘构图约束段（单人/竖版/腰以上/正面）和背景模板（no people/watermark） | 立绘/场景画师内置提示词 | 移植改写 |
| 14 | Flux Kontext / Qwen-Image-Edit 文档 | “一次只改一个变量”、Qwen 多图一致性编辑=差分工位最佳开源备选项 | 差分画师原则确认 + 备选模型档案 | 只参考 |
| 15 | WebGAL `scriptParser.ts` 注释/多行 (MPL-2.0) | `;` 注释 + `\;` 转义；续行机制**不取** | `.nvs` 解析器 | 只参考 |

---

# 和我们现有设计冲突或缺口

按文档列，带证据：

## docs/visuals.md

1. **缺“派生图与基准图同尺寸”的技术检查**。§4 只写“尺寸是否正确”。WebGAL figureDiff 证明换表情混合的前提是同 W/H/位置——建议明确“差分/变体尺寸=基准图尺寸，不符拦下”。证据：`syncPixiStageState.ts:206` sameGeometry 判定。
2. **缺“锚点特征”字段**。角色外貌是自由文本，表情审核和 keep-list 都需要 2-3 个可机器枚举的锚点（痣、发饰、瞳色）。建议在 bible 角色外貌加 `anchorFeatures` 子字段（确认点 1 时定），技术检查/视觉审核/派生 prompt 三处复用。证据：A1 锚点细节法。
3. **视觉审核契约未定结构**。“主体是否完整、和角色参考是否一致、和描述是否相符”建议落成 `{pass, failedChecks, feedback}`（AI4VN 已验证 feedback 闭环），feedback 追加给画师重画用。
4. **审核拒绝重试的提示没有固定化**。“改得含蓄一点再生成一次”应该由工具把固定句追加进 prompt（“上一次生成被内容审核拒绝，请收敛以下方面：…”），否则模型可能反复踩同一描写。
5. **不兜底抠图的决定与证据相安，但要写明备选**：rembg `isnet-anime`+alpha_matting 参数组（fg200/bg20/erode10/base0）是验证过的动漫立绘抠图配方，记在文档备查即可。
6. **多参考图声明缺失**：images.edit 传多图时 prompt 需声明每张图角色（“第1张是 lin-xiao 的设定图”），代码生成这句。

## docs/work-format.md

7. **转场/缓动枚举全集缺失**（M1a 要定稿）：`@bg @cg` 的过渡名、@move/@camera 的 ease 名，按 Ren'Py 枚举表收敛（fade/dissolve/wipe/slide/push/iris/zoom + linear/ease*）。
8. **“一句播完不停点击接下句”缺写法**：WebGAL `-notend`/`-next`、Naninovel `[>]`/`[wait]` 都有此语义；我们连续对白抢话/字幕接对白时需要。建议给文本行加尾标（如行尾 `!cont`）或 `@caption` 之外的通用 `cont` 标记。
9. **行内演出指令缺口**：说到一半换表情/震屏，Naninovel `[cmd]` 内联是成熟解；当前只能拆两句（第二句 `cont`）。记入以后评估，不必现在做。
10. **`@show` 状态语义未写明**：同一角色同位置换表情/换造型时保留 transform 与层级（WebGAL isIdentityChanged 语义），换人才重置。指令表要明确“同槽位同身份→保留舞台状态”。
11. **粒子参数边界**：`@particle` 只允许内置名+强度/速度/角度意图参数，不开放自由参数（Monogatari 注册表模式），避免模型写物理参数。

## docs/player.md

12. **缺 roll-forward**：回滚后无法回到最新位置。Ren'Py roll_forward 语义=backlog 栈保留前进指针；WebGAL 只回退。建议补“回滚后前进”，实现成本=backlog 不弹栈只移指针。
13. **缺舞台快照模型描述**：“存档”“回滚”“历史跳回”三者在实现上是同一机制（句落点存舞台状态快照），player.md 应按此写明——这决定存档体积（只存 URL 引用+transform JSON，不存图）。
14. **换表情混合未写**：演出能力清单加“立绘差分在同等尺寸下短混合（~200ms），不等时淡入淡出回退”（WebGAL 实测方案）。
15. **跳过语义**：写清“跳过已读”的已读判定=句子 ID 在已读集合；未读句在跳过模式下按最短停留过（Ren'Py `skip unseen` 默认关的做法）。
16. **粒子/遮罩/滤镜写在能力清单但无内置集**：建议首批 `rain|snow|sakura`（WebGAL 三件套改写），滤镜首批 `blur|brightness|sepia|glitch`(CSS/Pixi filter 直接映射)，遮罩留以后。

## 其他

17. **pi-scaffolding/通用层**：无新增冲突。`draw_image` 一步封装设计被 AI4VN/consistgen 双双印证（生成→检→反馈重画），维持。
18. **播放器渲染技术选型**：文档未定 DOM vs canvas。粒子+滤镜+转场混合若要做，PixiJS（MIT）是被 WebGAL/pixi-vn 双验证的路线；若只做 DOM+CSS，粒子和 RGBA 混合换表情做不了——建议规格明确“舞台层 PixiJS，UI 层 DOM”。证据：WebGAL 全 Pixi 舞台、pixi-vn 全 Pixi。
