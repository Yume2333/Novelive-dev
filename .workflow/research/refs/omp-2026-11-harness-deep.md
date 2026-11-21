# oh-my-pi 深挖报告：Agent 框架逐子系统可拷贝清单

2026-11-21。源码 `/tmp/omp-src`（MIT，`@oh-my-pi/*` 19.0.1，HEAD fbb8085）。本报告把 refs/omp-2026-11-tools-agents.md 和 refs/omp-2026-11-context.md 的设计结论**落成逐文件拷贝清单**，并补齐此前未覆盖的子系统：会话条目格式与崩溃恢复、提示组装块序、todo/plan 状态、ask 确认闸、扩展事件、标题生成、wire/RPC 事件面（映射到我们的 Electron IPC + assistant-ui）。行数为源码实测。

**许可与依赖总前提**：omp 全仓 MIT，文本可照抄需署名。代码层所有 `.ts` 依赖 `@oh-my-pi/pi-agent-core`/`pi-ai`/`pi-tui`/`pi-utils`/`omptype`（全部 Bun-only 且与 earendil 类型不通），所以**没有能 import 的模块**，能拿的是：prompt `.md` 文件（可接近原文改写）、纯数据形状（entry/事件/schema 字段）、纯函数算法（read-selector、frontmatter、模板引擎、错误文本）。判断标注：`直接拷贝`（内容近乎照搬）/`移植改写`（逻辑重写、结构照搬）/`只参考`/`不要`。

---

## 1. 会话条目格式、分支与持久化

| 文件 | 行数 | 依赖 | 判定 | 落点 |
|---|---|---|---|---|
| `src/session/session-entries.ts` | 486 | 仅类型 | **移植改写** | 通用层 3（运行记录）+ 对话面板存储 |
| `src/session/session-title-slot.ts` | 141 | fs | 只参考 | 同上 |
| `src/session/session-persistence.ts` | 597 | fs | 只参考 | 同上 |
| `src/session/session-loader.ts` | 766 | fs | 只参考 | 同上 |
| `src/session/turn-recovery.ts` | 3748 | pi-agent-core 全家 | **只参考**（算法） | 通用层 1 + 主控会话恢复 |
| `src/session/sub-sessions.ts` | 139 | — | 只参考 | 通用层 5（子转录落盘布局） |
| `src/session/queued-messages.ts` | 119 | — | 只参考 | 通用层 8（steering 队列） |

**条目格式可直接照的字段**（`session-entries.ts`）：

- `SessionEntryBase {type,id,parentId,timestamp,runtime?,activeLeafId?}`——`activeLeafId` 是"off-branch 追加"（后台 job 结果、late usage）落盘时记的当时叶，replay 时不会把分支跳错。我们的"出图完成异步回报写回美术导演会话"同构，这个字段要抄。
- `SessionHeader {type:"session",version,id,title?,titleSource,timestamp,cwd,parentSession?,continuationOf?,providerPromptCacheKey?}`——`continuationOf`（同一会话因文件被占用续写新文件）我们用不上；`providerPromptCacheKey` 主控会话可用。
- 文件物理格式：JSONL append-only，**首行定宽 256B title slot**（改标题只重写第一行），第二行 `type:"session"` header。SQLite 方案的我们可改为：条目表 append + 会话行单独存 title，不必学这个 slot hack——`只参考`。
- 条目类型枚举抄：`message`/`model_usage`/`model_change`/`thinking_level_change`/`service_tier_change`/`compaction`/`branch_summary`/`reset_boundary`/`custom`/`custom_message`/`label`/`title_change`/`session_init`/`mode_change`/`ttsr_injection`(略)/`credential_pin`(略)。
- **`session_init` 条目值得抄**：子 Agent 首条记 `{systemPrompt:string[], task, tools[], mountedTools?, agent, modelRole, resolvedModel, outputSchema, spawns, isolated, workPoolYieldItems}`——就是我们"运行记录=完整可复现输入"的落地格式，把 spawn 的全部生效参数记一条，断点重跑/审查都靠它。
- **`custom` vs `custom_message` 二分要抄**：`custom`（`customType`+`data`，不进 LLM 上下文，给代码重建状态用，如画清单进度）vs `custom_message`（`content`+`display`+`excludeFromContext`，经 `convertToLlm` 变 developer 消息）。我们的"进度状态"存 `custom`，"系统提醒"存 `custom_message`，正好对上通用层 3 和 8。

**崩溃恢复**（`turn-recovery.ts`，只参考算法）：

- 挂在 `pi-agent-core` 的 synthetic tool result 机制上：流死在 tool call 中间 → agent-loop 给每个已发出的 call 补一条 `isSyntheticToolResultMessage` 占位结果（`details.executed=false`）保住 provider 的 tool_use/tool_result 配对；转录尾可据此判断"可重试尾巴"。
- `prepareResume()`（3695）：尾部连续的 `isCutOffAssistant` 丢弃，`unansweredPrompt` 找到最后一个没等到回答的 user prompt → `replaceMessages` 切齐后 `Agent.continue()`。**主控面板"上次中断，继续"按钮的算法就是这个**。
- `hasAbortedToolCallTail`/`retry`（3608-3685）：重试先剥掉占位结果+失败的 assistant 边界，若整批工具参数完整则 `toolReplayStart` 直接重放工具（省一次模型调用）。我们的画师循环恢复可用同一思路。
- **恢复带 0.8·trigger、连续无输出重试上限 3 次**、provider `isContextOverflow` → 压缩再重发，都已列在 omp-context 报告。

## 2. 系统提示组装与块缓存序

| 文件 | 行数 | 依赖 | 判定 |
|---|---|---|---|
| `src/system-prompt.ts` `buildSystemPrompt` | 1209（函数 ~725-1209） | pi-utils prompt | **只参考**（块序），数据准备流程不抄 |
| `src/prompts/system/system-prompt.md` | 240 | 模板 | **移植改写**（结构+措辞骨架） |
| `src/prompts/system/project-prompt.md` | ~55 | 模板 | **移植改写** |
| `src/prompts/system/subagent-system-prompt.md` | 96 | 模板 | **移植改写**（见 §prompt 清单） |
| `src/prompts/system/subagent-user-prompt.md` | 4 | 模板 | **直接拷贝**（`Complete assignment thoroughly:\n\n{{assignment}}`） |
| `src/prompts/system/date-cwd-reminder.md` | 4 | 模板 | **直接拷贝** |

**块序要点**（`system-prompt.ts:1184` 注释实测）：返回 `string[]`；块 0 = 渲染后的静态模板（`system-prompt.md`）；eval preludes guidance 追加在后；**`<project-context>`（workstation/context files/workspace tree/active repo）整块殿后**，Anthropic 缓存断点落在它之前——"不同 cwd 的会话共享静态前缀"。子 Agent 同样：默认块 + `subagent-system-prompt.md`，per-spawn 内容（task、context、花名册）全放尾部保持前缀字节一致。我们的角色提示 = 静态角色块 + 尾部"本章规则/素材清单/上下文"块，已定的写手提示顺序与此一致。

`project-prompt.md` 里有句可抄进我们角色提示：上下文文件加载后明写"已自动加载，别再 grep/glob 找 AGENTS.md"——对应我们的"设定集切片已放进上下文，别再去读整本"。

## 3. 工具框架

| 文件 | 行数 | 判定 | 落点 |
|---|---|---|---|
| `src/tools/read-selector.ts` | 136 | 纯函数 | **移植改写**（`parseSel`/`resolveTailSelector`/`invalidSelector` 错误文本） |
| `src/tools/xdev.ts` | 523 | session | **只参考**（设备化思路已定） |
| `src/tools/output-meta.ts` | 858 | — | 只参考（`<meta lines size>` 截断标记格式） |
| `src/tools/approval.ts`+`approval-cache.ts` | 1164 | settings | **只参考**（policy/tier 模型） |
| `src/tools/tool-errors.ts` / pi-tui `ToolError` | — | — | **直接拷贝**概念：工具抛带 message 的 `ToolError`，循环转成 tool result；**错误文本里写合法写法+一个例子** |
| `agent/src/tool-arguments.ts` | 50 | pi-ai | **移植改写**（`lenientArgValidation` 契约 + `__parseError`/`__rawJson` sentinel 剥离） |
| `agent/src/types.ts` intent 字段 | ~1237 | — | **直接拷贝**：`intentTracing` 给每个工具注入可选 `i` 字段（require/optional/omit/动态函数四档），工具卡/运行记录直接用 |
| `src/session/artifacts.ts` `writeArtifact` | 188 | fs | **移植改写**（tmp→校验字节→rename 原子写） |
| `src/tools/ask.ts` + `pi-tui/html-form/*` | 608+ | pi-tui | **移植改写**（见 §6） |
| `src/tools/yield.ts` | 762 | — | **移植改写**（见 §4） |
| `src/tools/output-schema-validator.ts` | 395 | — | **移植改写** |

**read-selector 语法**（我们 `read_source_range`/`read_scenes`/`read_reference` 的参数形态）：`:N`、`:N-M`、`:N+K`、`:N-`（到尾）、`:-N`（尾 N）、逗号多区间、`:raw`、复合 `:raw:50-100`、`:img`、`:conflicts`。`resolveTailSelector` 拿到 totalLines 后 clamp。非法输入抛 `ToolError("Invalid selector ':x'. Use :N, :N-M, …")`——**错误文本列全部合法式，这是"报错即教材"的样板**。

## 4. 子 Agent（task）与子系统合同

| 文件 | 行数 | 判定 |
|---|---|---|
| `src/task/types.ts` | 314 | **移植改写**：`taskSchema`/`taskItemSchema`/`getTaskSchema`/`canSpawnAtDepth`/`AgentDefinition` |
| `src/task/agents.ts` + `src/prompts/agents/*.md` | ~80+md | **移植改写**：bundled 角色 = frontmatter 数据 + 正文模板；sonic 复用 task.md 只换 frontmatter → 我们三个画师可复用同一份正文模板 + 各自 frontmatter |
| `src/discovery/helpers.ts` `parseAgentFields` | ~321-420 | **移植改写**：frontmatter 字段白名单解析（name/description 必填，tools CSV/数组，spawns `"*"`/列表，model `@role` 别名，output JTD） |
| `src/task/steps.ts` | 130 | 只参考（分阶段 spawn 续点） |
| `src/task/result-summary.ts` + `prompts/tools/task-summary.md` | 97+~40 | **移植改写**：`<task-result>` 信封模板 |
| `src/task/output-manager.ts` | 124 | 只参考（id 分配、`Parent.Child` 嵌套命名） |
| `src/session/harness-tags.ts` | 16 | **直接拷贝**：`escapeHarnessTags` 把 `<irc`/`<system-*>`/`<tangent-notice` 的 `<` 转义，防子 Agent 伪造控制块 |
| `src/task/settings.ts` | 748 | 只参考（`softRequestBudget` 200、1.5× 硬停、`maxRecursionDepth` 2、`maxRuntimeMs`） |
| `src/task/structured-subagent.ts` `buildExecutorOptions` | ~753-845 | **只参考**：模型只填 task/context/name，系统提示/工具集/model/会话环境全代码注入 |
| `src/task/workpool.ts` + `prompts/tools/workpool-batch.md` | 682+ | **只参考**：常驻工人池，逐 item `yield {key,data|error}`——出图队列参考 |
| `src/registry/agent-registry.ts` + `agent-lifecycle.ts` | — | 只参考：running/idle/parked/aborted 状态机 + sessionFile 复活 |
| `src/irc/bus.ts` + `messaging.ts` | — | 只参考：busy→step 边界 aside、idle→wake、parked→复活；广播只给主 Agent |

**task 工具 schema**（`task/types.ts:65-133`，逐字段可抄进 `spawn_agent`）：

```
{ name?: string; agent: string = 'task'; task: string; solutionSpace: string;
  outputSchema?: object|boolean|string|null; schemaMode?: "permissive"|"strict";
  tools?: string[]; isolated?: boolean; "+": "delete" }
// batch: { context: string; tasks: taskItemSchema[] }
```

- `"+": "delete"`：未声明键静默删（pi-schema 侧用 `additionalProperties:false` + strip 对齐）。
- 默认值写进 schema 字符串 `agent: "string = 'task'"`。
- **`solutionSpace` 必填**，工具说明教模型填（"one fix: rename, names given"/"deadlock cause open, no repro"）——我们 `spawn_agent` 的 `task` 之外加一个必填 `solutionSpace`，声明这个子的开放程度，帮助主控选对工作量。
- `outputSchema` 用 `type("object | boolean | string | null")`： ArkType 把 `unknown` 序列化成 boolean 子 schema，llama.cpp grammar 拒——**我们 schema 库也要注意"宽松 schema 输入"不能用裸 unknown**。

**yield 合同**（`tools/yield.ts`）：`{ data }` 终态、`{ error }` 失败、`type:["label"]` 增量段（reviewer 逐条报 findings）、`type:"result"` 无 data 仅收尾已交段。`MAX_SCHEMA_RETRIES=3`，超过按豁免接受并 `schemaOverridden:true`。严格模式 provider（OpenAI/Codex）会把可选 `type`/`error` 发成 `null`/`""`/占位符（`PLACEHOLDER_YIELD_ERRORS`），yield 解析都要容——**这是真接口的脏行为清单，直接抄进我们 submit_* 的容错**。错误文本：`YIELD_FORMAT_HINT = 'Submit success as {"data":<your output>} or failure as {"error":"message"}.'`——简短、给正确样例。

**结果信封**（`prompts/tools/task-summary.md`，模板原文可改）：

```
<task-result id="{{id}}" agent="{{agentName}}" status="{{status}}" duration="{{duration}}">
  [<meta lines size />] [<abort-reason>…resumable 提示…</abort-reason>]
  [<error>…</error>]
  <preview full-output="agent://{{id}}">…</preview> | <output>…</output>
  [<merge-summary>…</merge-summary>]
</task-result>
```

后接一行"该 agent idle/aborted/isolated → `write agent://id` 续聊 or `history://id` 看转录"的提示（`task-follow-up.md`）。阈值：内联 ≤ ~11.5k 字符，超过给 5000 字符 preview + `agent://` 指针，全量原子写 `<artifactsDir>/<id>.md`。子转录放父 artifacts 目录 `<parent>/<agentId>.jsonl`。

**AgentProgress**（`pi-tui/tools/task.ts:2375`，面板进度行字段，逐字段可抄进我们的子任务面板）：`index/id/agent/status(pending|running|completed|failed|aborted)/task/description/lastIntent/currentTool+Args+Intent/recentTools[]/toolCount/requests/tokens(不含cacheRead)/contextTokens/contextWindow/cost/durationMs/resolvedModel/completionPercent/stage(≤80字)`——我们的"运行中子任务卡片"按这套字段出。

## 5. todo/plan 状态跨压缩存活

| 文件 | 行数 | 判定 |
|---|---|---|
| `src/tools/todo.ts` | 743 | **移植改写**（状态序列化思路），工具本身我们不做 |
| `src/session/todo-tracker.ts` | 544 | **只参考**（重建+提醒节奏） |

**核心机制**（这正是 pi 没有导致抱怨的点）：todo 相位不存文本消息里，存**工具 result 的 `details.phases`**（`TodoToolDetails`），每次成功 todo 调用把整份 `{name,tasks[{content,status}]}[]` 记在 toolResult 条目上。`syncFromBranch()`（134）从当前分支最后一条 todo toolResult 的 details 重建精确相位——**压缩摘要器写不写都不影响，代码从条目还原**。

**对我们的映射**：美术导演长循环的"图清单进度"、待办状态，存工具 result `details` 或 `custom` 条目（见 §1），压缩后代码重建——这正是我们 `agent/context/state.ts` 的出处依据。omp 还做了：压缩后自动补发 `buildPostCompactionEagerNudges`（eager todo/task prelude 重注入）；`isAwaitingUserAnswer`（495-544）用正则集判断 assistant 收尾是否在等用户回答，等的话不发提醒——**确认卡场景同构**：我们的提议卡 pending 时不该被进度提醒打断，这个判断函数可抄。

## 6. ask/confirm 工具（对比我们的确认卡闸门）

| 文件 | 行数 | 判定 |
|---|---|---|
| `src/tools/ask.ts` | 608 | **移植改写**（协议，不抄 TUI 渲染） |
| `src/prompts/tools/ask.md` | 39 | **移植改写**（确认卡工具说明骨架） |
| `src/prompts/tools/ask-result.md`、`ask-headless-fork.md` | ~10 | 参考 |

**机制**：`{html}` 单参数装一张 `<form>`。有表单面（TUI/ACP/RPC）整渲；无 UI 的主机走 `fieldQuestions`/`fieldContexts` 逐字段问 select/input/editor。模型拿到 JSON `{name: value}`。**预选即默认**：`checked/selected/value` 预选值在超时（`askTimeoutMs`）后按默认提交——和我们"确认卡预填推荐项、超时按推荐走"一致。`TIMEOUT_DETECTION_TOLERANCE_MS=1000`：窗口内 `undefined` 算 UI 超时、窗外算用户 Esc。

`ask.md` 的规则全可改成我们 `propose_*` 工具说明：禁 `<script>/<style>/<button>`（UI 自带 Submit/Cancel）；radio=one-of、checkbox=many-of、`<select>` 长列表；radio/checkbox 自动带 "Other" 自由文本，**禁止模型自己加 "Other" 选项**；上下文（findings/diffs/drafts）放进 `<p>/<ul>/<table>/<pre>`；预选用 `checked` 标出推荐；"a few questions, 2-5 options each; ask follow-ups in a later call"。

**和我们确认卡闸门的差异**：我们的确认工具（`propose_*`）在 `beforeToolCall` 拦下 → 登记提议出卡 → 确认后代码执行把结果补回会话。omp 的 ask 是**阻塞工具**等 UI 应答，我们的确认点 1（角色候选）是**让出制作槽**等用户——更接近 omp 的 `agent_pause{awaiting:true}` + `extension_ui_request{method:"form"}` 唤醒模型：提议登记进 `project.db`、会话 park、用户确认后唤醒续跑。omp 的 `RpcExtensionUIRequest method:"form"`（带 `html`+`timeout`）就是出卡协议；`extension_ui_response{data}` 即用户提交。这两个帧形可直接映射到我们的 IPC。

## 7. 钩子/扩展事件

`src/extensibility/extensions/types.ts`（2577 行）约 40 个事件。我们不需要插件系统，但**这个清单 = 我们的运行记录/闸门/注入要挂的点**，pi-agent-core 已有的钩子（`transformContext/prepareRequest/prepareNextTurn/beforeToolCall/afterToolCall/transformAssistantMessage`）之外，omp 扇出的值得知道：`before_subagent_spawn`（可 block/换模型）、`tool_approval_requested/resolved`、`session_before_compact/compacting/compact`、`auto_retry_*`、`retry_fallback_*`、`ttsr_triggered`、`input`、`goal_updated`、`agent_pause{yielded,awaiting}`。`beforeToolCall` 链序：TTSR 规则 → 扩展 `tool_call`（block/改参/附上下文）→ 审批层（`agent-session.ts:6075`）。

## 8. 记忆

mnemopi 不可装（`bun:sqlite` 绑死，21k 行），已有定论。值得留的两个**设计**（omp-context 报告 §3 也提了）：`memory://` URL 两级形态（预览截断+全文按 id 取——我们 `project.db` 查询工具同构）；`veracity` 加权召回（跨作品经验以后再说）。**判定：不要**。

## 9. 运行统计/用量账本

| 文件 | 行数 | 判定 | 落点 |
|---|---|---|---|
| `agent/src/run-collector.ts` | 631 | **移植改写**（字段） | 通用层 3 |
| `src/session/model-usage-journal.ts` | 108 | **移植改写** | 通用层 3 |
| `packages/stats/src/db.ts` schema | ~204-320 | **移植改写**（列设计） | project.db |
| `packages/metaharness/src/store.ts` RunRow/TraceRow | ~95-143 | **移植改写** | 章/素材级 run 记录 |
| `src/session/cost-gate.ts` | — | 只参考 | 确认闸门前查预算 |

`AgentRunSummary`（一次 agentLoop 聚合）：`chats{total,byStopReason,totalLatencyMs}`、`tools{total,ok,error,skipped,blocked,timeout,aborted,totalLatencyMs,byName{...}}`、`usage{input,output,cachedInput,cacheWrite,reasoningOutput,total}`、`cost{estimatedUsd,unavailableReasons[]}`、`errors{total,byType}`、`stepCount`。**"一步一行运行记录"字段模板**。

`model_usage` 条目（`session-entries.ts:166`）：`{purpose,role,api,provider,model,usage,stopReason,errorMessage?,cacheRefresh?,duration?,ttft?,judgment?,completion?}`——`purpose` 命名静态提示（title/summary/compaction），`completion` 记 ≤4000 字符的 prompt/reply。**整理/压缩/标题这类 off-transcript 调用按这个记账**。

stats `messages` 表列（`db.ts:204`）：`session_file,entry_id,folder,model,provider,api,timestamp,duration,ttft,stop_reason,error_message,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,total_tokens,premium_requests,cost_input,cost_output,cost_cache_read,cost_cache_write,cost_total,cost_no_cache_input,cost_unpriced,agent_type('main'|'sub'|'advisor'),service_tier,purpose`。UNIQUE(session_file,entry_id)，索引 `(timestamp,entry_id)`（时间靠前——"同转录行在邻叶"）。**我们 project.db 的调用记录表照这套列**（`agent_type` 换成我们的角色名）。

metaharness `RunRow`（`store.ts:24`）：`{benchmark,jobName,dataset,agent,models,role,label,status('running'|'complete'|'failed'|'cancelled'),pid,exitCode,createdAt,finishedAt,nTotal,done,pass,fail,error,running,costUsd,tokIn,tokOut,tokCache,score,metrics{}}`——**"一次 run 一行"的结算行**，我们的章级/素材级制作 run 记录按这个出（done/pass/fail 正好对"已出图/通过/失败"）。

## 10. wire/RPC 协议 → Electron IPC + assistant-ui 映射

| 文件 | 行数 | 判定 |
|---|---|---|
| `packages/wire/src/index.ts` | 496 | **移植改写**（类型形状，不装包） |
| `src/collab/protocol.ts` | 326 | **只参考**（帧拓扑） |
| `src/modes/rpc/rpc-types.ts` | 1000 | **移植改写**（命令/事件拆分 + 帧形） |
| `src/session/agent-session-events.ts` | 137 | **移植改写**（事件清单） |
| `src/session/loop-end-wire.ts` | 53 | 只参考 |
| `packages/collab-web` | — | **只参考**（per-tool 渲染卡 + 子 Agent 抽屉结构） |

**总架构**（直接对我们 MessagePort）：命令（stdin→host）/ 事件+响应（host→stdout），全 JSON。omp 是"host 权威 hub"，Electron 里 utility process 即 host、React 面板即 guest。

**命令侧**（`RpcCommand`，挑我们需要的）：`prompt{message,images?,streamingBehavior:"steer"|"followUp"}`、`steer`、`follow_up`、`abort`、`abort_and_prompt`、`new_session{parentSession?}`、`get_state`、`get_entries{since?}`、`get_tree`、`branch{entryId}`、`fork{entryId?}`、`navigate_tree{entryId,summarize?}`、`set_label`、`get_messages_page{cursor,limit}`、`set_subagent_subscription{level:"off"|"progress"|"events"}`、`get_subagents`、`get_subagent_messages{subagentId,fromByte}`、`cancel_subagent`、`steer_subagent`、`compact{customInstructions?}`、`set_model`。

**→ 我们的 IPC 命令**：`send_message`（=prompt）、`stop`、`confirm_proposal{proposalId,data}`（=extension_ui_response）、`list_runs`/`get_run{runId,fromByte}`（=get_subagent_messages 增量拉）、`list_branches`/`switch_branch{entryId}`、`get_messages_page`、`cancel_task{taskId}`（=cancel_subagent）。**`fromByte` 增量拉子记录这招**：`RpcSubagentMessagesResult{sessionFile,fromByte,nextByte,reset,entries,messages}`——制作面板点开某章看运行记录，按字节偏移增量拉，正好抄。

**事件侧**（`AgentSessionEvent` + 会话事件）：`agent_start/end`、`agent_pause{messages,yielded,awaiting}`（=我们的"让出制作槽等确认"信号：`awaiting:true` 即只等外部唤醒）、`turn_start/end`、`message_start/update/end{messageId}`（`message_update` 两种投影：`full` 累计快照 / `delta` 增量块——**assistant-ui 流式渲染用 `delta` 投影**，`text_delta/thinking_delta/toolcall_delta`/`text_start`（壳）/`text_end`（权威块尾）语义写在 `RpcDeltaAssistantMessageEvent` 注释 738-752）、`assistant_message`、`tool_execution_start/end`（`{toolCallId,toolName,args,intent}`→工具卡）、`auto_compaction_start/end{reason,action}`、`auto_retry_start/end{attempt,maxAttempts,delayMs}`、`retry_fallback_*`、`todo_reminder`、`queue_update{steering[],followUp[],liveSteered}`、`notice{level,message}`、`irc_message`（=子任务回报注入）。

**子 Agent 事件**（`RpcSubagentFrame`）：`subagent_lifecycle{payload:SubagentLifecyclePayload{id,index,agent,status:"started"|"completed"|"failed"|"aborted"}}`、`subagent_progress{payload:{id,index,progress:AgentProgress}}`、`subagent_event{payload:{id,event:AgentSessionEvent}}`——三级订阅（off/progress/events）由 `set_subagent_subscription` 控制。**→ 我们**：出图队列/子任务的进度推流 = lifecycle + progress 两级就够，事件级不需要。

**UI 请求帧**（`RpcExtensionUIRequest`，=我们的确认卡/表单推流）：`method:"form"{id,html,timeout}` / `"select"{title,options,initialIndex,selectionMarker,checkedIndices,timeout}` / `"input"/"confirm"/"editor"/"cancel{targetId}"/"notify"/"setStatus"`。应答 `RpcExtensionUIResponse{data}|{value}|{confirmed}|{cancelled,timedOut}|{answers[]}`。**确认卡 = `method:"form"` 推过去、`data` 应答回来**，与 §6 对应。

**collab 拓扑**（只参考）：`welcome` 帧 `{header,state,agents,entryCount}` → `snapshot-chunk{entries,final}` 分块补历史 → 之后 `entry{entry}`/`event{event}`/`state`/`agents`/`bus` 增量推。**"快照+增量"是面板首次连接 + 断线重连的模型**——我们 utility process 重启后，React 面板先发 `get_state`+`get_entries{since}` 拿快照，后续收增量事件，同构。加密信封（AES-GCM+peerId）不需要。

## 11. 标题生成

| 文件 | 行数 | 判定 |
|---|---|---|
| `src/tiny/title-client.ts` | 570 | 不要（本地 ONNX 推理 worker，过重） |
| `src/prompts/system/title-system.md` | ~18 | **移植改写** |
| `src/prompts/system/title-fork.md`、`title-card.md`、`title-marker-instruction.md` | ~50 | **移植改写** |

`title-system.md` 全文可改："You MUST write a 3-6 word title…Output exactly one line: the title inside `<title>` tags, or `<title/>` when there is no task to name"，规则含"用用户自己的关键词造祈使句、不要含糊词、greeting/乱语答 `<title/>`、`<chat>` 块里取开场请求而非当前微步"。`title-fork.md` 加了 icon/emoji/code 字段（我们用不上）。**我们的会话/作品命名**：用主模型一次 side 调用（记 `model_usage{purpose:"title"}`），prompt 照这个骨架改成中文书名/章节名。

## 12. 错误恢复与崩溃恢复

`turn-recovery.ts` 见 §1。另有：

- **自动重试**（同文件）：分类器 `unexpected-stop-classifier.ts`（68 行）+ `empty-stop-retry.md`/`unexpected-stop-retry.md`/`stream-stall-continue.md`/`thinking-loop-redirect.md`/`malformed-function-call-retry.md` 模板（各 ~5-15 行，`prompts/system/`）。空 stop/意外 stop/流停滞时注入一条对应模板的 developer 消息续跑，**重试上限 3 次**。模板可改：我们的"模型返回空响应/截断"重试提示。
- **retry-fallback-chains.ts**（模型降级链）：`retry_fallback_applied{from,to,role,reason}`/`succeeded` 事件。我们的多模型角色（主/写作/快速/视觉/图片）可做"快速模型挂了落主模型"的最小版，只参考。
- **`agent_pause.awaiting` + `prepareResume`** = "中断可唤醒"模型的两端，主控面板"中断后继续"照 §1 算法。

## 13. Prompt 文件清单（值得改写成我们角色的）

以下 `.md` 是**纯文本模板（handlebars 风 `{{var}}`/`{{#if}}`/`{{#each}}`），无代码依赖，可近乎原文改写后落我们 `agent/prompts/`**：

| omp 文件 | 改成我们的 | 说明 |
|---|---|---|
| `prompts/system/system-prompt.md`（240 行） | 各角色系统提示骨架 | "# Engineering/# Tool Policy/⁂ Workflow/⁂ Delivery/⁂ Critical" 的分节骨架和"NEVER/SHOULD/MUST"措辞；我们的角色提示可借"delivery 段"（不编输出、不 stub、不缩水、受阻才报、匹配格式） |
| `prompts/system/project-prompt.md`（55） | `<project-context>` 尾块模板 | workstation/context files/"已自动加载别再找"提醒 |
| `prompts/system/subagent-system-prompt.md`（96） | 子 Agent 系统提示 | ⁂ Role/⁂ Context/⁂ Coop/⁂ Completion 四段；"While work remains, you MUST continue with another tool call"（无 yield 时）和 Yield protocol（有 yield 时）两版收尾协议；Peers 花名册段（若我们做子↔主控回报） |
| `prompts/system/subagent-user-prompt.md`（4） | 子 Agent 首条 user 消息 | `Complete assignment thoroughly:\n\n{{assignment}}`，照抄 |
| `prompts/system/date-cwd-reminder.md`（4） | 每次运行的 system-reminder | `Today: {{date}}; current working directory: '{{cwd}}'. Do not repeat…`，照抄换成作品目录 |
| `prompts/system/eager-todo.md`（20） | eager prelude | "call todo first this turn…init op 只收 phase 名+任务标签"（若我们做进度清单工具） |
| `prompts/system/title-system.md`（18） | 标题生成 | 见 §11 |
| `prompts/agents/scout.md`、`reviewer.md`、`security-reviewer.md`、`task.md` | 角色定义参考 | frontmatter+正文=数据化角色定义的样板；`scout` 的 `<directives>/<procedure>/<critical>` 分节、"search 空结果至少换一种策略再下结论"；`reviewer` 的 `output` schema（`overall_correctness`/`explanation`/`confidence`/`findings` 增量段） |
| `prompts/tools/ask.md`（39） | `propose_*` 工具说明 | 见 §6 |
| `prompts/tools/yield.md`（20） | `submit_*` 工具说明 | `{data}`/`{error}`/`type:["label"]` 增量段规则 |
| `prompts/tools/task-summary.md`+`task-follow-up.md`（~60） | 子结果信封+续聊提示 | 见 §4 |
| `prompts/tools/workpool-batch.md`（~15） | 出图队列 item 提交协议 | "yield {key,data|error} per item, tool response names remaining keys" |
| `prompts/tools/read.md` + `read-sources.md`/`read-selector` | 读工具说明 | `path` 单参数承载选择器语法的说明写法 |
| `prompts/system/empty-stop-retry.md`/`unexpected-stop-retry.md`/`stream-stall-continue.md`/`thinking-loop-redirect.md` | 恢复重试提示 | 各 ~5-15 行，按场景注入 |
| `agent/src/compaction/prompts/compaction-summary.md`（38）/`compaction-update-summary.md`（44）/`compaction-turn-prefix.md`（17）/`compaction-summary-context.md`（6）/`branch-summary.md`（30） | 压缩摘要 prompts | 7 节格式+"unanswered question 必须保留"+"仓库状态换成作品/章节状态"；compaction-summary-context.md 的 `"Prior model work/tool state available. MUST build on prior work.\n<summary>…"` 是重建注入模板 |
| `prompts/tools/approval-folder.md` | 确认卡文案参考 | — |

## 14. 排名 top-15（源 → 拿什么 → 落点 → 判定）

1. **会话条目模型** `session/session-entries.ts` → `id/parentId` 条目树 + `custom`(状态)/`custom_message`(注入)/`session_init`(完整 spawn 输入)/`model_usage`(off-transcript 记账)/`activeLeafId`(off-branch 落盘) → 通用层 3 + 对话面板。**移植改写**，SQLite 化、去掉 title slot。
2. **结果信封+提交协议** `task/result-summary.ts`+`prompts/tools/task-summary.md`+`tools/yield.ts` → `<task-result>`+inline/preview 阈值+`yield{data|error|type:[段]}`+3 次 schema 重试+`schemaOverridden`+`escapeHarnessTags` 中和 → 通用层 2/5。**移植改写**。
3. **ask 表单协议 → 确认卡** `tools/ask.ts`+`prompts/tools/ask.md`+`RpcExtensionUIRequest method:"form"` → 单 `html` 表单、预选=超时默认、"Other"自动加、上下文进 `<p>/<ul>/<pre>` → 通用层 4 + `propose_*`。**移植改写**。
4. **todo 状态存 details 跨压缩重建** `tools/todo.ts`+`session/todo-tracker.ts:134` → 状态写进 toolResult `details.phases`/`custom` 条目，`syncFromBranch` 从条目还原；压缩后补 eager nudge；`isAwaitingUserAnswer` 等用户时不提醒 → 美术导演图清单进度 + 通用层 6。**只参考（60 行自实现）**。
5. **RPC 命令/事件拆分 + 子任务增量拉** `modes/rpc/rpc-types.ts` → prompt/steer/abort/branch/get_subagent_messages{fromByte} 命令 + message_start/update/end(delta 投影)/tool_execution/subagent_lifecycle+progress/extension_ui_request 事件 → Electron IPC + assistant-ui + 制作面板。**移植改写**。
6. **提示块序与缓存断点** `system-prompt.ts:1184`+`system-prompt.md`+`project-prompt.md`+`subagent-system-prompt.md` → 静态块在前、`<project-context>` 整块殿后、子 Agent per-spawn 内容放尾部、"已自动加载别再找" → 通用层 1 各角色提示组装。**移植改写**。
7. **`i` intent 字段** `agent/src/types.ts:1237` → 每工具注入可选 `i`（require/optional/omit/动态四档）→ 运行记录+工具卡零成本意图行。**直接拷贝**（10 行实现）。
8. **read 选择器语法+报错** `tools/read-selector.ts`（136 行） → `:N`/`:N-M`/`:N+K`/`:-N`/逗号/`:raw`/复合，非法输入列全部合法式；clamp 不让模型先查行数 → 审稿 `read_source_range`、美术导演 `read_scenes`、画师 `read_reference`。**移植改写**。
9. **错误即教材** `tool-errors.ts`+`xdev.ts:183`+`tool-arguments.ts`(50 行) → `ToolError` 纯 message；参数错回吐 schema+一个可用例子；`lenientArgValidation` 契约+`__parseError` sentinel 剥离；只修文本字段 → 全部角色工具（`apply_staging_patch` 非法 op 列合法 op）。**移植改写**。
10. **压缩摘要 prompt 集** `agent/src/compaction/prompts/*.md` → 7 节+"unanswered question 保留"+`compaction-summary-context` 重建注入+"仓库状态→作品/章节状态" → 通用层 6 `agent/context/prompts/`。**直接拷贝**（改中文+换词）。
11. **运行记录字段** `agent/src/run-collector.ts`+`session/model-usage-journal.ts`+`stats/src/db.ts:204`+`metaharness/src/store.ts:24` → `AgentRunSummary` 字段、`model_usage{purpose,...}`、`messages` 表列、`RunRow` 结算行 → project.db 三步表。**移植改写**。
12. **AgentProgress 进度行** `pi-tui/tools/task.ts:2375` → `status/task/lastIntent/currentTool+Intent/recentTools/toolCount/requests/tokens/contextTokens/cost/stage` → 制作面板"运行中"卡片字段。**直接拷贝**字段集。
13. **steering 边界注入** `agent/src/types.ts:288-370`（`getSteeringMessages`/`hasSteeringMessages`/`waitForSteeringMessages`/`hasBackgroundCompletions`/`hasIrcInterrupts`）+`session/queued-messages.ts` → 用户插话/子任务回报在工具批边界注入不打断 → 通用层 8。**只参考**（pi-agent-core 已有同名钩子，我们接即可）。
14. **崩溃恢复算法** `session/turn-recovery.ts`（`prepareResume`/`hasAbortedToolCallTail`/`toolReplayStart`） → 切掉的 assistant 尾丢弃、`unansweredPrompt` 找未答 prompt、`replaceMessages` 切齐后 continue → 主控面板"中断继续"。**只参考**。
15. **frontmatter+角色即数据** `discovery/helpers.ts:321`+`task/agents.ts`+`prompts/agents/*.md`+`prompts/agents/frontmatter.md` → `{name,description,tools,spawns,model,thinking-level,output,blocking}`+正文模板；sonic 复用 task.md 只换 frontmatter → 我们三个画师可同构（共享正文+各自 frontmatter/modelRole）。**移植改写**。

## 15. 和我们现有设计冲突或缺口（带证据）

1. **缺"会话条目=树"的明确建模**：`pi-scaffolding.md` 通用层 3 只写"运行记录一步一行"，`novelive-agent.md` 对话面板说"会话与分支和运行显示"。omp 证据：主控会话需要 `id/parentId` 条目树 + `branch`/`fork`/`navigate_tree` 命令 + `branch_summary` 条目 + `get_tree` 快照（`session-entries.ts`、`rpc-types.ts:134-140`）——**分支是条目属性不是会话属性**。我们的存储设计还没把"对话面板分支"落成具体条目字段，要补。
2. **缺 `session_init` 完整输入记录**：我们通用层 5 说"新建 Agent，不传父对话"，但没说记录什么。omp 的 `SessionInitEntry`（`session-entries.ts:335-379`）把 spawn 的全部生效参数（systemPrompt 块、tools、model、outputSchema、spawns、isolated）记成一条——**我们"断点重跑被中断任务"需要这条**，否则恢复时不知道从哪拼上下文。
3. **确认闸门语义偏了**：我们定的是"`beforeToolCall` 拦下登记提议、确认后代码执行把结果补回"。omp 的 ask（阻塞等表单）证明**模型侧的提议提交本身就该是个工具调用结果**，不是"拦下再补"——两种都能做，但 omp 把"用户未答"也建模成 `agent_pause{awaiting}` + UI 帧 + 超时默认提交，我们的"让出制作槽"对应 `awaiting:true`，要补**"确认卡=一个可 park 的 UI 请求帧"**这个协议，而不是只在 `beforeToolCall` 里 block。
4. **`useless` 结果标记没写进通用层**：omp-context 报告 §4 提了（"read/find 查不到时标 useless，压缩时整对丢弃"），但 `pi-scaffolding.md` 通用层 1-8 没有。审稿 `find_term` 零命中、`read_source_range` 空段，正该标 `useless:true`——一行字段换上下文，要在通用层 2 工具结果契约里补上（pi-agent-core 的 `AgentToolResult` 已有该字段，`agent/src/types.ts:1068`）。
5. **画师重画循环需要"软预算"**：我们定了"重画次数用完→占位图"，但只限"重画"这个维度。omp `task.softRequestBudget`（`task/settings.ts:590`）是**整个 run 的请求次数预算**——画师一张图可能陷入"画了审核不过→改 prompt→再画"的非重画消耗（描述、查询），光数重画不够。要在画师/美术导演的角色运行器加 `maxRequests` 软预算（超限注入"收尾"提示，1.5× 硬停）。
6. **进度状态"存哪"未定**：`agent-orchestration.md` 说美术导演长循环，但图清单进度存哪没写。omp 的答案是**写进工具 result `details`/`custom` 条目**（§5），压缩后代码重建——不是存文本消息、不是只在内存。这是我们 `state.ts` 缺失的持久化路径。
7. **子任务结果回传的"伪造标记"清单**：我们只说"中和控制标记"。omp `harness-tags.ts` 给出精确清单（`<irc`/`<tangent-notice`/`<system-*`）——我们系统里的标记是 `<task-result>`/确认卡标记/`<system-reminder>` 等，**要列自己的清单**，不能照抄 omp 的表。
8. **wire `i` 字段与"一步封装"的关系**：intent 字段给运行记录和工具卡，但它进的是**发送给 provider 的 schema**（注入后 strip）。我们的 schema 用 pi-schema，注入方式不同，要在"角色运行器包 streamFn"那步加 `intentField` 处理，不是工具本身的事。
9. **omp 有而我们明确不要的**（避免漏看）：`worktree` 隔离（无 git COW 场景）、IRC 子↔子（我们禁止子派子）、`advisor` 旁审（审稿若要实时旁审再回来抄 `advisor/runtime.ts`）、`prewalk`（强模型规划→弱模型执行切换，`session/prewalk.ts`——写手长文若质量不够可回看）、`find`/`jfind` 语义搜索、TTSR 流式规则、snapcompact、speculative-launch、eval 内核、metaharness 代码、mnemopi。

## 16. 备注（实测纠正/补充前报）

- `getTaskSchema`（`task/types.ts:243-281`）：**schema 随能力动态生成**（isolation/batch/effort/evalTools/structured/steps/perCallModel 七个开关组 key 缓存）——我们 schema 不用做这么花，但"`agent` 默认值写进 schema 字符串"和 `"+": "delete"` 两点可直接用 pi-schema 对齐。
- `outputSchema` 字段不能用裸 `unknown`（`task/types.ts:43` 注释：ArkType 序列化成 boolean 子 schema、llama.cpp grammar 拒）——pi-schema 侧"宽松 schema 输入"也要规避。
- `subagent-system-prompt.md` 的 Peers 段写明"名单可能过期，读 `history://` 拿实时"——主控若派多个子，花名册注入要同样标注时效。
- `wire` npm 包**只发 `.ts` 源**，Node 24 直接 import 报 `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`（refs/omp-tools-agents 已实测确认，此处重申：抄形状不装包）。
- `RpcSubagentMessagesResult{sessionFile,fromByte,nextByte,reset,entries,messages}` 的 `reset` 字段：增量拉时若会话被压缩/重写，`reset:true` 让客户端丢弃本地缓存重拉——我们"点开看运行记录"的增量拉也要这个逃逸口。
