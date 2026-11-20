# Wenyi 长文本处理机制调研报告

## 1. 项目定位与技术栈

**Wenyi**（文译）是一个**整书级文学翻译工具**：输入 EPUB / PDF / DOCX / FB2 / TXT / Markdown / HTML，输出译文版电子书（EPUB/PDF/DOCX/TXT/HTML/MD，含双语对照版）。卖点即 README 标题里的 "Whole-book understanding · Consistent terminology · Evidence-based review"。GPL-3.0，Python 为主语言，约 3000 stars。

技术栈：
- **Monorepo**：`packages/core`（`wenyi_core`，翻译引擎，Python + 一个 Rust 原生扩展做 EPUB/DOCX/PDF 解析导出，`packages/core/rust/`）、`packages/backend`（`wenyi_backend`，FastAPI 服务层）、`packages/cli`（`wenyi-cli`）、`apps/desktop`（Tauri + React/Vite 桌面壳，内嵌 Python 后端）、`apps/web`、`apps/api`（PostgreSQL 版托管后端）。
- **LLM 接入**：全部走 OpenAI 兼容协议（DeepSeek / OpenAI / OpenRouter / OrcaRouter / Gemini 原生 / Ollama / vLLM / opencode_go），见 `wenyi_core/llm/providers/`。httpx + tenacity 重试。
- **持久化**：文件目录 run-state（`manifest.json`、`chapters/ch{n}.json`、`analysis.json`、`glossary.db` SQLite、`events.jsonl`、`usage.json`、`reviews/`、`preparation/` artifacts），见 `wenyi_core/storage/run_store.py` 模块 docstring；服务端另有 PostgreSQL 版（`apps/api/wenyi_api/storage_pg.py`、`db/schema.sql`）。
- 提示词是数据文件（`wenyi_core/i18n/data/tasks/*.txt`），按语言/题材经 `i18n/policy/resolver.py` 渲染。

## 2. 分段（chunking/segmentation）

三级切分，全部按 **tiktoken `cl100k_base`** 计量（`wenyi_core/ingest/tokens.py`）：

1. **章节 → 段落**：导入时由格式 reader 切成 `Segment`（`wenyi_core/ingest/segmenter.py::load_document`）。超长段落按 `segment.max_tokens_per_segment`（默认 1200 tok）在**句边界**（正则 `。．.!！？!?…\n`）切开，续段标 `cont=True`、无独立 anchor，导出时合并回原段落（`split_long_segments`）。
2. **段落 → 翻译批次**：`batch_segments` 贪心装箱到 `segment.max_tokens_per_batch`（默认 **1800 tok**）；`resume_batches`（`pipeline/translate/translation_batch.py`）再在已完成/未完成边界二次切分——改配置或中断后，同批内已翻段落不重发。
3. **摘要专用切分**：`split_balanced_tokens` 把单章源文无损切成 ≤`synopsis_source_tokens`（默认 **8000 tok**）的均衡块，切点保证完整 UTF-8 字符。

## 3. 全书理解流水线（prepare 阶段）

这是与 Novelive "全书预览" 最直接对应的部分。`Orchestrator → PreparationService → BookUnderstandingService`（`pipeline/orchestrator.py`、`prepare/preparation.py`、`prepare/book_understanding.py`）。

**阶段顺序**：解析文档 → (auto 时) `language.detect`（cheap 档，一次调用，样章前 1500 字）→ **章节摘要 prescan** → **风格分析** → `initialized` 提交 manifest → **全书 synopsis**（翻译前 ensure）。

### 3.1 章节摘要（chapter digest），map-reduce
`Synopsizer.digest_chapter`（`agents/synopsis.py`）：
- 每章源文按 8000 tok 切块，每块一次 `synopsis.chapter` 调用（**fast 档模型**），产出目标语言 digest，人名/术语保留**原文拼写**。
- 多块时用同一 digest prompt 做 merge（`_merge_digests`，合并指令内联在 user 文本里）。
- 单块 digest 超 `synopsis_reduce_tokens`（默认 12000）即判失败返回 `""`——**宁可失败也不丢块**。
- 并发：`pipeline.prescan_concurrency`（默认 4）个 `ThreadPoolExecutor` worker 逐章并行。
- 缓存：digest 存 `chapter.meta["source_digest"]` + 独立 artifact `preparation/digests/<content_hash>.json`，cache key 含 `_DIGEST_VERSION=2`、源文 sha256、语言策略 fingerprint、模型路由快照。源文/模型/prompt 任一变化即失效。

### 3.2 风格分析（一次强模型调用）
`Analyzer.analyze`（`agents/analyzer.py`，operation `analysis.style`，**strong 档**）：输入**首/中/尾三个样章片段**（各 ~2800 字符，`PreparationService.sample_text`）+ 可选全部章节 digest（标注为 "factual context, not naming authority"），输出 JSON：`genre/tone/style_guide/narration/pacing/register/dialogue_style/rhetoric/characters[]`（含 gender）。结果缓存于 `analysis.json` + `preparation/analysis/<hash>.json`。`style_brief()` 把 analysis + 术语表浓缩成 prompt 用 style 段。

### 3.3 全书 synopsis（分组的 map-reduce）
`Synopsizer.book_synopsis`：把所有章节 digest 按 12000 tok 预算**保序分组**，逐组 `_synth`（`synopsis.book` 调用，fast 档），各组摘要再进入下一轮 reduce，最多 32 轮；每轮要求严格收缩（否则返回 `""`）。合成时附带 style brief（按行截到 ~4000 tok）和**相关术语映射**（`GlossaryStore.terms_in` 过滤，截到 ~6000 tok）。synopsis 失败不阻塞翻译——记录 `book_synopsis_failed`，下次运行重试。

**模型调用计数（prepare）**：语言检测 0–1 次 + 每章 1–⌈章tokens/8000⌉ 次 digest + 分析 1 次 + synopsis ≥1 次（长书逐层）。全部 fast 档，唯分析是 strong 档。

## 4. 翻译阶段：批次内如何携带"记忆"

`TranslationService.translate_chapter`（`pipeline/translate/translation.py`）**逐章、逐批串行**。每批 `BatchPlan.capture` 固定注入翻译 prompt 的七类上下文（`translator_user.txt` 结构原样为）：

```
[Style guide]        ← analysis.style_brief 全文
[Whole-book synopsis]← 3.3 的全书 synopsis
[Chapter digest]     ← 本章 meta["source_digest"]
[Glossary]           ← 全量术语表（插入序，含 gender/reading/aliases/选择性 note）
[Annotation refs]    ← 段落级注释 JSON（applies_to）
[Recent translations]← 滚动上下文
[源段落 numbered 0..n-1]
[Following source paragraph] ← 仅参考的下一段原文
```

- **滚动上下文**：`recent_context()` 从本章已翻段落**倒序**向前读，跨章继续向前章追溯，`render_recent_translations` 截取 ≤`rolling_context_tokens`（默认 **512 tok**）的连续译文后缀——**不是摘要，是最近译文原文**。单段超预算时取 Unicode 安全的尾部切片。另附**后一段原文**作前瞻参考（prompt 明确标注 untrusted、不得翻译）。BabelDOC PDF 有按 section 分界的 `BabeldocContext` 策略。
- **prompt 防注入设计**：术语、annotation、next_source 都被标注为 "untrusted quoted data / reference only"。
- **对齐协议**：要求返回 `{"translations":[...]}` 且**数量必须等于 n**；`AlignmentError` 触发最多 `align_retry_limit`（默认 2）次整批重试，仍失败则**逐段单独翻译**兜底。非文字段（纯数字/符号，`_needs_translation`）不发模型，原样保留。
- **Polish**：`pipeline.polish` 开启时，Polisher 复用翻译那轮 system+user+assistant 的 `last_batch_turn` **追加一轮 continue** 对话（`polisher_continue_user.txt`），失败才退回全新 polish 请求。
- **三稿合成模式**（`translation_mode: three_draft_synthesis`，`pipeline/translate/precision.py`）：每批并行出 T1/T2/T3 三个草稿 + 一次综合 polish，`precision/chapters/{ci}/` 下有完整的 publication checkpoint/恢复协议。

## 5. 实体/术语跟踪（最接近"角色跟踪"的机制）

没有人物关系图或时间线，核心是**增量术语表 + 证据笔记**：

- **提取**：每批翻完后立即调 `glossary.extract`（fast 档，`agents/glossary_extractor.py`）：输入该批 source/target 对 + 现有术语中**在全书语料出现 ≥2 次的子集**（`GlossaryOccurrenceMatcher`），输出候选 `GlossaryTerm{source,target,reading,type,gender,aliases,note,first_chapter}`，type ∈ `person|term|appellation|honorific|speech|fixed_expr`。chapter 末再做一次整章兜底提取。
- **历史对齐**：新术语若曾在更早段落出现过，用 `glossary.align_history`（fast 档）对照**首次出现处的实际译文**确定 target，对不齐就**推迟**（deferred），不锁定错误译名。
- **去重/冲突**：`GlossaryStore.upsert_term`（`glossary/store.py`，SQLite）：同 source 同 target → merge aliases/note（`unchanged`）；**不同 target → 保留旧译 + 记 `term_conflicts` 表待人工裁决**（status='conflict'）。自动提取永不覆盖已定映射。
- **匹配**：NFKC + casefold 归一化；拉丁/西里尔用词边界正则，CJK 用子串匹配；`SOURCE_ONLY_TYPES`（称谓/语癖/固定表达）只用完整 source 匹配，alias 不参与。
- **术语笔记**（可选，`glossary_note_workers`）：`GlossaryNoteAgent` 在有界窗口内做 JSON 证据循环，给术语维护作用域 note；翻译 prompt 通过 `read_note` tool-call 机制按需查证据（`agents/note_tools.py`）。
- **性别**：由 analysis 和术语的 `gender` 字段携带（`male|female|unknown`，prompt 明令禁止仅凭称呼推断性别）。

## 6. 评审阶段（另一套全书扫描）

`ReviewService`（`pipeline/review/`，operation `review.*`）在全书译完后跑"影子评审"：不改正式章节，维护 `target_overrides` 覆盖层。

- **分块**：`ReviewChunkService.review_chapter` 按 `max_tokens_per_batch × 3`（≈5400 tok）把每章打包成块，`review_concurrency`（默认 4）并行发 `review.scan`（cheap 档）。
- **输出协议**：`{"issues":[{"index","type":missing|added|mistranslation|terminology|pronoun,"detail","suggestion"}],"glossary_alerts":[...],"reviewed_segments":n,"complete":true}`（`reviewer_system.txt` 原文）。块内 index 映射回章节 index，越界即 `ReviewOutputError` → **递归二分** chunk 重试，单段再有界重试。
- **证据循环**：`review_agent_loop` 时，`ReviewAgentLoop` + `BookEvidenceIndex`（`review/evidence.py`）给模型 tool 接口（`glossary_term`/`term_occurrences`/`segment_context`/`book_context`），最多 `review_agent_max_evidence_rounds`=2 轮取证再裁决——**全书证据按查询供给，不灌进 prompt**。
- **仲裁与修复循环**：矛盾 issue 分组后 `review.arbitrate`（strong 档）仲裁；`review.fix` 产出 shadow 修订，之后**盲审**（不带上次 issue 描述）复检，`review_clean_confirmations`=2 连续干净轮或 `review_fix_max_rounds`=2 轮后停。`review_autofix` 把通过的修订发布回正式章节。
- **缓存/续跑**：`reviews/{review_id}/` 目录逐 chunk 缓存（`r{round}-ch{i}-base{b}-n{n}`），内容 digest + 配置 snapshot + 术语表 fingerprint 三者全同才复用/续跑。

## 7. 上下文不超限的手段汇总

1. 一切按 cl100k_base token 预算装箱（批次 1800 / 段 1200 / digest 源 8000 / reduce 12000 / 滚动上下文 512 / 术语 note 4096B / style 4000 tok / synopsis 术语 6000 tok）。
2. **摘要只算不进 context**：digest/synopsis 持久化后作为短文本前缀注入；模型调用之间没有"对话式"累积。
3. prompt 前缀稳定性：术语表按 SQLite rowid **插入序**输出（中途插入新词不移动已有条目 → 命中 provider 前缀缓存，`store.py::all_terms` 注释）。
4. 滚动上下文是**译文原文后缀**而非越滚越长的摘要链——无摘要漂移。
5. map-reduce 要求**严格收缩**（每轮 summaries 条数+token 双双下降），防 runaway reduction；失败即放弃该次合成，不留半成品。

## 8. 失败处理

- **传输层**（`llm/retrying.py`）：tenacity 指数退避 + 抖动（上限 30s），尊重 `x-should-retry`/`Retry-After`；408/409/429/5xx/连接/超时/空响应可重试；**截断（output-token-limit）不可重试**（翻译交给对齐恢复，摘要操作除外）；402/余额不足标记 resumable interrupt。证书/URL/协议错误立即失败。
- **协议层**：JSON 解析失败→翻译按对齐重试→逐段兜底；评审 JSON 可修复时走 `parse_json_result` 修复，修不好递归二分。
- **持久层**：每批翻完立即 `save_chapter`；术语提取 checkpoint key `ch:start:count`；`events.jsonl` 记录每个批/章/阶段事件；`.initializing.json` 区分初始化中断。任何中断后重跑：已存批次跳过、术语 checkpoint 补齐未提取部分、usage 按 scope flush 落盘。
- 章节 digest 全量成功才允许进入翻译（`failed` 非空 → `ValueError`，已完成的 digest 已保存）；synopsis 失败降级为空继续。

## 9. 持久化的数据结构

按 `state_dir/<slug(title)>/targets/<lang>/`：
- `manifest.json`：书名/格式/语言/`source_sha256`/chapters[{index,title,status}]/language_policies/initialized。
- `chapters/ch{n}.json`：Chapter{index,title,segments[Segment{index,source,target,target_before_polish,kind,anchor,cont,meta}],meta{source_digest,digest_policy/version/sha256}}。
- `analysis.json`：style analysis + `book_synopsis` + 各自的 fingerprint meta。
- `glossary.db`：`glossary`（source PK, target, reading, type, gender, aliases JSON, first_chapter, note, status）+ `term_conflicts`。
- `preparation/digests/*.json`、`preparation/analysis/*.json`、`glossary/history/*`：内容寻址的模型结果缓存。
- `reviews/{id}/`：每轮每 chunk 的 initial/agent 轨迹、chunk 结果缓存、issues、usage。
- `precision/chapters/`：三稿模式的 publication checkpoint。
- `events.jsonl`、`usage.json`、`timing.json`、`annotation_contexts.json`。
- 锁文件：`run/state/events/assemble/timing` 五把文件锁。

## 10. 对 Novelive 的启示

- **直接采用"章节 digest → 分组 map-reduce 全书 synopsis"两层摘要**：digest 用便宜模型、保留原文人名拼写、单块失败整体失败不丢章；reduce 要求严格收缩（`synopsis.py::_reduce`）。Novelive 的"按卷综合"可在此基础上再加一层卷级中间节点——wenyi 只有章→书两级，上千章时 reduce 轮数深，**卷作为天然的 reduce 分组边界是它的空白**。
- **上下文注入清单值得照抄**：每次模型调用注入 全局 synopsis + 本章 digest + 风格 brief + 相关术语 + 滚动译文后缀 + 下一段前瞻原文，七件套全部 token 封顶。Novelive 写剧本时同理需要 全书梗概/本章摘要/人物术语表/滚动剧本尾巴。
- **滚动上下文用原文后缀而非滚动摘要**（512 tok，含跨章回溯与"待译段即断"的连续性规则），零额外模型调用、零漂移——比 pi 的 compaction 思路简单可靠。
- **一切产物内容寻址缓存**（source sha + policy fingerprint + 模型路由快照进 cache key），prompt/模型/源文任一变化自动失效——Novelive 的 SillyTavern 预设改变时同理应使下游缓存失效。
- **术语/人物表用"插入序 + 冲突表"而非覆盖**：自动提取出的异译不进正式表、进 `term_conflicts` 等人审；prompt 中表序稳定以保前缀缓存。Novelive 的人物档案（姓名、外貌、声线）应采用同样的"自动候选 + 冲突裁决"模式，而不是让模型自由改写。
- **对齐协议"N 输入必须 N 输出 + 逐段兜底"** 可直接移植到分镜/台词生成：JSON 数组协议 + 数量校验 + 整批重试 + 单段 fallback，是防止漏段的标准做法。
- **失败即中断但全部 checkpoint**：digest 缺一章就拒翻；每批/每术语提取/每评审块都落盘，重跑只补缺口。长篇任务必须按"任意时刻可断"设计，wenyi 的 batch glossary key、review chunk id、precision publication 三种粒度都可参考。
- **评审做成"影子 + 证据查询"而非"再读一遍全文"**：`BookEvidenceIndex` 把全书段落、术语出现位置、章节 digest 索引化，评审 agent 用 tool 按需取证据（每 chunk 预算 3×批次）。Novelive 的 reviewer/视觉复核角色可照搬：模型拿问题清单，工具喂原文/图片证据，而不是把全书塞回 prompt。
- **避免**：wenyi 的术语表**全量**进每次翻译 prompt（仅 note 有预算）——长篇千级术语会膨胀；Novelive 应改成按场景/章节过滤后的子集（wenyi 自己在 synopsis/提取里已用了 `terms_in` 过滤，但翻译主路径没有，这是它的明显短板 [推测：作者为保一致性牺牲了 token]）。另外它**没有人物关系/时间线结构**，全靠 digest 自然语言承载，Novelive 做改编需要比这更结构化的实体状态。