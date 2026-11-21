# 调研：长篇小说改编 / AI 写作 Agent / 小说转剧本·漫画·VN·视频流水线

2026-11-21。范围：长篇小说改编、AI 小说写作 Agent、novel→script/comic/VN/video 流水线、互动小说、故事一致性（设定集/时间线）、长上下文分章处理、LLM 文学翻译的一致性。共 24 个条目，6 个读源码（AI4VisualNovel、ViMax、ai-webnovel-pipeline、novel-to-script-team、novel-to-storyboard、inkos），4 个读了核心代码（Dramatron、DOC/Re3、MovieAgent、novelvids），其余 README/论文级。克隆副本在 `/tmp/fiction-research/`。

对照我们的设计：`docs/creation-pipeline.md`（逐章预览→按卷综合→两个确认点→写/审稿/演出/出图）、`docs/bible.md`（设定集三层结构、候选/确认、"变化"列表、截至本章切片）、`.workflow/research/agent-orchestration.md`（九角色、单次调用 vs 工具循环、提示顺序）、`.workflow/research/novelive-agent.md`（各阶段契约）。

## 一、逐条评估

### A. 长篇小说生成与大纲控制

**1. Dramatron（google-deepmind）** — https://github.com/google-deepmind/dramatron — Apache-2.0
- 是什么：层级式剧本共写系统。log line → 标题 → 角色表 → 场景梗概（每场景：地点/剧情节点/beat）→ 每个地点描述 → 逐场景对话。单文件 colab（`colab/dramatron.ipynb`，~40KB 代码）。
- 深读所得：每场对话生成的 prompt = `DIALOG_PROMPT 前缀 + 本场景地点描述 + 只在 beat 文本里出现名字的角色描述 + plot_element + 全书 summary + 上一场景 beat + 本场景 beat`（`prefix_summary` + `generate_dialog`）。**关键手法：按名字是否出现在 beat 里过滤角色描述**——和我们"截至本章设定切片只含本章出场人物"完全同构。另有 `detect_loop` 防重复、`rewrite` 把人工编辑同步回结构化对象。
- 取什么：①"角色描述按场景出场过滤"印证了我们切片规则的粒度；②每个结构化产物（Title/Characters/Scenes/Place）有 `from_string`/`to_string` 双方向文本表示，人工可改文本、系统回解析——对应我们"提议卡 + 差异列表"的思路。
- 落地：通用层（上下文组装）。判定：**只参考**（手法印证已有设计；代码是 colab 单文件，没有可移植模块）。

**2. DOC / Re3（yangkevin2，Berkeley）** — https://github.com/yangkevin2/doc-story-generation（MIT）、https://github.com/facebookresearch/doc-storygen-v2（更新版）、https://github.com/yangkevin2/emnlp22-re3-story-generation（MIT）
- 是什么：Re3 = plan（premise/setting/角色+大纲）→ draft（逐段写，按相关性重排序大纲条目进 prompt）→ rewrite（检测事实矛盾再改）。DOC = 更细的递归大纲树 + detailed controller（写作时强制当前大纲条目相关）+ 实体矛盾检测。
- 深读所得（`story_generation/plan_module/outline.py`、`edit_module/entity.py`）：①大纲是树，`recursively_expand_to_depth` 每个节点生成 2–5 个子事件，候选重排序后选；②**实体一致性靠"infobox 属性抽取 + 相互关系蕴含检查"**：给每个实体抽 `Attribute: Value`，新写入的属性要和已有属性做 NLI 矛盾打分（`complete_mutual_relations`），矛盾概率高就触发编辑；③`infer_is_character` 用"是角色还是地点/物品/事件？Yes/No"三选一投票。
- 取什么：①"属性级矛盾检测"比我们"候选不冲突直接用、冲突挂起"更细——它们查的是**新条目和已有条目字段级蕴含矛盾**，可借鉴到我们 `BiblePatch` 合并时的冲突判定（代码侧做关键词/LLM 蕴含检查，而不是只靠"同 ID 字段不同"）；②大纲递归扩张对应按卷综合时的"卷骨架→章梗概"两级展开。
- 落地：按卷综合（主控）/ 设定冲突检测。判定：**只参考**（NLI/共指依赖 GPT3 时代的 logprobs 与 sentence-transformers，不能照抄；思路可用）。

**3. Re3 的滚动上下文**（同 2）— 它 draft 时给模型的上下文 = plan 全部 + **已写正文末尾固定长度后缀** + 当前大纲条目。和 wenyi 结论一致、和我们"上一章剧本结尾原文衔接"一致。**只参考**（印证）。

**4. StoryWriter（THUDM，CIKM'25）** — https://arxiv.org/abs/2506.16445 — 论文 CC BY-NC-SA，代码仓库 THUDM/StoryWriter 未见发布
- 是什么：大纲→逐章计划→写正文三 Agent，外加"历史信息压缩成结构化 state"传递。
- 取什么：①它把"已写历史"不存摘要而存**结构化状态**（人物状态、事件、关系），和我们 ChapterPreview+bible 切片同向；②验证"逐章生成时带全书大纲"的必要性。
- 判定：**只参考**（无代码）。

**5. Agents' Room（Google DeepMind，ICLR'25）** — https://arxiv.org/abs/2410.02603 — 论文 only
- 是什么：写作拆成 planner→writer→editor 三阶段多 agent 协作，每轮讨论后定稿。
- 判定：**只参考**（会议式多 agent 讨论，token 开销大；我们一章一次写手调用已决定）。

**6. Weaver（Chinese LLM for creative writing）** — https://arxiv.org/abs/2401.17268 — 论文；模型未开源
- 是什么：专为创意写作微调 + RAG/function calling 原生支持；提出 WriteBench 评测。
- 取什么：它的评测维度（风格、文学性、想象力、切题）可当**我们质量评测集**的标注维度参考。
- 判定：**只参考**。

**7. LongWriter（THUDM）** — https://github.com/THUDM/LongWriter — Apache-2.0
- 是什么：AgentWrite "plan-then-write" pipeline 造长文 SFT 数据，训出能写 1 万词的模型；附带 LongWrite-Ruler 评测。
- 判定：**只参考**（我们不做训练；plan-then-write 已采用）。

**8. FactTrack（UIUC/Berkeley，NAACL'25）** — https://arxiv.org/abs/2407.16347 — 论文；代码 https://github.com/cogito233/FactTrack 未公开（克隆 404）
- 是什么：把故事大纲分解成原子事实 + 每个事实在时间线上的有效区间，做**时间感知的世界状态追踪**来查矛盾。
- 取什么：**概念直接对应我们"变化列表 + 截至第 N 章切片"**。它证明了"每个事实带有效区间、按章过滤"是检测/预防设定矛盾的正解。我们 bible.md 已实现同构机制，此论文是理论背书；它额外做的"事实递归分解"我们不需要。
- 判定：**只参考**。

**9. ai-webnovel-pipeline（XZ-LI）** — https://github.com/XZ-LI/ai-webnovel-pipeline — MIT — **深读**
- 是什么：Claude Code/Cursor 里跑的中文网文连载 skill，目标百万字级、300+ 章一致性。Python 脚本 + 提示词文件，核心在 `references/method.md`（分层记忆设计文档）和 `scripts/write_novel.py`（~2000 行）。
- 深读所得——**七层记忆结构**（这是本报告里最值得吸收的设计）：
  1. `hard_constraints`：违反即整章作废的红线断言，置顶渲染 + 结尾再强调一遍。**必须人工过目**（模型自己挑的不准）。写法要求"可直接检查的断言"（"主角不能说话"可以；"人物要有成长"不行）。
  2. `bible.json`：世界规则 + 全部人物档案 + 总走向，每 10 章据摘要自动重写刷新。
  3. `open_threads` 伏笔台账：`{thread, planted_chapter, status: open|paid}`，兑现标 paid 不删；按埋设早晚排序、常驻 ≤12 条、>30 章未兑现标"该考虑收了"；**单章最多登记 2 条**——实测模型会把每个未解释名词都报成伏笔，不设上限三章就攒出 15 条噪音。
  4. `knows` 信息边界：每人物 `{"what", "chapter"}` 列表，记"他第几章知道了什么"；写作提示词明文禁止"人物依据不在 knows 里的信息行动/反应"。**这是最隐蔽的崩坏**：A 第 7 章死了，第 20 章 B 表现得像知道——不像矛盾那样显眼，但读者立刻察觉"他怎么会知道"。
  5. `arc_digests.jsonl`：每弧（30 章）压成 200–300 字提要，常驻最近 8 弧、更早合并成一行。
  6. `arc_plan.txt`：当前 30 章细化计划，弧满自动生成下一弧，可出 3 个候选版本人工挑。
  7. `summaries.jsonl` + 最近 2 章原文：最近 10 章摘要进上下文，更早的折成一行"已压缩入故事圣经"。
  - 工程细节同样值钱：每 10 章重写 bible 时**模型不认 `knows` 字段会整层丢掉**——用 `reconcile_bible()` 代码逐人物比对回填（"提示词管不住的东西要在代码里兜住"）；章型六循环防连打十章；防重复扫描最近两章开篇手法写进提示词禁用；`status` 命令实际构造一次提示词再量 token（不按公式估）。
- 取什么：①**`hard_constraints` 层整个抄**——我们改编要求/规则里没有"违反即作废"的机制，红线断言 + 双位置渲染可直接搬进"本作品规则"的语义；②**`knows` 信息边界是我们设定集没有的维度**（bible.md 只有"变化"管字段值，不管"谁知道什么"）——审稿角色查一致性时这是最容易漏的类；③伏笔"单章登记上限 + 按埋设早晚排序 + 超期标注"三个代码侧规则可直接移植到我们 `foreshadowing.json` 的渲染逻辑；④ bible 刷新时保留模型不认识字段的代码保护（我们 `BiblePatch` 合并逻辑同理要在代码侧做字段级合并，不能整对象覆盖）；⑤输入 token 实测做法（构造真实 prompt 再量）对应我们上下文长度检查。
- 落地：bible.md（加 knows/红线字段）、整理/写手的上下文组装、审稿的检查项。判定：**移植改写**（设计文档和常量直接参考；代码是 Claude Code skill 形态，不嵌我们 pi 栈）。

### B. 小说→剧本 / 分镜 / 视频 流水线

**10. ViMax（HKUDS）** — https://github.com/HKUDS/ViMax — MIT — **深读**
- 是什么：idea→video / novel→movie / script→video 三条流水线。novel→movie 和我们最像：小说 → 压缩 → 抽事件 → 每事件检索原文块 → 抽场景 → 跨场合并角色 → 角色立绘 → 每场景派生图 → 剧本 → 视频。
- 深读所得（`pipelines/novel2movie_pipeline.py` 1010 行、`agents/` 14 个 agent）：
  - `NovelCompressor`：RecursiveCharacterTextSplitter 切块（64K 块、8K 重叠）→ 每块压缩 → `aggregate` 提示词专做**相邻块重叠去重**（重叠语义相同措辞不同，保后者/自然版）。比我们"长章按段落切段、段间带衔接"多了一步显式合并调用。
  - `EventExtractor`：**事件流式抽取**——把全文 + 已抽事件列表喂回去，每次只抽"下一个事件"，直到模型自报 `is_last`（上限 50 防死循环）。事件带 `process_chain`（过程链）。
  - **关键设计：事件→原文检索**。对每个事件的每个 process，用 embedding similarity_search 找回原文 k=10 块、rerank ≥0.7 分保留——**场景生成只给检索到的原文块，不灌整章**。这和我们"写手拿到本章原文"（章是我们天然边界）不同，但**审稿查证据**时可以借用：按问题检索相关段落而不是全章。
  - `GlobalInformationPlanner.merge_characters_across_scenes_in_event`：同一事件内不同场景抽出的角色描述**再合并一次**成事件级角色（静态特征/动态特征分开），再跨事件合并成全书级角色表。对应我们"候选条目冲突合并"，它多了一层"场景→事件→全书"三级。
  - 角色图：`generate_base_portrait`（基准立绘）→ 每场景 `generate_scene_portrait` 从基准图**编辑派生**当场景的造型——和我们"造型基准图 + 表情编辑派生"完全同构，MIT 可抄做法。
  - 恢复：中间产物按 `event_{i}/scene_{j}.json` 落盘，已存在且 is_last 就跳过——和我们"每步存下来接着做"一致。
- 取什么：①aggregate 去重调用（长章切段摘要后可加一次合并）；②事件级"下一个"抽取协议 + is_last 自报 + 硬上限；③原文检索块喂场景（审稿证据工具的实现参考）；④场景级角色图从基准派生。
- 落地：整理（长章合并）、审稿（证据检索）、美术导演/画师（派生关系）。判定：**移植改写**（Python/LangChain，我们只取管道结构和提示词；`_normalize_asset_reference_text` 这类资产名替换代码思路可参考）。

**11. novelvids / 猫影短剧（Anning01）** — https://github.com/Anning01/novelvids — MIT — **读了核心代码**
- 是什么：小说→短剧全流程生产平台（FastAPI + Vue）：章节拆分、实体提取、参考图生成、分镜生成、视频合成。工业级、体量大（`services/` ~80 模块）。
- 深读所得：`services/chapter_screenplay.py` 的**乐观并发协议**值得直接抄——提交改编任务时把 `source_version = fingerprint([chapter.name, chapter.content])` 和 `screenplay_version = fingerprint(expected_screenplay)` 快照进任务参数；执行前和落盘前各 `verify_source()` 一次，指纹变了就报"原文或剧本已修改，请刷新后查看"。**防止 LLM 跑了几分钟回来覆盖掉用户刚手动改过的内容**——我们"写剧本任务进行中创作者改了原文/设定"场景正缺这个。
- `prompts/story_memory.py`：每章产出的"故事记忆"不是摘要而是**给下一次创作直接用的世界+阶段快照**，要求"区分已发生的事/人物推测/未执行的计划""未知保持未知，切勿从书名/资产/分镜补造事实"——比我们的 ChapterPreview 多了"推测 vs 事实"的区分和防脑补条款。
- `prompts/storyboard.py` 的 `_normalize_asset_reference_text`：分镜文本里 `@资产名` 引用正规化——台词、引文、铭文先 protect 占位再替换，别名消歧（一个别名只在一个资产无歧义时才映射）。我们 `scene.source` 原文引用、素材名校验可借这套"先保护字面内容再匹配资产名"的做法。
- 取什么：①fingerprint 快照+双验证协议；②story memory 的"事实/推测/计划三分 + 未知不补"条款；③资产名自动补标前先做引文保护和别名消歧。
- 落地：通用层（任务快照防覆盖）、整理（preview 加"推测/计划"字段）、剧本检查（素材名匹配）。判定：**移植改写**。

**12. novel-to-script-team（Supreme-Ultimate）** — https://github.com/Supreme-Ultimate/novel-to-script-team — MIT — **深读**
- 是什么：Claude Code 多 agent 多 skill 小说改编影视流水线：改编分析→洞察→分集→情绪设计→剧本→审核→连续性→分镜视频化。16 个 agent .md + 23 个 skill + 22 篇 references 方法论文档。
- 深读所得：
  - `agents/continuity-recorder.md`：专职连续性记录员，每次写集/审核后更新 `knowledge/project-memory.md`：剧情决策、角色状态变化、伏笔埋设与回收、集级爽点、**待处理一致性风险**。比我们 bible 多"决策记录"和"风险挂账"两类。
  - `references/04-review-gates.md`：**四遍修改法**——删冗余（主线无关砍）→ 强化冲突戏眼 → 修技术错误（格式/错别字/逻辑）→ 观众视角通读。每遍有 FAIL 标准，任一 FAIL 回改复审。我们审稿目前只"列有把握的问题"，这套分遍清单可直接当审稿系统提示词的骨架。
  - `agents/script-comparator.md`：评价标准量化——对话比例 ≥70%、句长 10–14 字符、短句比例 30–40%、视觉标记密度 3–5 个/100 字。**把"网文感/可拍性"变成可检查的数字指标**——对应我们质量评测集可加的自动指标。
  - `show-dont-tell-skill`：专查抽象心理描写改成可镜头呈现的动作/表情/道具。
- 取什么：①四遍审稿清单；②可量化检查指标（对白占比、视觉标记密度）；③ continuity 记录里"决策/风险"两列。
- 落地：审稿角色的检查清单、质量评测集指标。判定：**移植改写**（skill 是 markdown 文档，思路和方法论直接搬；agent 编排是 Claude Code 的，不用）。

**13. novel-to-storyboard（Chengsiyu-web）** — https://github.com/Chengsiyu-web/novel-to-storyboard — MIT — **深读**
- 是什么：三段式 LLM 调用把小说正文转成结构化分镜表：①按"时空单元"拆镜头组 + 原文剧本转写（删掉对画面无贡献的文字）②镜头组内"能合就合"拆单镜头 ③补景别/机位/运镜/资产 ID。
- 深读所得（`prompts/call1_scene_split.txt` 等 3 个提示词 + `src/pipeline.py` 183 行）：
  - call1 的**剧本转写判断标准**可直接借给我们写手："这段文字是否指向一个具体的、可在画面或声音中呈现的效果？"动作轨迹/光影/声音保留；纯心理无外化压成 ≤15 字旁白或删；作者对读者的引导删除——**这正是"长段环境描写压成短旁白"的操作化定义**。
  - call2 的"能合就合"：每个 Shot 对应一次生成任务，切镜默认不切，只有内容确实无法在一个 Shot 呈现才切。**对应我们场景划分的保守倾向**（场景碎→演出指令碎→素材关联碎）。
  - 资产绑定：模型输出 `@资产ID` 绑定到预定义资产表。
- 取什么：①剧本转写的"可呈现性"判断标准；②分镜/场景"能合就合"的保守切分原则写进写手和美术导演提示词。
- 落地：写手（改写判断）、美术导演（分场粒度）。判定：**移植改写**（提示词可直接翻译采用，代码本身薄）。

**14. MovieAgent（showlab，NUS）** — https://github.com/showlab/MovieAgent — 未见 LICENSE 文件（只读参考）
- 是什么：script + 角色库 → 多场景多镜头长视频。CoT 规划：编剧分子剧本 → 剧本总监审核 → 导演拆场景（带情绪基调/视觉风格/道具/音乐/运镜）→ 分镜。
- 深读所得（`movie_agent/system_prompts.py`）：它的**分场提示词内置"内部 CoT 再输出"两阶段**——先要求"分析叙事结构、列角色互动、定场景边界"作为 JSON 的一个 key，再输出正式场景表。还有"Involving Characters 只能用已给角色名、不许加修饰语"这类防幻觉条款；`scriptsupervisor-sys` 是"当前子剧本和梗概比是否合理 yes/no + 理由"的轻量审核点。
- 取什么：①分场时带"为什么要这样分"的理由字段（我们写手分场也要求写 `source` 段落范围，同理可加一句理由帮助审稿核对）；②角色名白名单条款；③轻量 yes/no 审核点（比全量复审便宜）。
- 判定：**只参考**（无 LICENSE；提示词思路可记）。

**15. novelToScreenplay（qudder）** — https://github.com/qudder/novelToScreenplay — 未见 LICENSE
- 是什么：章节解析、叙事信息抽取、场景拆分、剧本生成、分镜生图、视频任务管理的中文流水线。条目级参考，未深读。判定：**只参考**。

**16. ScriptPilot-AI（JettXiang）** — https://github.com/JettXiang/ScriptPilot-AI — 未见 LICENSE（YAML 结构化输出的 novel→screenplay workbench）。判定：**只参考**。

**17. Toonflow-app（HBAI-Ltd）** — https://github.com/HBAI-Ltd/Toonflow-app — MIT
- 是什么：短剧/漫剧创作平台，无限画布编排剧本/分镜/角色素材/图/视频。README 级：章节级工作流、角色场景参考图、programmable provider。和我们差异在它是画布编排工具不是自动流水线。判定：**只参考**（产品形态）。

### C. AI 视觉小说

**18. AI4VisualNovel（ttsmallHot）** — https://github.com/ttsmallHot/AI4VisualNovel — Apache-2.0 — **深读**
- 是什么：需求 → VN 成品的多 agent 框架：Producer（ReAct 审核）→ Designer（游戏大纲 + story_graph）→ Writer（节点切剧情片段→合成剧本）→ **Actor（每角色一个，角色扮演演绎 + 第一人称视角审核立绘）**→ Artist（立绘/背景/CG）。DAG 剧情图拓扑排序遍历。Pygame 引擎 + 可导出 Ren'Py。
- 深读所得（`agents/` 3000 行）：
  - `story_graph.py`：DAG + merge 节点（多父汇合）+ 拓扑排序 + 环路检测 + `enumerate_all_paths`。我们是线性小说不需要分支，但它的**节点 schema（`{id, summary, type: normal|merge}` + `{from, to, choice_text}` 边）**是"剧情骨架→分章"的干净参考。
  - **Actor 用第一人称视角审立绘**（`IMAGE_CRITIQUE_PROMPT`）："你现在要审核为你生成的立绘……以'我'的口吻，发色/眼睛/服装/表情对不对，PASS 或具体意见"。比客观审核更贴合角色设定，且 REVISE 意见自带可喂回生图的修改描述。我们视觉审核是客观第三人称，可以加"角色口吻"变体试试效果。
  - 立绘 prompt 模板（`IMAGE_PROMPT_TEMPLATE`）：vertical、upper body（waist up）、forward、standing、**SOLID WHITE BACKGROUND 方便抠图**、动态姿势+手势匹配表情和性格、表情不单改脸。与我们竖版透明底不同——它用白底再抠图；我们用原生透明底。但"表情要带肢体动作，不是只换脸"这条我们差分"只改一处"反而约束了。
  - 表情派生：先出 neutral 基准图，其他表情**以 neutral 为参考图编辑生成**（`generate_character_images` 排序 neutral 优先、自动加载参考）——和我们编辑派生一致。
  - 剧本合成：多个 Actor 各自按片段"表演"（写自己台词），Writer 把多角色表演日志整合成剧本。和我们写手一次写整章不同——多 Actor 演绎更像"角色驱动对话"，质量可能更高但贵 N 倍。
- 取什么：①Actor 第一人称审立绘的提示词角度；②角色立绘 prompt 的"上半身/正面/表情带肢体"细则（我们立绘画师提示词要素可吸收"动态姿势匹配性格"一句）；③ DAG 骨架 schema 参考。
- 落地：视觉审核/立绘画师提示词、卷骨架 schema。判定：**移植改写**（Apache-2.0 可抄提示词；它的整体框架是 Python + 它自己的 BaseAgent）。

**19. vina-ai/vina** — https://github.com/vina-ai/vina — Apache-2.0/MIT 双 — **读了代码**
- 是什么：一句话 prompt → Rust 写的 VN 生成器：大纲→场景→剧本（JSON）→ SD 出立绘/背景 → Ren'Py 工程。
- 深读所得：剧本行 schema `{speaker, dialogue, facial_expression}`，表情从**固定枚举** `smiling, crying, nervous, excited, blushing` 里选（`api.rs` function-calling schema 里枚举写死）。和我们"表情登记制"不同——它预枚举我们开放登记+同义合并，我们的更省图。
- 判定：**只参考**（固定表情枚举是反例；Ren'Py 导出思路简单）。

**20. PanProjects/LLM-Visual-Novel、ZzzhangLK/ai-galgame、wiguo/ai-showrunner、Saltedfish20060409/vn-script-studio、joicreate.ai**
- 一批 Ren'Py+LLM 项目。joicreate.ai（JOI Lab）是产品级"prompt→playable VN"闭源/开源混合。整体方向都是"生成→导出 Ren'Py"，没有比我们更深的机制。判定：**只参考**（存在性记录，不逐个展开）。

### D. AI 小说写作 Agent（通用）

**21. inkos（Narcooo/inkos，同 woainielsa 上游）** — https://github.com/Narcooo/inkos — **AGPL-3.0，只看不抄** — **深读**
- 是什么：题材最近的"小说全生命周期 agent"（13 种创作类型：长/短篇小说、剧本、分镜、翻译、同人、互动影游等），TypeScript monorepo（611 个 .ts），`spec/creative-harness-v2.md` 是它的设计契约。
- 深读所得（`packages/core/src/`）：
  - **结构化交付用"强制提交工具"**：`ContinuityAuditor.auditChapter` 走 `submitSourcedReview` + `submit_chapter_review` 工具——模型只有调提交工具才算结束。和我们 `submit_*` + `finishTurn` 设计**完全一致且独立验证**（pi-scaffolding 已记录 inkos 这个做法）。
  - **证据锚定审稿**（`models/observation.ts` 值得细读）：审稿模型产出的每条观察必须带 `sourceRefs: [{sourceId, startLine, endLine}]` 指向**编号后的原文行**；代码 `resolveObservationSources` 把行号解回原文 quote 并校验：行号越界/选中全空白→结构化错误码（`REVIEW_SOURCE_RANGE_INVALID`/`REVIEW_SOURCE_REQUIRED`，带邻近行提示"选真正有支撑的行或撤回"）→ 打回模型重选；quote 必须能在 source 里找到（`REVIEW_SOURCE_MISMATCH`）。**scope 类观察必须同时引用 before/current 两个版本**。这比 wenyi 的审稿更进一步：wenyi 让模型带问题清单查证据，inkos 强制**每条结论必须有行号引用且代码验真**——直接解决了"模型编问题"的风险。
  - **修订范围对比**：`auditChapter` 会找出本章对应的已存 artifact revision，算出 before/current 的 `changedSourceRegion`——作者授权改 A 段，模型连 B 段也动了，会按"越范围"分类并必须同时引用两版。对应我们"重写场景"后差异列表的代码侧核对（我们已在代码做 ID 比对，它做的是文本区域比对）。
  - spec 文档还有几条：`atomic file sets`（多文件写日志化，中断可恢复）、"派生作品保留源版本引用"、图片"先锁外生成、锁内提交"。
  - governed context：上下文按 `selectedContext` 的 source 分桶渲染（`story/pending_hooks.md#`、`story/chapter_summaries.md#`、`story/volume_summaries.md#`），每块标"已选伏笔证据/章节摘要证据/卷级摘要证据"——**每类证据有独立的 source 命名空间**，模型引用时按 sourceId 区分。
- 取什么：①**审稿观察的 sourceRef 行号引用 + 代码验真**整套协议；②"越授权范围"作为单独的观察类别；③ governed context 的分桶证据渲染。AGPL 只能看思路，代码必须自己写（本来就不难，是验证逻辑）。
- 落地：审稿角色的输出契约、剧本检查。判定：**移植改写**（AGPL，按描述自己实现；这是本报告最该吸收的设计之一）。

**22. Novel-OS（mrigankad）** — https://github.com/mrigankad/Novel-OS — 未核 LICENSE
- 是什么：多 agent 写全书，持久 story state + 确定性 continuity engine + 五角色编辑管道。README 级。判定：**只参考**。

**23. graphify-novel（Anshler）** — https://github.com/Anshler/graphify-novel — 未核 LICENSE
- 是什么：知识图谱式写作助手：跨全书追踪角色/线索/世界观，从 premise 搭 story bible，按章审一致性。和 FactTrack/我们 bible 方向一致。判定：**只参考**。

**24. chinese-longnovel-skill（xiaofeng-928）** — https://github.com/xiaofeng-928/chinese-longnovel-skill — 未核 LICENSE
- 是什么：中文长篇写作 skill：分层上下文组装、50 章分阶段规划、**状态回证**、伏笔追踪回收、一致性审查自动修复。和 ai-webnovel-pipeline 同类（SKILL.md 形态）。判定：**只参考**（同类印证，不如 9 详细）。

**25. Long-Novel-GPT（MaoXiaoYuZ）** — https://github.com/MaoXiaoYuZ/Long-Novel-GPT — **无 LICENSE（只读参考）** — 浏览级
- 是什么：大纲-章节-正文自上而下扩写 + RAG 检索相关正文片段和剧情纲要，按意见修改后**同步更新剧情纲要**。停更近一年。
- 取什么：它做的是"改正文→同步改纲要"的双向一致性；我们"按选中原文修改"目前只改剧本不改 bible——它提示了**bible 也可能需要随改动回流**（但我们 bible 是提取产物的定位，回流与否是设计选择）。判定：**只参考**。

### E. LLM 文学翻译 / 跨语言一致性

**26. TransAgents（minghao-wu，TACL'25）** — https://github.com/minghao-wu/transagents — CC BY 4.0（仓库是论文+输出样例，**无代码**）
- 是什么：模拟翻译公司的多 agent（CEO/资深编辑/初级编辑/译者/本地化），专门做超长文学翻译。全局一致性案例：同一成语在第 1906/1907 章保持同一译法（GPT-4 逐章译则两章译法漂移）。
- 取什么：①它证明**章节间术语/风格漂移是逐章独立调用的主要失败模式**——正是我们 glossary+bible 切片要解决的；②它的"MHP 单语人偏好评测"思路（不看原文只评目标语质量）可作我们质量评测集的一个维度。
- 判定：**只参考**（无代码；wenyi 已覆盖更实用的机制）。

**27. wenyi（已在 refs/wenyi.md 深读，GPL-3.0 只看不抄）** — 补充确认：digest map-reduce、插入序术语表保前缀缓存、滚动上下文用原文后缀、对齐协议"N 进 N 出 + 逐段兜底"、影子评审+证据索引。本轮复核后它仍是**最贴近"全书预览"层**的实现；我们已吸收其核心结论。判定：**只参考**（GPL）。

### F. 互动小说 / 状态追踪

**28. BookWorld（alienet1109，ACL'25）** — https://github.com/alienet1109/BookWorld — Apache-2.0（仓库标 MIT 或 Apache，待核）
- 是什么：从小说建角色 agent 社会，角色按设定自主行动生成新故事；做小说→互动式创作的转换。
- 判定：**只参考**（方向是模拟而非改编）。

**29. Story2Game、lono、AI-DnD 等 IF 引擎**
- Story2Game（arxiv 2505.03547）：从故事生成可玩 IF 游戏。SteveCastle/lono：LLM 驱动的故事游戏状态引擎（世界状态 + 玩家输入）。与我们"改编固定小说"目标不同（它们是运行时生成）。判定：**只参考**（存在性记录）。

### G. 一致性评测 / 诊断

**30. ConStory-Bench / "Lost in Stories"（ACL'26 Findings）** — https://github.com/Picrew/ConStory-Bench — 待核 LICENSE；论文 https://aclanthology.org/2026.findings-acl.410
- 是什么：专门测 LLM 长故事自一致性 bug 的 benchmark：角色忘背景、时间线断、世界规则悄悄变。CONSTORY-CHECKER 评测管线。
- 取什么：**我们质量评测集的失败类型清单**可以直接用它的 bug 分类（背景遗忘/时间线/规则变化）。
- 判定：**移植改写**（评测设计借来，不用代码）。

**31. "Mary, the Cheeseburger-Eating Vegetarian"（EACL'26）** — https://aclanthology.org/2026.eacl-long.280 — 论文
- 是什么：测 LLM 能否**识别**叙事不自洽（素食者吃汉堡）——结论是模型自己不擅长发现矛盾。**直接支撑我们"审稿要强制证据引用、不能只靠模型自觉"的设计**。
- 判定：**只参考**。

**32. SCORE（Story Coherence and Retrieval Enhancement，arxiv 2503.23512）** — 论文
- 是什么：动态追踪关键物品/角色状态的 narrative 评测框架；"w/o Dynamic Tracking"一致性掉 17.6 分——证明状态追踪的必要性。
- 判定：**只参考**。

---

## 二、深读笔记（6 个重点）

### inkos（AGPL，只参考思路）
审稿证据锚定是最大收获：`submit_chapter_review` 提交 `{observations:[{code, summary, evidence, category:execution|quality|scope, assessment, sourceRefs:[{sourceId,startLine,endLine}]}], summary}`。`resolveObservationSources` 把行号解回 quote 并三重校验（越界/全空白→打回附邻近行提示；quote 不在原文→`REVIEW_SOURCE_MISMATCH`）。scope 类强制双版本引用。`governed-context` 把上下文按 source 命名空间分桶（hooks/summaries/volume_summaries 各一块）。另：`atomic file sets`（多文件写先记日志再落盘）。

### ViMax（MIT）
novel→movie：压缩切块→aggregate 去重→流式"下一个事件"抽取（is_last 自报+上限 50）→**每事件 process 检索原文块（embedding top10 + rerank ≥0.7）**→逐场景生成（只喂检索块+已生成场景表）→场景角色→事件角色→全书角色三级合并→基准立绘→场景派生图。中间产物 `event_i/scene_j.json` 全落盘可续。

### AI4VisualNovel（Apache-2.0）
Actor agent 双职：角色扮演写台词 + **第一人称审立绘**（PASS/REVISE + 角色口吻意见）。立绘 prompt 固定要素：vertical、waist-up、forward、solid white background（它用白底抠图方案）、姿势手势要匹配表情和性格、不只换脸。表情以 neutral 为参考编辑派生。DAG story_graph 拓扑排序 + merge 节点。

### ai-webnovel-pipeline（MIT）
七层记忆（硬约束/圣经/伏笔台账/knows 信息边界/弧提要/弧计划/摘要+近期原文），输入 token 第 10 章后恒定在 ~19,800。伏笔单章 ≤2 条、常驻 ≤12、>30 章标待收。knows 配禁令"人物不得按不在 knows 里的信息行动"。bible 自动重写后代码 reconcile 回填 knows（模型不认的字段会丢）。硬约束是"违反即整章作废"的可检查断言，人工必审。

### novel-to-script-team（MIT）
四遍审稿法（删冗余→强冲突→修技术→观众通读）每遍 FAIL 标准明确。量化检查指标：对白 ≥70%、句长 10–14 字、短句 30–40%、视觉标记 3–5/100 字。continuity-recorder 记剧情决策+角色变化+伏笔+待处理风险。

### novel-to-storyboard（MIT）
剧本转写判断标准："是否指向可在画面/声音中呈现的具体效果"——保留动作/光影/声音，纯心理压 ≤15 字旁白或删，作者引导删。分镜"能合就合"。`@资产ID` 绑定。

## 三、排序后的采用清单（Top 15）

| # | 取什么 | 来源（许可） | 落点 | 判定 |
|---|--------|-------------|------|------|
| 1 | 审稿观察必须带 sourceRef 行号、代码验真解回 quote；scope 类强制双版本引用 | inkos（AGPL） | 审稿契约 | 移植改写 |
| 2 | 七层记忆里的 `knows` 信息边界：每人物"第几章知道什么" + 写作禁令 | ai-webnovel-pipeline（MIT） | bible 角色字段 + 写手提示词 | 移植改写 |
| 3 | `hard_constraints` 红线断言层：违反即作废、可检查断言、双位置渲染、人工必审 | 同上 | 改编要求/本作品规则 | 移植改写 |
| 4 | 伏笔台账三规则：单章登记上限、按埋设早晚排序、超期标"该收了" | 同上 | foreshadowing.json 渲染 | 移植改写 |
| 5 | fingerprint 快照 + 执行前/落盘前双 verify_source，防 LLM 结果覆盖人工改动 | novelvids（MIT） | 通用层任务协议 | 移植改写 |
| 6 | 剧本转写"可画面/声音呈现"判断标准 + "能合就合"保守分场 | novel-to-storyboard（MIT） | 写手/美术导演提示词 | 移植改写 |
| 7 | 四遍审稿法 + 量化指标（对白占比、句长、视觉标记密度） | novel-to-script-team（MIT） | 审稿检查清单、评测集指标 | 移植改写 |
| 8 | 长章切段后的 aggregate 去重合并调用 | ViMax（MIT） | 整理（超长章预览） | 移植改写 |
| 9 | 事件流式抽取："下一个事件" + is_last 自报 + 硬上限 | ViMax（MIT） | 整理/按卷综合 | 移植改写 |
| 10 | 审稿证据检索：按问题 embedding+rerank 找原文块而非灌全章 | ViMax（MIT） | 审稿工具 | 移植改写 |
| 11 | story memory 的"事实/推测/计划三分 + 未知不补造"条款 | novelvids（MIT） | ChapterPreview schema | 移植改写 |
| 12 | Actor 第一人称审立绘；立绘 prompt"姿势匹配表情性格"要素 | AI4VisualNovel（Apache-2.0） | 视觉审核/立绘画师 | 移植改写 |
| 13 | 角色描述按"名字是否出现在本场"过滤 | Dramatron（Apache-2.0） | 通用层（已有同构设计，印证） | 只参考 |
| 14 | 属性级矛盾检测：新条目字段与已确认条目做蕴含矛盾检查，不只同 ID 冲突 | DOC/Re3（MIT） | BiblePatch 合并 | 只参考 |
| 15 | ConStory-Bench 的一致性 bug 分类（背景遗忘/时间线/规则漂移）当评测集标注维度 | Picrew/ConStory-Bench | 质量评测集 | 移植改写 |

## 四、和我们现有设计冲突或缺口

1. **审稿缺"证据锚定"机制**（证据：inkos `models/observation.ts`、`agents/continuity.ts` + "Mary" 论文证明模型自己不擅长发现矛盾）。我们 `novelive-agent.md` 审稿"只列有把握的问题，定位到句子"，但没有强制行号引用 + 代码验真——模型可以编出看似合理的问题。应加：审稿输出每条必须带 `{sourceId, startLine, endLine}`，代码解回 quote、校验在原文章节内，否则打回。

2. **设定集没有"谁知道什么"维度**（证据：ai-webnovel-pipeline `references/method.md` knows 层；这是我们找到的所有系统里独有的一层）。`bible.md` 的"变化"只管字段值随章变化，管不了"A 第 7 章死了、第 20 章 B 却知情"这类崩坏。长书改编时这种错比设定矛盾更常见更难查。应在角色条目加 `knows: [{what, chapter}]`，整理预览时顺带提取，写手提示词加禁令。

3. **没有"红线断言"层**（证据：同上 hard_constraints）。改编要求现在是自由文本，模型写顺手时会忽略。应把"违反即整章作废"的可检查断言单列（"主角全程不能说话""某角色第 X 章前不能出场"），渲染置顶 + 结尾再强调，内容要求人工过目。

4. **伏笔台账缺代码侧的登记上限和排序规则**（证据：同上 open_threads 三规则 + 实测事故）。`bible.md` 只写了字段，没有"单章最多登记几条、常驻给几条、超期怎么标"。模型会把每个未解释名词都报伏笔，不截断就稀释真伏笔。

5. **LLM 结果可能覆盖人工中途改动**（证据：novelvids `chapter_screenplay.py` 的 fingerprint 双验证）。我们"章太长分几段写""出图队列并发"时，创作者可能在任务跑的时候改了原文或设定；目前设计没说怎么防。应在任务参数快照 source/bible 指纹，落盘前比对。

6. **超长章切段摘要后缺显式合并**（证据：ViMax `aggregate` 提示词）。我们现在"每段输出同一 schema，代码拼接列表、拼接摘要为分段摘要"——相邻段重叠语义没人去重。可加一次便宜的合并调用，或在代码侧按段落边界做去重。

7. **审稿是"开关默认关"，但一致性 bug 恰恰是最隐蔽那类**（证据：ConStory-Bench、"Mary"论文）。如果开审稿的成本可控，它的价值主要在"角色用了不该知道的信息""伏笔忘了收"这些读者立刻察觉但模型不自觉的地方——配合缺口 1/2 才能让审稿真正查到这些。

8. **按卷综合的分块做法仍是 Open question**（`novelive-agent.md` 末尾）。可参考：ViMax 的"事件流式抽取 + is_last 自报 + 上限"、wenyi 的分组 map-reduce 严格收缩、ai-webnovel-pipeline 的弧计划"30 章一弧 + 可出 3 候选人工挑"。M1a 拿测试用书定时先试"逐块产出 BiblePatch 且中途状态落盘可续"。

9. **质量评测集的失败类型还没分类清单**（证据：ConStory-Bench 的 bug 分类 + novel-to-script-team 的量化指标）。`decisions.md` 只说"挑别名/伏笔/换装/超长章片段人工标注"。应固定标注维度：原文忠实度（漏段/加戏）、设定一致性（含 knows 违规）、伏笔、演出可拍性、量化指标（对白占比等）。
