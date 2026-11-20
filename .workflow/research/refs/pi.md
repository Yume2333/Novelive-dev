# pi 技术调研报告：pi-ai / pi-agent-core / pi-coding-agent 能力边界

调研基于 npm `@earendil-works/pi-ai@1.5.2` 与 `pi-agent-core@1.5.2` 的 dist 产物，以及 GitHub 仓库 `earendil-works/pi`（main 分支，coding-agent 已升级到 1.6.0）的源码。整仓 MIT 许可，`author: Mario Zechner`（`packages/coding-agent/package.json`）。

## 一、三层架构总览

- **`pi-ai`**（`packages/ai`）：统一多 provider LLM API。不含 agent 循环、不含会话。
- **`pi-agent-core`**（`packages/agent`）：通用 agent 运行时——`Agent` 类 + 底层 `agentLoop` + 工具执行 + 事件/队列/钩子的协议类型。**不含持久化、不含压缩、不含 provider 绑定**（`streamFn` 由调用者注入，`setDefaultStreamFn` 兜底）。
- **`pi-coding-agent`**（`packages/coding-agent`）：完整 CLI，**也是一个可导入的 SDK**（`package.json` `main: ./dist/index.js`，`docs/sdk.md` 官方支持 `import { createAgentSession } from "@earendil-works/pi-coding-agent"`）。会话存储、压缩、分支、扩展系统都在这里实现。README 明确说："Pi ships with powerful defaults but **skips features like sub-agents and plan mode**"。
- 另有一个 **`pi-durable`**（`packages/durable`，实验性）：durable 会话/任务运行时，带崩溃恢复、后台任务、子会话所有权——仓库里唯一有"subagent"成品的层。

## 二、pi-ai@1.5.2 提供什么

`dist/types.d.ts` + `dist/models.d.ts` + `dist/index.d.ts`（npm tarball 实读）：

- **API 适配器**（`dist/api/`，每个模块导出 `stream`/`streamSimple`）：`openai-completions`、`openai-responses`、`azure-openai-responses`、`openai-codex-responses`、`anthropic-messages`、`google-generative-ai`、`google-vertex`、`mistral-conversations`、`bedrock-converse-stream`、`pi-messages`；图像生成 `openrouter-images`；分类器 `typesafe-system-one` 等。
- **统一流事件** `AssistantMessageEvent`（types.d.ts:584-）：`start` → `text_start/text_delta/text_end`、`thinking_start/thinking_delta/thinking_end`（含 `redacted` 加密思考块）、`toolcall_start/toolcall_delta/toolcall_end` → `done|error`。**流式 text、thinking、tool-call JSON delta 全部覆盖**。
- **消息模型**：`SystemMessage`（带 `sections`/`toolsAdded`/`toolsRemoved`，可中途改 prompt 和工具）、`UserMessage`（文本+`ImageContent` base64 图片）、`AssistantMessage`（content = text|thinking|toolCall，含 `usage`、`stopReason`、"error"/"aborted"/"deferred"）、`ToolResultMessage`（含 `details`/`nestedCalls`/`durationMs`）。
- **Provider 体系**：`Provider<TApi>` 接口（`id/baseUrl/auth/getModels()/stream()`）、`createProvider()`、`createModels()`/`MutableModels`、30+ 内置 provider 工厂（`dist/providers/*.d.ts`，如 `anthropicProvider()`、`openaiProvider()`、`openrouterProvider()`）；`models.json` 自定义 provider 机制；`baseUrl` 是 `BaseModel` 与 `Provider` 的一等字段 → **自定义 endpoint（vLLM/SGLang/llama.cpp）原生支持**，还有 `OpenAICompletionsCompat`/`OpenAIResponsesCompat`/`AnthropicMessagesCompat` 兼容旋钮（`compat-schema.d.ts`）和 `StreamOptions.samplingParams`（top_p/top_k/min_p/repetition_penalty 直接合并进请求体——**正好满足 SillyTavern 式参数需求**）。
- **Usage/成本**：`Usage{ input,output,cacheRead,cacheWrite,reasoning,totalTokens, cost{input,output,cacheRead,cacheWrite,total,totalFromProvider} }`；`calculateCost(model,usage)` 由目录价目推算。
- **Abort**：`ProviderRequestOptions.signal: AbortSignal`；`stopReason: "aborted"` 为协议内终止态。
- **重试**：`utils/retry.d.ts` 导出 `RetryPolicy`、`retryAssistantCall(produce, policy, signal, callbacks)`、`isRetryableAssistantError()`；SDK 层还有 `maxRetries`/`maxRetryDelayMs`/`timeoutMs`。
- **上下文溢出检测**：`utils/overflow.d.ts` 的 `isContextOverflow(message, contextWindow)` 覆盖 ~18 家 provider 的错误模式+静默溢出+MiMo 型截断——**触发压缩的关键原语**。
- **结构化输出/约束采样**：`Tool.constrainedSampling?: {type:"json_schema",strict:"prefer"|"require"} | {type:"grammar",variants}`；`api/constrained-sampling.ts` 提供 `makeStrictJsonSchema`/`resolveJsonSchemaStrictSampling`/`resolveGrammarConstrainedSampling`（openai_lark/regex grammar）。
- **图片输入**：`ImageContent`（base64+mimeType），`Model.input` 模态声明。
- **图像生成**：`generateImages(model, context, options)` → `AssistantImages`（`ProviderImages` 契约；内置 `openrouter-images` 适配器）。
- **认证**：`auth/` 目录（API key、`CredentialStore`、OAuth device flow helpers）、`env-api-keys.ts`、`session-resources.ts`（sessionId → provider 缓存亲和）。
- **多模型路由**：单 `Model` 对象粒度调用；多角色路由要自己编排（coding-agent 有 `virtual-models.ts` 虚拟模型路由器可参考，见下）。

## 三、pi-agent-core@1.5.2 提供什么

`dist/agent.d.ts` + `dist/types.d.ts`（共 4 个源文件：`agent.ts`、`agent-loop.ts`、`proxy.ts`、`stream-fn.ts`）：

- **`class Agent`**：状态机持有 transcript。方法：`prompt()`、`continue()`、`steer(msg)`/`followUp(msg)`（两条队列，`steeringMode`/`followUpMode` 控制 `all`/`one-at-a-time` 排出）、`abort()`、`waitForIdle()`、`reset()`、`subscribe(listener)`、`state`（`model`/`thinkingLevel`/`tools`/`messages`/`isStreaming`/`streamingMessage`/`pendingToolCalls`）。
- **事件** `AgentEvent`：`agent_start/agent_end`、`turn_start/turn_end`、`message_start/message_update`（内嵌 `AssistantMessageEvent`——流式 delta 直接透传到 UI）/`message_end`、`tool_execution_start/update`（工具内 `onUpdate` 回调 → **工具进度流**）/`tool_execution_end`（含 `durationMs`）。
- **工具**：`AgentTool` = `Tool` + `label` + `execute(toolCallId, params, signal, onUpdate)` + `prepareArguments` + `outputSchema`/`structuredContent` + `replay:"never"|"safe"` + `executionMode`。`toolExecution: "sequential"|"parallel"`（默认 parallel，可 per-tool 覆盖）。
- **关键扩展点（Novelive 压缩/编排的挂载点）**：
  - `transformContext(messages, signal)` — 每次请求前在 AgentMessage 层变换上下文（文档注释直接建议 "Context window management (pruning old messages)"）。
  - `convertToLlm(messages)` — AgentMessage → LLM Message，必须提供。
  - `prepareRequest`/`prepareNextTurn(WithContext)` — 每请求前换 context/model/thinkingLevel → **这就是做路由和自动压缩的官方挂钩**。
  - `finishTurn` — turn 后可 continue/end。
  - `beforeToolCall`（可 block）/`afterToolCall`（可改写 result）。
  - `getSteeringMessages`/`getFollowUpMessages` 队列源。
- **不提供的**：持久化、会话文件、压缩逻辑、模型路由、子 agent、系统 prompt 组装——全部留给了调用方（coding-agent 就是参考实现）。

## 四、pi-coding-agent（SDK 可直接 import，MIT）

`src/index.ts` 导出面已核对。核心组件：

- **`SessionManager`**（`src/core/session-manager.ts`，~2000 行）：JSONL append-only 存储。文件 `~/.pi/agent/sessions/--<cwd-encoded>--/<ts>_<uuidv7>.jsonl`；首行 `SessionHeader{type:"session",version:3,id,timestamp,cwd,parentSession}`。条目树（`id`/`parentId`）天然支持**分支**：`branch(entryId)` 只移动 leaf 指针，`branchWithSummary()` 额外写 `branch_summary` 条目（含被弃路径摘要），`createBranchedSession(leafId)` 可把单条路径导出成新文件。条目类型：`message / thinking_level_change / model_change / usage / compaction / branch_summary / custom / custom_message / context_edit / label / session_info`。`buildSessionProjection()`/`buildSessionContext()` 负责把条目树投影成模型上下文（应用最新 `context_edit`、取最新 compaction 之后 `firstKeptEntryId` 起保留）。
- **压缩**（`src/core/compaction/`）：
  - `shouldCompact(tokens, contextWindow, settings)`：`tokens > contextWindow - reserveTokens`（默认 `reserveTokens=16384, keepRecentTokens=20000`）。
  - 触发点：**不是 agent-core 的事**——`AgentSession` 在 `prepareRequest`（`_compactBeforeNextAssistantResponse`）与 `prepareNextTurnWithContext`（`_installAgentNextTurnRefresh`）里做阈值检查；provider 报溢出错误时走 `isContextOverflow` → 压缩+重试路径（`agent-session.ts:834`、`_runAutoCompaction("threshold")`）。
  - `prepareCompaction(entries, settings)` 选切点（`findCutPoint` 按 `keepRecentTokens` 保留尾部 turn 边界）；`compact(preparation, model, apiKey, ...)` → `generateSummaryWithUsage()` 用 `SUMMARIZATION_SYSTEM_PROMPT` + `SUMMARIZATION_PROMPT`/`UPDATE_SUMMARIZATION_PROMPT`（有旧摘要时增量更新），工具结果截断到 `TOOL_RESULT_MAX_CHARS`，拆 turn 时另有 `TURN_PREFIX_SUMMARIZATION_PROMPT`；`CompactionEntry.details` 追踪 `readFiles/modifiedFiles`；摘要落盘为 `compaction` 条目+完整 `systemMessage` 检查点。
  - `branch-summarization.ts` 同款流程生成分支摘要。
- **`AgentSession`**（`agent-session.ts`，170KB 巨型文件）：把 `Agent` + `SessionManager` + `ModelRuntime` + 扩展运行时 + 设置 + 自动压缩 + 重试缝在一起。事件含 `compaction_start/end`、`entry_appended`、`agent_settled` 等。
- **SDK 入口**：`createAgentSession(options)`（`src/core/sdk.ts`）支持注入 `modelRuntime/model/thinkingLevel/sessionManager/sessionDir`/`customTools`/`tools` allowlist/`settingsManager`/`resourceLoader`（含 inline `ExtensionFactory`）；`SessionManager.inMemory()` 可免落盘；`AgentSessionRuntime` 提供 `newSession()/switchSession()/fork()/importFromJsonl()`。
- **多模型路由**：`virtual-models.ts` 的 `VirtualModelDefinition{ route(req) → {model,thinkingLevel,state} }`，按 `reason: "user"|"continuation"|"retry"|"direct"` 逐请求路由，路由状态存 session 的 `pi.virtual-model-state` custom 条目——**多角色模型的现成模式**。
- **扩展系统**（`src/core/extensions/`）：几十个事件钩子（`session_before_compact`、`turn_end` boundary、`before_provider_request`、`message_update`、自定义工具/命令/渲染器/虚拟模型），文件级 `.pi/extensions/*.ts` + 内联 factory。
- **工具工厂**：`createReadTool/createBashTool/createEditTool/createWriteTool/createGrepTool/createFindTool/createLsTool/createCodingTools/createReadOnlyTools` + `truncateHead/Line/Tail`、`withFileMutationQueue`。
- **MCP**：`createMcpExtension()`（`pi-mcp` 包）。
- **依赖注意**：coding-agent 依赖 `jiti/chalk/undici/proper-lockfile/typebox/yaml` 等且 `engines: node>=22.19`；Electron utility process 跑 Node 可行，但 SessionManager/compaction 用 `fs` 同步 API——只适合主进程/utility 进程，不进 renderer。
- **子 agent**：**没有**。README 明说刻意不做。`pi-durable`（实验性，README 警告 API 不稳定）有完整子会话模式：`tx.createConversation({ownership:{kind:"task",taskId}})` + 前台/后台 subagent 示例（`22-subagent-background.ts`），但依赖 `@earendil-works/chord` 对象运行时，重。

## 五、能力矩阵

| 能力 | pi-ai@1.5.2 | pi-agent-core@1.5.2 | pi-coding-agent(SDK) |
|---|---|---|---|
| 流式文本 | ✅ `text_delta` 事件 | ✅ `message_update` 透传 | ✅ session.subscribe 透传 |
| thinking 展示 | ✅ `thinking_delta`（含 redacted 块、`ThinkingLevel`/`ThinkingBudgets`/`thinkingLevelMap`） | ✅ 透传 | ✅ 透传+TUI 组件 |
| 工具调用流式 | ✅ `toolcall_delta`（JSON 参数增量） | ✅ `tool_execution_start/update/end` | ✅ |
| abort | ✅ AbortSignal→`stopReason:"aborted"` | ✅ `agent.abort()` | ✅ `session.abort()` |
| usage/成本 | ✅ 每条 `AssistantMessage.usage`+`calculateCost` | ✅ 附在消息上 | ✅ `usage` 条目+`usage-totals.ts` |
| 图片输入 | ✅ `ImageContent` | ✅ | ✅（含 `resizeImage` 工具导出） |
| 结构化输出 | 🟡 per-tool `constrainedSampling`（json_schema/grammar） | — | ✅ 继承 |
| 会话持久化 | ❌ | ❌ | ✅ JSONL 树 + `SessionManager` |
| 压缩 | 🟡 只有 `isContextOverflow` 检测+token 估算原语 | 🟡 只有 `transformContext`/`prepareRequest` 挂钩 | ✅ 完整（阈值/溢出触发、增量摘要、文件跟踪、检查点恢复） |
| 分支 | ❌ | ❌ | ✅ entry 树 + `branch()`/`branchWithSummary()`/`createBranchedSession()` |
| 子 agent | ❌ | 🟡 可自己套娃 new Agent + 当 tool | ❌ 官方不做；pi-durable 有实验性参考实现 |
| 多模型路由 | 🟡 `Models`+provider 目录 | 🟡 `prepareRequest` 可逐请求换 model | ✅ `VirtualModelDefinition.route` 模式 |
| 重试 | ✅ `retryAssistantCall`/`isRetryableAssistantError` | ✅ `maxRetryDelayMs` 透传 | ✅ `settings.retry` 接线 |

## 六、对 Novelive 的启示

1. **三层分工直接照抄**：pi-ai 只负责 provider/流协议，agent-core 是"无持久化的可挂循环"，所有会话语义都在应用层。Novelive 应沿用 `@earendil-works/pi-ai` + `pi-agent-core`，**不要**自己写 provider 适配——`streamSimple` + `AssistantMessageEvent` 已覆盖 sidebar 的 text/thinking/tool-call 三种流式展示，事件直接 IPC 给 renderer 即可。
2. **多角色路由用 `prepareRequest` + 每 Agent 绑定一个 Model**：agent-core 支持同一 `Agent` 换 `model`/`thinkingLevel`，但角色（fast/写作/主模型/director/review）天然是**多个 `Agent` 实例**，每个有自己的 system prompt + 工具集 + `convertToLlm`；主 agent 通过自定义 `AgentTool`（其 `execute` 里 `await subAgent.prompt()`）调用其他角色——子 agent 不需要框架支持，一个工具函数就够。
3. **压缩不要等 pi-agent-core**：它只做钩子（`transformContext`）。直接复用 coding-agent 的压缩算法：`shouldCompact`/`estimateContextTokens`/`findCutPoint`/`generateSummary` 都从 `@earendil-works/pi-coding-agent` 导出（`compact()`、`SUMMARIZATION_SYSTEM_PROMPT`、`DEFAULT_COMPACTION_SETTINGS`），在 utility 进程里以 `SessionManager.inMemory()` 或自定义 sessionDir 使用；触发方式照 `_installAgentNextTurnRefresh` 的模式挂在 `prepareNextTurnWithContext` 和 `prepareRequest`。
4. **会话存储可选两条路**：（a）直接 import `SessionManager`/`createAgentSession`（省造轮子，但拖进 jiti/undici/typebox 等 CLI 依赖和 `~/.pi/agent` 目录约定）；（b）自己写 JSONL/DB 存 `AgentMessage[]`，把 coding-agent 的 entry 类型（`compaction`/`branch_summary`/`context_edit`/`label`/`usage`）当 schema 参考——**长期建议 (b)**：Novelive 的会话树还要关联小说项目/章节/产物，`parentId` 链式 JSONL 和 sqlite 都容易表达，且 coding-agent 的 `fs` 同步写入和 `~/.pi` 路径假设不适合 Electron 的 `app.getPath('userData')`。[推测] 中期可能 fork 其 `SessionManager` 源码而非 npm 依赖，以便砍掉 CLI 依赖链。
5. **写作模型的参数与约束**：`Model.samplingParams`（模型级）+ `StreamOptions.samplingParams`（请求级，逐 key 覆盖）+ `samplingParamsByThinkingLevel`（按 thinking level 切换采样参数）正好装 SillyTavern preset；`Tool.constrainedSampling` 可强制剧本输出 JSON schema；`OpenAICompletionsCompat` 处理第三方 OpenAI 兼容服务的怪癖。
6. **director/art 角色**：pi-ai 有 `generateImages()` 契约（`ProviderImages`），但内置只有 `openrouter-images`；Novelive 自己的图像工具应实现为普通 `AgentTool`，多模态 review 直接给 `UserMessage` 塞 `ImageContent`。`NestedToolCalls`/`tool_execution_update` 事件能让 UI 显示"导演正在调图像工具"的嵌套过程。
7. **子 agent 参考 pi-durable 的所有权模型而非其代码**：`ownership:{kind:"task",taskId}` + 前台（父 abort 级联 abort 子）/后台（`background:true` anchor task，结果以 follow-up 消息回报父会话）两种模式 + `requestId` 幂等，这套设计可以直接抄到 Novelive 的编排器；但不要依赖 `pi-durable` 本体（实验性、拖 chord 运行时）。[推测]
8. **thinking/usage 的展示与计费已免费**：`AssistantMessage.usage`（含 cacheRead/cacheWrite/reasoning 分项+cost）和 `thinking_delta` 无需自建；`usage` session 条目模式可用来统计压缩/图像审查这类"非对话"消耗。
9. **避免的东西**：(a) coding-agent 的 `AgentSession` 170KB 单文件是缝补出的巨石，只借鉴其挂钩顺序（prepareRequest→路由→阈值检查→compact→重投影）不要整体 import；(b) `compat.ts` 是废弃全局 API（registry+env key 注入），新代码用 `createModels()`/`createProvider()`；(c) Electron renderer 绝不能 import pi-agent-core/coding-agent——它们用 `fs/crypto` 同步 API，放 utility 进程，IPC 只传事件。
10. **SillyTavern 式 regex 后处理**：pi 没有对应物；在 `transformContext`（进模型前改写）和 `afterToolCall`/`message_end` 钩子（出模型后处理）之间各插一层 regex pipeline 即可，两个钩子都是现成的。