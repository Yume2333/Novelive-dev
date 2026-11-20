# oh-my-pi 工具与子 Agent 设计调研（面向 Novelive）

2026-11-21。源码：`/tmp/omp-src` @ fbb8085（`@oh-my-pi/*` 19.0.1，MIT）。omp 是 earendil pi 的 fork 再加一层 coding-agent：我们嵌的 `@earendil-works/*` 和它的 `@oh-my-pi/pi-*` 类型不互通，**任何包都不能直接混用**，但设计高度对口（它也在 pi-agent-core 外写了会话存储、子 Agent、确认闸门、运行记录）。

---

## 1. 子 Agent：`task` 工具

### 1.1 Agent 定义（bundled + 发现）

- Bundled：`src/task/agents.ts` + `src/prompts/agents/*.md`。五个：`scout`（只读调研，`model: "@smol"`，工具白名单 read/find/grep/glob/ast_grep/web_search，自带 `output` schema）、`reviewer`（`model: "@slow"`，`spawns: scout`，output schema 含 `findings` 增量段）、`security-reviewer`、`task`（通用，`spawns: "*"`）、`sonic`（低推理、机械任务，`@smol`）。`sonic` 复用 `task.md` 正文、只换 frontmatter——**角色 = 数据（frontmatter）+ 正文模板**，值得抄。
- 外部定义：markdown + YAML frontmatter，发现路径 `~/.omp/agent/agents/*.md`、`.omp/agents/*.md`、扩展根（`src/task/discovery.ts`）。
- Frontmatter 字段（`src/discovery/helpers.ts:321` `parseAgentFields`）：`name`、`description`（必填）、`tools`（白名单，缺省=全集）、`spawns`（允许再派哪些 agent，`"*"` 或列表，`tools` 含 `task` 时旧版默认 `*`）、`model`（模式列表，支持 `@角色` 别名如 `@smol`/`@slow`）、`thinking-level`、`output`（结果 schema，JTD 风格）、`blocking`（同步内联返回）、`structured`、`read-summarize`（false=read 返回原文不折叠代码块）、`autoloadSkills`、`prewalk`、`advisor`。
- `AgentDefinition` 类型：`src/task/types.ts:293`。

### 1.2 task 参数 schema（`src/task/types.ts:65-133`）

- 单体：`{ name?, agent='task', task, solutionSpace, outputSchema?, schemaMode?, tools?, isolated? }`。批量：`{ context, tasks[] }`（`task.batch` 设置切换），`context` 共享、每项可换 agent。
- `solutionSpace`：必填字段，声明问题的开放程度（"one fix: rename, names given" / "deadlock cause open, no repro"）。工具说明里给例子教模型填（`src/prompts/tools/task.md:49`）。
- arktype 对象带 `"+": "delete"`：未声明键静默删掉，不报错。
- 默认值写进 schema 字符串：`agent: "string = 'task'"`。
- 模型给错字段名也有专门回复：旧字段 `schema` → 提示"改用 `outputSchema`"（`task/index.ts:224`）。

### 1.3 上下文传递与隔离

- **子 Agent 不继承父对话**：新开 AgentSession，系统提示 = 默认块 + `prompts/system/subagent-system-prompt.md`（Role=agent 定义正文、Context=task.context、worktree 提示、Peers 花名册、Completion 协议），首条 user 消息 = `prompts/system/subagent-user-prompt.md`（"Complete assignment thoroughly:\n\n{{assignment}}"）。见 `task/executor.ts:4341`、`task/structured-subagent.ts:761`。
- `steps`：分阶段 spawn，第一阶段先进，前一段交付后才发下一段；最多 4 条 prompt，超过合并（`task/steps.ts`，MAX_STEPS=4）。运行中断可按 `task-steps` 条目续跑。
- 隔离：`isolated: true` 在 copy-on-write worktree 里跑（apfs/btrfs/zfs/reflink/overlayfs/projfs/git worktree，backend 自动选，`task/settings.ts:40`、`task/worktree.ts` 1153 行、`task/isolation-runner.ts`）。完成后 diff 捕成 patch 或分支合回父仓库（`mergeIsolatedChanges`）。**Novelive 用不上**（没有并行改同一 git 树的场景）；要抄的只有一点：隔离运行的 agent 结束后**不可恢复、不可发消息**，结果信封里如实标注（见 1.6）。
- workpool（`task/workpool.ts`）：常驻工人池。`workpool()` 建池，worker 保活按 item 排队轮次干活，每项一次 `yield {key, data|error}`，工具回执报告剩余 key，最后一项自动收尾（`prompts/tools/workpool-batch.md`）。**直接对应我们的出图队列**：N 个画师保活、按素材 item 逐项交付，省得每张图重开会话。

### 1.4 结果回传与结构化输出

- 无 schema：子 Agent 最后一条文本消息即结果。有 `outputSchema`：子 Agent 拿一个 `yield` 工具（`tools/yield.ts`），`{data}` 终态交付；`type:["findings"]` 增量分段累积（reviewer 逐条报 findings）。`schemaMode`：permissive（重试后警告接受）/strict（失败）。schema 校验失败最多重试 3 次（MAX_SCHEMA_RETRIES），超过按"豁免校验"接受并标记 `schemaOverridden`。
- 校验器：`tools/output-schema-validator.ts`（JTD→JSON Schema，增量段按顶层属性子 schema 校验）。
- 结果信封：`task/result-summary.ts` + `prompts/tools/task-summary.md`。`<task-result id agent status duration>`，status ∈ completed / failed(exit N) / cancelled / merge failed；输出 ≤~11.5k 字符内联（`INLINE_OUTPUT_CHARS = ASYNC_INLINE_RESULT_MAX_CHARS-500`），超过给 5000 字符 `<preview full-output="agent://<id>">` + `<meta lines size>`。全量写 `<artifactsDir>/<id>.md`（原子写，`session/artifacts.ts:writeArtifact`），`agent://<id>` 可读、`agent://<id>/<json-path>` 可取结构化字段。
- **回传文本中和**：`escapeHarnessTags`（`session/harness-tags.ts`）把 `<irc>`、`<system-*>`、`<tangent-notice>` 的 `<` 转义，防子 Agent 伪造控制块。我们设计里已有"回传文本中和控制标记"，omp 的清单可直接抄。
- 每个 spawn 产出上限：`MAX_OUTPUT_BYTES=500_000`、`MAX_OUTPUT_LINES=5000`（`task/types.ts:29`）。
- 结构化结果还能按 JSON 路径取：`agent://<id>/reports/0/data`（`internal-urls/agent-protocol.ts`）。

### 1.5 深度限制、取消、预算

- `task.maxRecursionDepth` 默认 2（`task/settings.ts:524`）；`canSpawnAtDepth`（`task/types.ts:288`）决定该会话还拿不拿得到 `task` 工具。我们要的"只有主控能派" = 主控 depth0 有 task、子 Agent depth≥1 不给 task 工具即可，更简单。
- 软请求预算：`task.softRequestBudget` 默认 200 次 assistant 请求/run；超限注入一条"[budget notice] wrap up now"转向通知，到 1.5× 强停并强制交付已做部分（`task/settings.ts:590`、`task/executor.ts:257`）。**强相关**：画师/美术导演的工具循环也该有每轮预算+软停。
- `task.maxRuntimeMs`：子 Agent 硬墙钟超时，默认关。
- 取消：父 abort 传播到子 run；`detached`（async）spawn 是 AsyncJobManager 的后台 job，结果以 `async-result` follow-up 注入父会话（`session/async-job-delivery.ts`，>12k 字符走 artifact）。`blocking: true` 的 agent 永远同步内联。
- 被停的 run 保持 `resumable`：`write agent://<id>` 发消息可唤醒续跑（IrcBus + AgentLifecycleManager 复活 parked 会话，见 1.7）。隔离 run 不可恢复。
- 推测启动：批量 `tasks[]` 流式解析，单项 JSON 闭合就提前拉起子 Agent（`task/speculative-launch.ts`）；参数对不上就 abort。花哨，不抄。

### 1.6 结果摘要回父的方式

`task/index.ts:1147+`：同步 spawn 合并成一个工具结果返回；异步 spawn 立即返回 spawn 回执，结果到点自动以 follow-up 注入（模型被告知 NEVER poll，用 `wait` 工具阻塞）。信封附 `<merge-summary>`（隔离合并结果）和后续提示：可恢复→"write agent://<id> 续聊"、不可恢复→"transcript at history://<id>"（`prompts/tools/task-follow-up.md`）。

### 1.7 IRC 式互发消息

- 通道：`write agent://<id>`（`internal-urls/agent-protocol.ts:write` → `irc/messaging.ts:executeSend`）。`read agent://<id>` 读结果，`history://<id>` 读转录，`proc://` 看在跑的 job/agent。
- 路由：`irc/bus.ts` IrcBus（进程全局 mailbox，每 agent 上限 100 条），`registry/agent-registry.ts` AgentRegistry 管 id→会话。状态机：running/idle（活着可唤醒）/parked（会话已 dispose，有 sessionFile 可复活）/aborted。
- 投递策略：busy agent 的消息在**下一个 step 边界以非打断 aside 注入**；idle agent 起一次真实 wake turn；parked agent 先复活再送。广播只有主 Agent 能发；子 Agent 广播被拒并提示"发给能回答的那一个"（`irc/messaging.ts:38`）。
- 花名册写进子的系统提示（Peers 段），注明"名单可能过期，读 `history://` 拿实时"。为省提示缓存：重建时若默认块没变就复用上次花名册文本（`executor.ts` heldIrcRoster，字节级相同保持前缀缓存命中）。
- **对我们的映射**：Novelive 不需要子↔子聊天，但两点可抄——(a) 主控运行中，用户/代码在 step 边界注入消息而不是硬打断；(b) 中断的任务以"可唤醒实体+转录"建模，而不是重新跑一遍。

---

## 2. 工具设计模式（和我们的"一步封装"原则逐条对应）

### 2.1 schema 保持小

- `read` 只有**一个参数** `path`（`tools/read.ts:902`），行区间、`:raw`、尾行 `:-N`、逗号多区间全编码在 path 选择器里由代码解析（`tools/read-selector.ts`）。规则：**把语法塞进一个字符串参数，别展开成 offset/limit/ranges 一堆字段**。
- `bash` 只有 `command` + 少量修饰（timeout/cwd/pty/async/notify/name/ready）；按会话能力选 schema 变体（无 UI 不给 pty；async 关不暴露 async/name 字段，`tools/bash.ts:461-507`）。`eval` 的 `language` 枚举按启用的后端动态收窄（`tools/eval.ts:158`）。规则：**schema 随能力生成，模型永远看不到不可用的字段**。
- `wait` 零参数（`tools/wait.ts:28`）。`checkpoint{goal}` / `rewind{report}` 各一个字符串。
- `edit` 三形态之一 hashline：`{input: string}` 单参数承载整个补丁 DSL（`edit/schemas.ts:38`、`edit/hashline-compact.md`）：`[PATH#TAG]` 快照标签 + `PUT/CUT/REM/MV` 操作 + `@寄存器` 搬移。模型只写"改哪几行、改成什么"，锚点校验、块边界、no-op 检测全在工具里（`edit/index.ts` 877 行 + pi-natives EditStore）。这是"模型不填可计算参数"的极限示范：连 old_string 都不让模型重复，必须引用 read 见过的行号+快照。
- `ask` 一个 `html` 参数装整张表单（`tools/ask.ts:57`）。
- `task` 让模型填 task/context/name，**不让它填**：系统提示、工具集（除非定义了 agent）、模型细节（只能给审批过的 model 字符串）、会话/目录/安全项——全由代码按角色定义注入（`structured-subagent.ts:buildExecutorOptions` 753-845）。
- 每个工具调用自动注入 `i` intent 字段（`agent/src/types.ts:1237`，可在 schema 里 require/optional/omit）——所有工具调用自带一行意图，运行记录和 UI 直接可用。**建议抄**。

### 2.2 一步动作的内部工作

- `read` 内做：目录列表、PDF/DOCX 提取、图片解码、SQLite/zip/JSONL/jq 源、URL 抓取、tree-sitter 结构摘要（`read.summarize`，代码文件默认折叠，`tools/read-summary.ts`）。
- `bash` 内做：内建 coreutils、内置壳内 URL 协议解析、`notify` 正则行推送、超时自动后台化、`ready` 探测管服务（`prompts/tools/bash.md`、`exec/bash-executor.ts`）。
- `generate_image` 之于我们 = `bash`/`read` 之于 omp：参数少、内部串完整管线，正好印证已定原则。

### 2.3 大输出：artifacts/spill

- 工具输出超阈值 → 写会话 artifacts 目录 `local://<N>.log`，正文给截断预览 + `<meta lines size>` + spill 指针（`session/artifacts.ts`、`tools/output-meta.ts`、`exec/bash-executor.ts:1070`）。
- 子 Agent 全文输出 → `<artifactsDir>/<id>.md` 原子写（先写 tmp 校验字节数再 rename，`artifacts.ts:24`），信封给 preview + `agent://` 指针。
- async job 结果 >12k 字符 → 同样 spill，head 预览 + tail 通知（`session/async-job-delivery.ts:28`）。
- 规则统一：**正文永远小，全量永远可回取，取回通道就是模型已有的 `read`**。

### 2.4 内部 URL 方案（`internal-urls/`，19 个 scheme）

`agent`（子结果+发消息）、`history`（转录/花名册）、`local`（会话 scratch/spill，write 可写）、`proc`（job/agent 状态+`proc://<id>/kill` 取消+`/streams` 看管道字节）、`xd`（工具设备）、`skill`、`memory`、`ssh`、`cfg`、`out`、`conflict`、`issue`/`pr`/`mr`、`mcp`、`omp`、`rule`、`security`、`vault`、`attachment`。每个 handler 声明 `SchemeSpec`：backing(file/virtual/device)、selectors、immutable、是否可写及 tier。**对我们的映射**：project.db 的资源寻址——`local://` 草稿/溢出、`agent://` 子任务结果、`proc://` 出图队列状态、`history://` 运行记录查看；`write` 到 `agent://`/`proc://` 即是"发消息/取消"这类动作，不用再发明动词。

### 2.5 `xd://` 设备：把低频工具藏到 write 后面（`tools/xdev.ts` + `internal-urls/xd-protocol.ts`）

- `read xd://` 列设备，`read xd://<tool>` 出文档+`type Args = …` schema，`write xd://<tool>` 用 JSON args 执行。低频工具不占工具列表/不烧 schema 预算，文档按需取。
- 顶层保留清单：`todo, yield, ask, grep, web_search`；`read/write` 是传输层永不挂载（`XDEV_KEEP_TOP_LEVEL`/`XDEV_TRANSPORT_TOOLS`，`xdev.ts:60-75`）。
- 工具还可以挂 `docTopics()`：`read xd://read/sources`、`xd://read/urls` 取大块参考文档（`tools/read.ts:1311`）。
- **对我们**：画师 `give_up`、审稿的偏门查询、编辑器的低频修复工具都适合做设备；常用工具留顶层。审批还按设备名单独走 `tools.approval.<device>`。

### 2.6 错误返回让模型能自己修

- `ToolError`（`pi-tui/tools/tool-errors`）：纯 message 文本，`render()` 可覆盖。工具抛 ToolError，循环转成 tool result。
- **schema 校验失败把 schema 还给模型**：`xd://` 设备参数错 → `Invalid args for xd://<name>: <err>` + 完整文档+schema（`xdev.ts:183`）；模型下一轮自纠，不用额外往返。
- 错误文本里写**正确的调用样例**：`proc://<id>/kill` 读不得 → "call write with `{path:"proc://bg_3/kill", content:""}`"（`proc-protocol.ts:74`）；read 非法 selector → 列全部合法语法（`read-selector.ts:53`）。
- 写错字段名 → 直接告诉新名（`schema` → `outputSchema`）。非对象/非 JSON → 说明期望形态 + `Write \`?\` for docs` 提示。
- `lenientArgValidation`（`agent/src/tool-arguments.ts`）：工具可声明"校验不过也把原始参数给我"，自己推断（todo 推断省略的 op，`tools/todo.ts:497`）。
- 定向修复：`task` 的自然语言字段（task/steps/context）做"双重 JSON 编码"自动修复，标识符字段和代码类工具绝不修（`tui/src/tools/task-repair-args.ts`——原则：**只修文本字段，误修会毁数据的地方一律不修**）。
- 结果软标记：`isError: true` 之外还有 `useless: true`（结果无信息量，`agent-loop.ts:645`）提醒模型换打法。

---

## 3. 钩子/扩展与系统提示组装

### 3.1 提示组装（`system-prompt.ts:725` `buildSystemPrompt`）

- 返回 `string[]` 块数组而非一整串：静态块（system-prompt.md 模板渲染）在前，`<project-context>`（workstation 信息、context files、AGENTS.md 清单、workspace-tree、active repo）**整块殿后**， Anthropic 缓存断点落在它之前（`system-prompt.ts:1184` 注释明写"不同 cwd 的会话共享静态前缀"）。
- 子 Agent：默认块 + 渲染 `subagent-system-prompt.md` 作为附加块；**per-spawn 内容（context/worktree/花名册）放在 `<project-context>` 之后**，同 agent 的多次 spawn 共享静态前缀命中缓存（`executor.ts:4355` 注释）。
- 模板引擎：`pi-utils` 的 `prompt.render/renderTracked`（`utils/src/prompt.ts:586`，handlebars 风 `{{#if}}{{#each}}{{#list}}{{#when}}`），每个 `{{#each}}` 记录来源用于 token 归因。**我们可直接写一个 200 行的同款**，配合角色模板文件。
- 各准备步骤带超时和降级：`SYSTEM_PROMPT_PREP_TIMEOUT_MS` 内并行跑 context files / skills / workspace tree / personality，超时或失败用最小回退并记日志（`system-prompt.ts:852-1006`）。
- 组装输入即设置集合 `cfgSystemPromptInputs`（`system-prompt.ts:88`）：这批设置任一变才重建提示；改工具集/技能/根目录走各自的 reconcile。
- `date-cwd-reminder`：每次运行注入"今天日期+cwd"的 system-reminder（对应我们 system-notice 同款）。

### 3.2 规则、技能、上下文文件

- Skills：`SKILL.md` 目录，frontmatter `{name, description, globs?, alwaysApply?, hide?/disableModelInvocation?}`（`capability/skill.ts:12`）。进系统提示 `<skills>` 只列 name+description，命中时模型 `read skill://<name>` 取全文（`skill-protocol.ts`）。`hide` 的技能不列出但可显式调。还有 agent frontmatter `autoloadSkills` 在 spawn 时整篇注入。
- Rules：markdown + frontmatter `{description, scope: "tool:edit(*.ts)", interruptMode, astCondition: [ast-grep 模式]}`（`discovery/builtin-rules/*.md`）。alwaysApply 的进 `<generic-rules>`；带 globs 的只列名字+范围进 `<domain-rules>`，命中工具流时由 TTSR 引擎注入正文（`session/ttsr-coordinator.ts`）。规则还能按 `agents: [main|sub]` 限定会话种类。
- 上下文文件：provider 机制合并各家约定——AGENTS.md、CLAUDE.md、codex/gemini/cursor/cline/windsurf/opencode 各自目录（`discovery/*.ts`，`contextFileCapability`），去重后塞进 `<repo-rules>`；workspace 树顺带扫 AGENTS.md 列"改这些目录前必读"（`workspace-tree.ts`，上限 200 个）。**对我们的映射**：作品的改编要求/本作品规则 = 我们的 context files，进角色提示的固定位置（第 3 层，和已定的写手提示顺序一致）。
- AGENTS.md 加载后有显式提示"已自动加载，别再 grep 找"（`project-prompt.md`）——防模型浪费轮次重复发现。

### 3.3 钩子/扩展事件面（`extensibility/extensions/types.ts` 约 40 个事件）

`session_*`（start/before_switch/branch/before_compact/compacting/compact/before_tree/tree/shutdown）、`context`、`before_provider_request`、`before_agent_start`（可改系统提示块）、`before_subagent_spawn`（可 block 或换模型，`runner.ts:2714`）、`agent_start/end`、`turn_start/end`、`message_start/update/end`、`assistant_message`、`tool_call`（可 block/改参数/附加上下文）、`tool_result`、`tool_execution_*`、`auto_compaction_*`、`auto_retry_*`、`retry_fallback_*`、`ttsr_triggered`、`tool_approval_requested/resolved`、`credential_disabled`、`input`、`mode_changed`、`goal_updated`。

`beforeToolCall` 链顺序：TTSR 流规则 → 扩展 `tool_call` 事件（可 block/改参）→ 审批层（`agent-session.ts:6075`）。**我们不需要插件系统**，但事件清单 = 我们运行记录/闸门/注入要挂的点：pi-agent-core 已有 `transformContext/prepareRequest/prepareNextTurn/beforeToolCall/afterToolCall/transformAssistantMessage`，omp 只是把它们扇出成更多具名事件。

---

## 4. 会话存储、运行记录、wire/collab/stats

### 4.1 会话文件格式（`session/session-entries.ts`）

- JSONL append-only，`<id>.jsonl`；首行是定宽 256B 的 title slot（改标题只重写第一行，`SESSION_TITLE_SLOT_BYTES`）；第二行 `type:"session"` header（id/timestamp/cwd/parentSession）。
- 每条 `SessionEntryBase`：`id`/`parentId`/`timestamp`/`runtime`/`activeLeafId`。类型：`message`、`model_usage`（purpose/api/provider/model/usage/stopReason/duration/ttft/judgment/completion）、`model_change`、`thinking_level_change`、`service_tier_change`、`compaction`（summary/firstKeptEntryId/tokensBefore/tokensAfter/method/providerReplayThroughEntryId）、`branch_summary`（fromId+summary，分支被弃路径的摘要）、`reset_boundary`、`custom`、`custom_message`、`label`、`title_change`、`ttsr_injection`、`session_init`、`mode_change`、`credential_pin`。
- **id/parentId 条目树 + compaction/branch_summary 也是条目**——和我们已定方案相同，omp 多了 `activeLeafId`（离线写入标记当时叶）和 `runtime`（写入方构建号）。
- 子 Agent 转录放父 artifacts 目录：`<parent>.jsonl` → 目录 `<parent>/`，子写 `<parent>/<agentId>.jsonl`（`session-manager.ts:394`）；子输出 `<agentId>.md`、advisor `__advisor.jsonl` 同目录。
- `model-usage-journal.ts`：转录外调用（标题、提交信息、压缩摘要）落成 `model_usage` 条目，purpose 命名静态提示，prompt/reply ≤4000 字符才记。→ 我们的运行记录：整理/压缩摘要这类调用也一步一条带 purpose。

### 4.2 run 记录与用量

- `agent/src/run-collector.ts`：每次 agentLoop 聚一个 `AgentRunSummary`——每 chat 一步（model/provider/stopReason/各 token 项/costUsd/latency）+ 每工具计数（ok/error/blocked/timeout/aborted + 总延迟）+ 总 usage/cost。OpenTelemetry span 可选。**直接是"一步一行运行记录"的字段模板**。
- `tui/src/tools/task.ts:SingleResult`：子 run 的结算行——exitCode/outputPath/tokens(不含 cacheRead)/requests/contextTokens/contextWindow/resolvedModel/durationMs/usage/aborted+abortReason。
- `stats` 包（`@oh-my-pi/omp-stats`，`stats/src/`）：bun:sqlite 仓库，扫 sessions 目录 JSONL → 每消息一行（input/output/cacheRead/cacheWrite/cost、provider/model、tool 调用计数、按路径分类 AgentType main/sub/advisor），日 rollup，未定价请求打 `cost_unpriced` 标记。**我们 project.db 运行记录表可照它的列设计**（`stats/src/db.ts`、`parser.ts`）。React 仪表盘、bun:sqlite → 不可直接复用。
- `session/cost-gate.ts` 有花费上限闸门，可抄概念（确认闸门前先查预算）。

### 4.3 wire / collab / RPC（UI↔agent 协议）

- `pi-wire`（19.0.1）：**零依赖纯类型包**，但 npm 只发 `src/*.ts` 无编译 JS（`exports.import → ./src/index.ts`），Node 24 直接 import 报 `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`（实测）；engines 只写 bun。→ **抄形状不装包**。形状：消息/内容块（text/image/thinking/redactedThinking/toolCall+intent）、`WireUsage`（含 cacheRead/cacheWrite/cost.total）、StopReason、`CollabFrame`/`GuestFrame`、`AgentSnapshot`。
- `collab`（`coding-agent/src/collab/protocol.ts`）：host 权威 hub 拓扑，guest 不互通；`[4B peerId][AES-256-GCM payload]` 信封，relay 只见明文信封；welcome 帧带 header+state+agents+entryCount，随后 `snapshot-chunk` 补历史。**对我们的 MessagePort**：同样"快照+增量帧"模型——welcome 帧结构（先给头部+条目数，再分块补）和 `AgentSnapshot`（子 Agent 面板）可照搬；加密层不需要。
- `collab-web`：React SPA 客人端，tool-render 组件与会话 HTML 导出共用（per-tool 卡片+`<omp-tool-view>` 包裹）。我们已选 assistant-ui；可参考的是它的**工具卡按工具定制渲染 + 子 Agent 抽屉/面板**结构。
- RPC 模式（`modes/rpc/rpc-types.ts`）：命令/事件双通道。命令含 `prompt/steer/follow_up/abort/new_session/get_state/get_entries/get_tree/set_subagent_subscription/get_subagents/get_subagent_messages(fromByte 增量拉)/cancel_subagent/steer_subagent/compact/set_model/...`。→ 我们的 MessagePort 契约同款拆分：**命令（提示/停止/确认/切分支/拉记录）+ 事件推流（正文增量/工具卡/子 Agent 进度/确认请求）**，`fromByte` 增量拉子记录这招特别适合"制作面板点开某章看运行记录"。

### 4.4 压缩（顺带，omnibus 供参考）

`agent/src/compaction/compaction.ts:544` `findCutPoint`：只在 user/assistant 边界切（绝不切在 tool result 中间），从尾向前按 `keepRecentTokens` 保留完整最近轮次；`CompactionEntry.firstKeptEntryId` 记录切点；方法有序回退 remote→snapcompact→handoff→shake→soft（`session/compaction-methods.ts`）。snapcompact（`@oh-my-pi/snapcompact`）把历史渲成位图帧给视觉模型读回——机制酷但对纯文本会话过重，且依赖 pi-natives。细节归 OmpContext 的题，这里只留指针。

---

## 5. metaharness / catalog / omptype / utils

| 包 | 是什么 | 能否直接用 | 结论 |
| --- | --- | --- | --- |
| `@oh-my-pi/pi-metaharness` 0.0.1 | 基准运行器：experiment→run→trace 统一模型 + SQLite store + REST/SSE + React 仪表盘（`metaharness/src/{runner,store,server}.ts`，README） | 否：deps 含 pi-coding-agent + react + bun-only | 只抄运行记录形状：一次 run 一行（benchmark/model/score/progress/spend/tokens），SQLite + 适配器归一化 → 我们的章/素材级 run 记录 |
| `@oh-my-pi/pi-catalog` 19.0.1 | 内置模型库 models.json + 供应商发现 + 价格/成本计算（`models.ts` `calculateCost`/`getBundledModel`、contextWindow、promptCache lifetime） | 否：npm 只发 TS 源（实测 Node 24 import 失败）+ 依赖 pi-utils（bun API） | 不需要。pi-ai 的 Usage 已带 cost；我们只要"每个模型配置的上下文长度"——抄 `models.json` 的思路维护一张小表 |
| `@oh-my-pi/omptype` 19.0.1 | ArkType 兼容的运行时 schema（解释器+懒 JIT 编译），全 omp 工具参数都用它 | **能**：npm 发编译后 `dist/js`，engines `node>=20`，零依赖，Node 24 实测 import+校验通过 | 但我们已定 pi-schema，不必换；知道它是"omp 工具 schema 的引擎"即可。`type({"+":"delete"})` 删未声明键、`"string = 'x'"` 默认值这两个特性在 pi-schema 侧可用 TypeBox additionalProperties/default 对齐 |
| `@oh-my-pi/pi-utils` 19.0.1 | 共享工具库（prompt.render 模板、parseFrontmatter、Snowflake、logger、truncation、spillUrl） | 否：多处 `import {YAML} from "bun"`、`bun:sqlite`、`bun:ffi`（frontmatter.ts:1、sqlite.ts:2、process-*.ts），engines 只写 bun | 抄实现：`prompt.render`（约 600 行模板引擎，prompt.ts）、`parseFrontmatter`（YAML frontmatter+kebab→camel+容错修复，frontmatter.ts，YAML 换 js-yaml）、Snowflake id、spill 命名 |
| `@oh-my-pi/pi-wire` 19.0.1 | collab/stream 协议类型 | 否：只发 TS 源，Node 24 实测加载失败 | 抄 `CollabFrame`/`AgentSnapshot`/`WireUsage` 形状进我们的 MessagePort 类型 |
| `@oh-my-pi/omp-stats` 19.0.1 | 用量统计仓库+仪表盘 | 否：bun:sqlite + React + bun engine | 抄列设计（per-message usage/cost/tool 计数、unpriced 标记）进 project.db |
| `@oh-my-pi/pi-natives` 19.0.1 | N-API Rust 原生库（PDF/tree-sitter/grep/pty/sqlite/vcs 等），按 6 平台出 leaf 包（gen-npm-packages.ts） | 否：发布源需 bun 构建，engines bun-only | 不碰 |
| `@oh-my-pi/pi-ai` / `pi-agent-core` 19.0.1 | pi 的 fork | 否：与 `@earendil-works/*` 类型不兼容、引擎 bun-only | 不混装；仅抄 `run-collector`、compaction `findCutPoint`、`tool-arguments` lenient 校验等设计 |
| `@oh-my-pi/collab-web` 16.3.6 | collab 客人端 SPA | 否（React SPA，且我们的 UI 走 MessagePort 不走 relay） | 抄 per-tool 渲染卡+子 Agent 抽屉结构 |
| `@oh-my-pi/pi-mnemopi` | SQLite 记忆引擎 | 未细查（deps: pi-agent-core 系） | 不采用；记忆=我们的设定集/规则 |
| `@oh-my-pi/snapcompact` 19.0.1 | 位图帧压缩 | 否：依赖 pi-natives+pi-ai fork | 不采用（见 §4.4） |

---

## 6. 排名：Novelive 应采纳的模式（omp 出处 → 落点）

落点编号对照 `pi-scaffolding.md` 通用层 1-7 与各角色工具表。

1. **提交工具 = yield + output schema + 增量分段 + 重试上限** → 通用层 2（提交工具+结束检查）。omp 出处：`tools/yield.ts`（type 省略=终态 data、type:[label]=增量段、MAX_SCHEMA_RETRIES=3、placeholder error 过滤）、`tools/output-schema-validator.ts`、`prompts/system/subagent-system-prompt.md` 的 Yield protocol。落地：`submit_review`/`apply_staging_patch`/`submit_image_manifest` 带各自 schema；审稿用增量段逐条报 findings；校验失败把"期望形状+错误"回吐让它重交，3 次后按 permissive 接受并标记。
2. **派子 Agent 的合同：agent 定义数据化 + 不传父对话 + 结果信封** → 通用层 5。出处：`task/types.ts`（taskSchema/AgentDefinition/canSpawnAtDepth）、`discovery/helpers.ts:321`（frontmatter 字段）、`structured-subagent.ts`（context/task 渲染、buildExecutorOptions 代码注入全部环境项）、`result-summary.ts`+`task-summary.md`（`<task-result>` + inline/preview 阈值 ~11.5k/5k + `agent://` 指针）、`output-manager.ts`（id 分配防碰撞、`Parent.Child` 嵌套）、`session/harness-tags.ts`（控制标记中和清单）。落地：主控 `spawn_agent {role, task, context?, name?}`；角色表 = {systemPrompt, tools, modelRole, outputSchema}；深度门控=只有主控持有该工具（比 omp 的计数更简单）；结果 ≤ 阈值内联、否则 preview+指针。
3. **内部 URL 资源方案** → 通用层 3（运行记录）+ 对话面板数据访问 + 角色读工具的统一寻址。出处：`internal-urls/`（19 个 handler 的 `SchemeSpec` 模式）。落地：`agent://<id>`（子任务结果全文/JSON 路径/写入=发消息）、`history://<id>`（运行转录）、`proc://<id>`（出图队列/长任务状态、`/kill` 取消）、`local://<N>.log`（溢出与草稿）、`asset://`、`chapter://` 这类工程资源 scheme 可同构扩展。
4. **大输出 spill + preview/meta 协议** → 通用层 1-3 与所有读工具。出处：`session/artifacts.ts`（原子写）、`tools/output-meta.ts`（truncation meta）、`async-job-delivery.ts`（12k 阈值）、`result-summary.ts`（信封）。落地：读原文/剧本/设定集的结果超阈值即落 `local://N.log`，正文给 head 预览 + `<meta lines size>` + 指针；运行记录里存 artifact 路径不算正文。
5. **软请求预算 + 软停通知 + 硬停** → 通用层 1（角色运行器）+ 画师/美术导演护栏。出处：`task/settings.ts:590`（softRequestBudget 200、agent 级覆盖）、`executor.ts:257`（"[budget notice] used N/budget…at 1.5x force-stopped"）。落地：每个工具循环角色设请求预算（画师默认小），超限注入"收尾"提示，1.5× 强制交差——正好配合"重画次数用完→占位图"。
6. **`ask` 表单工具 → 确认卡** → 通用层 4（确认闸门）+ 主控 `propose`。出处：`tools/ask.ts` + `prompts/tools/ask.md`（一个 `html` 表单，控件 name→JSON；`checked/selected/value` 预选项=超时默认提交；无 UI 时逐字段问）。落地：确认卡用同一表单协议，创作端渲染；预填推荐项，用户超时未答按默认提交（可关）。
7. **read 选择器语法 + 报错教语法** → 审稿 `read_source_range`/`find_term`、美术导演 `read_scenes`、画师 `read_reference`。出处：`tools/read-selector.ts`（`:N-M`/`:N+K`/`:N-`/`:-N`/逗号/`:raw`/`resolveTailSelector`）、`prompts/tools/read.md`。落地：路径参数内嵌选择器，非法输入回 `Invalid selector ':x'. Use :N, :N-M, …` 全部合法式；代码算 totalLines 后 clamp，不让模型先查行数。
8. **系统提示分块 + 可变内容殿后 + 缓存断点** → 通用层 1 各角色提示组装。出处：`system-prompt.ts:1157`（静态块 + `<project-context>` 殿后）、`executor.ts:4355`（per-spawn 块放最后保前缀）、`heldIrcRoster`（重建复用字节相同的花名册）。落地：角色提示=静态模板块 + 尾部可变块（本章规则/素材清单/花名册），与已定写手提示顺序一致；omp 验证了"可变块必须放最后且重建时保持字节相同"。
9. **Agent 注册表状态机 + 转录落盘布局** → 制作面板/对话面板的实体模型。出处：`registry/agent-registry.ts`（running/idle/parked/aborted + sessionFile + history.summary）、`agent-lifecycle`（parked 复活）、`session-manager.ts:394`（子转录嵌在父 artifacts 目录）。落地：运行中的子任务/中断任务以同一状态机建模；"中断"即 aborted+sessionFile，重跑=复活或新 spawn；制作面板点开看 `<runId>` 转录。
10. **workpool 常驻工人池** → 出图队列（代码调度层，不是模型工具）。出处：`task/workpool.ts` + `prompts/tools/workpool-batch.md`（池化 worker、逐项 `yield {key,data|error}`、回执报剩余 key、末项自动收尾）。落地：N 个画师会话（=同时出图数）保活，素材 item 顺序喂，每项交付一张图的 verdict；比"每图重开会话"省前缀重建。
11. **steps 分阶段 spawn** → 一章三步/主控长流程。出处：`task/steps.ts`（≤4 prompt、前段交付再发后段、`task-steps` 条目断点续跑）。落地：与"每步存结果、停下续做"的调度天然对齐；阶段产物即下一步输入。
12. **错误即教材 + lenient/修复边界** → 全部角色工具。出处：`xdev.ts:183`（参数错回吐完整 schema+docs）、`proc-protocol.ts:74`（错误里给正确调用样例）、`read-selector.ts:53`（列合法语法）、`tool-arguments.ts`（lenientArgValidation 契约）、`task-repair-args.ts`（只修自然语言字段）。落地：校验失败回"期望形态+一个可用例子"；`apply_staging_patch` 这类 DSL 工具非法 op 时列合法 op；文本字段可做去双重编码修复，代码/补丁字段绝不自动修。
13. **`i` intent 字段** → 通用层 3 运行记录 + 工具卡。出处：`agent/src/types.ts:1237`（`i` 注入策略 require/optional/omit/动态）、`prompts/system` intentTracing。落地：每个工具 schema 注入可选 `i`，工具卡/运行记录直接显示模型自报意图，零成本。
14. **`xd://` 设备化低频工具** → 角色工具瘦身（审稿偏门查询、编辑器低频修复、`give_up`）。出处：`tools/xdev.ts`（mount/keep 清单、docs+schema on demand）、`xd-protocol.ts`。落地：核心工具 ≤5 个顶层；罕用工具 `write xd://<name>` 调，`read xd://` 发现。schema 预算省下来给上下文。
15. **session JSONL 条目树 + model_usage 条目** → 通用层 3（运行记录）+ 对话面板存储。出处：`session-entries.ts`（id/parentId、`model_usage` purpose/usage/ttft、`compaction`/`branch_summary`/`label`/`custom` 类型、定宽 title slot）、`model-usage-journal.ts`（转录外调用记账）、`stats/src/parser.ts`+`db.ts`（统计列设计、unpriced 标记）。落地：project.db 条目表字段照抄这套；整理/压缩摘要等 off-transcript 调用也逐条记账（purpose+usage），制作面板按 runId 聚合成本。
16. **运行中 steering/aside 注入** → 主控对话面板（用户插话不打断当前步骤）。出处：`irc/bus.ts`（busy→step 边界 aside、idle→wake turn、parked→复活）、`agent-session.ts:2707`、`types.ts` steeringSignal。落地：主控跑长循环时，用户追加消息在工具批边界注入；子任务给主控的进度汇报走同路。
17. **`context`（批处理共享上下文）与 `solutionSpace` 字段** → 通用层 5 spawn 参数。出处：`task/types.ts:120`（`{context, tasks[]}` + `"+":"delete"`）、`prompts/tools/task.md`（字段说明与例子）。落地：批量派生时公共设定放 `context` 一次写清；`task` 必填，`solutionSpace` 可选（声明自由度，帮助模型选对工作量）。
18. **只看不抄的大块**：worktree 隔离（`worktree.ts`/`isolation-runner.ts`，git COW 合并，无场景）、IRC 子↔子（我们禁止子派子）、`advisor`（`advisor/runtime.ts` 被动旁观模型+`<advisory>` 注入——如果"审稿"未来想做实时旁审可回来抄）、`find`/jfind 语义搜索（judge 驱动的级联，过度）、`metaharness`/`stats`/`collab` 的代码本身、TTSR 流规则引擎、snapcompact、`prewalk`（强模型规划→弱模型执行的一次性切换，`session/prewalk.ts`，有趣但无对应角色）、`speculative-launch`、eval 内核（`tools/eval.ts`，`tool.<name>` 桥——除非未来给主控写脚本化批处理）。

**一句话**：能装的都是纯类型/设计（omptype 是唯一能跑在 Node 24 的包，但我们已有 pi-schema）；真正值钱的是编码在 `task/*`、`tools/*`、`session/*` 里的合同——子 Agent 定义、yield 提交、结果信封、URL 寻址、错误自愈文本、提示块缓存序——全部按上面的落点移植到我们 `pi-agent-core` 外的那一层。
