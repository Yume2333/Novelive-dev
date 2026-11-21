# 第四轮调研：gpt-image 2.x 提示词与画师技能

> 2026-11-21 第四轮：生图提示词调研与实测。汇总见 `../gap-ledger-r4.md`。

## 一、gpt-image 2.x 提示词与去 AI 感

## 编号发现

1. **官方参数表（2.6）**：`quality` 控制可渲染的视觉细节量（纹理、小字），档位 `low|medium|high|xhigh|max|auto`；`complexity` 存在，控制「渲染前的规划量」，`low|medium|high`，**两模型默认都是 high**。官方建议：版式已写死时提高 complexity 差别不大；定点编辑从 `low` 起步。→ `complexity=low` 是最直接的"少发明细节"旋钮，值得 A/B。来源：https://developers.openai.com/api/docs/guides/image-prompting（2026-11 读取，2.6 版文档）。

2. **`revised_prompt` / prompt 改写**：API 参考明写「Not returned by GPT image models」——**gpt-image 系不做 DALL·E 式 prompt 改写**，写什么渲染什么（文档只在 SVG 模式提到 `prompt_rewriter`）。来源：https://developers.openai.com/api/reference/resources/images/methods/generate。意味着压细节只能靠提示词本身+参数，不会被改写器"补料"。

3. **`style` 参数**：`vivid|natural` 是遗留参数，**GPT image 模型不支持**，风格只能写进 prompt。`negative_prompt`/`negativePrompt` 参数不存在——Novelive 的 `draw_image.negativePrompt` 字段会被模型当正文读或丢弃，见第 4 条。同源 API 参考。

4. **否定式措辞是反模式**（有论文背书）：无 `negative_prompt` 通道时，「no/avoid/without + 名词」会把该名词以正权重嵌入——"no watermark"≈画水印。CVPR2024「pink elephant」实验证明 DALL·E 3 会强化被禁止概念。**社区分歧**：官方 prompt 范例大量使用「No extra text」「Avoid clip art」且工作（gpt-image 指令遵循强于扩散模型）；但 7ebastian/gpt-image-2 参考库（2026-04-26）主张全部改写成正向描述："matte natural surface" 替代 "no plastic"。折中：排除项用「正向排他描述」（"single subject in frame""edge-to-edge composition"），PRESERVE 列表用正向名词枚举。来源：https://github.com/7ebastian/gpt-image-2/blob/main/references/negative-prompting-antipattern.md。

5. **quality 档位与细节密度**：S Anand 实测（2026-09-26）`low` 已能产出真实皮肤/织物/拉丝金属，**`low` 生成的细节更少**（2880px 放大对比才看得出）；`high` 细节明显增多；`xhigh/max` 盲测与 high 无差异但贵 4-35 倍。→ 想压细节先试 `quality=low|medium`，而不是继续堆 prompt。来源：https://www.s-anand.net/blog/quality-levels-of-gpt-image-2.5-flare/。

6. **最有效的反碎片化配方（日文 note，"監獄プロンプト"，2026-08-05，配实测前后图）**：正向写法——`clean flat anime rendering, flat color planes, broad clean color planes, large simple shadow shapes, clear value separation, crisp silhouette, minimal internal noise, grouped hair masses, minimal strand detail`；关键指令 `translate detail into clean, organized, medium-scale design language rather than micro-texture or noisy fine detail`、`Prioritize silhouette clarity over micro-detail`。作者结论：易碎的素材（卷发、破布、薄纱）要单独"丸める"（圆整化）；对本来就平涂的图效果有限。来源：https://note.com/ezumi_gameover/n/n3f2bc13d9e2e。——**Owner 的反碎块几乎肯定是此文的浓缩/改写**（"large simple color masses"≈"broad clean color planes"，"low visual frequency/restrained edge density"≈"minimal internal noise/micro-texture"的转述），[INFERENCE]。

7. **风格词选有明确规则的媒介**比情绪词稳：zulo.dev 单变量测试 11 种插画风格（gpt-image-1.5，2026-02 更新 2026-09）："flat vector editorial, clean geometric shapes, crisp edges, minimal shading, limited palette"、"storybook gouache, matte opaque brush strokes"、"linocut high contrast two-tone" 都成立；结构 = scene lock + style treatment + control block。来源：https://www.zulo.dev/blog/ai-illustration-styles-for-ai-prompts。

8. **动漫圈实证**：elser.ai（2026-08-05）"No Plastic Face" 规则有效短语：`matte skin texture, no shine`、`traditional cel animation look`、`hand-drawn line art with slight roughness`、`pencil texture on lines`；给 Ghibli 风必须写 "no harsh lines, watercolor texture" 否则默认成干净数码 anime。反例：speed lines 会过量，需 "moderate speed lines"。来源：https://www.elser.ai/blog/gpt-image-2-anime-style-prompts-that-actually-work。

9. **结构 > 散文**：官方指南推荐 labeled sections（scene/subject/details/constraints），顺序 = 用途→场景→主体→细节→约束；社区复测（r/ChatGPT 55 赞，2026-09-10）8 条规则：先点名交付物、描述可见物、文字加引号、编辑用"改 X 留 Y"单行。来源：官方指南 + https://www.reddit.com/r/ChatGPT/comments/1wcatvx/。

10. **编辑稳定性**：2.5 起是严格 change-vs-preserve 模型；第 3 轮起丢 preservation 列表就漂移；参考图必须编号分工（"image 1 = identity, image 2 = style only"），否则不可控混合。来源：https://www.reddit.com/r/PromptEngineering/comments/1wutavh/（2026-10-01，28 赞）+ 官方 rule 7/8。

11. **中英 prompt 差异（实测，图叮 2026-04-28）**：英文风格/技术词粒度细、跨张一致性高；中文文化语境（民国、北平）还原好但风格词"按中文文艺感填空"会漂。**混合式**：主体/场景用中文 + 风格与渲染参数用英文，比纯中文稳 ~30%。[非 OpenAI 一手] 来源：https://tudingai.cn/blog/202604/ai-retouch-chinese-vs-english-prompt-cross-border/。

12. **美术理论词汇**模型可识别（社区反复验证）：`clear value separation`（明暗分组）、`silhouette clarity`、`shape grouping`、`hard/soft edges`、`flat color planes`、`negative space`、`limited palette`、`two-tone`、`screentone`。"notan/lost-and-found edges" 未见实证 [INFERENCE]——但语义等价物（"clear value separation""soft lost edges in shadows, hard edges at silhouette"）与已验证词同族，可测。

## A/B 候选（英文块，拼在现有中文主体后）

A. 平涂压制块（正向）：
```
Rendering: clean flat anime rendering, broad flat color planes, large simple shadow shapes, clear value separation, crisp silhouette, minimal internal contour lines, grouped hair and fabric masses, medium-scale detail only. Translate fine detail into clean organized shapes rather than micro-texture.
```
B. 日系"监狱"变体：A + `cel-shading base with restrained gradients, smooth elegant planes, controlled clean details, broad specular bands only where the material demands it`。
C. 美术理论变体：`two-three value groups per object, hard edges at focal silhouettes, soft lost edges inside shadow masses, restrained edge density`。
D. 排除行（对照组，验证否定词是否反噬）：`Avoid micro-texture, speckled highlights, scratchy linework, cluttered background.`
E. 参考图为主：prompt 只写"render in the exact rendering style of reference image 1; keep details at the same scale"，靠主视觉图传风格。

**API 旋钮**：`complexity` low vs high（默认）首选；`quality` low/medium vs high；模型 flare vs sunburst（sunburst 官方定位"更多细节"——碎感重者 flare 可能反而合适 [INFERENCE]）；编辑用 `markup` 圈定区域。

## 二、教 Agent 写生图提示词（Codex imagegen、VNCCS 等）

## 各来源做法

**1. Codex 内置 imagegen 技能**（`~/.codex/skills/.system/imagegen/`，上游 `github.com/openai/skills` `skills/.system/imagegen/` 与 `codex-rs/skills/src/assets/samples/imagegen/`）
- SKILL.md：18.8KB 的完整技能。核心是"标签化脚手架"（`:120`）——`Use case / Asset type / Primary request / Input images / Scene / Subject / Style / Composition / Lighting / Palette / Materials / Text(verbatim) / Constraints / Avoid`，明确标注是"提示词脚手架，不是封闭 schema"。
- 具体度政策（prompting.md "Specificity policy"）：**已具体→只规范化不加料；笼统→"仅当能实质改善时"加构图/用途/版式提示**。禁止增扩：未暗示的角色/物体、品牌/叙事、任意左右摆放。这正是防过度增扩的机制。
- 迭代规则："从干净的基础提示词开始，单次单点修改；每轮重复关键约束/不变量防漂移"（prompting.md "Iterate deliberately"）。
- 参考图：每张按序号标角色（"Image 1: edit target; Image 2: style reference"），风格/构图参考不当作编辑目标。
- 代码侧：`_augment_prompt_fields`（image_gen.py:262-290）把 CLI flag 拼成同样的标签块——增扩逻辑在代码与技能文本两处同构。
- 用例分类法：11 个 generate + 8 个 edit slug，每类给一句话 tips。

**2. gpt-image-1.5 官方 prompting guide**（openai-cookbook `image-gen-1.5-prompting_guide.ipynb`）
- 与 skill 同源的 8 条原则：固定顺序（背景→主体→细节→约束）、用用途定打磨度、照片感用镜头/光圈词而非"8K/ultra-detailed"（**明确说通用画质词不如摄影语言有效**）、编辑用 "change only X; keep everything else the same" 且每轮重述、引用图按编号描述交互。

**3. Anthropic skills**（github.com/anthropics/skills）
- canvas-design / algorithmic-art：不教图像提示词，而是**两步法**——先写 4-6 段"美学哲学 .md"（运动名+空间/色彩/尺度/节奏），再让同一模型把哲学表达成产物。相当于把风格圣经物化成中间工件。algorithmic-art 有"FIXED vs VARIABLE"清单：固定骨架由模板持有，变量部分由 agent 填——正是"代码拥有风格块 + agent 填内容槽"的范式。
- 反面教训：它反复强调"masterpiece / meticulously crafted / top of their field"这类词——对代码生成有效，但这是文本激励，进图像提示词就是我们要禁的词。

**4. 泄露的 ChatGPT 图像系统提示词**
- DALL-E 3 工具规范（spdustin/ChatGPT-AutoExpert `_system-prompts/dall-e.md`）：9 条政策，关键结构——开头必说图像类型（photo/oil painting/…）、只写一次 prompt 不复述、"一段极具体客观的描述，每段超 3 句"。重写在工具层，用户 prompt 被规范化后才进模型。
- ChatGPT-4o `image_gen` 工具（leaked-system-prompts.com 2025-09-27）：几乎不教提示词写法，只管触发条件、身份保护、安全拒绝——说明 gpt-image 代不再需要重写器，提示词职责前移给调用方。

**5. ComfyUI_VNCCS**（github.com/AHEKOT/ComfyUI_VNCCS）——最有参考价值
- `character_template/qi2_prompt_rewriter.txt`：LLM 只做"忠实翻译"——JSON 字段逐字段展开成视觉句，**"不是创意补全；无最低字数；不许发明值；显式特征优先于刻板印象；不许加故事/情绪/填充空间"**。风格/参考/画质词由**应用程序拼接在 LLM 输出之后**（"The application appends Style/Reference AFTER your output… Do not mention medium, art style… quality tags"）。这是标准的代码拥有风格块+agent 填内容槽。
- `qwen_image_21_t2i_system_prompt.txt`：八步重写器——"observer 视角陈述画面"（第三人称陈述句，不用 "create/make sure"）；显式禁词：**"No quality boosters — no 'masterpiece', '8K', 'highly detailed', 'award-winning'"**；长度定量（~20 句 / 400-500 词）；色彩必带修饰词；枚举不许概括。

**6. Nano Banana 官方指南**（deepmind.google/models/gemini-image/prompt-guide）：五槽公式——Style(或媒介)+Subject+Action+Setting+Composition；引用图按名字命名保一致性。和 gpt-image 指南同构：标签化槽位而非自由散文。

**7. VN/游戏资产管线**：ComfyUI_VNCCS 之外多为 SD/Flux 系（Farl/ai_visual_novel_generator 用 flux+白底伪透明），gpt-image 系的 VN 管线开源样本稀少 [INFERENCE]。共性：逐资产模板（立绘帧/背景 16:9/表情只改脸）与我们 briefs.mjs 的 STYLE/SPRITE_FRAME/EXPR 常量一致——业界共识是**模板在代码里，不在模型脑子里**。

## 推荐技能架构

**代码持有（拼接进 prompt，agent 不可见可改）：**
- 风格块：STYLE 行 + 反碎片化块（"large simple color masses, low visual frequency…"），所有画师共用同一常量。
- 每资产类型模板：SPRITE_FRAME（立绘）、16:9+中央4:3安全区（场景/CG）、EXPR_PROMPT 的不变量清单（差分）。
- 参考图角色声明句（visuals.md 已定：工具在提示词头部生成"第 N 张是 X 的角色设定图"）。
- negativePrompt → `Avoid:` 尾部拼接；审核失败追加降敏句。

**agent 只填内容槽：** 主体、动作、服装、氛围——一个场景句 + 若干主体句，不写风格词、不写构图句、不写参考图声明。

**技能文本必教：** 观察者陈述句（不用"画一张/确保"）；具体度政策（brief 已具体就不加料）；每轮迭代只改一处并重述 keep-list；编辑类强制 "change only X" 句式。

**禁词表（中英文）：** masterpiece、杰作、best quality、highly detailed、8K/4K、ultra-detailed、intricate、精美、细节丰富、award-winning、光影大片、电影级（场景画师 "电影感构图" 建议改"构图参照参考图"）、任何 artist 名、画质标签堆砌；同时禁 Danbooru 标签语法（gpt-image 吃自然语言）。

**长度上限：** 立绘/CG ≤150 中文字等效（参考 VNCCS 的 ~500 英文词对应单主体复杂场景；我们更克制，r3 样例已在 100-150 字区间且效果可用 [INFERENCE]）；差分 ≤60 字 + keep-list。内容槽不超过 3 个句组。

**迭代协议：** 视觉审核 feedback 追加尾部；每次重画只动失败项对应槽位；keep-list 每轮全量重述；3 次内不逐轮重写整段 prompt。
