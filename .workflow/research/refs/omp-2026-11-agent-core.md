# oh-my-pi agent-core / ai / utils / catalog 可移植性审计

2026-11-21。源码：`/tmp/omp-src` @ `fbb8085`（`@oh-my-pi/*` 19.0.1，仓库根 `LICENSE` 为 MIT，版权 Mario Zechner / Can Bölük / Stencil Labs）。对照：`@earendil-works/pi-ai@1.6.0` + `@earendil-works/pi-agent-core@1.6.0`（MIT，装在 `/tmp/pi16`）。前序报告：`refs/omp-2026-11-modules.md`（包级结论）、`-context.md`（压缩）、`-tools-agents.md`（子 Agent/工具）。本文不重复它们的结论，只做两件事：**逐文件判定能否拷进我们在 earendil 1.6 上写的那层**，以及**实测拷贝**（§4）。

## 0. 结论先行

- **agent-loop.ts（4232 行）整体不可拷**：25+ 个 omp 内部 import（pi-ai fork 类型、dialect、harmony/dsml 泄漏恢复、cursor exec、speculative execution、otel、Bun.env 3 处、`.md` 文本导入）。但逐点对比后确认：**earendil 1.6 的循环骨架已经够用**（`finishTurn`/`prepareNextTurn`/`prepareRequest`/steering/followUp/sequential+parallel 全有），omp 的增量按点移植即可，最贵的一批点都集中在 §1 的清单里。
- **真正能近乎原样拷的是外围小文件**，不是循环本体：`run-collector.ts`（运行记录）、`pause.ts`、`tool-context.ts`、`tool-arguments.ts`、`replay-policy.ts`、`tool-call-loop-guard.ts`、pi-utils 的 `fetch-retry.ts`/`json-parse.ts`/`incoming-json.ts`/`sanitize-text.ts`/`async.ts`/`bounded-json.ts`、pi-ai 的 `utils/abort.ts`/`utils/retry-after.ts`。**14 个文件已在 Node 24 + tsc + earendil 1.6 类型下实测编译并跑通**（§4）。
- **pi-ai 侧**：earendil 1.6 自带 `retryProviderRequest`（SDK 级重试+Retry-After）和 `retryAssistantCall`（消息级重试+错误分类）——比前研究认为的更全。omp 独有且值得拿的是：`extractRetryHint`（正文里的重试时间提示，earendil 只认 header）、`createAbortSourceTracker`（区分用户取消和本地看门狗，防止用户取消走重试路径）、`withReplaySafeStreamRetry`（产出内容前可安全重发的事件级重试）。
- **一个实测修正**：earendil `estimate.js` 用 `chars/3.5` 估 token，**对中文低估约 2.6 倍**（1200 个中文字 → 343 vs omp `bytes/4` → 900）。`pi-scaffolding.md` 计划里的"chars/4"同样偏低，压缩计量必须换算法（§5 缺口）。

## 1. Agent loop 增量（omp `packages/agent/src` vs earendil `dist/agent-loop.js`）

earendil 1.6 循环 674 行；omp 4232 行。逐点：

| 维度 | earendil 1.6 | omp 19.0.1 | 比我们好？ | 能否拷 |
|---|---|---|---|---|
| 工具并发 | `toolExecution:"sequential"|"parallel"`；任一工具 `executionMode:"sequential"` 则整批串行；并行批 `Promise.all`、结果按序落消息 | 每工具 `concurrency:"shared"|"exclusive"|(args)=>…`（`resolveToolConcurrency`，agent-loop.ts:119）；exclusive 排在前一个 exclusive 和全部 shared 之后；`approval` 非 "read" 的 shared 调用给后续读调用传 `earlierEffectsSettled` 等待句柄；结果仍按批序 flush（:3548-3558） | 是：omp 的 shared/exclusive 粒度更细，且结果永远按序 | 语义可移植：我们工具少，`toolExecution` 默认值已够；**不抄** |
| 准备/校验时机 | 执行前才 `prepareToolCall`（validate+beforeToolCall） | `message_end` 前就 `prepareToolCallDispatch`（:3169）：校验、`beforeToolCall` 改参数、blocked 全在消息定稿前烤进 message，快照/持久化只有一份 | 是：钩子改参只存在一个版本，避免 UI/存储分叉 | 移植概念；我们的 `beforeToolCall` 确认闸门照常跑在 earendil 的 prepare 点，差异只是时机，不影响合同 |
| steering | `getSteeringMessages` 在循环起点、prepareNextTurn 后、turn_end 后取；`getFollowUpMessages` 在将要停时取；QueueMode all/one-at-a-time | 同骨架 + `hasSteeringMessages`（不消费队列的偷看，批中轮询/事件唤醒）、`waitForSteeringMessages`、`getAsideMessages("work"|"stop")`、`isUndeliveredQueuedMessage`（abort 时把未送达消息还队列）、`LiveSteeringChannel`（provider 内嵌 steer）、IRC/后台完成中断源、`steeringQueueState` 分 user/agent/system 来源 | 部分：批中打断只影响 `interruptible` 纯等待工具；已发出的副作用工具永不被打断（omp 注释 #10439 的论证很值钱） | 只参考。我们的工具都是快操作（DB/单次 HTTP），外部 abort 已覆盖取消语义；**不抄** 批中中断那 700 行 |
| abort 语义 | 信号在 prepareToolCall/execute 检查，aborted → "Operation aborted" 错误结果；被截断（length）消息的工具调用整批报错 | tool-scoped abort reason（每调用单独归因，`toolScopedAbortReason` :2848）；`TERMINAL_TOOL_RESULT_ABORT_REASON`（子 Agent yield 终止）；`TOOL_INTERRUPT_ABORT_REASON`；aborted 消息只保留 `toolcall_end` 过的调用（`retainCompletedToolCalls` :2757）；`config.deadline` 墙钟 | 是：① 终态终止信号（子 Agent yield 后立即停，不再发一次请求）② length 截断调用的错误文本教模型拆小（:4133）③ `deadline` | 概念移植：`TERMINAL_TOOL_RESULT_ABORT_REASON` 思路 = 我们 `finishTurn` 已覆盖（提交即结束）；length 错误文本直接抄进我们的工具错误文案；deadline 用软预算替代 |
| 部分工具调用 JSON | pi-ai 自带 `StreamingJsonParser`/`ToolCallArgumentsStream`（dist/utils/streaming-json.js，512 行） | 流块上挂 `kStreamingPartialJson` 符号取原始增量 + `tool.openArgStream` 钩子 + `tool_stream_update` 事件（:2471-2515） | 边际：earendil 已有等价解析器；omp 多的是"参数流式预览"通道 | 不抄（画师的 draw_image 参数不需要流式预览）；若做写手流式预览用 incoming-json（§3） |
| 工具结果截断 | 循环不截断；压缩序列化 head-only 2000 字符 | 同（循环不截断）；序列化 60/40 头尾 + 参数值 500/调用 2000 两层 cap + useless 整对丢弃 + `escapeSummaryBoundaryTags`（compaction/utils.ts:171-260；snapcompact.ts:895 `truncateForSummary`） | 是（已定设计，此处给出确切代码位置） | 移植改写进 `agent/context/serialize.ts`（约 150 行，去 dialect/snapcompact 依赖） |
| 错误文本 | `Tool {name} not found`；校验错误含 schema 错误+收到的参数（pi-ai `validateToolArguments` 已带） | `formatToolNotFoundMessage`+`suggestToolNames`（尾段匹配给 "Did you mean X？"，:3012-3065）；skipped 结果文案教模型"不要把跳过当作已完成…下一步处理完插队消息后再重试"（:4196-4230）；length 截断教"拆成多个小调用" | 是，全部可直接摘文案 | 移植改写 ~150 行进通用层2（submit_* 工具的错误文案规范） |
| max-turns | 无（由 finishTurn/宿主控制） | 无；有 `config.deadline`（墙钟）、soft tool requirement 升级（3 次后抛错）、pausedTurn/DSML 修复上限 | — | 不用；我们用请求预算软停（已定） |
| 事件 | agent/turn/message/tool_execution 四类 | 同四类 + `tool_stream_update`、`agent_start.resumedToolCallIds`、`agent_end` 带 `telemetry`/`coverage` 汇总、tool_execution_start 带 `intent` | `agent_end` 附运行汇总这点好 | 运行汇总用 run-collector 移植件自己算，不换循环 |
| 消息快拍照相 | 每次 delta 全量 `{...partialMessage}` | `snapshotAssistantMessageIncremental` 增量克隆（开放块重拷、完结块引用共享，:483-525） | 性能项，长会话省 CPU | 不抄（我们消息量小一个数量级） |
| 循环外 gate | 无 | `agentPauseGate`（pause.ts，进程级暂停闸，turn/工具边界停驻，abort 可放归本 run）、`beforeModelCall` 可停（gate stop message）、soft tool requirement | pause 闸对我们"停在确认点让出制作槽"有用 | pause.ts **直接拷贝**（107 行，零依赖，实测） |

## 2. pi-ai 增量（omp `packages/ai/src` vs earendil `dist`）

| 维度 | earendil 1.6 | omp | 判定 |
|---|---|---|---|
| SDK 级重试 | `utils/provider-retry.js`（97 行）：`x-should-retry` 头、`retry-after(-ms)` 头、指数退避 ≤8s、`maxRetryDelayMs` 默认 60s 上限、abortable sleep | provider 内嵌同款 + `utils/retry-wait.ts`（19 行，注入式 sleep 便于测试） | earendil 已够；omp `retry-wait` 2 行可抄进我们的包装层（测试注入假 sleep） |
| 正文 Retry-After | **无**（只认 header） | `pi-utils/fetch-retry.ts` `extractRetryHint`（554 行文件，几十个正则：`retry-after-ms=`、`"quotaResetDelay"`、`try again in ~158 min`、中文`将在…重置`、Google `quotaResetTimeStamp`）；`pi-ai/utils/retry-after.ts`（181 行：`x-ratelimit-reset*`、`x-should-retry`、`x-ratelimit-limit-*`=0 检测、`appendRetryAfterHint` 把等待时间附到错误文本） | **直接拷贝两文件**（实测）。中转网关的限流常把等待时间写在正文里，earendil 解析不到 |
| 消息级重试 | `utils/retry.js` `retryAssistantCall`（~210 行）：`stopReason:"error"` 重试、非重试 quota/billing 模式黑名单、可中断 sleep、`isRetryableAssistantError` 分类器 | `utils/empty-completion-retry.ts` `withReplaySafeStreamRetry`（201 行）：缓冲未产出内容前的事件，瞬时失败重发新请求不产生重复事件；`toolcall_delta` 有内容才算"已提交"不可重发 | **关键缺口确认**：`decisions.md` 的 `maxRetries:2` 走 provider 选项=SDK 级（响应头前失败）；**中途断流要消息级重试**。earendil 的 `retryAssistantCall` 可用但在重试时第一次尝试的事件已外流；omp 的 replay-safe 版语义更对，**移植改写**进 streamFn 包装层（换成 earendil EventStream+`isRetryableAssistantError`） |
| 错误分类 | `isContextOverflow`（overflow.js 185 行，各家措辞齐全）、`isRetryableAssistantError`、quota 黑名单模式 | `error/flags.ts`（1249 行）Flag 位掩码分类（Transient/UsageLimit/ContextOverflow/Abort/Grammar/PayloadRejected…）+ `classify()` 附 id；`error/retryable.ts` `isProviderRetryableError`（更厚的传输模式）；`error/rate-limit.ts`（611 行）限流原因分类+按因退避（30min/30s/5s/45s/20s），为多凭证轮换设计 | 只参考。我们单 Key 中转，不做凭证轮换；earendil 两个分类器 + omp 的 hint 提取已够。flags.ts 的模式库当字典查（以后真遇到某家中转怪措辞再查它） |
| 用量/成本 | `Usage.cost{…,totalFromProvider}` 字段齐 | `usage.ts`（551 行）供应商配额端点归一化 + `usage/`目录 30 个提供商查询器 | 不要（我们记 usage 不查配额端点）；运行记录字段用 run-collector |
| prompt-cache | `cacheRetention`、`sessionId` | + `promptCache.mode:"explicit"`、`promptCacheKey`、`providerSessionState` Map（anthropic-state.ts） | earendil 够用；omp 的 append-only-context（§3）是字节级前缀稳定性的参照 |
| 模型目录 | models.generated + Model 字段（contextWindow/maxTokens/reasoning） | catalog models.json + `classifyModel` + `image-tokenization` 四种 regime 公式 + `model-thinking`/`Effort` | 只参考公式（§3）；我们五个模型槽位自己的小表 |
| thinking 映射 | `reasoning: "off"|minimal|low|medium|high` + ThinkingBudgets | `Effort` 七档 + `clampThinkingLevelForModel` + `thinking-probe.ts` | earendil 够用；只参考 |
| 请求超时/停顿 | `timeoutMs`（HTTP 级，SDK 默认 10min）；**无流式空闲看门狗** | `streamFirstEventTimeoutMs`/`streamIdleTimeoutMs`（默认 300s，`PI_STREAM_IDLE_TIMEOUT_MS`）+ `utils/idle-iterator.ts`（581 行，懂本地工作排除误报） | **缺口**：中转中途停摆时我们只有 SDK 总超时。omp 581 行太重；按它的设计在 streamFn 里写 ~60 行事件级看门狗（挂 AbortController，abort reason 标记 watchdog 供错误分类） |
| abort | `signal.reason` 透传 | `utils/abort.ts` `createAbortSourceTracker`（76 行）：区分 caller abort vs 本地看门狗 abort，用户取消绝不进瞬时重试路径；`error/abort.ts` `callerAbortReason`（28 行，取用户给的 abort reason 文本） | **直接拷贝**（小 shim：去掉 `attach/create(Flag)` 分类标记即可） |
| EventStream | FifoQueue 双栈 | 头索引+压实队列 | 等效，不抄 |

## 3. utils / catalog

| 文件 | 行数 | 内容 | 判定 |
|---|---|---|---|
| `utils/fetch-retry.ts` | 554 | `extractRetryHint`（header+正文几十种模式）、`fetchWithRetry`（`shouldRetryResponse` 正文判定钩子）、`isRetryableStatus/isRetryableError/wrapNetworkError`、`extractHttpStatusFromError` | **直接拷贝**（实测；唯一"依赖"`node:timers/promises` 与 Bun fetch `timeout` 选项透传——Node 下被忽略，无害）。落点：streamFn 包装层的错误→重试决策 + 我们自己的图片 HTTP 兜底 |
| `utils/json-parse.ts`+`json-lexer.ts` | 597+467 | `repairJson`（单引号/尾逗号/控制字符/截断修复）、`parseJsonWithRepair`、`parseStreamingJson`（未完成 JSON 取值）、`classifyJsonPrefix` | 直接拷贝（实测；earendil `json-parse.js`+`streaming-json.js` 已有同类弱版，**可二选一**——omp 版修复能力更全；`const enum` 需 tsc/transform-types）。落点：staging patch/manifest JSON 修复容错 |
| `utils/incoming-json.ts` | 869 | 增量 JSON pull parser：文档未下载完就能按键拉字段/按块拉字符串 | 直接拷贝（实测；deps 仅 async/json-lexer/json-parse）。落点：可选——写手 `.nvs` 长参数流式预览给 UI |
| `utils/sanitize-text.ts` | 166 | `sanitizeText`/`sanitizeTextDeep`/`escapeXmlText`（去控制字符+ANSI） | 直接拷贝（`Bun.stripANSI` 一处换正则，实测）。落点：子 Agent 回传文本、工具结果入库前净化 |
| `utils/async.ts` | 180 | `sleepLong`（>24.8 天分片）、`sleepUntil`、`withTimeout`、`Serial`、`AsyncDrain` | 直接拷贝（实测加载）。落点：看门狗/重试 sleep |
| `utils/bounded-json.ts` | 85 | `readBoundedBody/readBoundedJson`（超限即停） | 直接拷贝（实测编译）。落点：我们自写 HTTP（模型探测/图片下载）处 |
| `utils/spill-url.ts` | 47 | `local://N.log` 生成/解析 | 移植改写（我们要 `novelive-spill://`，借其三函数结构） |
| `utils/abortable.ts` | 113 | `abortableSource`（ReadableStream 可取消迭代）、`untilAborted`、`once` | 只参考（pi-ai 管 HTTP，暂不写自有 SSE 层） |
| `utils/prompt.ts`+`template.ts`+`lru.ts` | ~1500 | Handlebars 风模板（`{{#if}}{{#each}}`）+ `renderTracked` 溯源 | 移植改写：计划里的"200 行同款"可以改成直接 vendor 这 3 个零依赖文件；或直接写 200 行简化版。建议后者（我们只需要 `{{var}}`+`{{#each}}`+局部块），omp 版功能远超需求 |
| `utils/snowflake.ts` | 132 | 16-hex id | 不要（earendil `uuidv7` 已够） |
| `utils/logger.ts` 等 | — | bun/env 绑死 | 不要 |
| `catalog/compat/image-tokenization.ts` | 296 | 四种图像 token 计费 regime 公式（openai-patch/anthropic-patch/deepseek-patch/fixed）+ `imageTokens()`/`deliveredImageSize()` | 移植改写：抽 ~150 行公式（去掉 catalog cascade），用于视觉模型上下文的图片计量；比 earendil 的 4800 字符/图粗估准 |
| `catalog/models.ts`/`pricing.ts` | 472 | models.json + `calculateCost` | 不要（usage.cost 已由 pi-ai 算；五个槽位自维护小表） |
| `catalog/model-thinking.ts`/`effort.ts` | 225 | 思考档位钳制 | 只参考 |

## 4. 实测（`/tmp/omp-try`，Node v24.18.0 + tsc 7.0.2 + `node --experimental-transform-types`）

方法：把候选文件拷进 /tmp/omp-try，`@oh-my-pi/pi-ai` import 换成 `@earendil-works/pi-ai`，按需加最小类型 shim，先 `tsc --noEmit`（strict、bundler 解析）再过运行时冒烟。**14 个文件全部编译干净、全部跑通**：

| 文件 | 拷贝改动 | 验证 |
|---|---|---|
| `agent/pause.ts` | **零改动** | `pause()/resume()/waitUntilResumed` 跑通 |
| `agent/tool-context.ts` | 换类型 import 路径；`AgentMessage` 本地 shim（developer 角色） | `joinAdditionalContext` 去重去空、`createAdditionalContextMessage` 跑通 |
| `agent/tool-arguments.ts` | 去掉 `keepUnknownRootKeys`（earendil `validateToolArguments` 没有第三参；语义不变） | strict 通过、strict 抛 schema 错误、lenient 剥 `__parseError/__rawJson` 哨兵跑通 |
| `agent/replay-policy.ts` | import 路径 + `stopDetails`（omp 独有字段）加类型 guard | `toProviderReplayMessage` 重写 synthetic 结果跑通 |
| `agent/run-collector.ts` | `Span` → `object` 键 shim、`Model<any>` 泛型、`usage.reasoningTokens`→`usage.reasoning`（earendil 字段名） | `snapshot()` 汇总（byName 计数/usage 合计）、`aggregateAgentRunSummaries` 跑通 |
| `ai/utils/tool-call-loop-guard.ts` | `INTENT_FIELD` 1 行常量（替 pi-wire import）+ `ToolResultMessage.useless` 类型放宽 | 同参连调 3 次检出 `repeated_tool_call` |
| `ai/utils/retry-after.ts` | `extractRetryHint` 指向本地 `fetch-retry.ts`；`retryResetTimezoneOffsetFor`（catalog 依赖，只影响无时区墙钟戳）stub | header/date/`x-should-retry`/zero-limit/正文 hint/`appendRetryAfterHint` 全跑通 |
| `utils/fetch-retry.ts` | **零改动** | `extractRetryHint`（`retry-after` 头、`Please retry in 250ms`、`try again in 5 min`）、`isRetryableStatus` 跑通 |
| `utils/json-parse.ts`+`json-lexer.ts` | 相对 import 补 `.ts` 扩展名（omp 全仓靠 Bun 扩展名推断） | 坏 JSON（裸换行+尾逗号）修复、流式半截解析、prefix 分类跑通；注意 `const enum` → 需 tsc 或 `--experimental-transform-types`，裸 `--experimental-strip-types` 拒绝 |
| `utils/incoming-json.ts` | 相对 import 补扩展名 | 流中按键拉 `neg`、字符串分块 `nextChunk` 跑通 |
| `utils/sanitize-text.ts` | `Bun.stripANSI` → 一行 ANSI 正则 | `sanitizeText/sanitizeTextDeep/escapeXmlText` 跑通 |
| `utils/bounded-json.ts`、`async.ts`、`abortable.ts`、`spill-url.ts`、`snowflake.ts` | 零改动（snowflake API 是 `Snowflake.next()` 命名空间形式） | 编译+加载跑通 |

**拷贝 omp 文件的通用改动清单**（出现频率排序）：① 相对 import 补扩展名（全仓如此）；② `@oh-my-pi/pi-ai` → `@earendil-works/pi-ai`（核心消息类型兼容；字段级差异：`usage.reasoningTokens`→`reasoning`、`ToolResultMessage` 无 `useless`、assistant 无 `stopDetails`、`Context` 无 `inactiveTools`、`Tool` 无 `customWireName/strict/examples`）；③ `Bun.*`：agent 包仅 5 处（agent-loop.ts:1084,1085,2041；agent.ts:871,2064），ai 包热路径 12 处（SHA256/hash/deepEquals/sleep/write/env）；④ `*.md with {type:"text"}` 需打包器或内联；⑤ pi-natives/bun:sqlite/otel 为硬依赖的（tokenizer、telemetry、mnemopi、snapcompact）一律不碰。

## 5. 逐文件总表（路径/行数/要剥的依赖/判定/落点）

| 源文件 | 行数 | 要剥的依赖 | 判定 | 落点 |
|---|---|---|---|---|
| `agent/agent-loop.ts` | 4232 | 太多（dialect/harmony/dsml/cursor/speculative/otel/pi-utils/pi-wire/.md/Bun.env） | 只参考（逐点见 §1） | — |
| `agent/agent.ts` | 2449 | 同上+Bun.sleep | 不要 | — |
| `agent/run-collector.ts` | 631 | otel Span（已 shim 实测） | 移植改写→通用层3 运行记录 | `agent/run-records.ts` |
| `agent/pause.ts` | 107 | 无 | **直接拷贝**→通用层1 | `agent/pause-gate.ts` |
| `agent/tool-arguments.ts` | 50 | `keepUnknownRootKeys` 参数（已改） | 直接拷贝→通用层2 | `agent/tools/args.ts` |
| `agent/tool-context.ts` | 55 | 类型 shim（已做） | 直接拷贝→通用层8 系统提醒 | `agent/context/notice.ts` |
| `agent/replay-policy.ts` | 48 | `stopDetails` guard（已做） | 直接拷贝→会话重放过滤 | `agent/context/replay.ts` |
| `agent/live-steering.ts` | 89 | omp LiveSteering provider 接口 | 不要（earendil 无对应 provider API） | — |
| `agent/output-budget.ts` | 155 | Tokenizer、catalog `stopsOutputAtContextWindow`、transcript-tokens | 移植改写→压缩计量 | `agent/context/tokens.ts` |
| `agent/tokenizer.ts` | 729 | pi-natives（硬） | 不要；只拿 `bytes/4` 估算思路 | — |
| `agent/append-only-context.ts` | 535 | normalizeTools/toolWireSchema/message-cache | 只参考（字节级前缀稳定设计） | 通用层1 提示分块 |
| `agent/sent-tool-definitions.ts` | 67 | Context.inactiveTools（earendil 无此字段） | 不要（我们工具集不变） | — |
| `agent/compaction/utils.ts` | 283 | dialect/snapcompact/prompt | 移植改写（serializeConversation+truncate 60/40+useless 对丢+边界转义+stripReadSelector） | `agent/context/serialize.ts` |
| `agent/compaction/tool-protection.ts` | 83 | SessionEntry 类型、parseSpillUrl | 移植改写 | `agent/context/serialize.ts` |
| `agent/compaction/transcript-tokens.ts` | 172 | Tokenizer 类型 | 移植改写（usage anchor 规则） | `agent/context/tokens.ts` |
| `agent/compaction/entries.ts` | 156 | 类型 import | 移植改写（条目类型子集） | 会话存储条目 |
| `agent/compaction/message-cache.ts` | 91 | 无（纯函数+符号版本号） | **直接拷贝** | `agent/context/state.ts` |
| `agent/compaction/compaction.ts` 等其余 | ~8700 | 全面耦合 | 只参考（prompt 模板文案可摘） | `agent/context/prompts/` |
| `agent/telemetry.ts` | 2251 | otel | 不要（用 run-collector 输出即够） | — |
| `agent/speculative-execution.ts`/`proxy.ts`/`image-tokens.ts`/`types.ts` | 975/433/75/1362 | — | 不要/不要/只参考公式/只参考字段 | — |
| `ai/utils/tool-call-loop-guard.ts` | 141 | INTENT_FIELD、useless 类型 | **直接拷贝**→画师/美术导演防重复调用 | `agent/loop-guard.ts` |
| `ai/utils/empty-completion-retry.ts` | 201 | omp EventStream、AIError | 移植改写→streamFn 消息级重试 | `agent/stream-fn.ts` |
| `ai/utils/retry-wait.ts` | 19 | 无（node:timers/promises） | **直接拷贝** | `agent/stream-fn.ts` |
| `ai/utils/abort.ts` | 76 | `AIError.callerAbortReason`（下条） | **直接拷贝**→streamFn abort 归因 | `agent/stream-fn.ts` |
| `ai/error/abort.ts` | 28 | Flag attach（去掉） | **直接拷贝** | 同上 |
| `ai/utils/retry-after.ts` | 181 | extractRetryHint、catalog 时区（stub 掉） | **直接拷贝** | `agent/stream-fn.ts` |
| `ai/error/flags.ts`/`rate-limit.ts`/`retryable.ts` | 1249/611/75 | pi-utils、彼此互引 | 只参考（当模式字典查） | — |
| `ai/utils/idle-iterator.ts` | 581 | $env、AIError | 只参考（写 60 行简化看门狗） | `agent/stream-fn.ts` |
| `ai/utils/event-stream.ts` | 273 | AIError | 不要（earendil 版等效） | — |
| `utils/*` | 见 §3 | 见 §3 | 见 §3 | 见 §3 |

## 6. Top 15 排序

1. **`run-collector.ts` → 通用层3（运行记录）** — 移植改写。一次 run 的完整字段模板（chats/tools/usage/cost/errors/coverage+聚合器），直接是我们 project.db `runs` 表的 schema 来源；实测只要 3 处小改。
2. **`fetch-retry.ts`（extractRetryHint）→ streamFn 包装层** — 直接拷贝。earendil 不解析正文里的重试时间，中转限流全靠它。
3. **`empty-completion-retry.ts` → streamFn 消息级重试** — 移植改写。补 `maxRetries:2` 盖不住的"中途断流"档，事件缓冲语义正确。
4. **`utils/abort.ts`+`error/abort.ts` → streamFn/运行器** — 直接拷贝。caller vs 本地看门狗的归因区分，防止用户取消被当瞬时错误重试。
5. **`tool-call-loop-guard.ts` → 画师/美术导演循环护栏** — 直接拷贝。同参连调 N 次检出+摘要，配软预算正好管住"模型反复画同一张图"。
6. **`pause.ts` → 角色运行器** — 直接拷贝。进程级暂停闸，"让出制作槽"时把所有 agent 循环停在安全点。
7. **`tool-arguments.ts`（lenient 校验）→ 提交工具** — 直接拷贝（已改好）。`__parseError/__rawJson` 哨兵处理和 lenient 回退是我们 submit_* 校验失败路径要的。
8. **`tool-context.ts` → 通用层8（系统提醒）** — 直接拷贝。passive context 去重拼接+developer 消息构造，正是"提醒单独一条消息"。
9. **`replay-policy.ts` → 会话重放** — 直接拷贝。拒答消息不重放、synthetic 错误占位符换掉错误正文（防分类器自喂），冷知识但一行就抄对。
10. **compaction `utils.ts` 的 `serializeConversation`+`truncateForSummary`+`escapeSummaryBoundaryTags`+`stripReadSelector`（compaction/utils.ts:42-260）→ `agent/context/serialize.ts`** — 移植改写。头60%尾40%、参数双层 cap、useless 对丢、假边界标签转义，四个加固点一次拿全。
11. **`transcript-tokens.ts`+`output-budget.ts` → `agent/context/tokens.ts`** — 移植改写。usage anchor 规则（aborted/error 不算、prunedAt 失效）和 maxTokens 按剩余窗口收缩。
12. **`message-cache.ts` → `agent/context/state.ts`** — 直接拷贝。符号版本号原地失效机制，我们"压缩后代码重建状态"的缓存一致性契约。
13. **agent-loop 错误文案三件套（`suggestToolNames`/`formatToolNotFoundMessage` :3012-3065、skipped 结果文案 :4196-4230、length 截断文案 :4133）→ 通用层2 错误规范** — 移植改写 ~150 行。
14. **`sanitize-text.ts` → 子 Agent 回传净化** — 直接拷贝（1 行 shim）。
15. **`json-parse.ts`+`json-lexer.ts` → staging patch/manifest 容错** — 直接拷贝（可选，earendil 有弱版；要抄就连 `const enum` 一起 vendor 编译）。

落选但知道位置：`incoming-json.ts`（流式预览，可选第 16 位）、`idle-iterator.ts`（只取设计写简化看门狗）、`append-only-context.ts`（前缀稳定设计参照）、`prompt.ts` 模板（自写 200 行即可）、`image-tokenization` 公式（视觉模型计量要用再抽）。

## 7. 和我们现有设计冲突或缺口

1. **压缩 token 估算对中文系统性偏低**：`pi-scaffolding.md` 计划 `estimateTokens` 用 "chars/4"。实测：earendil `estimate.js` 用 chars/**3.5**，1200 个中文字符 → 343 token；omp `tokenizer.ts:165` 用 `Buffer.byteLength/4`（UTF-8 字节）→ 900。中文小说语料几乎全 CJK（1 字≈3 字节≈0.7–1 token），**应该用 `bytes/4` 或显式 CJK 加权**，否则压缩触发线实际偏松、窗口偏小模型会先溢出。证据：`pi-ai/dist/utils/estimate.js:2-4`、`agent/src/tokenizer.ts:141-173`。
2. **`maxRetries:2` 只覆盖 SDK 级**：`decisions.md` 的决定走的是 provider `maxRetries` 选项 → `retryProviderRequest`，只管请求发出前/响应头前的失败。**中途断流（SSE 断开、网关 200 后掉线）不在其中**——omp 用消息级 `withReplaySafeStreamRetry`（缓冲未提交事件重发）兜这层，earendil 也有 `retryAssistantCall` 可用。我们的 streamFn 需要显式加第二层（已定"重试用完标需要处理"不变）。
3. **无流式空闲看门狗**：earendil 只有 `timeoutMs`（整个 HTTP 请求，SDK 默认 10min）。中转挂起流会卡满 10 分钟。omp 有 `streamIdleTimeoutMs`/idle-iterator（581 行，过重）。建议 streamFn 包装层加 ~60 行事件级看门狗（最新事件间隔超阈值→abort，reason 标 watchdog 走瞬时重试）。**当前文档没提**，是缺口。
4. **earendil `ToolResultMessage` 没有 `useless` 字段**：我们的 `find_term`/`read_source_range` 零命中标 useless 的计划（omp-2026-11-context.md 已写）需要在我们自己的消息类型上加字段——`AgentToolResult`/`ToolResultMessage` 均可扩展，无阻碍，但**两处文档（pi-scaffolding 通用层、压缩 serialize）都没写这个类型落点**。
5. **omp `stopDetails`/`Context.inactiveTools`/`usage.reasoningTokens` 在 earendil 不存在**：拷 omp 文件时的三处字段级分歧（实测撞上），移植清单里凡涉及这三个字段的类型都要带 guard。
6. **omp 循环的"已发调用必跑完"原则值得写进我们的文档**：omp 注释（agent-loop.ts:3603-3613，issue #10439/#7493）论证了"生成调用的成本已付，跳过只会让模型再发一次"——我们的 steering 设计（工具批次间注入）与之一致，但文档没写这条不变量，建议补一句防以后有人想加"打断当前工具"。
7. **omp `prepareToolCallDispatch` 在 message_end 前跑校验/beforeToolCall**：我们的确认闸门设计（beforeToolCall 拦截→确认卡→结果补回）不受影响，但如果未来想让"钩子改过的参数"出现在运行记录和持久化里同一份，要注意 earendil 的准备点在执行前——改参后 message 里的原始 arguments 与执行 args 会不同，运行记录要记执行后的 args。
8. **`Intent`（`i` 字段）**：omp 把 intent 注入 schema（agent-loop.ts:1000-1081），工具调用自带一行意图，运行记录/工具卡直接可用。我们的工具少（每角色≤5），**值不大但成本=0**（工具 schema 加一个可选 `i` 字符串），可顺手采纳；docs 未提。
9. **`agent_end` 带运行汇总**：omp 把 `AgentRunSummary` 挂在 `agent_end` 事件上。我们的运行记录靠 `afterToolCall`/`onResponse` 逐步写库，落点等价，不冲突。
10. **omp `SoftToolRequirement` vs 我们的 `finishTurn`+`submit_*`**：同目的（必须先交 submit），omp 多了"先提醒、不服从再强制 tool_choice"的升级。earendil 的 `finishTurn` 只能 continue/end 不能强制 tool_choice——但 `prepareRequest` 可以改下一次请求，**等价路径已存在**，无缺口，只是实现路径不同，文档可补一行说明。
