# oh-my-pi 上下文管理调研：snapcompact / 压缩 / mnemopi / 周边机制

2026-11-21。仓库：`/tmp/omp-src`，HEAD `fbb8085`（2026-11-20）。npm 全系 `@oh-my-pi/*` 19.0.1（`engines.bun >= 1.4.4`）。对照：`@earendil-works/pi-coding-agent` 1.6.0（`docs/compaction.md` + `dist/core/compaction/`）。

## 1. packages/snapcompact：是什么，能不能直接用

### 它做什么

不是 LLM 摘要，也不是普通算法压缩：**把被丢弃的历史序列化成紧凑文本，用像素字体渲染成 PNG 帧，让带视觉能力的模型直接"读"这些图**。全程本地、确定性、零 LLM 调用、零 API key、零网络。光栅化和 PNG 编码在 Rust native 代码里（`crates/natives/src/snapcompact.rs` → `renderSnapcompactPng`）。

文件：`packages/snapcompact/src/snapcompact.ts`（2721 行单文件）+ `src/prompts/snapcompact-summary.md`（27 行模板）+ `src/prompts/file-operations.md`（5 行）。

### 算法（`compact()`，`snapcompact.ts:2550`）

输入 `CompactionPreparation`：`firstKeptEntryId`、`messagesToSummarize`、`turnPrefixMessages`、`tokensBefore`、`previousSummary?`、`previousPreserveData?`、`fileOps`（`{read,written,edited}` Set）。

1. `convertToLlm`（可注入）把消息转成 LLM 形态，`serializeConversation` 序列化为 `¶user:` / `¶ai:` / `¶call:name(args)//intent` / `<out>…</out>` 前缀行。工具结果截断 2000 字符（头 60% + 尾 40%），单个参数值 500 字符、整次调用参数 2000 字符。data: URL 一律抹除（防切断后坏图重放）。
2. 上一次压缩留存的 `Archive.text`（有界源文本）展开拼到新历史前面——**不是搬旧 PNG，而是每次从有界源文本重渲染**。
3. `resolveShapeForText` 按**读模型的 model id**选帧形：Claude → `11on16-bw`（8x13 字形 11px 字距，高分辨率 Claude 线用 1932px 帧），Gemini → `8on22-bw` @2048px（Gemini 3.x 每图固定 1120 token 不计像素），GPT → `8on22-bw` @1568px `detail:"original"`，未知 → 默认 Anthropic 形。形状来自 SQuAD recall evals 和工具结果可读性 bench（`research/toolbench.py`）。
4. `normalize`：ANSI 序列剥除、空白折叠、换行折叠成实心块字形（`█`）、制表符/兼容符号折叠、emoji 转 ASCII 标签或丢弃、CJK 全宽两格。Silver TTF 兜底缺失字形。
5. `planArchive`：帧占阈值留白的约一半预算；中间成像段内部 foveate（HQ/LQ/HQ 三档），**时间两端保持纯文本 verbatim**（`textHead`/`textTail`）；超预算从中间最老处丢字符记 `truncatedChars`；始终允许至少一帧。
6. 渲染各帧 → `Frame[]`（base64 PNG + cols/rows/chars + 形状元数据 + `detail`）。
7. `summary` 用 `snapcompact-summary.md` 模板生成：引导语 + 阅读说明（哪些段是图、图怎么读）+ `FILES` 文件操作清单（目录树前缀折叠，`(Read)/(Write)/(RW)` 标记，上限 20 条）。
8. 输出 `CompactionResult`：`summary`（引导语文本）、`shortSummary`（UI 一行，"Archived N chars onto M frames"）、`firstKeptEntryId`、`tokensBefore`、`details:{readFiles,modifiedFiles}`、`preserveData.snapcompact = Archive`。
9. 每次重建上下文时 `historyBlocks(archive)` 把 `preserveData` 还原成有序 block：旧文本段 → 图像中间段 → 新文本段，附在摘要消息后面（`convertMessageToLlm` 的 `compactionSummary` case，`blocks` 直接进 content，不走 `<summary>` 包装）。

API 面（`src/index.ts` re-export）：`compact`、`render/renderMany/frames`、`serializeConversation/normalize/wrap`、`resolveShape*`、`historyBlocks/images/capFrameDataBytes`、`createFileOps/computeFileLists/upsertFileOperations`、`getPreservedArchive`。

### Node 24 可用性实测

已实测（`/tmp/omp-node-test`，Node v24.18.0，esbuild bundle）：

- `serializeConversation`、`normalize`、`resolveShape`、`compact()` 完整跑通：`compact()` 对 80 条假消息产出 `preserveData.snapcompact`（1 帧 + textHead/textTail 各 13916 字符）。
- `renderSnapcompactPng` 在 Node 下能真实渲染出 PNG（base64 输出验证过）。

**但有三个障碍，都不是小问题：**

1. **包发的是 `.ts` 源码**（`main: "./src/index.ts"`，`files: ["src"]`）。Node 24 拒绝对 `node_modules` 里的 `.ts` 做类型剥离（`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`），loader hook 也拦不住这个检查。**必须打包**：esbuild `bundle` 能成，要配 `--loader:.md=text`、一个 package.json `with {type:"json"}` 属性插件（omp 从 `../package.json` 具名 import `engines/version`，esbuild 不认 attributes）。
2. **`Bun.*` 运行时引用**：`snapcompact.ts:1369` `Bun.stripANSI`（有 `includes("\u001b")` 前置判断但 ANSI 文本会踩）、`:2625` `await Bun.sleep(0)`（`compact()` 必经路径）；`pi-utils` 模块初始化顶层跑 `Object.keys(Bun.env)`；`pi-natives/native/loader-state.js:927` `import.meta.dir`（Bun-only，Node 下 undefined → `path.join` 崩）。实测给 `globalThis.Bun` 打一个 ~5 行 shim（`env/sleep/stripANSI`）+ 把 loader 的 `import.meta.dir` 改成 `import.meta.url` 派生即可全链路跑通；`bun:ffi`/`bun:sqlite`/`bun` 的裸 import 在 pi-utils 里存在但走的代码路径不触发（esbuild external + stub 即可）。
3. **`@oh-my-pi/pi-natives` 是 N-API native 依赖**（`.node` 二进制）。npm 有六个平台包：linux/darwin/win32 × x64/arm64，x64 还有 AVX2 modern/baseline 变体（运行时探测）。Electron 打包要处理 `.node` 的 asar unpack 和 `~/.omp/natives` staging。注意**这是 omp 的 fork（`@oh-my-pi/pi-natives`），不是 earendil 的包**——snapcompact 依赖的是 `@oh-my-pi/pi-ai` 的 `Message/Model/ImageContent` 类型和 `pi-catalog` 的模型谱系规则（`classifyModel`、`image-tokenization`、`image-max-edge`、`image-count-budget`），类型层面和 earendil `pi-ai` 1.6.0 不互通（`convertToLlm` 注入点可以适配消息形态，但 `Model.api/id` 和 catalog 规则解析是 omp 私有）。

**结论：snapcompact 不能直接 `npm install` 用。** 要复用只能"vendor 打包"：bundle `@oh-my-pi/snapcompact` + 其 omp 依赖 + native shim，或用 esbuild 在 Novelive 构建期把它打进 utility process bundle。可行但要维护一份打包配置 + Bun shim + native staging。对 Novelive 是否值得，见 §5。

## 2. 压缩：omp（coding-agent + agent）vs earendil pi-coding-agent

### 逐点对比

| 维度 | earendil pi-coding-agent 1.6.0 | oh-my-pi 19.0.1 |
|---|---|---|
| **方法数** | 一种：本地 LLM 结构化摘要 | 五种按 `compaction.methodOrder` 走：`remote`（provider 原生：OpenAI `/responses/compact` V1、流式 V2、Anthropic `compact-2026-09-04` beta、Bedrock Converse 侧请求）→ `snapcompact` → `handoff`（交接文档法）→ `shake`（纯机械抹除）→ `soft`（本地 LLM 摘要）。不可用的方法自动跳下一种 |
| **触发路径** | 3 条：`contextTokens > window - reserveTokens`（reserve 默认 16384）在 `prepareNextTurn` 检查 + 新 prompt 前检查 + provider 溢出/`stopReason:"length"` 后最终一次 compact-and-retry | 6 条：手动 `/compact`、溢出恢复、`stopReason:"length"` 不完整输出恢复、阈值维护（成功 turn 后超 `resolveThresholdTokens`）、**轮中维护**（工具循环里下一次 provider 请求前，默认开）、**空闲维护**（turn 落定后闲 300s 或 1h 缓存命中时，`idleThresholdTokens` 默认 200k，默认关） |
| **阈值模型** | 单阈值 `window - reserveTokens` | 三层：`thresholdTokens` 固定值 > `thresholdPercent` > 默认 `window - effectiveReserve`（reserve = `max(15%·window, configured‖16384)`，小窗口自动退化比例 reserve）；`modelThresholds` 可按 `provider/model-id` 前缀单独给触发点；还有 0.8 恢复带（COMPACTION_RECOVERY_BAND）防抖 |
| **触发计量** | `usage.totalTokens` 或 `input+output+cacheRead+cacheWrite` | `calculateContextTokens` 优先 `usage.contextTokens`（provider 上报的窗口占用），减 `orchestration`（计费的但不重放进前缀的部分）；`compactionContextTokens` 取 provider 值和本地存储估算的 max——防 on-wire 压缩（Headroom 类扩展、inline snapcompact）让 provider 看到缩水输入而实际历史无限涨 |
| **投机/异步** | 无 | `compaction.asyncEnabled`（默认开）：进入 `[threshold − lead, threshold)` 区间就后台预生成摘要（side session id 隔离），真越线时秒提交；分支变了/native payload 不可读就丢弃 |
| **切点选择** | `findCutPoint`：从后往前按合法切点累计 token 到 `keepRecentTokens`（默认 20000）。合法切点 = user/assistant/bashExecution/custom_message/branch_summary；**绝不在 toolResult 切**。切点可以落在 assistant 上（它后面的 tool results 跟着保留） | 同一算法（`findCutPoint`，`compaction.ts:544`）但两点加固：① token 计数对"最后一个存活 assistant turn"按字节级 replay 计（`countLatestTurn`），其余按 `countMessage`；② `keepRecentTokens` 先被压进恢复带（`0.8·trigger − reserveFloor`），再按实测 `promptTokens/estimatedTokens` 比值缩放（provider 实际用量比字符估算高就等比收紧尾部） |
| **切完分三块** | `messagesToSummarize` + `turnPrefixMessages`（跨 turn 切）+ 保留尾部；split-turn 生成两份摘要（history + turn-prefix）再合并 | 同构（`CompactionPreparation`），但 split-turn 的两份摘要在 omp 里合并且带 `<history>---Turn Context (split turn):<prefix>` 结构；turn-prefix 专用 prompt 只问三件事（原始请求/早期进展/理解保留尾部所需上下文） |
| **摘要内容** | 固定 7 节：Goal/Constraints & Preferences/Progress(Done·In Progress·Blocked)/Key Decisions/Next Steps/Critical Context + `<read-files>/<modified-files>` XML 标签 | 同样的 7 节骨架 + `## Additional Notes` 自由节 + `<files>` 合并标签（目录树前缀折叠 + `(Read)/(Write)/(RW)` 标记，上限 20 条 `[…N files elided…]`）；旧 `<read-files>/<modified-files>` 标签下次压缩时自动剥掉重排 |
| **增量摘要** | 有：`<previous-summary>` 传入，用 UPDATE prompt 合并 | 同，但加了"超大输入折叠"：摘要输入超 `DEFAULT_SUMMARY_INPUT_WINDOW`（200k）时按 budgeted windows 分块滚动摘要，provider 溢出则砍半重排到最低 16k 输入预算 |
| **文件操作追踪** | read/write/edit 三个工具名硬编码，read 的 path 原样记 | 同三个工具，但 read 的 path 先 `stripReadSelector`（`foo.ts:10-20` → `foo.ts`）去重、`isUrlSchemePath` 过滤 `local://`/`conflict://`/URL |
| **工具结果序列化截断** | head-only 2000 字符 `[...N more chars truncated]` | head 60% + tail 40% 共 2000 字符（尾部保留命令报错/测试结果）；单个参数值 500、整次调用 2000；带 `useless` 标记的 call/result 对整对丢弃；`escapeSummaryBoundaryTags` 防历史里的假 `</conversation>` 骗摘要器 |
| **图片** | `estimateTokens` 里按 4800 字符/图估 token；序列化时 `contentText` 只取 text block，**图片在摘要输入里直接消失**；保留尾部的图片原样发 | 摘要输入同样丢图；但多了两条后路：① snapcompact 把整个历史渲成图（文本信息不丢）② `preserveData` 里的帧是 blob 外置（`blob:sha256:`），重建时按帧字节预算重新物化，丢了就记 `[N frames unavailable]` 而不发存储引用给 provider |
| **分支摘要** | `/tree` 切分支时可生成 `BranchSummaryEntry`（`fromId` + summary + details），新→老按 `window - reserveTokens` 预算收 | 同构（`BranchSummaryEntry`），omp 明确**默认关**（`branchSummary.enabled=false`）；切分支摘要是独立功能不是压缩的一部分 |
| **prompt 缓存交互** | 摘要请求禁 cache write（一次性 prompt 不写缓存）；保留尾部原文不重写 | 多层：① 剪枝（`pruneSupersededToolResults`/`pruneUseless`）只在尾部 ≤8k token 且在 catalog `prompt-cache-lookback`（Claude 20 个位置）内、或 session 闲过 cache 寿命时才动——改已发送的热前缀会逼 provider 重写整个后缀付 cacheWrite 溢价 ② 空闲压缩特意等 1h cache entry 确认或 300s 默认延时 ③ 摘要请求带 `promptCacheKey`/`remotePromptCacheKey` ④ `handoff` 走 live-cache 侧请求复用基 system prompt |
| **剪枝/offload** | 无：工具结果只有摘要时 2000 字符截断，原始大结果留在 session 文件里占 JSONL | 三层：① **pruneToolOutputs**（阈值前跑）：保护最新 40k 工具输出 token，节省 ≥20k 才动，<50 token 的不空（占位符成本 ~8 token 不划算），superseded（同文件更新 read）和 `useless` 标记优先抹成 `[Superseded by a newer read of this file]`/`[Uneventful result elided]` ② **shake**：把大工具结果/大 fenced/XML 块换成 `local://N.log` spill 引用（原文落盘可恢复），保护尾部 16k token，自动档省 4k 才触发，`/shake` 手动更激进 ③ **OutputSink**：bash/python/ssh 输出超过 50KB 即开始写 spill 文件，inline 只留尾窗或头+省略+尾，模型看到的是 `local://<id>.log` 引用，`read`/`grep` 能回读全文（`docs/blob-artifact-architecture.md`） |
| **todo/plan 存活** | 无机制 | `TodoTracker.syncFromBranch()` 压缩后从分支条目重建 todo 相位（todo 工具的 `details.phases` 记在条目上）；压缩后自动补发 eager todo/task nudge（`buildPostCompactionEagerNudges`）；plan-mode 批准的计划文件引用在压缩成功后清 flag 重新注入（issue #4094/#1246 修复） |
| **失败/无进展守卫** | 摘要失败/cancel → 不追加 compaction、不重试，context_edit 抹掉溢出 attempt | "无进展"检测：重写后上下文须 ≤0.8·trigger 才算成功，否则本地救援（snapcompact 重渲更小帧预算、重块 elide 成 artifact、丢附图）再不行就告警并**阻止自动继续**而不是在同尺寸上下文上打转；连续无文本/无工具调用的恢复上限 3 次 |
| **显示** | 压缩后滚动历史仍在（entry 不删），但上下文从 summary 重建 | 同（display transcript 是完整分支），omp 把压缩渲染成滚动条内的细分隔线 `── 📷 compacted · ctrl+o ──`，ctrl+o 展开摘要 |
| **钩子** | `session_before_compact`（可取消/给摘要）、`session.compacting`（prompt/context/preserveData）、`session_compact`（事后）、`session_before_tree`/`session_tree` | 同名同能力钩子，另加 `internalGuidance` 内部通道（plan-mode "Approve and compact" 蒸馏提示只给摘要器不外泄给 hook） |

### 为什么所有者觉得 pi 的难用——具体原因

对照上表，pi-coding-agent 的压缩**算法不难用（Novelive 本来就打算移植它），难用的是"它的边界情况全靠你自己兜底"**：

1. **只有一种方法、没有降级链。** 本地 LLM 摘要失败就是失败；没有"不行就机械抹除（shake）"、"不行就渲图（snapcompact）"、"不行就 provider 原生压缩"的退路。omp 的 `methodOrder` 是 5 级降级。
2. **触发只看 `window - reserve`。** 小窗口（比如 Novelive 用的某些模型）里 16384 固定 reserve 可能吃掉大半个窗口；omp 有比例 reserve 兜底和 per-model `modelThresholds`。pi 里这个值藏 `~/.pi/agent/settings.json`，嵌入方要自己实现整套读取/解析/校验。
3. **工具结果是最大的上下文来源，pi 只有一个 2000 字符截断，且只截头。** 测试结果/命令报错都在尾部，被砍掉。omp 头 60% 尾 40%，加上 prune/supersede/useless/shake/spill 四层。
4. **没有轮中压缩。** pi 在 `prepareNextTurn`（工具结果落地后）检查，omp 在下一次 provider 请求**前**检查——长工具循环里 pi 可能带着超窗上下文再发一次请求才触发。
5. **没有 prompt-cache 意识。** pi 的剪枝逻辑=压缩本身；omp 的剪枝带 cache-lookback 窗口和 warm-suffix 保护，空闲压缩特意挑 cache 过期后跑。
6. **todo/plan 状态会被摘要吃掉。** pi 压缩后 todo 列表只剩摘要器写了多少算多少；omp 从条目 `details.phases` 重建精确状态 + 重新注入 plan 引用。
7. **图片在摘要输入里消失**（两家都是），但 pi 没有任何补偿；omp 的 snapcompact 直接把图当载体。
8. **失败语义粗糙。** pi 摘要失败就放弃；omp 有"无进展守卫"防止压缩了等于没压缩还反复触发。

**对 Novelive 的含义**：`agent-orchestration.md` 里写的"按 `pi-coding-agent` 的算法移植"指的是切点+增量摘要+溢出重试这个**骨架**——这个骨架 pi 和 omp 是同源的（omp 是 pi 的 fork，cut-point/三段式/`<read-files>` 血缘清楚）。omp 在这骨架上叠的东西里，对 Novelive 直接有用的是：**头尾截断、useless 标记对丢弃、keepRecentTokens 恢复带缩放、压缩后状态重建**这四件，代码量都不大。snapcompact/remote/native/spill 那套是 omp 特有重资产，见 §5。

## 3. packages/mnemopi：记忆，能不能用

**不能直接装，也不用抄代码——要抄的是设计。**

- **是什么**：本地 SQLite 长期记忆引擎（`@oh-my-pi/pi-mnemopi`，~21k 行 src，含 `beam/` 检索层 `recall.ts` 1426 行、`memory.ts` 737 行、`embeddings.ts` 691 行、`episodic-graph.ts` 781 行、`veracity-consolidation.ts` 514 行）。记忆分 working/episodic 两类、bank 作用域（global/per-project/per-project-tagged），召回是 FTS + 向量（可选 `fastembed`/`onnxruntime-node` 本地嵌入，或 OpenAI 兼容端点）+  episodic graph + temporal，按 `veracity` 标签和 degradation tier 加权。工具面给模型 4 个：`recall`/`retain`/`reflect`/`memory_edit`；coding-agent 侧在首个 turn 注入 `<memories>` 块、每 N turn 自动 retain、压缩前把记忆塞进 `<additional-context>`。
- **为什么装不了**：`src/db.ts` 第 1 行 `import { Database } from "bun:sqlite"`，`memory.ts` 第 1 行 `import type { Database } from "bun:sqlite"`，全仓库数据层绑死 bun:sqlite。`package.json` `engines.bun`，依赖 omp 全家（pi-ai/pi-catalog/pi-natives/pi-utils）。换成 `node:sqlite` 是个 fork 级工作（API 相似但不一样：bun:sqlite 的 `query().all()` vs node:sqlite 的 `prepare().all()`，事务、PRAGMA 处理差异），21k 行的 fork 维护不起。
- **Novelive 要不要这套**：**现在不要。** 我们的记忆模型（`agent-orchestration.md` §3）是确定性的三层摘要 + 结构化设定集 + `project.db` 运行记录，不存在"让模型自己决定记什么"的场景——生产调用每次从存储数据现拼上下文，记忆没有插足点。mnemopi 值得记的两个**设计**留着以后参考：① `memory://` 内部 URL 让 `read` 工具能回读完整记忆行（我们的 `project.db` 查询工具可借鉴这个"预览截断 + 全文按 id 取"的两级形态）；② `veracity` 加权召回——如果以后主控会话要做"跨作品经验"再议。

## 4. 其他上下文机制（omp 有、pi 没有或不同）

| 机制 | omp 做法 | 文件 | Novelive 要不要 |
|---|---|---|---|
| **system-reminder 注入** | `custom_message` 条目（`role:"custom"`,`customType`,`display:false`）→ `convertMessageToLlm` 变 `developer` 消息；TTSR 中断用 `<system-interrupt>`、非中断匹配用 `<system-reminder>`（独立的 developer 消息挂在工具结果后，不污染工具输出）；plan-mode/todo/eager 提示都走这条路 | `agent/src/compaction/messages.ts:218-234`、`ttsr-coordinator.ts` | **要**。我们的 `prepareNextTurn`/`afterToolCall` 注入项目进度、改编要求提醒时照这个：app 级 `custom` 消息 + convertToLlm 转 developer，不混进 user/toolResult |
| **TTSR（流式规则）** | 正则/AST 条件实时匹 assistant 输出增量（text/thinking/toolcall 分 scope），匹配可中断（abort 当前流、丢掉违规部分、注入 reminder 重试）或仅提醒；规则有 repeatMode（once/after-gap/always）和 scope/glob 门控 | `session/ttsr-*.ts`、`docs/ttsr-injection-lifecycle.md` | **不要整套**（~1k+行且依赖 omp 规则能力体系）。可借**思路**：美术导演写 staging patch 时，`beforeToolCall` 里对参数跑校验就够用（`apply_staging_patch` 已有解析器校验退回）。流式中断对我们没有必要——工具内校验已经是同步的 |
| **todo/plan 跨压缩存活** | todo 相位序列化在工具 `details.phases` 里，压缩后 `getLatestTodoPhasesFromEntries` 从分支重建；plan 文件引用 flag 在压缩成功后清零重新注入；压缩后自动补 eager nudge | `todo-tracker.ts:134,239`、`agent-session.ts:10203` | **要**。美术导演长循环里的"图清单进度"应该存在工具返回的 details 或会话条目上（不是只在消息文本里），压缩后代码重建精确状态——这正是 omp 的做法，也正是 pi 没有导致所有者抱怨的点 |
| **上下文用量显示** | `context-usage-runtime.ts`：阈值解析 + `computeCompactionBoundaries`（UI 显示触发线、投机带、恢复带）；`context-view.ts` 分类视图（system/tools/各类消息/加密 thinking 显示尺寸不显示字节）；`model-usage-journal.ts` 用量账本 | `session/context-usage-runtime.ts`、`context-view.ts` | **要简化版**。对话面板显示"当前上下文 ~N tokens / 窗口 M"即可：`calculateContextTokens(lastUsage)`（优先 `contextTokens`，减 orchestration）+ `resolveThresholdTokens` 两个纯函数值得移植（约 80 行） |
| **useless 结果标记** | 工具在结果上标 `useless:true`（零命中搜索、wait 空窗），序列化时整对 call/result 丢弃、剪枝时优先抹成占位符；错误结果永远保留 | `pruning.ts`、`utils.ts:176-181` | **要**。我们的 `read_source_range`、`find_term` 查不到时就该标 useless——一行字段换真金白银的上下文 |
| **OutputSink spill** | bash/python 输出 >50KB 即开始写 `<session-dir>/local/<id>.log`，inline 只留尾/头+尾，模型看到 `local://<id>.log` 引用，`read`/`grep` 可回读；spill id 单调递增、fork/resume 续号 | `docs/blob-artifact-architecture.md`、`tui/tools/streaming-output.ts` | **要**。美术导演读整章剧本、`read_scenes` 返回大文本时照此：超过阈值（比如 30KB）写 `project.db` 的 spill 表或会话目录文件，消息里放 `novelive-spill://<id>` 引用 + 头尾摘要，读工具能回读全文。比 omp 的简化：我们用 `node:sqlite` BLOB 列或作品目录下 `spills/` 文件即可，不需要 blob:sha256 内容寻址 |
| **context_notes / new_context（实验）** | 模型自己写 ≤16KB 工作笔记，`new_context` 在安全边界滚动窗口（保留完整近期 tool call/result + 笔记，不调摘要模型）；`history://current/full` 让 read/grep 回读被滚掉的原文 | `session/context-notes.ts`、`docs/compaction.md:167-213` | **观望**。这本质是"笔记 + 窗口滚动"代替摘要，适合长工具循环；美术导演如果摘要质量不够可以退到这个方案（结构化图清单本来就是我们自己管的状态，比模型笔记可靠） |
| **handoff 压缩法** | 生成交接文档（另一套 prompt，`handoff-document.md`），作为压缩条目提交；`/handoff` 手动 | `compaction.ts:1217+` | **不要**。对我们来说就是另一种 LLM 摘要 prompt，没有本质区别 |

## 5. 给 Novelive 的具体建议

### 场景回顾

压缩只用两处：**对话面板主控会话**（长聊、多分支）和**美术导演的长工具循环**（一章一个循环，可能跨几十次工具调用）。生产调用不累积对话——每次从 `project.db` 现拼上下文，不需要压缩。

### 直接 import 的包：**一个都不要**

| 包 | 为什么不能 import |
|---|---|
| `@oh-my-pi/snapcompact` | .ts 源码发布 + `Bun.*` 依赖 + omp fork 类型链 + pi-natives native 依赖。要用得 vendor bundle + Bun shim + native staging，为一个"渲染历史成 PNG"的功能不值。且小说语料 CJK 密集，`8x13` 点阵字体渲中文靠 Silver 兜底，可读性未经验证（omp 的 evals 是 SQuAD 英文）；我们的摘要需求是"继续创作"，不是"检索旧 QA 答案" |
| `@oh-my-pi/pi-mnemopi` | `bun:sqlite` 绑死，21k 行，我们已有的三层摘要+设定集方案覆盖它的价值 |
| `@oh-my-pi/pi-agent-core`（omp fork） | 我们已选定 earendil `pi-agent-core` 1.6.0（`decisions.md`）；换 fork 等于换底座 |
| `@oh-my-pi/pi-natives` | 只为 `renderSnapcompactPng`/`countTokens` 引入 native 依赖不值；token 估算用 chars/4 或 `gpt-tokenizer` 即可 |

### 要移植的代码（earendil pi 骨架 + omp 加固）

骨架照 `pi-coding-agent` 1.6.0（已是 MIT、`agent-orchestration.md` 已定这个方向），从 omp 19.0.1 只搬加固点：

| 文件（新建于 Novelive 创作端，建议放 `agent/context/`） | 移植自 | 约 LOC | 内容 |
|---|---|---|---|
| `tokens.ts` | omp `compaction.ts:272-436` + pi `compaction.js:65-177` | ~120 | `calculateContextTokens`（优先 `contextTokens`，减 orchestration）、`resolveThresholdTokens`（固定>百分比>reserve，reserve 小窗口比例退化）、`shouldCompact`、`estimateTokens`（chars/4 + 图片 4800 字符/图）、`getLastAssistantUsage` |
| `cutpoint.ts` | omp `compaction.ts:449-607`（同 pi `compaction.js:253-375`，omp 版多 latest-turn 精确计数） | ~160 | `findValidCutPoints`（user/assistant/custom/branchSummary，绝不 toolResult）、`findTurnStartIndex`、`findCutPoint`（keepRecentTokens 从后往前累计）、`isTurnStartEntry` |
| `serialize.ts` | omp `utils.ts:82-262` + snapcompact 头尾截断 | ~150 | `extractFileOpsFromMessage`（read/write/edit + `stripReadSelector` 去重 + `isUrlSchemePath` 过滤）、`serializeConversation`（`[User]/[Assistant]/[Tool Call]/[Tool Result]`，工具结果**头 60% 尾 40% 共 2000 字符**、参数值 500、参数列表 2000、useless 对丢弃、`escapeSummaryBoundaryTags`）、`computeFileLists`、`formatFileOperations`（`<files>` 树 + Read/Write/RW，20 条上限） |
| `compact.ts` | pi `compaction.js:379-748` + omp `compaction.ts:1544-1705` 的 prepare | ~250 | `prepareCompaction`（lastUsage 取 tokensBefore、keepRecentTokens 恢复带缩放 `min(keepRecent, 0.8·trigger − reserveFloor)`、按 `promptTokens/estimated` 比值缩放、findCutPoint、三段分区、fileOps 累计）、`compact`（首次用 `compaction-summary.md`、增量用 `compaction-update-summary.md`、split-turn 加 `compaction-turn-prefix.md`、文件清单 upsert）、摘要输入超窗时滚动窗口（可选，先按 200k 截断） |
| `prompts/` | pi `compaction.js:379-449` + omp `prompts/compaction-summary.md`、`compaction-update-summary.md`、`compaction-turn-prefix.md`、`compaction-summary-context.md` | ~80 | 7 节格式 + "unanswered question 必须保留"条款（omp 加的，Novelive 确认卡场景直接相关）+ Additional Notes；turn-prefix 三问模板；omp 的 `<files>` 格式替 pi 的 `<read-files>/<modified-files>` |
| `spill.ts`（可选，M1b 美术导演需要时） | omp OutputSink 思路 | ~80 | 工具结果超阈值（30KB）写 `spills/<sessionId>/<n>.log`（作品目录下），消息里放引用 + 头尾各 500 字符摘要；`read` 工具识别 `novelive-spill://` 回读 |
| `state.ts`（对话面板+美术导演都要） | omp todo syncFromBranch 思路 | ~60 | 会话条目上存结构化状态（美术导演的图清单进度放工具 result `details`，待办放 `custom_message` 条目）；压缩后 `syncFromBranch` 等价物从条目重建，不依赖摘要器记了多少 |

**总计约 800 行**，全部是纯函数 + 一个小 prompt 目录，零 native 依赖，跑在 `pi-agent-core` 的 `prepareNextTurn`/`transformContext` 钩子里。

### 我们的压缩模块长什么样

```
agent/context/
  tokens.ts      // 计量与阈值
  cutpoint.ts    // 切点
  serialize.ts   // 序列化与文件清单
  compact.ts     // prepare + generate + split-turn 合并
  prompts/       // 4 个 .md 模板
  spill.ts       // 大结果 offload（可选）
  state.ts       // 压缩后状态重建
```

调用契约（对齐 pi/omp 的 `CompactionPreparation`/`CompactionResult`，方便以后对照升级）：

```ts
prepareCompaction(entries, settings, model) → {
  firstKeptEntryId, messagesToSummarize, turnPrefixMessages,
  recentMessages, isSplitTurn, tokensBefore, previousSummary, fileOps
} | undefined

compact(preparation, model, { customInstructions? }) → {
  summary, firstKeptEntryId, tokensBefore, details: { readFiles, modifiedFiles }
}
```

会话存储侧：对话面板条目树加一个 `type:"compaction"` 条目（`summary/firstKeptEntryId/tokensBefore/details`），`buildSessionContext` 重建时把它转成 user 消息（omp 的 `renderCompactionSummaryContext` 模板："Prior model work/tool state available. MUST build on prior work."），`firstKeptEntryId` 起原样保留。这正好落在已定的 `id/parentId` 条目树方案上（`agent-orchestration.md` §5）。

触发：只两条——`prepareNextTurn` 里 `contextTokens > resolveThresholdTokens(...)` 就压；provider `isContextOverflow` 错误时先压再重试（pi `streamFn` 层）。**不要** omp 的轮中/空闲/投机/降级链——两处用法都不需要，加了全是测试负担。

### 验证过的关键事实

- Node 24.18.0 实测：`@oh-my-pi/snapcompact` 的 `compact()` 在 esbuild bundle（`.md`→text loader + package.json attributes 插件 + `bun` specifier stub + `globalThis.Bun` shim + pi-natives loader 一处 `import.meta.dir` 修补）后完整跑通，`renderSnapcompactPng` 产出真实 PNG。可行但配置脆。
- pi-natives 的 Node 加载唯一硬阻塞是 `loader-state.js:927` `import.meta.dir`；其余 `Bun.*` 都在编译二进制/可选路径有守卫或 `typeof Bun` 判断。
- mnemopi `bun:sqlite` 在 `src/db.ts:1` 和 `src/core/memory.ts:1`，无替代注入点。
- omp 摘要 prompt 比 pi 多两条硬规则：`unanswered question 必须原样保留到 Critical Context`、`## Additional Notes` 自由节、仓库状态（branch/未提交改动）必须记——Novelive 版把"仓库状态"换成"作品/章节状态"。
