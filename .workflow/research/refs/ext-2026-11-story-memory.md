# 设定集长期记忆调研：回答"截至第 N 章"

调研对象：GraphRAG（MIT）、LightRAG（MIT）、Graphiti/Zep（Apache-2.0）、mem0（Apache-2.0）、Cognee（Apache-2.0）、HippoRAG（Apache）、RAPTOR（MIT）、BookRAG（AGPL，只参考）、StoryWeave（MIT，剧透感知 KG）、fabula（无 LICENSE 文件，只参考代码思想）。前 6 个已克隆到 /tmp/storymem/ 读源码。

## 结论先行

我们的"变化列表 + 首次出场 + 截至本章过滤"设计方向是对的，但有三处明显缺口：

1. **条目级"从哪章起算"有了，事实级没有。** StoryWeave 和 fabula 都把"读者/模型在第几章能知道这件事"建成一等字段（`revealed_chapter`），挂在节点、边、**属性、甚至名字标签**上。我们的"变化"只记字段被改成什么，不记这个字段值"从哪章起为真"、不记证据。
2. **证据/出处缺失。** StoryWeave 每条边存 `quote`（逐字引用）+ `quote_chapter` + `evidence_span`；fabula 每条事实存 `quote` + `revealed_chapter` + `evidence` chunk 列表。我们的设定条目没有"这句话从原文哪段来的"。审稿和设定冲突说明都要"按需查证据"，现在只能让模型重新翻原文。
3. **别名合并没有算法。** 我们术语表/角色条目的"别名"字段靠模型一次写对。StoryWeave 有一套 5 条规则的保守合并（有序连续子序列 + 首见章顺序 + 章窗口 + 唯一候选 + 停用词拒绝），实测 0 错合并；中文名字要靠模型做语义判断，但"全称/简称/称呼"的结构化规则可以移植。

---

## 一、各项目评估

### 1. fabula —— 三条时钟 + 揭示位置（最贴合，代码最少）
- 路径：`/tmp/storymem/fabula/src/fabula/models.py`、`extract.py`（仅 368KB）
- 许可：无 LICENSE 文件 → **只参考，不拷**
- 核心概念：区分 discourse position（读者读到哪）/ story time（故事里何时发生）/ revelation position（读者第几章能知道这件事）。`Fact.revealed_to_reader_at` 是防剧透闸门；`Relation.valid_from/valid_until` 是故事内有效期。
- 提取 schema（`extract.py:26-141`）：`WindowExtraction` 含 entities/events/facts/relations/precedence；`ExtractedFact.revealed_chapter` 字段说明写得极清楚（"the earliest point the reader could actually know it"）；`known_by` 记角色认知状态（含 `falsely_believes`）。
- 别名合并：`graph.py` 用 union-find 按提取器给的 alias 合并，模型只保证窗口内一致，跨窗口合并交给确定性代码。
- 落地：我们的"首次出场"≈ `first_seen`；他的 `revealed_chapter` 更精确（读者能知道的章 vs 出现的章——伏笔章和被识破章不同）。**建议给设定字段值和伏笔条目加"读者何时可知"。**
- 判定：**只参考**（无许可证），三时钟模型和提取 schema 值得搬进 `novelive-agent.md` 综合一节。

### 2. StoryWeave —— 剧透闸门 + 逐条证据 + 5 规则别名合并（结构最值得抄）
- 路径：`/tmp/storymem/StoryWeave/storyweave/`（MIT）
- 核心：
  - `db/models.py:356-560`：`Node/Edge/NodeProperty/EntityLabel` 全部带 `first_seen_chapter` + `revealed_chapter` + `extraction_method` + `evidence_span`；`Edge` 另带 `quote`/`quote_chapter`/`weight`/`grade`（STATED/INFERRED）。`EntityLabel` 单独成表——名字本身带剧透（"the Warden" 第 5 章才揭示是谁）。
  - `query/fence.py`：唯一闸门。规则：节点 revealed≤N；边要**边本身+两端点**都 revealed；属性要属性+节点都 revealed；**标签要标签+实体都 revealed**（"名字也是剧透"这一点我们完全没有）。
  - `nlp/cluster.py`：别名合并 5 规则（全满足才并）：R1 有序连续子序列、R2 全称先出现、R3 章窗口内、R4 非停用词、R5 唯一候选。全部记录在 `MergeDecision` 里，漏并和错并可分开报告。实测 0 over-merge。
  - `extract/llm_relations.py:234-262`：关系提取提示词——封闭关系表 + 只给候选实体名 + 引文必须逐字抄自句子（"Never from the context, never reworded"）。
  - `nlp/identity.py`：身份边（SECRET_IDENTITY/ALIAS/SAME_AS 等）的揭示章用"从 1..k 逐章喂模型、要求引文落在 1..k 内、取最小 k"算出；无有效引文不写入。
- 落地：SQLite 单表结构直接可搬；`EntityLabel` 概念解决我们"称呼"字段（`bible.md` 角色表"谁怎么叫这个角色"）的剧透问题；别名 5 规则可直接移植成综合阶段的代码步骤（中文需改：子序列→字符级包含/姓氏+单名规则）。
- 判定：**移植改写**。schema（reveal 章 + evidence + quote）和 fence 规则直接吸收；合并算法改写成中文名适用版；GLiNER 底层不要。

### 3. Graphiti（Zep）—— 双时态边 + 冲突判定的提示词
- 路径：`/tmp/storymem/graphiti/graphiti_core/`（Apache-2.0）
- `edges.py:236-252`：`EntityEdge` 有 `valid_at`（开始为真）/ `invalid_at`（不再为真）/ `expired_at`（系统时间维度的失效）——双时态。我们只需要故事内一维（章序），模型判 `invalid_at` 的规则可以学。
- `prompts/extract_edges.py` 的 DATETIME RULES（`182-186`、`269-277`）：ongoing→valid_at=该 episode 时间；future plan→valid_at=陈述时间**不是**未来发生日；**软截止日不是 invalid_at**；只有"持续状态到某时结束"才用未来日期当 invalid_at。这套规则对"伏笔到第 N 章回收"、"关系第 N 章破裂"直接适用。
- `prompts/dedupe_edges.py:40-127`：`resolve_edge` 提示词把**重复**和**矛盾**分开判定，且明确"不要仅凭时间新就判矛盾"、"活动/进展事实不构成对角色/归属事实的矛盾"。我们设定冲突说明可以借鉴"duplicate vs contradicted 两列表"。
- `prompts/extract_nodes.py:84-279`：实体提取的 NEVER 清单（代词/抽象概念/泛名词/裸亲属词要加所有者限定……）适合改写进预览提取提示词。
- `prompts/snippets.py:19` summary_instructions：摘要要"信息密集、直接陈述事实、不用 mentioned/stated 这类填充动词"。
- 判定：**移植改写**（Apache-2.0，提示词改写后可用）；双时态边概念和矛盾/重复分离判定最值得拿。

### 4. LightRAG —— 提取-续写-总结的提示词工程
- 路径：`/tmp/storymem/LightRAG/lightrag/prompt.py`（MIT）
- `entity_extraction_system_prompt`（56-124 行）：实体+关系一起出，用分隔符元组而非 JSON（适合弱模型）；强调"名字一致""第三人称""专名保留原文"。
- `entity_continue_extraction_user_prompt`（145-161）：漏提取时**只输出补漏/纠正**，不重复已对的——我们做"重新综合某卷"的增量补丁可参考。
- `summarize_entity_descriptions`（297-330）：多条描述合并成一段、矛盾要解掉、限字数。
- 判定：**只参考**。我们综合输出已经是 pi-schema JSON，不需要它的元组格式；但"continue extraction"和"descriptions 合并"两段提示词可以改写。

### 5. mem0 —— ADD/UPDATE/DELETE/NONE 的记忆操作判定
- 路径：`/tmp/storymem/mem0/mem0/configs/prompts.py`（Apache-2.0）
- `DEFAULT_UPDATE_MEMORY_PROMPT`（176-324）：给旧记忆列表 + 新事实，让模型逐条标 ADD/UPDATE/DELETE/NONE，UPDATE 要带 `old_memory` 原文。和我们要做的 BiblePatch（候选条目 vs 已确认条目冲突/合并）几乎同构。
- `FACT_RETRIEVAL_PROMPT`（15-60）：从对话抽事实的 few-shot（不相关输入输出 `{"facts":[]}`）。
- 判定：**移植改写**。UPDATE 提示词的判定规则（信息更全的留下、矛盾才删、同义不改）可直接写进综合合并步骤；few-shot 例子偏用户偏好类，需换成小说例子。

### 6. GraphRAG（微软）—— 提取提示词 + 描述合并
- 文件：`extract_graph.py`、`summarize_descriptions.py`（MIT，可直接拷）
- `GRAPH_EXTRACTION_PROMPT`：实体（name/type/description）+ 关系（source/target/description/strength）两段式 + 3 个完整 few-shot；`CONTINUE_PROMPT`/`LOOP_PROMPT` 做续提取。
- `SUMMARIZE_PROMPT`：多条描述并成一段、限字数、第三人称、含实体名。
- 判定：**直接拷提示词骨架改写**。它的 community 报告、embedding 检索、层次聚类全不要——我们每章调用只带切片，没有全局检索需求。

### 7. Cognee —— 冲突审查提示词 + 分块摘要结构
- 路径：`/tmp/storymem/cognee/cognee/infrastructure/llm/prompts/`（Apache-2.0）
- `review_conflicts.txt`：把同一 subject 的多条事实分行列出（带 `[r#]`/`[s#]`/`[d#]` 标签），让模型判哪些单值属性冲突、`kind` 分 `time_varying`/`fixed`——**这个概念我们要**："发色"是 fixed（变更是修正错误），"身份/职位"是 time_varying（第 20 章真的变了）。区分"写错了"vs"剧情变了"是我们设定冲突列表缺的一维。
- `summarize_content.txt`：分两段输出"涉及哪些类别的实体/主题"+"自足事实列表"，每条事实单独成立——适合做逐章预览里"出场人物/关键事实"的提取结构。
- `extract_graph_*`（cascade_extract 提示词）：先抽节点名、再抽关系名、再组三元组的多轮法——比单次提取多两轮调用，我们一章一次调用的节奏用不上。
- 判定：**只参考** conflict 审查的 kind 分类 + 自足事实的输出结构。

### 8. RAPTOR —— 递归聚类摘要树
- 路径：`/tmp/storymem/raptor/`（MIT）
- 做法：chunk→embed→聚类→摘要→再聚类。摘要提示词一句话（`SummarizationModels.py:34`）。
- 我们已有"逐章预览（JSON）→按卷综合→全书梗概"的结构化层级，比它的语义聚类更可控、可定位。唯一可用思想：卷太长放不下时，**按章数分块先做中段摘要再合并**（我们的未决项"卷太长放不下怎么分块"）。
- 判定：**不要**。机制被自家预览/综合替代；分块再合并思想已在我们设计里。

### 9. BookRAG —— 实体合并裁决提示词（AGPL，只参考）
- 路径：`/tmp/storymem/BookRAG/Core/prompts/kg_prompt.py`（代码主体 Apache/AGPL，实体解析部分源自 LightRAG MIT）
- `ENTITY_RESOLUATION_PROMPT`（~1170 行起）：新实体 vs 候选实体列表，逐字段裁决（name 高权重、type 中权重、description 上下文权重），**默认不合并**、疑罪从无（-1）。
- `ENTITY_MERGE_PROMPT`（~937 行起）：两实体合并成一条，规范名取全称（缩写合成 "全称 (缩写)"）、类型取最具体的、描述并集去矛盾。
- 判定：**只参考**（AGPL）。两条提示词思路改写：候选裁决的"字段权重+默认拒绝"合并进 StoryWeave 的 5 规则之后做中文名的模型兜底。

### 10. HippoRAG —— 同义边 + PPR 检索
- 路径：`/tmp/storymem/HippoRAG/`（Apache，已读 HippoRAG.py + prompts/templates/）
- 提取：NER→三元组两段式提示词，例子是新闻类。同义边靠 embedding 余弦相似度 topk + 阈值（`add_synonymy_edges`），需要向量库。
- 判定：**不要**。同义边用字符串归一化+模型裁决已够（一本书实体几百个，不是开放域）；PPR 检索与我们"按出场角色切片"无关。

### 11. Letta/MemGPT —— 记忆块
- 资料：letta-ai/letta 文档与 block schema（Apache）
- 设计：core memory（始终在上下文的分块，如 persona/human）+ archival（向量库）。我们是"每章现拼上下文、不留对话"的制作型 agent，没有对话记忆要滚——但**"设定集分块常驻 + 按需取"**的思想和 `read_bible` 工具已等价，无需再抄。
- 判定：**不要**。

### 12. NarrativeQA / 中文人名消歧文献
- NarrativeQA（google-deepmind, Apache-2.0 数据集）：问题标注在全书范围，没有"截至第 N 章"维度——只能当评测题源参考。
- LREC-COLING 2024《Approaches and Challenges for Resolving Different Representations of Fictional Characters for Chinese Novels》（CC BY-NC）：中文小说角色名消歧难点（姓/名/表字/绰号/官职），佐证"中文明文规则不够、必须模型兜底"。
- NovelCR（ACL 2025 findings）：中英长文本共指数据集，可当评测语料参考。
- 判定：**只参考**（评测语料与难点清单）。

---

## 二、对我们 schema 的具体建议

现有（`bible.md`）：条目带 `status`、`firstSeenChapter`、字段内容、`changes[]`（"从哪一章起、哪个字段、变成什么"）。缺的：

```jsonc
// 建议：BibleEntry 的每个"字段值断言"升级为带有效期和证据的 fact
{
  "entryId": "lin-xiao",
  "field": "appearance.hair",          // 或 relation 的 type、foreshadowing 的 status
  "value": "黑色长发 → 第38章剪成齐耳短发",
  "validFromChapter": "ch-38",          // 故事内从这章起为真；缺省=首次出场章
  "validToChapter": null,               // 该值失效章（剧情真的变了）；与"被修正"区分
  "revealedChapter": "ch-38",           // 读者/制作模型能知道这事的章——防剧透闸门
  "status": "candidate | confirmed",
  "evidence": [                         // 出处——审稿/冲突说明直接引用，不用重翻原文
    { "chapterId": "ch-38", "paragraphStart": 12, "paragraphEnd": 14,
      "quote": "她抬手，剪刀落下，长发散了一地。" }
  ],
  "kind": "fixed | time_varying"        // cognee：固定事实 vs 随剧情可变——判冲突时用
}
```

字段说明：
- `validFrom/ToChapter`：**故事内时态**（关系破裂、身份改变、外观改变），对应 graphiti 的 valid/invalid_at 和 fabula 的 valid_from/until。
- `revealedChapter`：**话语位置**（读者第几章能知道），对应 StoryWeave/fabula 的闸门。伏笔"埋下章"是 first_seen、"读者能识破"是 revealed——两个章往往不同。`bible.md` 的过滤规则改为按 `revealedChapter ≤ N`，同时 `firstSeenChapter ≤ N` 保留。
- `EntityLabel`（名字标签）独立成表：label/别名带 revealedChapter——"称号/秘密身份"按章揭示。角色条的"称呼/别名"字段只是标签表的展开视图。
- `kind` 分 fixed/time_varying：冲突审查时，fixed 值不同=候选错，time_varying 值不同=可能剧情推进（记变化不记冲突）。
- 全部 `evidence[].quote` 要求逐字抄自原文（StoryWeave 校验器规则：grade=STATED 必须引文里能找到双方名字，否则降为 INFERRED）。

### 别名合并（中文适配版算法）
1. 代码层（规则全满足才自动并，全部记 MergeDecision）：
   - 归一化：去标点/空格/书名号，去"小/老/阿"前缀做候选但保留原键（"阿明"→候选"明"）。
   - R1′：短名是长名的**连续子串**或"姓+单名"vs"全名"（"林晓" ⊂ "林晓雪"不成立；"晓" ⊂ "林晓"成立需 R2-R5）——中文不用 token 子序列，用字符子串+姓氏表。
   - R2：全称首见章 ≤ 简称首见章；R3：间隔 ≤ K 章（默认可取 StoryWeave 的窗口值）；R4：简称不在停用集（"姐姐/学长/那家伙/掌门"等称谓词进术语表"称呼"而非别名）；R5：候选唯一。
   - 含"的"的所有格限定（"林晓的刀"）不并——Graphiti 的 possessor 规则。
2. 模型层（规则无法判定的）：
   - 候选实体列表 + 新实体（名字/类型/描述/证据引文）→ 裁决 select_id，默认 -1（BookRAG ENTITY_RESOLUATION 改写：name 高权重、证据引文必须有、疑罪从无）。
   - 并名时取"最完整写法"为原文名字，其余进别名表（mem0 UPDATE/ADD 判定改写）。
   - 身份类（马甲/转世/真名揭示）**不合并成一条**——学 StoryWeave：记为 revealed_chapter 受控的"同一人"边，设定集切片按章决定显示哪个名字。

### 按卷综合的增量合并流程（建议）
```
输入：本卷各章 ChapterPreview + 上级设定集切片 + 术语表
1. 逐章提取（整理角色，可并行）：实体/关系/事实/伏笔 → 窗口内一致的 ChapterPreview
   （输出 schema 参考 fabula WindowExtraction：含 quote、revealed_chapter、known_by）
2. 卷内合并（代码）：同一章内先按规则并别名 → 跨章 union-find → 计算每条事实的
   validFrom/revealed → 标记 fixed/time_varying
3. 与已确认设定比对（主控，一次调用）：输出 BiblePatch，
   每条带 ADD/UPDATE/DELETE/NONE + contradicted（事实级，不是条目级）
4. 冲突只列"同一 fixed 属性两个值"或"time_varying 但无有效变化章"——其余进变化列表
```

---

## 三、提示词清单（值得改编/拷用的）

| 用途 | 来源 | 路径 | 许可 | 取什么 |
|---|---|---|---|---|
| 逐章实体+关系提取 | GraphRAG | `graphrag-prompts/extract_graph.py` `GRAPH_EXTRACTION_PROMPT` | MIT | 两段式实体/关系格式 + 3 个 few-shot 骨架（换成小说例子） |
| 提取防幻觉清单 | Graphiti | `prompts/extract_nodes.py:84-279` | Apache-2.0 | NEVER 清单：代词/抽象概念/裸亲属词要加所有者 |
| 关系+引文提取 | StoryWeave | `extract/llm_relations.py:234-262` | MIT | 封闭关系表、引文逐字、只给候选实体名 |
| 事实有效期判定 | Graphiti | `prompts/extract_edges.py:182-186,269-277` | Apache-2.0 | ongoing/future/软截止日的 valid_at/invalid_at 规则（改"章"为时间轴） |
| 事实矛盾 vs 重复 | Graphiti | `prompts/dedupe_edges.py:40-127` | Apache-2.0 | duplicate_facts 与 contradicted_facts 分开；不凭时间新判矛盾 |
| 记忆操作判定 | mem0 | `configs/prompts.py:176-324` | Apache-2.0 | ADD/UPDATE/DELETE/NONE + old_memory 回填 |
| 冲突分 kind | Cognee | `prompts/review_conflicts.txt` | Apache-2.0 | fixed/time_varying 分类、单值属性才报冲突 |
| 实体裁决 | BookRAG | `Core/prompts/kg_prompt.py:~1170` | AGPL（只参考） | 字段权重（name>type>desc）、默认 -1 |
| 实体合并 | BookRAG | `Core/prompts/kg_prompt.py:~937` | AGPL（只参考） | 全称(缩写)规范名、最具体类型、描述并集 |
| 描述合并 | GraphRAG | `summarize_descriptions.py` | MIT | 多描述并一段、解矛盾、限字数 |
| 摘要风格 | Graphiti | `prompts/snippets.py:19` | Apache-2.0 | 直述事实、禁 mentioned/stated 填充动词 |
| 自足事实列表 | Cognee | `prompts/summarize_content.txt` | Apache-2.0 | "涉及类别 + 自足事实"两段输出（改写进逐章预览） |
| 揭示位置提取 | fabula | `extract.py` `EXTRACTION_SYSTEM` | 无许可（只参考） | 三时钟说明、revealed_chapter 判定问法 |
| 实体/关系提取（元组式） | LightRAG | `prompt.py:56-161` | MIT | 备选：弱模型输出不稳时用分隔符元组代替 JSON |

---

## 四、Top-15 排序

1. **StoryWeave 的揭示闸门 schema**（`revealed_chapter` + first_seen + evidence_span，MIT）→ 移植进 BiblePatch/设定集条目
2. **StoryWeave EntityLabel**（名字本身带剧透章）→ 解决"称呼/秘密身份"切片的剧透泄露
3. **fabula 三时钟模型 + WindowExtraction schema** → 逐章预览输出的字段结构（只参考，无许可）
4. **StoryWeave 别名合并 5 规则** → 中文适配后写进综合阶段代码
5. **Graphiti valid_at/invalid_at 判定规则** → 变化列表的"从哪章起/到哪章止"（Apache-2.0）
6. **evidence quote 逐字 + STATED/INFERRED 分级**（StoryWeave R4 校验器，MIT）→ 审稿和冲突说明的出证据能力
7. **Graphiti dedupe_edges 矛盾判定** → 综合冲突说明的判定提示词
8. **mem0 ADD/UPDATE/DELETE/NONE 操作** → BiblePatch 条目操作语义
9. **Cognee fixed vs time_varying 冲突分类** → 冲突列表分"候选错误"vs"剧情推进"
10. **GraphRAG 提取提示词骨架**（MIT 可直接拷）→ 逐章预览提取
11. **StoryWeave 身份边按章揭示**（不合并节点、按 revealed_chapter 控制可见）→ 马甲/真名类角色
12. **Graphiti extract_nodes NEVER 清单** → 预览提取防幻觉规则
13. **GraphRAG summarize + continue-extraction** → 卷内合并与增量重综合
14. **BookRAG 实体裁决/合并提示词**（AGPL 只参考）→ 模型兜底别名裁决
15. **RAPTOR 分块再合并**（思想）→ 卷太长时分块综合的未决项

## 五、和现有设计冲突或缺口

- **缺口 1：事实级有效期和证据。** 现在"变化"记在条目上但不带出处；`revealedChapter`/`validFrom/To`/`evidence.quote` 三件套我们没有。审稿"按需查证据"现在只能靠工具重翻原文。
- **缺口 2：名字/称呼的剧透属性。** `bible.md`"称呼"字段不带章信息；称号揭示身份（如"夜鸦"=某人）会在切片里提前泄露。需要 EntityLabel 式按章揭示的名字表。
- **缺口 3：冲突没有 kind 分类。** 现在"冲突"只分冲突/不冲突；cognee 的 fixed/time_varying 区分能把"模型提错了"和"剧情变了"分开处理（前者标候选错误，后者进变化列表）。
- **缺口 4：别名合并无算法。** 综合阶段没有确定的合并步骤，全靠模型一次写对"别名"字段——跨章的"学姐/林学姐/林晓"变体无法归并。
- **冲突 1：不需要向量库/KG 检索。** GraphRAG/LightRAG/HippoRAG/mem0/Letta 的检索层全部不要——我们每章只带切片，检索是代码按章过滤，不是语义搜索。这些项目只有提取与合并层有用。
- **冲突 2：提取粒度。** GraphRAG 式开放实体提取会抽一堆"学校/公司"泛节点；我们 schema 已限定条目类型（角色/关系/地点/时间线/伏笔/术语），不需要自由 KG——只借提示词技巧，不借 schema。
- **冲突 3：双时态只要一半。** graphiti 的 valid/invalid_at + expired_at 是真实世界双时态；我们只要故事内一维（章序），外加读者维度的 revealedChapter——这是 fabula/StoryWeave 的模型，比 graphiti 的更贴。
