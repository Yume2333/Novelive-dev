# 外部 Agent harness / coding agent 调研：可抄与可参考清单

2026-11-21。本轮把指定清单里的框架全部过了一遍：能读源码的都 clone 到了 `/tmp`（opencode `sst/opencode@main`、codex `openai/codex@main`、aider、mastra、openai-agents-python/-js、cline、goose、smolagents、pydantic-ai、vercel-workflow、inngest-agent-kit），文档类的读了官方文档（Claude Agent SDK、LangGraph、Temporal、ADK、Letta）。已有结论见 `.workflow/research/refs/pi-2026-11-products.md`、`refs/omp-2026-11-*.md`，本文**只补充它们没覆盖的或需要修正的**，并逐条给出"直接拷贝/移植改写/只参考/不要"的判定。

## 0. 一句话结论

**最大收获是四份压缩提示词全文**（opencode、Goose、Codex、Claude Code 泄露版 + pi 自带的）和 **opencode `packages/core/src/session/compaction.ts` 这 1262 行压缩状态机**——它把我们压缩设计里"两处触发"之外的几乎所有边界情况都用代码回答了。我们的压缩模块（通用层 6）应当以 opencode 为骨架蓝本（MIT，TS，可直接移植改写），提示词在 Goose 模板和 opencode 模板之间二选一或合成。其次是 opencode 的 `SessionExecution` claim、`SessionInbox` steer、`SubagentJob` 恢复三件套，正好是我们"运行记录带进程号回收"和"对话面板插话"的成熟实现。

---

## 1. 逐机制对比表

图例：●=核心做法，◐=有部分，○=没有/不同路。

| 机制 | pi-agent-core(我们底座) | opencode (MIT/TS) | Codex (Apache-2.0/Rust) | Claude Code/Agent SDK | OpenAI Agents SDK | LangGraph | Mastra | Goose | Aider | Vercel Workflow/DurableAgent | Inngest AgentKit | Pydantic AI | smolagents |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 结构化输出=提交工具+结束检查 | ○ `finishTurn`钩子自写 | ○ 无显式 submit（靠 max-steps+idle marker） | ○ 轮次由 harness 判定 | ◐ outputFormat/tool | ◐ output_type+handoff | ◐ structured output node | ◐ step schema | ◐ 摘要强制 JSON schema | ○ | ◐ `Output.object` step | ◐ onFinish lifecycle | ● output tool + ModelRetry | ● `final_answer` 工具 |
| HITL 中断&恢复 | ○ `beforeToolCall` block 自写 | ● Permission.assert + QuestionTool + DeclinedError defect 通道 | ● approval 走 Op/event 通道，policy `Never` 派生子代理强制 | ◐ `canUseTool` 回调 | ◐ `needsApproval`+RunState 序列化恢复 | ● `interrupt()`+`Command(resume=)`+checkpoint | ◐ `suspend()`+snapshot | ○ | ○ | ◐ client-side tool calls 暂停循环 | ○ | ◐ deferred/approval | ○ |
| 子 Agent 合同 | ○ 自写 | ● `subagent`工具：child session+`parentID`+depth cap+prompt 全文注入+后台 Job+`<background-result>`回传 | ● `codex_delegate`/multi-agent，approval_policy=Never | ● AgentDefinition 不继承父上下文+输出消毒+fork/background | ● agent.as_tool + handoff 二选一 | ◐ subgraph node | ◐ agent 网络 | ○ | ○ | ◐ | ● network router 按 state 路由 | ◐ | ◐ managed_agents |
| 上下文压缩 | ○ 自写（骨架照 pi-coding-agent） | ● 全自动+后台预算+native/overflow/手动三触发+四级逐级缩减transcript | ● 本地摘要+provider 远端压缩(v2)+world_state 重建+pending mail 保留 | ● 9 节模板+<analysis>草稿块+partial 三种 | ◐ Responses compaction session | ◐ | ● OM(观察/反思两级) | ● JSON schema 结构化摘要+模板渲染+逐级丢工具结果 | ◐ | ○ | ○ | ◐ history processor | ○ |
| 持久执行&崩溃恢复 | ○ 自写 run 记录 | ● write-ahead `claim`(time_suspended) 存活即崩溃签名+`resume_attempts`+orphan claim 释放 | ● rollout 事件流+`replace_compacted_history` | ◐ | ◐ RunState 序列化 | ● checkpoint+幂等键 | ● step snapshot+resume | ○ | ○ | ● `'use step'` 每条流一个 step 边界 | ● step.run memo | ◐ `_durable_replay` | ○ |
| 工具错误文本教模型改 | ○ 自定 | ◐ `ToolFailure(message)` 逐工具手写；permission decline 走 defect 隧道不进模型 | ◐ FunctionCallError 文本 | ◐ | ◐ toolErrorFormatter 可定制 | ○ | ○ | ○ | ◐ | ◐ repairToolCall 回调 | ○ | ● ModelRetry 消息即回给模型的重试指令；ToolFailed 终态不占重试预算 | ○ |
| 并行工具调用 | ● pi 支持批次 | ● 每个 tool-call 事件 fork fiber，stream 消费不停 | ● parallel.rs RwLock 批 | ◐ | ◐ | ◐ | ◐ | ○ | ○ | ◐ Promise.all | ○ | ◐ | ○ |
| 提示缓存布局 | ○ 前缀固定自定 | ● 压缩摘要复用原请求前缀；`promptCacheKey` 透传；后台摘要只在 cache 存活期内起 | ● `prompt_cache_ttl`+window prefix 更新分离 | ● fork 共享父缓存 | ◐ | ◐ | ◐ | ○ | ◐ | ◐ | ○ | ○ | ○ |
| 记忆 | ○ 三层摘要+设定集切片 | ◐ | ● world_state 分节渲染+前缀/独立/可合并三种 placement | ◐ CLAUDE.md | ◐ Session 协议 | ◐ | ● OM activeObservations+bufferedChunks+反射代际 | ○ | ◐ repo map | ○ | ○ | ◐ | ○ |
| 用量/成本记账 | ○ usage 记录自写 | ● `SessionUsage.record`：端点自报 cost 优先、目录价兜底、分层 context 价 | ● CodexCompactionEvent 全量分析字段 | ◐ | ● usageTracking 每请求 clone | ◐ | ◐ | ◐ usage 估算补齐 | ○ | ◐ | ◐ | ◐ usage limits | ○ |
| 追踪/运行记录 | ○ run 表自写 | ● gen_ai.* OTel 属性+SessionEvent 总线+每消息 token 列 | ● codex_rollout_trace+analytics crate | ◐ | ● tracing processor | ● checkpoint 即记录 | ● scorer/evals | ◐ | ◐ | ◐ telemetry settings | ● run/step 事件 | ● OTel instrumentation | ○ |

---

## 2. 可直接拷贝的提示词/代码片段（带出处与许可）

### 2.1 opencode 压缩提示词（MIT，可逐字拷贝）

出处：`/tmp/opencode-src/packages/core/src/session/compaction.ts:160-236`（`SUMMARY_TEMPLATE`、`SUMMARY_RULES`、`buildPrompt`、`NUDGE`）。上游仓库 `sst/opencode`，文件路径同上。

要点：
- **模板分八节**：Objective / Requirements / Decisions / Work State(Completed·Active·Blocked) / Next Move / Relevant Files(≤15，每条给理由) / Important Context。
- **规则五条**值得照抄精神（改写成我们场景）："Prefer short references over detailed restatement"（下一个 agent 能自己从文件恢复的信息不写）；"Preserve exact file paths, symbols, commands, error strings, URLs, identifiers"；"Carry forward only user questions or requests that remain unanswered"；"Preserve consequential workflow state, including whether changes are uncommitted/committed/pushed/under review/merged"；"Do not mention the summary process"。
- **首段防泄密**（`buildPrompt` shared 第一条）："Summarize only what the user and the assistant said and did. Leave out instructions and setup the assistant was given rather than told by the user... The next agent receives current versions of all of these separately."——**这条正好补上我们摘要提示词的缺口**：剧本格式说明、内置提示词、设定集切片这类"代码下次调用还会注入"的内容，应明确告诉摘要器不要复述。
- **NUDGE**（回复没填模板时的一条补发消息）：`"The previous response did not fill in the required summary template. Do not call tools. Return the summary as text using the exact section headings from the template."`——比我们"解析失败再补一轮"更明确的写法，可照抄。
- **增量更新版**（`update=true`）的关键三句：`"Newer history always takes precedence over the existing checkpoint. Preserve previous information unless newer history clearly contradicts, supersedes, resolves, or makes it stale."`、`"Incorporate newer requirements, decisions, progress, and context. Reconcile Work State and Next Move: move completed work out of Active, remove resolved blockers and answered questions"`、`"Return only the updated Markdown sections. Do not reproduce the <conversation-checkpoint>, <summary>, or <recent-context> wrapper tags."`

判定：**直接拷贝（改写章节名为我们场景）**。美术导演长循环和对话面板的摘要模板以此为基础，把"Relevant Files"换成"设定集/剧本/图清单状态"，加"未回答的用户问题原样保留"（opencode 已有此条）。

### 2.2 Goose 结构化压缩提示词 + 渲染模板（Apache-2.0，可逐字拷贝）

出处：`/tmp/goose-src/crates/oi-kit-context-management/src/prompts/{compaction.md, compaction_request.md, compaction_summary.md}`。

- **JSON schema 输出**而不是 Markdown：`user_intent[]`/`technical_concepts[]`/`files[]{path,summary,key_code}`/`errors_and_fixes[]`/`problem_solving[]`/`user_messages[]`/`pending_tasks[]`/`current_work`/`next_step`。规则里几句可直接用：`"Quote error messages, panic text, and failing test output verbatim"`、`"it is ok to make it much longer than a normal summary you would show to a human"`、`"Omit a field rather than inventing content"`、`"No new ideas unless user confirmed"`。
- **`compaction_request.md` 额外五条**（进程内压缩即"插进当前对话"而不是独立调用时用）：`<turn-context>` 临时状态不记；本摘要指令本身不算对话；系统提示和工具定义每轮都会重发、复述浪费预算；不许调工具（覆盖早先一切指令）；已有旧 `# Conversation Summary` 时合并成一份。
- **渲染模板** `compaction_summary.md`（MiniJinja）：把 JSON 渲染回 Markdown，`key_code | code_fence` 包裹防内容里的围栏突破块。
- **`structured.rs` 的 lenient 反序列化**（`structured.rs:36-110`）：字段缺失给空、对象/数字当字符串 stringify、未知顶层字段收进 `extra`——"模型 enrich schema 也保住摘要"的宽容解析，可直接移植成 pi-schema 的 fallback parse。

判定：**二选一或合成**。Goose 的"每个 list 都按重要性降序排，尾部可裁"这条和 opencode 的"Prefer short references"互补；**推荐骨架用 opencode 的八节模板（Markdown 对写作类模型更自然），规则吸收 Goose 的"按重要性排序"和"报错原文引用"**。JSON schema 输出对我们的整理角色（单次调用+校验）反而是负担，不要为压缩摘要引入第二套输出形态。

### 2.3 Codex 压缩提示词（Apache-2.0，可逐字拷贝）

出处：`/tmp/codex-src/codex-rs/prompts/templates/compact/prompt.md`、`summary_prefix.md`。

- `prompt.md` 只有 7 行，四要项：progress/decisions、context/constraints/user preferences、clear next steps、critical data/references。**太简，只作下限参照，不抄。**
- `summary_prefix.md`（注入回上下文的摘要头）：`"Another language model started to solve this problem and produced a summary of its thinking process. You also have access to the state of the tools that were used by that language model. Use this to build on the work that has already been done and avoid duplicating work."`——**这段头可抄**，比我们自己起头的措辞更不容易让模型把摘要当新任务。

判定：**只参考**。Codex 真正的价值在代码不在提示词（见 §3.3）。

### 2.4 Claude Code 泄露压缩提示词（出处非官方、不可拷，但机制可参考）

出处：`geniusgeek/claude-code-system-prompts` 等第三方反编译仓库（Anthropic 未开源，**许可不明=只读参考，绝不拷贝文字**）。`pinion05/pi-cc-compact`（MIT）是它移植到 pi `session_before_compact` 钩子的版本，可参考其移植方式。

机制上值得拿的三点：
1. **`<analysis>` 草稿块先于 `<summary>`**：让模型先按时间线逐段过一遍对话（明确列出"user's explicit requests / your approach / key decisions / file names, full code snippets, function signatures / errors and fixes / specific user feedback"），再写最终摘要；宿主拿到回复后把 `<analysis>` 剥掉只存 `<summary>`。**这是零成本的摘要质量提升，我们的整理角色调用时照做**（pi-scaffolding 通用层 6 的压缩提示词加一段 analysis 指令+剥离代码）。
2. **三种 partial 变体**：全量、"只压最近消息、旧的保留原样"、"压旧消息给新消息腾地方"——第三种就是我们美术导演长循环"切点+留尾"的提示词措辞。
3. **`NO_TOOLS_PREAMBLE`**：摘要调用从父会话继承工具集时，开头硬写"Respond with TEXT ONLY. Do NOT call any tools... Tool calls will be REJECTED and will waste your only turn"。**我们所有"文本输出"的单次调用（整理、写手、视觉审核、压缩摘要）都应加这句的变体**——pi 的 `Agent` 若不挂工具则天然无此问题，但对话面板摘要若复用主控会话就要防。

判定：**机制移植改写**（用我们自己话重写九节）；文字不可拷。

### 2.5 opencode 压缩状态机（MIT，可移植改写）

`compaction.ts` 里这些常量和函数是我们压缩模块（约 800 行目标）现成的边界答案：

- `SHRINK_STEPS = [0.85, 0.7, 0.5, 0.35]`（`compaction.ts:129`）：溢出重试时下一轮压缩请求的目标尺寸按首个被拒尺寸的阶梯缩减——**直接抄**。
- `RESERVE_MIN=16_000` / `RESERVE_SHARE=0.15` / `SUMMARY_OUTPUT_FLOOR=32_000`（`:131-138`）：触发线 = window − max(15%·window, 16k)；摘要输出保底 32k。比我们"固定留 16384"精细，**移植**。
- `TRANSCRIPT_LEVELS=[0,1,2,3,4]` 逐级缩减（`:140-148`）：压缩请求放不下时，transcript 按 exchange 从最老开始逐级降级（完整→工具结果截断→工具结果去掉+工具参数截断→只剩用户文本→整条省略），**每个 exchange 先都降一级再有任何一条降下一级**，最新一条永不省略——`flattenAndDropOldest`（`:713-770`）整个函数可移植。
- `clip()`（`:1082-1090`）：头尾各留 `TRANSCRIPT_CLIP/2` 字符、`[… N characters omitted …]`、不劈 surrogate pair——直接抄。
- `splitConversation`/`recentStart`（`:1001-1045`）：留尾选择"从后往前累加到 keep 预算、**停在 user 消息边界**、上一轮摘要的 recent 段算一条"——和 stavrobot 的 `isTurnBoundary` 同一规则，**抄**。
- `estimatePrompt`（`:1107-1128`）："上次响应实测 token（input+cache.read+cache.write+output+reasoning）+ 之后消息的字符估算"——**用服务端实测值锚定估算，不要只靠字符数**。这是我们"每轮请求前估算上下文长度"的正确实现，抄。
- `hasMeasuredPrompt`（`:1180-1190`）：只信**同 provider 且同 model+variant+agent** 的实测计数——换模型后实测值作废，我们换模型功能需要这条。
- `recentUserMessages`/`withoutTail`/`previousCompaction`：留尾只留真实 user 消息（剥技能/附件合成物）。
- 后台预算摘要 `precompute`（`:310-410`）：离顶 `PRECOMPUTE_LEAD=60k` 时后台先算好摘要存着，压缩到期直接用（`usePrecomputed`）；**且只在 prompt cache 剩余寿命足够时起**（`CACHE_LIFETIME=5min`/`CACHE_MARGIN=30s`）——这是省一次摘要调用的优化，我们两处压缩场景收益不大，**只参考不抄**。
- `deliver`（`:614-685`）：发送失败=payload-too-large 则改发纯文本（剥图）、context-overflow 则按 SHRINK_STEPS 缩、其他错误走 session 重试策略——错误分流表可抄。
- `spend`/`addSpent`（`:840-865`）：压缩本身的每次模型调用（含失败、被打断的）都记 usage 并在压缩完成事件里汇总——**和我们"压缩摘要这类不进对话的调用也逐条记"一致，印证设计**。

判定：**移植改写**（去掉 Effect/Schema 层，抽成纯函数；我们只保留 auto+overflow 两个触发）。

### 2.6 opencode `SessionRecentText`（MIT，可直接拷贝 93 行）

`packages/core/src/session/recent-text.ts` 全文件：把每条消息渲染成摘要可见的文本行——`[User]:`、`[Assistant]:`、`[Assistant tool call]: name(input)`、`[Tool result]:`、`[Tool error]:`、`[Synthetic context]:`、`[Shell]:`；`TOOL_OUTPUT_MAX_CHARS=1250` 头截、reasoning 块一律不进摘要文本（注释原文："Providers return summaries of the real reasoning, and written out as text it can read like an attempt to extract the model's thinking"——**reasoning 不进摘要，重要**）。

判定：**直接拷贝改写**（换类型名，行格式照搬）。我们压缩序列化和对话面板"运行记录"显示都可以用这套行格式。

### 2.7 opencode 工具输出截断（MIT，可移植）

`packages/core/src/tool-output.ts`：`MAX_LINES=2000`/`MAX_BYTES=50KiB` 双限；超限写 `tool_<id>` 全文文件、消息里留 `[showing lines 1-N of M (last line cut); full output saved to <path>]` 标记；`save(bytes, ext)` 给二进制用；7 天保留清理。

判定：**移植改写**。我们"大结果转存"（pi-scaffolding 通用层 6）已经有此设计，这份是现成措辞和边界处理（最后一行被截断要标 `last line cut`、文件写失败时标记降级为 `could not be saved: <reason>`）。美术导演读剧本、审稿读原文的超限输出按此做。

### 2.8 opencode `subagent` 工具与 Job/claim（MIT，可移植改写）

- `packages/core/src/tool/plugin/subagent.ts`：输入 `{agent, description(3-5词标签), prompt, model?, sessionID?}`；`sessionID` 复用已有子会话做 follow-up（"A follow-up to a running child joins its current run"）；深度限制 `SubagentDepth.reached`（默认 1，可配）；`permission.assert` 闸；工具描述里动态追加可用子 Agent 列表（`hook("context")` 改写描述——**我们主控的派子 Agent 工具描述也应该由代码动态生成**）；结果统一 `status:"running"` + 文本四行：在后台跑、`background-result` 会回来、不许 sleep/poll/重复派工、`sessionID` 可追问。**"DO NOT sleep, poll, proactively check on its progress"这句要写进我们派子 Agent 工具的描述**。
- `packages/core/src/session/subagent-job.ts`：子会话作为 `Job{kind:"subagent"}` 后台跑；`Effect.onInterrupt` 里**只有显式 cancel 才 interrupt 子会话**——服务关机不动它，下次起来可续（崩溃安全语义）。
- `subagent-completion.ts`：完成/失败/取消统一格式化成 `<background-result kind="subagent" sessionID="..." state="..." description="...">` + 正文，作为 **synthetic 消息**注入父会话（`sessions.synthetic`），还带 `STILL_RUNNING` 后缀列出该子会话还在跑的后台项——子 Agent 的"还没跑完"状态要如实回给父级，不能装完成。
- `subagent-depth.ts`：沿 `parentID` 链数深度，默认限 1 层——对应我们"子 Agent 不能再派"，用配置深度而不是硬编码。

判定：**移植改写**。我们子 Agent 是同步等的（主控等结果），不需要 background-result 通道；但"描述=3-5 词标签、prompt 全文注入、depth 沿 parentID 数、synthetic 消息回传"这四点直接搬。`sessionID` 追问模式可做进对话面板二期。

### 2.9 opencode `SessionInbox` steer/queue（MIT，可参考）

`packages/core/src/session/inbox.ts` + `synthetic.ts`：外部输入先进 inbox 表，delivery 分 `"steer"`（步骤边界插入）和 `"queue"`（等当前排空）。`SessionSynthetic.make` 是代码注入消息的正规入口（子 Agent 报告、compaction 完成、问题答复都走它）。

判定：**只参考**。pi-agent-core 已有 steering 机制（工具批次间注入），我们"对话面板插话"用它；但 opencode 的 delivery 二分（steer vs queue）和"synthetic 单独消息类型进模型前转 user"印证了我们"系统提醒单独一条消息"的决定。

### 2.10 opencode `SessionExecution` claim 恢复（MIT，可移植改写）

`packages/core/src/session/execution.ts:80-90` + `store.ts:79-140`：

- **write-ahead claim**：execution 启动在 started 事件提交时写 `time_suspended`；终态 release 时清零并 `resume_attempts=0`。**存活到下次开机的 claim 就是进程崩溃的签名**——"恢复是数据库的属性，不是关机钩子的责任"（注释原文）。
- shutdown 中断**故意保留** claim 和 running Job 行，下次启动直接续；普通中断/完成才清。
- `releaseOrphanedChildClaims`：父会话被删后子会话的 claim 释放。
- `countResume`：孤儿 claim 每次续跑计数——防无限复活。

判定：**移植改写**。这正是我们"运行记录带进程号、启动时把进程已死的'进行中'标为中断"的成熟版：claim（workID+开始事件同一事务写）→ 启动扫 `time_suspended IS NOT NULL` → resume 计数防爆。比我们现在文档里的"pid 列"更准（pid 复用问题）。

### 2.11 Codex `compact_pending_input`（Apache-2.0，可移植）

`codex-rs/core/src/compact_pending_input.rs`（49 行全）：压缩时**未送达的 agent 间消息**按 `history_sequence` 找出，≤10k token 的保留在摘要之后原位插回——摘要插在第一条 pending mail **之前**，保证队列顺序。

判定：**只参考**。我们没有 agent 间消息队列；但思路通用：**压缩不能吞掉"已登记但模型还没见过"的注入物**——美术导演循环里"刚 apply 的补丁回执、刚入队的图清单"这类条目要么在 keep 尾部、要么由代码在压缩后重建注入（我们已有"压缩后状态由代码重建"决定，这条是其特例，写进压缩模块注释）。

### 2.12 Aider repo map PageRank（Apache-2.0，可参考算法）

`aider/repomap.py`：tree-sitter 抽 def/ref → `nx.MultiDiGraph`（referencer→definer 边，权重 `mul·√num_refs`；chat 内文件 referrer ×50、被提及 ident ×10、snake/kebab/camel 长名 ×10、`_` 开头 ×0.1、定义点 >5 处 ×0.1）→ PageRank → 排名定义二分搜索凑满 token 预算 → tree context 渲染。

判定：**不要**（机制上）。我们没有代码库要给模型建图；**算法思想可参考一处**：如果将来"设定集切片"需要按相关性排序而不是规则过滤，"实体被谁引用 + 当前章出场加权"的 PageRank 思路可用在角色/术语条目上。M3 之后再议。

### 2.13 Vercel Workflow `DurableAgent`/`doStreamStep`（Apache-2.0，可参考）

`packages/ai/src/agent/do-stream-step.ts`：一次模型流调用标 `'use step'`，**整个流被包成一个 durable step**——返回 `DoStreamStepRawResult` 只带重建 `StepResult` 需要的最小字段（注释明确说避免序列化 AI SDK 的冗余副本）；流式 delta 直接写 `writable` 进 UI，跨 step 边界的是聚合结果。`clientSideToolCalls`（无 execute 的工具）**暂停循环把未决调用还给调用者**——对应我们"确认卡挂起"。

判定：**只参考**。我们不引 Workflow runtime；但"模型调用=一个 step 边界、step 边界只传最小可序列化结果、无 execute 的工具=挂起点"这三条印证了我们"每步落库+工具外执行"的形状。

### 2.14 OpenAI Agents SDK 的 `Session`/`RunState`/approval（MIT，可参考）

- `memory/session.ts`：`prepareHistoryItemForModelInput`（存储形态→模型形态分离）、`prepareHistoryItemsForPersistenceComparison`——**存储的和发给模型的允许不同**，我们 `details`/metadata 不发给模型的做法印证。
- `runState.ts`：8000 行 RunState 序列化（版本号注释 1.3→1.25 一长串），approval item 的 canonical identity、`state.approve(item,{message})` 每次调用自定义拒绝文本优先于全局 formatter（`approvalRejection.ts:31-45`）——**确认拒绝时给模型的反馈文本应可定制，且优先于通用文案**，写进我们确认闸门设计。
- `Session` 里 output guardrail tripwire 时**只持久化已完成的工具调用、剔除被拒输出**（`runner/` 注释和 products 报告已引）——"持久化什么"是策略。

判定：**只参考**（JS 版结构一致但我们不需要 RunState 级别的全量序列化）。

### 2.15 Pydantic AI `ModelRetry`/`ToolFailed`（MIT，可参考）

`exceptions.py`：工具/输出校验器抛 `ModelRetry(message)`=回给模型的修正指令、占重试预算；`ToolFailed`=终态失败模型可见、**不占重试预算**（"a missing resource...you want the model to see the failure and adapt"）。`ToolRetryError` 把 pydantic `ErrorDetails` 渲染成类 ValidationError 文本。

判定：**只参考**。pi 的工具结果通道就是消息，没有异常类型可用；但语义二分要写进我们工具约定：**"参数错了可重试的报错"和"终态失败"分开**，前者带 schema+例子，后者只说结论不引诱重试——正好是我们"最多 3 次仍不过标需要处理"的模型侧措辞。

### 2.16 smolagents `final_answer`（Apache-2.0，印证）

`prompts/toolcalling_agent.yaml`：唯一结束方式是调 `final_answer` 工具（"It is the only way to complete the task, else you will be stuck on a loop"）；规则"Never re-do a tool call that you previously did with the exact same parameters"。

判定：**印证现有设计**。我们的 `submit_*`+`finishTurn` 就是同构；"不许重复同参调用"这条值得写进画师工具描述（防止重画时 prompt 一字不改）。

### 2.17 Inngest AgentKit（Apache-2.0，可参考一处）

`agent.ts`：`lifecycles.onStart` 每次推理前可改写 prompt+history 或 `stop:true` 阻止调用；`onFinish` 改写结果；network `router` 按 state 路由下一个 agent。与我们 `prepareRequest`/`finishTurn` 一一对应，无新机制。判定：**只参考**。

### 2.18 ADK tool-confirmation（Apache-2.0 文档，可参考）

`adk.dev/tools/confirmation`：`require_confirmation` 标记的函数工具，agent 产出 `adk_request_confirmation` 事件、外部回 `CONFIRMED`/`REJECTED`；图式 HITL 另有 `HumanInput` 节点。**工具确认=事件出、应答回**，和我们"beforeToolCall 拦下→确认卡→代码执行→结果补回"同构。判定：**只参考**（印证）。

### 2.19 Mastra Observational Memory（Apache-2.0，只参考）

`packages/memory/src/processors/observational-memory/`：Observer（消息→观察，时间戳游标+buffer 块）→ 激活进 `activeObservations` → Reflector（观察攒够再压成反思，新代际 record）。`ARCHITECTURE.md` 自己记录的坑：invariant"buffered 列表必须紧接游标"、`swapBufferedToActive` 读后写会丢并发追加、AI SDK 会复用消息 ID——**全是增量摘要的真实陷阱**。`OBSERVER_SYSTEM_PROMPT` 的 `<observations>` XML 输出格式和"current-task/suggested-response"两个 extractor 可参考。

判定：**只参考**。我们的三层摘要+设定集切片是代码按章切片，不需要 agent 自维护记忆；但如果对话面板将来要跨会话长期记忆，OM 的"观察/反思两级+游标+后台 buffer"是现成架构——M3 后再议。

---

## 3. 采纳优先级排序（Top 15）

| 排名 | 拿什么 | 来源（路径/许可） | 落点 | 判定 |
|---|---|---|---|---|
| 1 | **压缩状态机骨架**：`splitConversation`/`deliver`/`flattenAndDropOldest`/`estimatePrompt`/`clip` | opencode `packages/core/src/session/compaction.ts`（MIT） | 通用层 6 压缩模块 | 移植改写：去 Effect 抽纯函数，保留 auto+overflow 两触发 |
| 2 | **压缩提示词**：opencode 八节模板+规则+`NUDGE`+增量更新三句 | 同上 `:160-236`（MIT） | 通用层 6；整理角色的摘要调用 | 直接拷贝：章节名换成我们的（设定集/剧本/图清单状态） |
| 3 | **`SessionRecentText.messageToText`** 行格式+reasoning 不进摘要 | opencode `packages/core/src/session/recent-text.ts`（MIT，93 行） | 通用层 6 序列化；对话面板运行记录 | 直接拷贝改写 |
| 4 | **`<analysis>` 草稿块**先于摘要+剥离 | Claude Code compact（只参考，自写） | 通用层 6；整理摘要调用 | 移植改写：提示词加 analysis 指令，代码剥块 |
| 5 | **claim=崩溃签名**：`time_suspended`+`resume_attempts`+孤儿释放 | opencode `packages/core/src/session/{execution,store}.ts`（MIT） | 通用层 3 运行记录 | 移植改写：run 表加 suspended/resume_attempts 列 |
| 6 | **工具输出超限转存措辞**：`[showing lines 1-N of M (last line cut); full output saved to <path>]` | opencode `packages/core/src/tool-output.ts`（MIT） | 通用层 6 大结果转存；美术导演/审稿读工具 | 移植改写 |
| 7 | **派子 Agent 工具契约**：`{agent,description(3-5词),prompt}`+描述里动态列可用子 Agent+"不许 sleep/poll"+depth 沿 parentID 数 | opencode `packages/core/src/tool/plugin/subagent.ts`（MIT） | 通用层 5 派子 Agent 工具 | 移植改写：同步等结果，去掉 background 语义 |
| 8 | **`estimatePrompt` 实测锚定**：上次响应 input+cache read/write+output+reasoning + 之后字符估算；换 model/provider 作废 | opencode `compaction.ts:1107-1190`（MIT） | 通用层 6 计量；角色运行器记录实测 usage | 移植改写 |
| 9 | **溢出压缩请求的 SHRINK_STEPS=[.85,.7,.5,.35] 逐级缩 + payload-too-large 剥媒体重发** | opencode `compaction.ts:129,614-685`（MIT） | 通用层 6 | 直接拷贝常量和分流表 |
| 10 | **每 exchange 逐级降级 transcript**（完整→截工具结果→去工具结果截参数→只剩 user→省略；每级全体先降，最新永不省） | opencode `compaction.ts:713-770`（MIT） | 通用层 6：压缩请求自身放不下时 | 移植改写 |
| 11 | **摘要头措辞**："Another language model...Use this to build on the work...avoid duplicating work" | codex `prompts/templates/compact/summary_prefix.md`（Apache-2.0） | 通用层 6：摘要注入回上下文的引导句 | 直接拷贝 |
| 12 | **Goose 规则四条**：按重要性降序、报错原文引用、宁缺字段不编造、没确认的不写新点子 | goose `crates/oi-kit-context-management/src/prompts/compaction.md`（Apache-2.0） | 通用层 6 压缩提示词的 RULES | 直接拷贝（句子级） |
| 13 | **工具错误语义二分**：可重试报错（带 schema+示例）vs 终态失败（不引诱重试） | pydantic-ai `exceptions.py` ModelRetry/ToolFailed（MIT，只参考语义） | 通用层 2 提交工具+各角色工具报错约定 | 只参考：写进工具报错规范 |
| 14 | **pending 注入物不被压缩吞掉**：摘要插在第一条未送达注入之前 | codex `compact_pending_input.rs`（Apache-2.0） | 通用层 6：美术导演循环里刚登记的条目 | 只参考：并入"压缩后状态由代码重建"注释 |
| 15 | **`preferThinkingOff`+输出保底**：摘要调用关 reasoning、输出预算保底 32k/8k | opencode `compaction.ts:137`；cline `compaction-shared.ts:31`（MIT） | 通用层 6：摘要请求的 generation 参数 | 移植改写：摘要调用强制 `reasoning:"off"`（支持时）+ maxTokens 保底 |

落选但记一笔的：
- opencode `precompute` 后台摘要（PRECOMPUTE_LEAD=60k+cache 寿命检查）：我们两处压缩场景不需要提前算，**不抄**；若对话面板压缩延迟体感差再回来看（`compaction.ts:283-410`）。
- Claude Code 九节模板文字：**许可不明不拷**，用 opencode 模板替代。
- Aider repo map：无代码库场景，**不要**；PageRank 思想留给设定集相关性排序（M3+）。
- Mastra OM 全套：超出我们需求；其 ARCHITECTURE.md 的坑清单（读后写丢追加、消息 ID 复用）留作增量摘要的排雷参考。
- 五级压缩降级链/多方法回退（oh-my-pi）、remote/native 压缩（opencode/codex）：我们接的三种文本格式里远端压缩不可控，**不抄**，保持"摘要失败就放弃、不自动继续"。

---

## 4. 和我们现有设计冲突或缺口

按证据列出，严重度递减：

1. **压缩触发线过于粗糙**。decisions/研究里沿用的"留 16384 给输出"来自 pi 默认 `reserveTokens`；opencode 用 `window − max(15%·window, 16k)`，且触发后压缩请求自身的预算、摘要输出保底 32k、溢出时按 SHRINK_STEPS 缩（`compaction.ts:129-138,614-685`）。我们的"接近上限就压"没写数值；美术导演循环在大窗模型上 15% 比固定 16k 更合理。**修正**：压缩模块常量按 opencode 三值（RESERVE_SHARE/RESERVE_MIN/SUMMARY_OUTPUT_FLOOR）。

2. **上下文估算没用实测值**。`agent-orchestration.md` §3 写"每轮请求前估算上下文长度"，没写怎么估。opencode `estimatePrompt` 证明正确做法是"最近一次响应实测（含 cache read/write 和 output/reasoning）+ 之后消息字符估算"，且换 provider/model/variant/agent 后实测作废（`hasMeasuredPrompt`）。**缺口**：角色运行器要在 usage 记录里存"最近一次实测 prompt 值"供估算用。

3. **摘要提示词缺"不要复述系统提示/工具定义"**。我们计划自写摘要提示词；opencode shared 第一条、Goose `compaction_request.md`、Claude 的分析块都明确"下一个 agent 会重新收到这些，别复述"。剧本格式说明、设定集切片正是我们每轮重注入的——**修正**：摘要提示词加等价规则。

4. **压缩会吞掉"已登记未送达"的注入**。Codex `compact_pending_input` 处理的场景我们也有：美术导演 `apply_staging_patch` 回执、提议登记回执若恰好在压缩窗口内又没进 keep 尾部。我们已有"压缩后状态由代码重建"总原则，但**没写"摘要必须插在未送达注入之前/重建时保留它们"这条具体规则**。

5. **工具报错缺"可重试 vs 终态"语义**。pi-scaffolding 通用层 2 写了"报错都写成能照着改的说明"，没区分两类。Pydantic AI 的 ModelRetry/ToolFailed 语义对照清楚：参数错误回 schema+示例（可重试、计数），"素材不存在/任务已完成/审核拒绝"是终态（不引诱模型换参数重试）。**修正**：提交工具和 `draw_image` 的报错文案分两类写。

6. **派子 Agent 工具描述缺两句关键文案**。opencode `subagent` 的四行结果文案里"DO NOT sleep, poll, proactively check on its progress, or duplicate this subagent's work"和"include all relevant context"（fresh context 不继承）我们文档只写了后者。**修正**：通用层 5 的工具描述补上。

7. **确认拒绝的模型反馈可定制**。OpenAI Agents `state.reject(item,{message})` 每次调用可带自定义消息且优先于全局文案。我们确认卡现在只有"确认/拒绝"；**缺口**：拒绝时若创作者写了理由（"这张构图不对"），理由应该作为工具结果文本回给主控，不是只标 rejected——决定里"提议的 status"加 `rejected` 带 `feedback` 字段。

8. **运行记录的"pid 列"有复用缺陷**。我们计划"带进程号回收"；opencode claim 机制更稳：执行开始在同一事务写 claim，终态清，**存活到开机的 claim=崩溃**，另有 `resume_attempts` 防无限复活和孤儿 claim 释放。**修正**：run 表设计改成 claim 语义（suspended_at + resume_attempts），pid 只作辅助。

9. **摘要调用未规定 reasoning 开关**。Cline `resolveSummarizerConfig` 对摘要请求 `preferThinkingOff:true`（`compaction-shared.ts:733`），理由：thinking 会吃掉输出预算导致拿不到摘要文本。我们整理角色走"单次调用文本输出"，若模型默认 reasoning，**修正**：摘要类调用统一传 reasoning off（支持的模型），输出 maxTokens 保底（opencode 32k、cline 8k——我们取 8k-16k 即可，摘要不该写 32k）。

10. **没有 NUDGE 机制**。我们写"解析失败时 `prompt()` 再补一轮把错误还给模型"；opencode 对"回复没填模板"专门发一条 NUDGE 且只补一次仍不过就算压缩失败。**修正**：压缩/摘要调用按"模板标题出现=合格"判定，不合格发一次 NUDGE，两次不过放弃（与"摘要失败就放弃"一致）。

11. **工具批次并发已有实现但缺 stop 语义**。opencode `step.ts` 的 stopTools：用户停→有可协作停止的工具给 `cancel` 机会、超时 `COOPERATIVE_STOP` 再 interrupt——我们 `agent.abort()` 一刀切。**只参考**：`draw_image` 里的视觉审核调用若跑到一半被停，重画计数怎么处理要写清楚（建议：abort 不算一次重画）。

12. **opencode 会话消息模型比我们条目树多两类**值得吸收：`system` 消息（"model-facing update text, frozen at emit time"+人类可读的 description——正好是我们"系统提醒单独一条"的存储形态）和 `idle` marker（"every step since the previous marker belongs to one turn"——我们的"轮次"边界在 SQLite 里可以就是一条 idle 行，运行记录分组直接用）。**修正**：会话条目树 schema 加 `system` 和 `idle` 两类条目。

13. **`subagent` 工具的 `sessionID` 追问模式**我们未设计。opencode 允许对已有子会话发 follow-up（"joins its current run"）。我们派子 Agent 是一次性的；对话面板若要做"和某个子 Agent 继续聊"，**留作 M3+ 候选**，当前不做。

14. **opencode 的 `native` 字段模式**（消息上挂 provider 私有数据、发给模型前剥掉：`metadata`/`native` 不进 `toLLMMessages`）印证了我们"`details` 存但不出上下文"的做法——无冲突，仅记录。

15. **冲突点（维持原设计）**：opencode/Codex 的 native/provider 压缩、oh-my-pi 五级降级、Temporal/Mastra 全量工作流引擎——都和我们"代码调度固定步骤+每次现拼上下文"冲突或超需求，维持不引入。

---

## 5. 附：各项目许可与语言速查

| 项目 | 许可 | 语言 | 本轮读到的关键文件 |
|---|---|---|---|
| opencode (sst) | MIT | TS(Effect) | `packages/core/src/session/compaction.ts` `recent-text.ts` `tool-output.ts` `tool/plugin/subagent.ts` `session/{execution,store,inbox,synthetic,history}.ts` `session/runner/{step,retry,max-steps}.ts` `schema/src/session-message.ts` |
| Codex CLI (openai) | Apache-2.0 | Rust | `codex-rs/prompts/templates/compact/{prompt,summary_prefix}.md` `core/src/compact.rs` `compact_pending_input.rs` `compact_remote_v2.rs` `context/world_state/` `tools/parallel.rs` `codex_delegate.rs` `core/templates/agents/orchestrator.md` |
| Goose (block) | Apache-2.0 | Rust | `crates/oi-kit-context-management/src/{summarize,structured,templates,lib}.rs` `prompts/*.md` |
| pi-coding-agent (earendil) | MIT | TS | `docs/compaction.md` `dist/core/compaction/compaction.js` `dist/bundle/chunks/chunk-KSDI5FD4.js`（SUMMARIZATION_PROMPT/UPDATE/TURN_PREFIX 全文已抽出） |
| Claude Code | 闭源（第三方反编译，不可拷） | TS | `services/compact/prompt.ts` 的 NO_TOOLS_PREAMBLE/BASE/PARTIAL 三变体 |
| OpenAI Agents SDK | MIT | Py+TS | `memory/session.ts` `runState.ts` `runner/approvalRejection.ts` `guardrail.ts` `handoff.ts` |
| Aider | Apache-2.0 | Py | `aider/repomap.py`（PageRank+二分凑预算） |
| Mastra | Apache-2.0（`ee/` 除外） | TS | `packages/memory/src/processors/observational-memory/`（ARCHITECTURE.md、observer-agent.ts） `packages/core/src/workflows/execution-engine.ts` |
| Cline | Apache-2.0 | TS | `sdk/packages/core/src/extensions/context/{compaction-shared,summarize-conversation,agentic-compaction}.ts` |
| smolagents | Apache-2.0 | Py | `src/smolagents/prompts/toolcalling_agent.yaml` |
| Pydantic AI | MIT | Py | `pydantic_ai_slim/pydantic_ai/exceptions.py` `_agent_graph.py`（output_retries） |
| Vercel Workflow | Apache-2.0 | TS | `packages/ai/src/agent/{durable-agent,do-stream-step,stream-text-iterator}.ts` |
| Inngest AgentKit | Apache-2.0 | TS | `packages/agent-kit/src/{agent,network,state}.ts` |
| LangGraph | MIT | Py | 文档：checkpoints/interrupt/RetryPolicy（详见 products 报告） |
| Temporal | MIT | 多语言 | 文档：durable execution、signal=approval |
| Google ADK | Apache-2.0 | Py | 文档：tool-confirmation `adk_request_confirmation` 事件 |
| Letta/MemGPT | Apache-2.0 | Py | 文档：memory blocks（in-context 可写记忆区） |
| Restate | MIT+BSL | Rust/TS | 文档：durable promises/awakeables（同 Temporal 语义，未深读） |
