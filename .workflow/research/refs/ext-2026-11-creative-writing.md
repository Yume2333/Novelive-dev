# 创意写作提示词与改编质量评测调研

调研目标：为 Novelive 的写手、审稿、写手预设、忠实度评测集找可抄/可参考的提示词模式与评分规约。重点中文创意写作与小说→视觉小说改编。
源码克隆到 /tmp 实地阅读（eqbench-cw、longform-bench、antislop-sampler、slop-forensics、ai-novel-gen、long-novel-gpt、autonovel、qiaomu、novel2galgame、t2vn、quaiwei、humanizer）。

## 逐项目结论

### 1. EQ-Bench Creative Writing v3 — github.com/EQ-bench/creative-writing-bench
- **License**：仓库根目录无 LICENSE（仅字体许可），按 all-rights-reserved 处理 → **只参考**，引用量控制在小段。
- **机制**（README + core/benchmark.py）：32 个写作提示 × 3 迭代（每迭代注入一个 `<SEED>` 位替换为 seed_modifier，10 选 1），温度 0.7 / min_p 0.1。混合评分：先按 21 条 rubric 0-20 分打分（GLM 5.3 低推理档），再用成对比较（Claude Opus 5）喂 Glicko-2 变体算 Elo，锚定 deepseek-r1=1500 归一。
- **rubric 清单**（`data/creative_writing_criteria.txt`，21 条）：Adherence to Instructions / Believable Character Actions / Nuanced Characters / Consistent Voice-Tone / Imagery and Descriptive Quality / Elegant Prose / Emotionally Engaging / Emotionally Complex / Coherent / Meandering↓ / Weak Dialogue↓ / Tell-Don't-Show↓ / Unsurprising or Uncreative↓ / Amateurish↓ / Purple Prose↓ / Overwrought↓ / Incongruent Ending Positivity↓ / Unearned Transformations↓ / Well-earned Lightness or Darkness / Sentences Flow Naturally / Overall Reader Engagement / Overall Impression。↓=负向项（`negative_criteria.txt` 9 条，scoring.py 里 20-x 翻转计入）。
- **judging prompt 要点**（`creative_writing_judging_prompt.txt`）：0-20 分制、"20 是传世杰作"锚点、"与该篇无关的标准不计"、"忽略正文后模型自加的评论"、"你是苛刻的批评家，尤其要挑业余和失败之处"、先写 [Analysis] 长评再出 [Scores]。这套"先分析后打分 + 明确苛刻人设 + 负向项单列"的结构可直接抄进我们的审稿/评测 judge。
- **pairwise prompt**（`pairwise_prompt.txt`）：9 条比较维度（character authenticity / interesting-original / writing quality / coherence / instruction following / world-atmosphere / avoids cliches / avoids verbosity / avoids poetic overload），每条必分胜负，+ 到 +++++ 表差距。匿名编号 A0493/A0488 消名字偏差，双向跑 A|B 和 B|A 消位置偏差，截断到等长消长度偏差——这三个偏差控制手段是我们评测集必须抄的。
- **landing spot**：`.workflow` 质量评测集（decisions 2026-11-21 已采纳）的 judge rubric 骨架 + 负向项清单；成对比较协议用于"换预设/换模型后新旧剧本对比"。**判决：移植改写**（rubric 结构+判分协议照搬，条目改写成中文版并加上改编特有项如"对白保留原意"）。

### 2. EQ-Bench Longform Writing Bench — github.com/EQ-bench/longform-writing-bench
- **License**：**MIT**（README 末尾 "MIT. Attribution appreciated but not required"）→ 可抄。
- **机制**：8 章中长篇，每章 ~1000 词。生成端是多轮对话式 planning pipeline：prompt1 头脑风暴+反思 → prompt2 写意图+逐章计划 → **prompt3 让模型讨论"人类会怎么写这篇、LLM 常见陷阱（爱写安全的、爱大圆满、为炫技牺牲可读性）并自我批判计划里的 LLM 套路"** → prompt4 定稿计划 → prompt5 逐个写角色卡（背景/怪癖/身体性/动机/台词示例）→ 逐章 `prompt_chapter_first/intermediate/last` 正文。
- **chapter judging**（`longform_creative_writing_judging_prompt_chapter.txt`）：每章单独评，输入给写作提示+最终计划+角色卡+该章文本，14 条 criteria 含 **Followed Chapter Plan / Characters Consistent with Profile / Faithful to Writing Prompt** 三条"对计划与设定忠实"项——这是和我们"忠实于原文/设定集"最像的现成维度。
- **final judging** 另加 Pacing / World Building / Unearned Transformations，criteria_weights.json 给 Forced Poetry 权重 5、Purple Prose 权重 1（负向项可单独加权）。
- **对我们的价值**：(a) prompt3 的"anti-LLM 套路自我批判"是一手可移植的提示词技巧——写手生成前/后插一轮"指出本稿哪里像 LLM"能显著提升人味，对应我们审稿环节可加一类"AI 味/套路"检查；(b) "Followed Chapter Plan + Characters Consistent with Profile"两条 rubric 直接是我们需要的"剧本对分场大纲/设定集切片忠实"维度；(c) 长文按"计划→角色卡→逐章→每章评+全书评"两级评测的组织方式可照搬到我们的质量评测集。**判决：直接拷贝**（pipeline 提示词结构 + 两类 rubric 文本，翻成中文并替换 plan/profile 为我们的场景大纲/设定集）。

### 3. sam-paech/antislop-sampler + slop-forensics — Apache-2.0 / MIT
- **License**：antislop-sampler **Apache-2.0**；slop-forensics **MIT**。
- **antislop-sampler**：HF/vLLM 本地 logit 层的"禁词回溯采样器"——命中 slop 短语就回溯到短语起点、压概率重采。我们走远端 API 模型，**logit 层用不了**；但它的数据资产可用：
  - `slop_phrases_2025-04-07.json`（2500 条高频 LLM 套语，如 "took a deep breath" 28671 次、"voice barely above a whisper" 19295 次、"couldn't help but feel" 15254 次）——**这是统计实证的英文 slop 榜**，前几十条翻译成中文就是现成禁用清单。
  - `slop_regexes.txt`（"not X but Y" 类结构正则）。
  - `slop_phrase_prob_adjustments.json`（517 条加权降概率表）。
- **slop-forensics**：slop 的**生成方法论**——`find_over_represented_words`（模型语料 n-gram 频率 ÷ wordfreq 基线频率，按比值排序）+ `calculate_slop_index`（命中短语数 × 权重 / 总词数 × 1000）。我们可以用同一套方法，拿真实中文 LLM 输出 vs 中文网文语料算自己的中文 slop 榜，比翻译英文榜更准。
- **landing spot**：(a) 写手预设的"输出替换规则"可用 slop 短语做**生成后正则/字符串替换**（对应 Luker regex 的 AI_OUTPUT 道）；(b) 审稿的"AI 味"检查项可把高频 slop 词表喂给 judge 做辅助；(c) 质量评测集可加一个**机械 slop 分**（每千字命中数），不依赖模型 judge，回归时先看这个。**判决：数据移植改写**（slop 清单本地化 + 检测方法照抄；采样器代码不要）。

### 4. qiaomu-novel-generator — github.com/joeseesun/qiaomu-novel-generator，**MIT**
- 乔木的 Claude Skill，专写中文短篇。**这是本次调研里和我们的写手预设契合度最高的单一项目**。
- `references/anti-ai-language.md`：**中文版 antislop 清单**，含硬规则（"不是X而是Y" 叙事中目标为零、允许对话中至多一次且须符合人物口吻）+ 改写对照表（"他不是害怕死亡，而是害怕被遗忘" → "他怕死，也怕棺材合上以后没人记得他来过"）+ 禁用词（总之/综上所述/关键在于/让我们/想象一个世界/这不仅是…更是…/这就是…的意义）+ "误导性诗意开头"检测（"死人走进了酒肆" 这类字面不可能的钩子要锚定）+ 可执行的自查正则列表。**判决：直接拷贝**进写手预设默认输出约束 + 审稿检查项 + 输出替换规则。
- `references/genre-quality-rubric.md`：**按"读者承诺"分 14 个题材**（爽文逆袭/复仇/甜宠/虐恋/女性成长/悬疑/恐怖/情感现实/修仙/进阶升级/科幻/职场/组织讽刺/武侠）的质量 rubric，每题材 4-6 条具体可判的检查点（如复仇要"伤害具体可感、反击靠铺垫和证据、惩罚对对手的方法、复仇开出道德代价"）。**判决：移植改写**——我们按作品题材取相应子集注进审稿提示词和评测集标注。
- `references/quality-checklist.md`：七查清单（开篇钩子 3 段内出现扰动/人物欲望可见/冲突由选择而非巧合升级/场景有具体人物物件地点动作/对白带压力不解释/结尾回收前文意象或台词）。
- `references/story-engine-library.md`：情绪承诺 → 高压关系 → 冲突场 → 引擎组合 → 升级/钩子节奏的五层公式；十种情绪 payoff 类型表（逆袭爽/复仇爽/打脸爽/成长燃/悬疑惊/甜宠爽/虐恋拉扯/女性成长/生存压迫/黑色反转）。
- 工作流亮点：Intent Hook → （可选搜索）→ Inspiration Remix → Story Engine 选引擎 → 前置访谈 → Strategy → Draft → **Anti-AI Language Hook** → Quality Hook，把"去 AI 味"做成独立后置关卡而非混在生成里。**判决：直接拷贝** anti-ai-language.md + genre rubric + 七查清单；分层工作流思路参考。

### 5. LifelongLazyLearner/qu-ai-wei — **MIT**
- 简体中文"去 AI 味"编辑技能，`references/pattern-catalog.md` 是**带证据等级标注的中文 AI 症状目录**（中文实证/中文研究启发/跨语言启发/编辑实践四级），引用 CCL 2023/2025、ACL/EMNLP 2024 实测文献。每条按"骨架/触发/保护/动作/复扫"五段写——"保护"段明确什么情况下不算 slop，防止误杀，这点比英文 slop 列表精细。
- 对我们最有用的条目：低信息密度复述、泛化缺细节、无证据拔高、假平衡正向缝合、表面分析假揭示（"看似X本质Y"）、推论台阶连接词链、开头复述任务、任意分层模板、段落过齐、收尾复述升华、主干后置修饰过载、翻译式代词被动定语链、词汇语义复现、抽象名词化弱动词（"进行/实现/推动+抽象名词"）、限定词安全垫串联、**对称骨架族**（不是而是/并非只是/不仅也更/看似本质/既是也是更是/从X到Y再到Z——含跨句跨段变体识别）、三连机械排比、句长句式过齐、预判标签假口语。
- **判决：直接拷贝**进审稿检查项（"AI 味"维度）和写手预设默认约束；其"触发/保护"双条件写法是我们审稿"只列有把握的问题"的完美模板——每条检查写明什么算命中、什么情况放行。

### 6. blader/humanizer — **MIT**
- 英文版同类技能（qu-ai-wei 的部分来源），`SKILL.md` 把 AI 味按严重度分 22 条，最强 5 条"一见即改"：§1 Not X but Y（含跨句变体识别）、§2 一句话收尾和戏剧化断句、§3 假装深刻的熟语（the real question is/at its core/X is the Y of Z）、§4-5 格式套用。**先找毛病再整段重写而非逐句打补丁**的编辑流程值得抄进我们的"写手按问题改一遍"环节。
- **判决：只参考**——中文版用 qu-ai-wei + qiaomu 已够，humanizer 的方法论（按强度分级 + 整段重写）吸收即可。

### 7. lin1753/novel2galgame — **Apache-2.0**
- **和我们产品形态最接近的项目**：中文小说 → Ren'Py 视觉小说，7-Agent 流水线（结构识别→叙事解析→台词归属→场景分割→VN映射→视觉提示→忠实度审核）+ RAG。`data/prompts/` 六个提示词全部可读。
- `narrative-parsing.md`：叙事单元五分类（dialogue/narration/thought/action/scene_description），置信度 + 严格 JSON 转义要求（中文引号策略——`"`必须转义或换`“”`，给了正反例，这个坑他们的审计报告里专门写过）。
- `scene-segmentation.md`：场景边界五信号（地点→时间→事件→焦点→闪回），场景粒度 5-30 叙事单元，unitId 白名单约束防编造。
- `attribution.md`：台词归属——speakerId/actorId/thinkerId 分设，participantIds，uncertain 标记 + evidence 判定依据，"已知角色必须复用 ID 不得新造"、临时角色 isMinor、角色别名表累积。
- `vn-mapping.md`：VN 导演规则写得非常细——站位五档（单 center、双 left/right、三 main center+far dim、四分列）、景别五档（waist 50-60% 默认/bust 30%/closeup 10%/thigh 群像/full_body 初登场）、强调 focus/dim、镜头动效五招（shake_heavy=争吵受击/shake_light=迟疑心慌/zoom_in_slow=表白沉思/zoom_punch=震惊揭晓/flash_white=回忆重击，**"只在情绪转折点用，每场最多 2-3 次"**）、对白原文保留、非原文添加 ≤5%、每步挂 sourceUnitIds。
- `fidelity-review.md`：**忠实度审核 rubric 直接是我们要的**——7 类缺陷（dialogue_rewrite 对白被改写 / content_omission 重要内容遗漏 / wrong_attribution 说话人标错 / type_mismatch 内心独白或动作被降级成旁白 / order_changed 顺序改变 / unsupported_addition 加了原文没有的内容 / semantic_drift 语义偏离）× 3 严重级（minor/major/critical），逐条对比 VN 步骤与原始单元、对白一字不差、给修复建议。
- **实战证据**（docs/AUDIT_AND_FIX_GUIDE.md）：他们真实跑 7 本书 298 章后复盘——fidelity review 能检出 226 个 critical 遗漏（85.8% 场景未过自审），但最初没接修复闭环；修复做法是把 issues 当 context 回灌 vn-mapping 重跑。这验证了我们"审稿列问题→写手改一遍"的 loop 是必要的，也提示**审稿必须带"退回重写"通路**。
- **判决：直接拷贝** fidelity-review 的 7 类缺陷分类作为我们审稿检查维度的主干（改写成我们的 .nvs 语境），attribution/scene/vn-mapping 的判定规则移植改写到写手和美术导演提示词。

### 8. yamasoo/text_2_visual_novel（t2vn）— **MIT**
- 台湾项目，小说→Ren'Py，特点是**规则表极其详尽且有人工标注黄金集**。
- `docs/20_標註規則.md` + `prompts/annotate_system.md`：台词/旁白转换的判定表是我们可直接抄的最完整版本——引号内→对白去引号；同段被动作分开的两截话合成一句对白、中间动作成旁白放前；**纯说话标记（"她说。""老张问。"）删掉因为 VN 显示名字**，但带情绪/动作/否定的（"艾莉打断他""声音压得很平"）保留成旁白或表情；有"她想"的内心独白→主角对白、自由间接引语保留旁白；被打断的话保留破折号。
- **说话人推断顺序**：同段说话标记 → 上下句称呼（"艾莉姐"）→ 对话轮替 → 语气内容；轮替推断的标 `u:true`/`?` 给校对。
- **表情八选**（neutral/smile/sad/angry/surprised/worried/serious/embarrassed）+ 原文线索对照表 + "拿不准选较平的"（serious>angry、worried>sad）+ 无线索沿用上句表情——**这个保守表情策略正好治 LLM 爱给夸张表情的毛病**。
- 分场规则：一场 8-25 段最多 35、少 4 段不独立成场、一章 3-6 场、边界以段为单位。
- QA 机制：`vn-qa` 用**没看过开发过程的新对话**独立验收（防"自己审自己"）；`source_para` 逐行回比原文算覆盖率。
- **判决：直接拷贝**标注规则表翻成简中进我们 .nvs 写手的剧本格式说明（对白/旁白/内心独白的转换规则、说话人推断顺序、表情对照与保守策略、分场粒度）+ 审稿的"对白归属"检查项。

### 9. YILING0013/AI_NovelGenerator — **AGPL-3.0 → 只参考**
- 演化到很复杂的 task_flows/defaults/ 88 个提示词。核心可借鉴思想：
  - **知识状态感知**：`facts.values` 已确认 / `facts.unknown` 未知 / `blockers` 待复核三级，提示词反复强调"作者知道的秘密不等于人物知道""计划里的 end_state 不是当前状态""记忆物品已消耗就不能再支付""没附的全书剧情保持未知不自行补终局"——这套"**信息可知性边界**"写法正好回答我们"写手看全书梗概但不提前揭晓"的诉求，比单句"不要剧透"严密得多。**移植改写**进写手提示词的防剧透段。
  - **写后检查链**：check_chapter_world_rules / character_relation / item_owner / psychological_state 系列——生成后按选定规则逐条核对，issues 带 `quote`（逐字引用）+ `start`（码点位置）+ `rule_ids`，"引文只证明出处不证明疑点正确，仍需人审"。和我们"审稿定位到句子"同构，可抄"逐字 quote + 位置"的输出格式。
  - 分场规划 plan_scenes：场景在篇章下章节上、start_state 承接前项 end_state、"不把尚未发生的节拍提前写成完成"。
- **判决：只参考**（AGPL 不能抄文本，但其"可知性边界/检查链/quote 定位"设计思想吸收进审稿与写手提示词）。

### 10. FredericMN/AutoNovel — **MIT**（AI_NovelGenerator 早期 MIT 系 fork/重构）
- `custom_prompts/` 26 个提示词可直接读。
- `critique_prompt.txt`：**现成的中文审稿提示词**——"以严苛著称的资深文学编辑"，从四维度批 3-5 个最严重问题：逻辑漏洞（行为违动机/人设）、节奏张力（冗长对话/高潮铺垫不足）、**描写文风（"AI 味"过重的重复句式/感官描写匮乏）**、连贯性（是否承上章结尾/与前文冲突/重复开篇重复设定），格式 `1. [问题类型] 具体问题 -> 修改建议`。**判决：直接拷贝**作我们审稿提示词的骨架，把"连贯性"维度扩展成对照原文+设定集的忠实度检查。
- `next_chapter_draft_prompt.txt`：章节写作的上下文七件套（前文摘要/卷架构/未解决伏笔/前章结尾段/用户指导/角色状态/本章摘要+下一章目录）+ 知识库三级过滤 + **角色动机合理性约束四则**（动机驱动、动机演变需触发事件+心理展现、决策前写"价值天平"、不合理行为清单）+ 防重复约束（相似度>40% 重构/20-40% 换 3 要素/<20% 保留核心改表现）。动机约束部分**移植改写**进写手提示词。
- `chapter_blueprint_prompt.txt`：分章蓝图含"悬念单元 3-5 章/认知过山车 2 紧张 1 缓冲/每章定位+核心悬念类型+情感基调迁移+伏笔操作（埋设/强化/回收）+认知颠覆 1-5 级"——伏笔操作四态可抄进综合阶段的 VolumeSkeleton。
- `plot_arcs_update_prompt.txt`：伏笔分级 A/B/C（主线/支线/细节）+ 只记录不预测不解决 + 已解决标记移至末尾——**直接拷贝**进我们的伏笔追踪（设定集伏笔条目）。
- `update_character_state_prompt.txt`：角色状态文档 + S/A/B 级角色升降级策略（核心角色永不降级即使死亡/非核心按活跃度降级/临时角色淡出即删）。
- `knowledge_filter_prompt.txt`：检索内容按"情节燃料/人物维度/世界碎片/叙事技法"分类 + 价值分级 + 冲突标记——参考。

### 11. MaoXiaoYuZ/Long-Novel-GPT — license 不明（README 未标）→ 只参考
- `prompts/` 中文目录结构完整。**两个值得抄的模式**：
  - **多轮 context 注入换 prompt cache**（`context_prompt.txt` 注释明说"多轮对话每轮输入一个信息，这样设计为了 Prompt Caching"）：每个 context 块一轮 user/assistant 确认，而非一个大 system——但我们 pi 栈是自己拼 Context，这个模式可用（把不变的前缀块拆成几轮）。
  - **审阅分件**（`审阅/审阅剧情.txt`/`审阅大纲.txt`/`审阅正文.txt`）：**正文审阅明确"只评格式文笔画面感，不评结构情节"**——审稿按稿件类型限定评判范围，防止越权，这个"审稿边界声明"要抄进我们审稿提示词。
  - 提炼系列（拆书：提炼剧情 1 行≤50 字对应一场/提炼章节大纲起因经过高潮结果/提炼全书大纲只关脉络不逐章）——和我们整理角色的章节预览同构，其"不延申不改编不总结推演"的约束写法可抄。
  - 生成意见（`生成创作正文的意见`）：`###思考`直击核心 + `###意见`精准犀利——简洁的编辑意见格式。

### 12. SillyTavern 写作预设（继承 refs/luker.md + refs/sillytavern-chat-ui.md）
- ST 自带 sysprompt 极简（"You are an intelligent, skilled, versatile writer"），真正有内容的是社区预设。**Lucid Loom v3.3**（prolix-oc/ST-Presets，抓取 /tmp/lucidloom.json，316 个 prompt 块的模块化 preset）里可移植的写作块：
  - **Repetition Repair**（防重复修复）："已建立的细节只在戏剧必需时出现/锚点轮换/感官通道轮换（视觉→听觉→触觉→温度→嗅觉→动觉）/重要性靠渲染质量不靠断言'闻所未闻'"——直接可抄进写手预设约束。
  - **Immersion Lock**：叙事只写当前场景能听到感到看到尝到的、空间距离要交代路径——对应我们场景内写作约束。
  - **Aperture of Cynicism**：高摩擦叙事——"世界展示冷漠而非肮脏、每个胜利留疤、不给白来的奇迹、若走向廉价希望就剪断重系"——是很好的"虐文/严肃向"预设块。
  - **Emotional Deflections**（情感曲写）：对白绕弯、欲言又止、拒绝回答、幽默来自人物与环境碰撞和dramatic irony、内心声音以碎片浮现不带"他想"、压缩动作放大安静时刻、长铺垫后短句落情感点——**这是治"对话太直白"的现成预设块**。
  - **Japanese Web Novel**：轻小说式第一人称内省+日常吐槽+技能通知+喜剧反应镜头——对应中文网文"系统流/吐槽流"预设。
  - **Endless Storytelling**：句式建筑激进变化（长句烟雾状+短句拳击+断片）、对白拆散穿插叙事动作、避免"动作→对白→观察"重复套路。
  - 预设结构本身：模块化可勾选（POV/时态/叙事风格/故事目标/难度/感官/节奏各成一类，每类选一项）——**这是我们写手预设的界面模型**：不是一整段文风文本，而是分类可选的块。决策已定"文风说明、输出约束自由文本 + 采样参数 + 输出替换规则"，可以在此基础上加一层"分类风格块"的预置库。
- **判决：移植改写**——风格块文本改写成中文进写手预设库；"分类可选风格块"的预设结构参考进预设 UI 设计；ST 的完整预设体系（prompt_order/深度注入）仍按已定决策不学。

### 13. 中文 AI 味研究 — 雷德麥 blog（zake7749.github.io/2026/08/30）
- 非代码项目，但**论证最贴合我们的写手/审稿架构**。核心论点：
  - AI 味 = "技巧用歪了（直接公布答案）+ 用满了（句句设喻段段转折）"，量化成**修辞预算**（譬喻/排比/设问/强转折都是支出，要在文眼集中而非均摊）。
  - **show-then-tell 检测**：前文已 show 过的再 tell 一遍是最常见毛病（例子：白描动作后又写"他终于明白她是真的要离开"）。给了可操作的 Judge 三步判定（目标句是否带来新动作/是否改变关系/是让解读更精确还是重复读者刚想到的）。
  - **段落尺度跃升**：具体场景过早抽向人生主题，治法是段落级 Writer Spec（每段给"任务/可用材料/禁止事项/停止条件"，如"禁止直接说明父亲的感情、禁止延伸到成长告别人生"）——这个 Spec 格式可以直接抄进我们的场景级写作指令。
  - **Plan→Write→Reflect→更新计划** 的交错循环。
  - **关键证据：Judge 自己也有 AI 味**——若 judge 偏爱完整明确有结论的文章，层层筛选只会得到"句句合格的高级八股文"。⚠️ 这直接警告我们的审稿：**不能把审稿做成"全部规则都过一遍才算合格"，否则会反向压平文风**——我们"只列有把握的问题、改完不再复审"的设计恰好规避了这个风险，有证据支持。
  - **Skill 用于 polish 而非 writing**：一堆限制直接塞进生成会漏+压出另一种 AI 味（引用 DeCRIM EMNLP 2024、Style over Story ACL 2026、LLM 创意续写不确定性低于作家 arXiv 2602.16162）——**先自由写稿、再在成稿的小范围做规则层编修**比"限制前置"更优。这支持我们"写手预设只放文风和输出约束、质量靠审稿后置"的分工。
- **判决：只参考**（博客非代码），但"修辞预算/show-then-tell 判定/段落 Spec 四元组/Judge 有 AI 味"四个概念直接进设计。

### 14. 忠实度评测方法（外部方法学，非小说）
- QAFactEval（salesforce，**BSD-3**）：QA 式事实一致性——从产出抽答案点出题、拿原文作答、比对，含 answerability 过滤。改编场景可对应"剧本断言的事实是否被原文支持"。
- 综述（Trust but Verify, RANLP 2025）：QA-based 指标对齐人类判断最好且错误可解释；LLM-judge 灵活但贵、提示词敏感；推荐混合。
- novel2galgame 的 fidelity-review（第 7 条）实质就是改编版 faithfulness rubric，且以"对话一字不差/重要内容不遗漏/无 unsupported_addition"为核心——**改编忠实度比摘要忠实度多了"内容遗漏覆盖"和"顺序/归属正确"两维**。
- Raj Murugan 实验：judge 对长原文的忠实度判断会失效（full posts 完美、短源反而多报），提示**评测集原文切片要控制长度**。
- **判决：移植改写**——评测集标注按"逐句/逐场景原文覆盖 + 对白逐字 + 新增内容标 unsupported"三件套，judge rubric 借 novel2galgame 7 类缺陷 + EQ-Bench 判分结构。

### 15. 闭源中文写作产品（蛙蛙写作/笔灵/秘塔写作猫/量子位 Weaver）
- 商业化闭源，无提示词可拿。公开信息只有产品层面：蛙蛙（波形智能 Weaver 模型）有"拆书/总纲章纲/小说转剧本/短剧漫剧"全流程、5000+ 工作流；量子位报道其"个性化知识库适配用户风格"。**判决：不要**（无可抄物，仅作功能参照）。

## 关键模式清单（可直接落成提示词/规约）

**P1 — 审稿检查项分类（合成自 novel2galgame fidelity 7 类 + AutoNovel 4 维 + qu-ai-wei/qiaomu AI 味）**，建议我们审稿"只列有把握的问题"按以下 8 类组织：
1. 对白忠实：对白被改写/原意口吻走样/一字不差检查
2. 归属：说话人标错（含内心独白归属主角判定）
3. 类型降级：内心独白或动作被写成普通旁白（type_mismatch）
4. 遗漏：重要情节/台词/细节未进剧本（content_omission，对照原文段落范围核对）
5. 新增：剧本出现原文没有的情节/设定（unsupported_addition）
6. 顺序/连贯：事件顺序错乱、不接上章结尾、与已确认设定冲突
7. 文风：AI 味/套路句式（对称骨架、修辞预算超支、show-then-tell、尺度跃升、收尾升华）
8. 动机合理：角色行为违动机无铺垫转变

**P2 — 审稿判定纪律**（抄 qu-ai-wei 的"触发/保护"双条件 + novel2galgame 严重度）：
- 每条 issue：`type + severity(minor/major/critical) + quote(逐字引用) + position + evidence(判定依据) + suggestion`。
- "quote 逐字引用只证明出处，不证明疑点成立"——允许列疑点但禁止把推断写成事实。
- 只列有把握的；拿不准的不列（对应 t2vn 表情"选较平的"保守策略）。
- 审稿边界声明：按稿件类型限定评判范围（抄 long-novel-gpt"只评格式文笔画面感不评结构情节"的写法）。

**P3 — 写手提示词防剧透/可知性边界**（抄 AI_NovelGenerator，改写）：区分"作品作者视角的计划/梗概（可看）"与"人物当时可知的信息（必守）"——"作者知道的秘密不等于人物已经知道""计划终点是后续边界不是本章必须提前完成的目标""已消耗的资源不能再支付""未附的全书剧情保持未知，不自行补终局"。

**P4 — 写手风格约束**（合成）：
- 修辞预算：譬喻/排比/设问/强转折是支出，集中于文眼，不均摊（雷德麥）。
- show-don't-tell + 禁 show-then-tell：前文已 show 的不许再 tell（三问判定）。
- 段落禁止尺度跃升：具体场景不提前抽向人生主题。
- 对白要承载压力不解释；允许绕弯、欲言又止、拒绝回答（Lucid Loom Emotional Deflections）。
- 句式节奏主动变化；感官通道轮换；已建立的细节不重复锚定（Repetition Repair）。
- 表情/语气保守：拿不准选较平的（t2vn）。
- 动机驱动 + 转变需触发事件 + 决策前价值天平（AutoNovel）。

**P5 — 输出替换规则默认集**（写手预设的"输出替换规则"出厂内容）：
- qiaomu 自查正则（不是.*而是 / 不在于.*在于 / 总之|综上所述|总而言之 / 关键在于|值得注意的是|让我们|想象一个世界 / 这不仅.*更是 / 这就是.*的意义 / 死人.*走|尸体.*开口）——命中→重写而非机械替换。
- sam-paech slop 榜前 ~100 条的中文对应（"深吸一口气""嘴角勾起一抹笑""空气仿佛凝固"类——需自行用 slop-forensics 方法在中文语料上重新统计，直接翻译英文榜覆盖不全）。
- 机械清理：代码块围栏/BOM/零宽字符/markdown 标题残留（已有决策）。

**P6 — 评测集设计**（合成 EQ-Bench + novel2galgame + QAFactEval）：
- 标注对象：从测试用书挑的片段（别名/伏笔/换装/超长章/多角色群像/内心独白密度高/对白密集——已有决策），每段标"必须保留的对白句、必须出现的情节点、允许的压缩范围、禁止新增的边界"。
- Judge rubric（中文，0-20，负向项单列）：忠实原文情节 / 对白保留原意口吻 / 归属正确 / 内心独白未降级 / 重要内容无遗漏 / 无原文外新增 / 设定一致 / 衔接上章 / 场景切分合理 / 对白有戏剧张力 / 旁白精炼有画面感 / AI 味低（负）/ 尺度跃升（负）/ 修辞预算超支（负）/ 节奏拖沓（负）/ 句式过齐（负）/ 整体演出效果。
- 判分协议（抄 EQ-Bench）：先写 [Analysis] 再出 [Scores]、苛刻批评家人设、无关维度不计、忽略模型自评、负向项翻转计分。
- 成对比较协议：新旧版本匿名 A/B、双向跑、截断等长，9 条必分胜负（改写自 pairwise_prompt，条目换成改编维度）。
- 机械指标兜底：解析通过率、对白逐字保留率、source 段落覆盖率、每千字 slop 命中数、句式长度方差——这些不依赖 judge、回归最快。

## 和我们现有设计冲突或缺口（含证据）

1. **缺口：审稿缺"忠实度缺陷分类"** — 现设计只说"对照原文和设定集找问题、只列有把握的"，没有缺陷分类学。novel2galgame 7 类缺陷 + AutoNovel 4 维 + 上面 P1 的 8 类可直接填这个空；尤其 "type_mismatch（独白降级为旁白）" 和 "unsupported_addition" 是改编特有、必须单列的。

2. **缺口：审稿输出格式未定** — 建议抄 AI_NovelGenerator 检查链的 `{issues:[{type,severity,quote,start,rule_ids}]}` 结构：逐字 quote + 码点位置，便于程序回指到 .nvs 行和原文段落，也便于"写手按问题改"时定位。

3. **缺口：写手提示词没有"可知性边界"的严格写法** — 现设计一句"提示词要求不提前揭晓"太弱。AI_NovelGenerator 的三级知识状态（values/unknown/blockers）+ "作者知道≠人物知道""计划终点≠当前状态"的措辞可直接改写进写手系统提示，配合设定集"截到本章"的代码过滤形成双保险。

4. **缺口：剧本语言的对白/旁白/独白转换规则未成文** — docs/work-format.md 只定义了 .nvs 语法，没写"原文→剧本"的转换判定规则。t2vn 标注规则表（说话标记删除条件、两截话合并、内心独白仅"她想"标记才转 player、自由间接引语留旁白、被打断保留破折号）是现成的中文版规则，应补进写手的剧本格式说明。

5. **缺口：写手预设的结构** — 现决策"文风说明自由文本"容易写成一整段不可维护的散文。Lucid Loom 的"分类可选风格块"（POV/叙事风格/节奏/情感策略各选一项）证明模块化可行；建议预设库内置若干可勾选风格块（含上面的 P4 约束集 + qiaomu 题材 rubric 对应的文风包），自由文本仍保留作覆盖层。

6. **缺口：无机械质量指标** — 评测集决策只说"人工标注对比"。建议加不依赖 judge 的机械项：对白逐字保留率（原文引号句 ↔ .nvs 对白行的字符串对齐）、source 覆盖率、slop 命中密度、句长方差。sam-paech 方法可自建中文 slop 榜。

7. **冲突（轻微）：审稿默认关的隐患** — 现设计审稿是作品开关默认关。证据面（novel2galgame 85.8% 场景自审未过 critical、AI 味在改编中高发）表明"忠实度检查"和"文风打磨"应分开：前者（对白忠实/遗漏/归属/新增）错误成本高、建议常开或至少首章强开；后者（AI 味）成本高易误杀、保持可选。可以把审稿拆成"忠实度检查（常开）+ 文风审稿（开关）"两档——novel2galgame 的 fidelity-review 是独立 agent、AutoNovel 的 critique 是可关步骤，两个先例都支持分离。

8. **证据支持的现状决策**：
   - "审稿只列有把握的问题、改完不再复审" ✓ — 自指评审收敛/放大数据偏的证据（self-refine 综述：intrinsic 自批 unreliable；雷德麥"judge 有 AI 味会筛出高级八股"）支持"不无限循环、不过度审稿"；我们"主模型审写作模型 + 工具查证据"是 grounded critique，优于 ungrounded self-refine。
   - "写手不用工具、材料代码备好" ✓ — EQ-Bench 写作模型普遍工具弱；longform bench 的"提示词给齐 plan+角色卡+前文"同构。
   - "局部修复只退回出错场景" ✓ — wenyi 的对齐协议"整批重试→逐段兜底"同思路。
   - "衔接用上一章剧本结尾原文而非滚动摘要" ✓ — wenyi 用译文原文后缀防漂移，同结论。

9. **风险记录：Judge/审稿的系统性偏差** — EQ-Bench about 页实测"extremely warm & validating"注入能让 rubric+1.3%/Elo+2.8%；Judge 偏爱完整有结论的文风。我们评测集若用同一主模型当 judge 又当写手，要警惕 family bias——judge 与被测模型分开（pi-scaffolding vitest-evals 结论一致）。

10. **不要做的**：
    - antislop 的 logit 层采样器（远端 API 拿不到 logits）；
    - AI_NovelGenerator 全文（AGPL）；
    - EQ-Bench v3 代码与 rubric 原文整段复制（无 license，只可参考结构和短引用）；
    - SillyTavern prompt_order/世界书注入体系（已定决策不学）；
    - 闭源产品（蛙蛙/笔灵/秘塔）无可取文本。

## 文件索引（/tmp 下已克隆，可复查）
- /tmp/eqbench-cw/data/{creative_writing_criteria,negative_criteria,creative_writing_judging_prompt,pairwise_prompt,creative_writing_prompts_v3,slop_*}.txt/.json；core/{scoring,metrics,benchmark}.py
- /tmp/longform-bench/data/{prompt1..5,prompt_chapter_*,longform_creative_writing_*}.txt；criteria_weights.json（MIT）
- /tmp/antislop-sampler/slop_phrases_2025-04-07.json、slop_regexes.txt、slop_phrase_prob_adjustments.json（Apache-2.0）
- /tmp/slop-forensics/slop_forensics/{analysis,metrics,slop_lists}.py（MIT）
- /tmp/qiaomu/references/{anti-ai-language,genre-quality-rubric,quality-checklist,story-engine-library}.md（MIT）
- /tmp/quaiwei/references/pattern-catalog.md（MIT）
- /tmp/humanizer/SKILL.md（MIT）
- /tmp/novel2galgame/data/prompts/{narrative-parsing,attribution,scene-segmentation,vn-mapping,fidelity-review,visual-prompt}.md（Apache-2.0）；docs/AUDIT_AND_FIX_GUIDE.md
- /tmp/t2vn/docs/20_標註規則.md、prompts/{annotate_system,extract_system}.md、skills/vn-*/SKILL.md（MIT）
- /tmp/ai-novel-gen/backend/services/task_flows/defaults/*.md（AGPL，只参考）
- /tmp/long-novel-gpt/prompts/**（license 不明，只参考）
- /tmp/autonovel/custom_prompts/*.txt（MIT）
- /tmp/lucidloom.json（ST 社区预设，Lucid Loom v3.3）
