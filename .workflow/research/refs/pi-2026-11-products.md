# pi 生态产品与成熟框架的脚手架做法调研

调研日期 2026-11-21。npm 上 pi 全家桶最新版均为 **1.6.0**（2026-11-20 发布）：`@earendil-works/pi-ai` / `pi-agent-core` / `pi-coding-agent` / `pi-durable`（`npm view` 实测）。仓库 `earendil-works/pi` HEAD 为 `cb1205e`（2026-11-20），npm 包均为 MIT。

## 0. 先回答"pi 2.0 支持子 Agent"指什么

不是 npm 包版本号 2.0。它指仓库里的新一代应用线：

- **`apps/p2`（"Pi Durable UI"）**：明确标注 **EXPERIMENTAL**——"a prototype. It will be gone soon."（`apps/p2/README.md:5`）。它是跑在 **`pi-durable`** 上的 Web 版 agent，含 `plugins/subagents/`（持久后台子 Agent：`apps/p2/plugins/subagents/tools.ts`、`worker.ts`，751+365 行，改编自 `pi-durable` 的 `test/examples/23-subagent-background.ts`）和 code mode 的 `tools.agent`（一次性子 Agent 编排：`apps/p2/docs/workflows.md`）。
- **`apps/p3`**：p2 的继任者，建在 Chord v2 上，插件 API 为 `@earendil-works/p3/v1`，目前 headless（`apps/p3/README.md`）。
- **`pi-durable` 包本身**（1.6.0，README 自标 experimental）：一个 durable agent harness——会话、模型轮次、工具调用都先落存储再展示；进程死后重开存储从断点续跑。它**原生支持子会话**：工具在 `api.commit()` 里 `tx.createConversation({ownership:{kind:"task",taskId}})` 建子会话，子会话复制父会话的 agent 配置（model/extensions/tools/cwd），可再 `configure` 换便宜模型、摘掉 subagent 工具（`packages/durable/README.md` "Abort and Subagents" 节，示例 `test/examples/21-subagent-foreground.ts`、`22-subagent-background.ts`）。
- **`packages/coding-agent/examples/extensions/subagent/`**：另一种形态——每个子 Agent 是一个独立 `pi` 子进程（`index.ts` 用 `spawn`），agent 定义是 `agents/*.md` markdown 文件（description+prompt+tools+model），支持 single/parallel/chain 三种模式，`MAX_PARALLEL_TASKS=8`/`MAX_CONCURRENCY=4`。

**结论**：pi 官方已有两套子 Agent 参考实现（durable 进程内子会话、coding-agent 子进程），都直接可抄。`pi-durable` 还顺便解决了 Novelive 的会话存储、断点续跑、压缩三个自建项（见 §3.1）。

---

## 1. 嵌 pi 的产品（按相关度排序，每个给文件路径证据）

### 1.1 TohmaN233/YN-translation-workshop —— Electron + 小说翻译工作台（最像 Novelive）

235★ MIT TS/Electron 39，2026-11-11 推送。`@earendil-works/pi-ai` + `pi-agent-core` **0.99.1**，esbuild `--external` 打包进 main 进程（`package.json` build 脚本）。

- **pi 层**：裸用 `Agent` + `Session`/`Storage` 原语，不用 AgentSession/TUI 外壳。`src/main/agent/piNative/sessionAgentRuntime.ts` 自称 "source-adapted from Pi AgentSession"，自己挂 `AgentEvent`→持久化→广播。`compact`/`prepareCompaction`/`shouldCompact`/`estimateContextTokens`/`isContextOverflow`/`isRetryableAssistantError` 全从官方包导入。
- **进程架构**：pi runtime 跑在 **main 进程**（不是 utilityProcess），重活用 `node:worker_threads` 隔离（`sessionIndexWorker.ts`、`proofreadPrescanWorker.ts`、`translationValidationWorker.ts` 等，后者用 `SharedArrayBuffer`+`Atomics` 取消）。IPC `agent-session:*` channels + `broadcast.ts` 推事件给 renderer（`src/main/ipc/agentSessionHandlers.ts`）。
- **会话存储**：每 workspace `.translation-workshop/agent/pi-sessions/*.jsonl`（自写 JSONL v4：header + 每行一个 transaction 的 `CommittedWrite[]`；`jsonlRecords.ts` 有 torn-tail 检测；`indexedJsonlStorage.ts` 实现 pi `Storage` 接口 + `*.yn-index.json` 磁盘索引 sidecar）。**host 状态也 event-sourced 进同一 JSONL**：`yn.host-state.v2` 自定义条目 = JSON delta ops（`hostStateDelta.ts`，每 256 deltas 全量 checkpoint），冷启动由 `sessionHostReplayWorker.ts` 重放。无分支，单 "main" branch。
- **压缩**：`compact()` 仅 idle 时跑；threshold 触发（turn 后 `shouldCompact`，workflow 运行中可 `deferThresholdCompaction` 推迟）+ overflow 后 compact-and-retry 一次。压缩后 `compactSubagentCards` 把子 Agent 卡片压到 ≤4000 字。
- **子 Agent**：`subagentSupervisor.ts` 的 batch 模型——host 把任务切成不重叠 range 队列（`folderTranslationPlan.ts`），最多 N 个 **persistent worker** 动态领取；每个 worker = 自己的 child `Session` + `PiSessionAgentRuntime`，**assignment 间复用**（`resetContext()`+`reconfigure(tools, systemPrompt)`，不新建 session）。隔离靠 range-restricted tool set（write scope 校验）+ children 不能再派。回传：live card custom message 写入 parent JSONL（terminal card 只存状态+child session 引用，完整 transcript 留在 child JSONL 按需展开）+ hidden message 唤醒 parent。`interruptSubagentCards` 在冷启动把进程退出时的 running card 标 stopped/recoveryReason=process_restart。
- **权限**：不用确认弹窗，用 **host gate**——写操作被 range/asset validator 机械拒绝（`NonRetryableAssignmentError`→`guardTools` 包装把 fatal 错持久化为 `yn_host_tool_failure` 条目 + `terminate:true`）；`userGate.ts` 解析 tool result 文本检测 "ask the user" 让 UI 停轮。
- **模型路由**：`providerConfigStore.ts`（`provider-config.json`：presets + `piProviderId` 映射 + api_key/oauth），request 级 `providerId/modelId`，子 Agent 默认继承、可按 task override（`assertWorkerModel` 绑定 worker↔assignment）。无 fallback chain。
- **重试**：`handlePostAgentRun`——`isRetryableAssistantError`→指数退避 maxRetries 3；`isExpiredProviderAuthError`→刷新 auth 换 model 重试；overflow→compact-retry 一次。`streamPiProviderWithTimeouts` 加 3_000_000ms 无活动超时（防 Grok reasoning 静默）。host 层还有 repair loop（`MAX_ASSIGNED_TRANSLATION_REPAIR_TURNS`、无进展轮数→`ParentTakeoverAssignmentError` 回 parent 修）。
- **取消**：IPC Stop→`runtime.abort()`（abortGeneration++ + `clearAllQueues`+`agent.abort()`+`waitForIdle`）；worker thread 用 cancel message / Atomics flag。
- **测试**：几十个 `.mjs`，核心是 pi-ai 自带的 **`fauxProvider`/`fauxAssistantMessage`/`fauxText`**（`tests/agent/piNativeCompaction.test.mjs` 注入假 `createModelSelection`，其余走真 JSONL 存储）+ 架构约束测试 `piNativeArchitecture.test.mjs`。
- **prompt**：`systemPrompt.ts` 纯函数按 request 拼装，workflow 段落条件注入；system prompt 持久为 `role:"system", sections:{...}` 条目，漂移时 append 新 system 条目不改历史。
- **教训**：`ynDomainTools.ts` 460KB、`subagentRunner.ts` 290KB 单文件——领域复杂度爆炸的下场，Novelive 应按角色拆文件。

### 1.2 Narcooo/inkos —— 小说/剧本/翻译 Agent（域名最近）

11.4k★ AGPL-3.0，TS pnpm monorepo，2026-10-24 推送。只依赖旧 scope `@mariozechner/pi-agent-core` + `pi-ai` **0.67.1**（pnpm overrides 钉死）。**注意 AGPL：只能参考机制，不能搬代码。**

- **pi 层**：`Agent` 类 + 自包 `guardedPiStream`/`guardedPiNonStreaming` 作唯一 transport 边界注入 `Agent({streamFn})`（`packages/core/src/agent/pi-stream.ts:26`）。
- **存储双轨**：① 会话 JSONL `.inkos/sessions/<id>.jsonl`（`interaction/session-transcript.ts`，seq 递增、uuid+parentUuid 链、`visibility:"model"` 标记，恢复时重建成 `initialState.messages`）；② **`node:sqlite` 执行账本** `.inkos/harness.sqlite`（`harness/episode-store.ts`，`creative_episodes`+`creative_episode_events` 两表，WAL，`owner_pid` 列 + `isLiveProcess` 崩溃回收 `recoverInterruptedEpisodes`——**几乎就是 Novelive 要的 run record**）。
- **压缩**：`transformContext` 钩子（`harness/agent-context.ts`）每轮做三层：闭合 tool exchange 超 60% 预算挪进 historical → work context 经 `context-compiler.ts` 的 protected/compressible 分桶 + LLM `semanticCompiler` → 历史消息 `conversationCompactor` 摘要成 `<conversation_summary>` user 消息（**增量缓存**，`extendsCache` 前缀匹配只压增量）。每轮还注入两条宿主 user 消息：`<current_work_context>`（机械刷新的 manifest）和 `<host_execution_progress>`（**从 tool result 收据算的真实进度**，防止摘要撒谎）。超预算抛 `ProtectedContextOverflowError`。
- **子 Agent**：`agent/worker-agent.ts` 新 `Agent` 实例。`runWorkerAgentTool` 亮点：**结构化输出 = 强制调一个 TypeBox-schema 工具**（`toolChoice:"required"`，`Value.Parse` 校验，最多 3 轮修正，不 scrape JSON 文本）。角色（architect/writer/auditor/reviser）由 `PipelineRunner` 编排，per-role 模型经 `models/project.ts` `modelOverrides` + `pipeline/runner.ts:357` `resolveOverride`。
- **工具/权限**：自研 capability 层包在 Pi tool 外（`harness/capability-registry.ts`：`CapabilityAction` 带 `risk:"read"|"recoverable-write"|"destructive-write"`、`requiresConfirmation`、TypeBox `parameters`；摊平成 `<capability>__<action>` AgentTool）。`isActionAuthorized`：read 放行，requiresConfirmation/destructive 未确认抛 `ActionConfirmationRequiredError`（宿主确认后 `confirmed:true` 重放）。**终态强制**：`finish_turn` 是唯一结束轮的方式，`TurnArtifactDeliveries.validate` 检查交付物 revision 没过期（`TURN_DELIVERY_STALE`）——防模型虚报完成。
- **重试**：`llm/provider.ts` 三重：first-event deadline（120s/pipeline 300s）+ idle watchdog（90s）、transient 错误重试 ≤2（指数退避）、空响应/required-tool-missing 各重试 1 次；`assertWithinContextWindow` 发前估算 fail-fast。
- **观测**：episode ledger 即审计（model-call-started/retry 等经 `withExecutionEvidence` AsyncLocalStorage sink）；`llm/agent-trajectory.ts` 把 conversationId/runId/agentRole/piTurnIndex 打成 HTTP header 发给网关对账。
- **测试**：无 fake-provider——单测直接跑 `CreativeHarnessRuntime`+sqlite(:memory:) 不碰模型；pipeline 测 vi.mock LLMClient；capability 测注入 `createModel` stub。
- **prompt**：`harness/system-prompt.ts` 代码拼双语模板；领域方法放 `skills/*/SKILL.md`（~20 个 Claude-Code 式技能包），`use_skill` 工具按需激活。

### 1.3 spinabot/brigade —— 建在 pi-coding-agent 上的个人助理

11.4k★ MIT，2026-11-13 推送。四个 pi 包全部 exact pin **0.79.9**（`@earendil-works/*` 新 scope + overrides）。pi 是核心依赖：整个 runtime 建在 `pi-coding-agent` 的 `createAgentSession`/`SessionManager`/`AuthStorage`/`ModelRegistry` 上（`src/agents/agent-loop.ts:1-160` 头注释是完整接线配方）。

- **存储**：pi 自己的 JSONL transcript + `sessions.json` 索引（`src/sessions/session-store.ts:160-300`）——**注意他们额外持久化 `leafEntryId`**，因为 pi 的内存 `branch()` 指针重启后不存活（`:260-290` 注释解释了为什么）。sync mutex + `.lock` sidecar 跨进程锁 + tmp+rename 原子写。可选 Convex 后端在 `BrigadeStore` 接口后。
- **压缩两层**：`src/agents/compaction/` mid-turn 压缩器（暂停 turn、隔离的 hardened summarizer prompt `summarizer-prompt.ts`、先前摘要 fold-forward、所有失败路径返回原消息）+ `smart-compaction.ts`（`COMPACTION_TRIGGER_RATIO=0.85`，两级确定性回退：tool result head+tail 截断 `MAX_TOOL_RESULT_CONTEXT_SHARE=0.30` → newest→oldest shrink）。
- **子 Agent**：`spawn_agent`/`spawn_agents` 工具 → `src/agents/subagent-spawn.ts`——**depth cap（默认 3）+ max-children（默认 5）**、child key `agent:<id>:subagent:<uuid>`、`subagent-registry.ts` 注册、abort 级联（`subagent-abort-cascade.ts`）、完成经 `subagent-completion-bridge.ts` 桥回；`SubagentSessionMetadata` 持久化在 session 条目上做崩溃后取证。深度编进 session key，叶子 agent 失去 spawn 工具。
- **权限（样板级）**：`composeBrigadeBeforeToolCall` beforeToolCall 守卫链（`session-wiring.ts:450-584`）：decodeArgs→unknown-tool guard→**path-write guard**（保护安装目录+`brigade.json`+agent internals）→cmd-ism guard→config-write guard→loop detector→**exec-gate**（bash/exec/shell 一律拦，**拒绝 `workdir`/`cwd`/`env` 覆盖**——防目录逃逸，`decideApproval` 查 `~/.brigade/exec-approvals.json`，确认请求经 `approval-bridge.ts` 路由回消息渠道）。**链上任何守卫抛错都 fails closed**。
- **模型路由**：`ModelRegistry` over `models.json`+`auth-profiles.json`；per-session `pinnedProvider/pinnedModelId`；fallback 链 `model-fallback.ts`（`runWithModelFallback`，per-(provider,reason) cooldown + probe-slot，`LiveSessionModelSwitchError` 换 mid-run model，上限 5）。
- **重试（策略矩阵值得抄）**：`error-classifier.ts` 分 ~12 种 `RetryReason` → `retry-policy.ts:30-160` 纯策略表（rate_limit→2 retries+5s jitter+rotate profile；billing/402→rotate model；context_overflow→先压缩再 1 retry；format/auth_permanent/session_expired→fail fast）。`stream-wrappers.ts` 加 LLM idle-timeout（90s 云/300s Ollama）+ toolcall-repair 修畸形 provider 输出。
- **取消**：`signal` 穿 retry loop；`onSessionReady` 把活 `AgentSession` 交给 gateway 让它能 `steer()`/`abort()`/`switchModelMidTurn()` mid-turn（`agent-loop.ts:340-370`）。
- **观测**：`agent-event-bus.ts` 进程单例，`tool-blocked`/`subagent_lifecycle:*` 事件带 runId/agentId/sessionKey 关联，TUI/WS/日志三处消费；`agents/usage/ledger.ts` 记 token 账。
- **测试**：281 个 `node:test`，`stream-wrappers.test.ts:17` `fakeEventStream(events)` 直接喂 pi 的 EventStream 形状过 wrapper 链。
- **prompt**：`system-prompt/assembler.ts` 分层拼装（identity→tools→safety→persona 文件→cache boundary marker→动态 HEARTBEAT→runtime 行），mode gate（subagent/cron/teamWorker 换 opener）；persona 经 "three-write hack"（`state.systemPrompt`+`_baseSystemPrompt`+`_rebuildSystemPrompt`）钉进 pi——**这是 pi 内部字段 workaround，1.6.0 上未必需要**。
- **教训**：`agent-loop.ts` 单文件 3.7k 行/178KB——功能全但体积是反面教材。

### 1.4 vercel-labs/durable-harness —— pi × Workflow SDK 的断点续跑

324★ Apache-2.0，2026-11-19 推送（很活跃）。pi 1.0.4 全家桶 + `@workflow/world*`。两条路径都值得看：

- **A 路 `pi-durable`**（`packages/pi-world/`）：不换 agent 循环，只给 `Harness.open` 换一个 `Storage` 实现——pi 的每次 commit 变成 World event log 一条 `hook_received` 事件；open 时全量 replay 进 `MemoryStorage`，单写者 fencing（每条 commit 携带已见事件数，被别的进程超写→`StorageFenced`）。
- **B 路 kernel**（`packages/harness-pi/src/index.ts`）：`Agent` 挂在自家 durable kernel 上——drive 启动扫 `state.effectOrder` 里所有 model step，把 `input.appended`+`output` 重建成 `initialState.messages`；**最后一个 model step 不落 output 直接重跑**，已完成 effect 靠 `ctx.effect(key)` memo 命中跳过。`contextLength` 做 replay 分歧检测（不一致→`Restart`）。失败 turn 合成 missing toolResult（`toolResultsOf`）防 provider 拒绝悬挂 tool call。
- **崩溃 backstop（值得抄）**：无心跳——每次留未完成工作的 commit 带一个 anchor（截止时间戳），storage 自己排延迟 `pi-wake` 队列消息；wake handler `runWake` 用 `judgeAnchor` 判断持有者死没死（pid 死/重启恢复），死则 `openAgent`→`harness.resume()`→`untilSettled`→`close()`。`maxDriveMs`（默认 10min）超时把 anchor 交给下一个 wake。**Novelive 在 SQLite 里存 "lease deadline + owner" 即可复制这套，不需要心跳。**
- **工具**：pi-durable 路 `defineTool` 带 `replay:'safe'|'never'` 字段（safe 工具崩溃后重跑，never 的标 interrupted）；虚拟 workspace（just-bash worker）文件变更随 tool result `details` 提交进 log。
- **UI 流**：kernel 路 `ctx.live()` 推 delta；pi-durable 路 `JournalReader` ~150ms 增量轮询 + `rewind` 事件让 UI 丢弃 crash 重启的 model call 已发文本。
- **测试（样板级）**：pi 自带 `fauxProvider` 假 provider；对 `worldStorage` 跑 pi 的 `registerStorageConformance` 46 例 + 每例终态对比全量 replay；**`test/pi-durable-sigkill.test.ts` 真 SIGKILL 子进程再重启验证** safe 工具重跑/unsafe 不重跑；`watchChaos` chaos-drill 在指定 effect 跑 N ms 后模拟崩溃。
- **promptDocs 巧思**（`harness-pi/index.ts`）：可变文档注入到**最新 user message 开头**而非 system prompt，记录每次调用时展示的内容——保 prompt 前缀缓存不炸，replay 不依赖外部状态。
- **注意**：`packages/*` 全 private workspace 包，只有 `durable-harness` npm 0.0.2；Durable Strict 每次 commit 一次 World 往返（README 自认是限制）；重开 session 全量 replay 无 snapshot。**抄代码比依赖现实。**

### 1.5 neondatabase/electric —— 同步即存储的 agent 平台

10.4k★ Apache-2.0，2026-11-18 推送。`@mariozechner/pi-agent-core` + `pi-ai` **^0.70.2**（`packages/agents-runtime`）。建在自研 Durable Streams + Postgres 上。

- **pi 层**：`pi-adapter.ts:11` `new Agent({initialState, streamFn, transformContext, getApiKey})`；`streamFn`/`summarizeComplete` 可在 `useAgent` config 注入——**这就是测试注入点**。Moonshot(Kimi) 用自构造 `Model` 对象 + `openai-completions` API + `onPayload` 注入 `thinking.enabled`（`deep-survey/model-config.ts:36-50`——pi 模型注册表的逃生舱写法）。
- **存储**：每 entity 一条 append-only durable stream，事件是带 key 的 upsert 行，聚合成 collections（`entity-schema.ts:1028-1134`：runs/steps/texts/textDeltas/toolCalls/reasoning/errors/inbox/wakes/signals/childStatus/contextInserted/replayWatermarks）。**LLM 输出从不整体存 message**——`outbound-bridge.ts` 拆成 `run-N/step-N/msg-N/tc-N` 行 + delta 行逐次 upsert。会话历史是**投影**：`timeline-context.ts` 物化 timeline 再投影成 `LLMMessage[]`，context 注入用 `<name attrs>content</name>` 渲染成 user message。
- **压缩三段式（精细，值得抄）**：① mid-turn `transformContext`→`createMidTurnCompactor`（`compaction-midturn.ts`）：每 step 前估算 token，≥0.9 ceiling 整段折叠，二次触发链式摘要，失败回退已有 compacted view；② turn-end background：≥0.85 时 fire-and-forget 预摘要，下次 handler 调用前落 checkpoint（`process-wake.ts:2280-2345`），摘要调用有 **120s hard deadline**（注释写明原因：pi-ai anthropic provider 无内部 retry，并发 stream stall 会永久卡死后台 slot）；③ 持久化：self-superseding `contextInserted` 行 `kind:"compaction"` 带 `watermark`，重建时隐藏 watermark 前全部历史、原位插 `<compaction_summary>`。**摘要模型用会话自身模型**（便宜模型小窗口装不下近乎满窗的上下文——原话）。另有 25/50/75% budget notice 注入让模型自己减速。
- **子 Agent（跨进程）**：`ctx.spawn(type,id,args,{wake:{on:'runFinished',includeResponse:true}})`——父结束 turn，子完成时 webhook 唤醒父并携带 response（`deep-survey orchestrator.ts:118-172` 一次 spawn 几十个 explorer + shared `mkdb` wiki 做 blackboard）。`spawn_worker` tool 让调用者挑 systemPrompt+工具白名单子集。`fork` tool 在最近 run 处分叉整个会话 stream。
- **权限**：无逐工具确认；权限在 entity 层 `permissionGrants` + server `authorizeRequest` hook（TTL 缓存）；危险工具靠 sandbox（docker/e2b）隔离而非逐次确认。
- **模型路由**：orchestrator=Sonnet / worker 可指定 model|provider|reasoningEffort；`completeWithLowCostModel` 按 provider 偏好顺序挑 haiku/nano 级做 title 生成。**无自动 fallback**。
- **测试**：`AgentConfig.testResponses`（string[] 按 run 轮播）+ `streamFn`/`summarizeComplete` 注入——**不要 fake provider 类，注文本应答序列更干净**。
- **避免**：`entity-manager.ts` 124k 行 control plane 是 SaaS 规模才需要；`readCodexAccessToken` 默认偷读 `~/.codex/auth.json`（侵入性）。

### 1.6 deer-flow/llm-space —— harness 逐步检查/回放工具

2.1k★ MIT，Bun monorepo（Electrobun 桌面壳），2026-11-09 推送。`@earendil-works/pi-agent-core` + `pi-ai` **^1.1.0** + **`patchedDependencies` 补丁**（`patches/@earendil-works/pi-ai@1.1.0.patch`，给 OpenAI-Responses adapter 加 `responseApiNativeTools`）。

- **关键架构选择**：用 **`agentLoopContinue`**（不是 `Agent` 类）驱动单模型轮；工具被转成 `execute()` 返回 `{terminate:true,...}` 的 AgentTool——pi 的循环每轮发完 `tool_execution_end` 就停，**工具执行由他们自己的层在两轮之间做**（`packages/core/src/server/agent/stream.ts:82,201-228`）。pi = 单轮流式+事件源；他们 = 多轮编排+工具分发+持久化。**这正好对上 Novelive "pi 出 loop、自己出一切"的计划，或者反过来：用 terminate 让 pi 每轮停下交还控制权。**
- **运行记录**：每次完成的 run 快照**整个 thread**（`thread/history.ts:611 recordRun`；零事件或失败的 run 不记录 `thread-store.ts:1242`）；v2 外置到 `~/.llm-space/run-history/<sha256(resourceKey)>/<entryRef>.json`（`run-history-store.ts`，opaque ref + marker `index.json` + 30 天孤儿回收）；thread 文件只留 `ThreadRunReference{id,ts,snapshotRef,preview,usage}`。UI：inspect（只读 trace 视图）/restore（快照灌回当 live state 重跑）/A/B 比较 + rubric 打分（手工 1-5 分，不调模型）。
- **会话**：Thread=单 JSON 文件（含 context{systemPrompt,tools,variables,snapshot,messages}），图片外置 blob store；`SerializedPersistence` 有序 revision 队列 + 指数退避写盘；rerun-from-message = 截断到 `fromMessageId`。
- **压缩**：app 层 `thread/compaction.ts`——`planCompaction` 按 user-turn 边界切，序列化成 `[User]:`/`[Assistant tool calls]:` 行（tool result 截 2000 字），专用 `COMPACTION_SYSTEM_PROMPT` + 结构化 checkpoint 模板（Goal/Constraints/Progress/Decisions/Next Steps）+ UPDATE 变体合并 `<previous-checkpoint>`；结果作为 `<system-reminder>` user 消息插回。
- **子 Agent**：`spawn_agent` builtin 工具 `terminate:true`——**暂停 run 等人点"Create subtask"**；`buildSubagentThread` 建 fresh thread（继承 system prompt+model+role 过滤工具，spawn_agent 永远排除），child 拿不到对话历史只有合成 user 消息；结果不自动回传——**human-in-the-loop 子任务**，不是自主子 Agent。
- **权限**：`isExecutableTool` 单闸门——mcp/plugin/builtin 自动跑，`function`/`ask_user_question`/`spawn_agent`/任何 `terminate:true` 工具要人在 UI 点 "Call tools"；`isDangerousBashCommand` denylist 在自动模式也拦；`MAX_AUTO_TOOL_TURNS=50`。
- **prompt 管理**：thread 文件内 system prompt + `{{name}}` 变量（current_date/workingDirectory/skills/`@include`）+ 条件/循环模板语言；**per-place 快照**（`context.snapshot.variables[place][name]`）让旧前缀保留首次渲染的值——保前缀缓存稳定的巧招。
- **测试**：`bun:test`，stub `globalThis.fetch` 喂罐头 SSE + 假 `Models` 对象；无 fixture 回放。
- **教训**：persist reduced messages 而非原始事件流→无逐步 replay；snapshot-per-run 重，高频 run 应改事件/增量记录（Novelive 用 SQLite 行即可）。

### 1.7 getsentry/vitest-evals —— pi 的 eval harness（测试策略参考）

365★ Apache-2.0，2026-11-07。`@vitest-evals/harness-pi-ai` peer-dep `@mariozechner/pi-*` `>=0.67 <1`。

- **不驱动 pi 循环，把 pi 当被测系统做归一化**：反射探测 agent 的 `tools`/`state.tools`，**monkey-patch `AgentTool.execute` 记录 transcript+replay，跑完恢复**（`packages/harness-pi-ai/src/index.ts:~1130-1290`，Symbol 标记防重复 patch，还 patch `agent.reset()` 以便 reset 后重新 patch）——**Novelive 不改 agent 代码就能夹取工具执行。**
- **Tool replay cassette（可直接复刻）**：`packages/vitest-evals/src/replay.ts` ~340 行零依赖——cache key = `sha256(stableStringify({toolName,input,version}))`，录制文件 `.vitest-evals/recordings/<tool>/<key>.json`，模式 `auto|record|off|strict`（`VITEST_EVALS_REPLAY_MODE`），录制含 error case（replay 时重 throw），`sanitize`/`key`/`version` 钩子。**模型不可录，但工具结果可录——agent 调录制好的工具返回固定数据再断言行为，这就是"确定性测试 pi agent"的完整方案。**
- **judge/app 分离**：judge 用自己的 model client+system prompt（`piAiJudgeHarness({model,...})` 走 `completeSimple`），`responseFormat:{type:"json",schema}` 注入 system prompt 拿结构化判定；FactualityJudge（A–E rubric）、ToolCallJudge（确定性序列/参数匹配）、StructuredOutputJudge；`expect(result).toSatisfyJudge(judge,{threshold,judgeHarness})`。
- **transcript 模型**：扁平 `TranscriptEvent[]`（message/tool_call/tool_result 按 toolCallId 关联），工具异常序列化为 `NormalizedError` 进 `tool_result.error`，run 崩了 `attachHarnessRunToError` 也产出 partial `HarnessRun` 给 reporter——**错误也进 transcript**。
- **观测**：`NormalizedTrace`/`NormalizedSpan`（OTel GenAI 语义 `gen_ai.operation.name`），usage 归一化 `UsageSummary{provider,model,input,output,costUsd,toolCalls,retries}`。
- **取消**：`AbortSignal` 从 `HarnessContext` 一条线透传到 judge `completeSimple({signal})`、tool ctx、runtime——signal 一条线，工具自己决定 respect。
- demo agent `apps/demo-pi/src/refundAgent.ts` 直接 `agent.prompt(input)`+读 `agent.state`+`assistant.usage`；单测 mock `agent.reset`/`agent.prompt`/`agent.state.messages` 塞假 AssistantMessage（**直接改 pi Agent 内部 state**，不用 fake provider）。

### 1.8 skorokithakis/stavrobot —— 安全向助理（权限模型参考）

184★ AGPL-3.0，2026-11-18。`pi-agent-core`+`pi-ai` **^1.1.0**（较新版）。706 行 `ARCHITECTURE.md` 文档齐全。

- **pi 层**：单个共享 `Agent` 实例（`src/agent/index.ts:509-530`），per-turn 直接 mutate `agent.state.messages`+重建 system prompt。**子 Agent = `agents` DB 表 + 同一 Agent 实例换上下文**——`filterToolsForSubagent()`（`agent/plugins.ts:23-115`）包装 `execute` 做 action-level 白名单（`send_agent_message` 永远排除、`allowed_plugins` 支持 `plugin.tool` 点号授权）。
- **安全模型（亮点）**：channel allowlist 硬闸 + `interlocutors` 软闸；plugins 跑在专用 Unix 用户 `plug_<name>`（`spawn(uid,gid)`、目录 chmod 700、config 不暴露给 LLM、`permissions` 只能 web UI 改）；MCP server 用 `setpriv --reuid` 降权后才应用 spec env。
- **压缩**：`agent/compaction.ts`——>60% 触发非阻塞摘要；`selectCompactionCutIndex` **只在 turn-boundary user message 处切**（`isTurnBoundary` 拒绝在 toolCall/toolResult 之间切，避免 Anthropic 400）；`escalatingSummarize` 三级（compaction prompt→bullet prompt→确定性截断 cap 10%）；summary 存 `compactions` 表带 `up_to_message_id`。
- **重试规则（值得抄）**：turn **在已持久化 assistant/toolResult 之后**失败→`TurnProgressPersistedError` **永不重试**（replay 会重复工具副作用）；`AbortError`/`AuthError`/400/401 不重试；429/403 正常重试。
- **测试**：vitest `vi.mock` 全部边界模块（含 `FakeAgent`），驱动真 queue+handlePrompt。
- **避免**：单 Agent 实例 per-turn mutate `state.messages` 脆弱（re-entrancy guard 就是为这打的补丁）；按字符串 `"401 "`/`"400 {"` 判错误类型。

**未深入**：OpenClaw（`openclaw/openclaw`，395k★）只用 `@earendil-works/pi-tui 1.4.0` 做 TUI，**不嵌 pi-agent-core/pi-ai**（root `package.json` 实测）——它的 agent runtime 是自研的，不属于"嵌 pi"案例。`proma-ai/Proma`、`NVlabs/SoL-Pi`、`thinkany-ai/dscode` 等也在用 pi 但本轮未展开。

---

## 2. 非 pi 成熟框架的可抄机制（只挑对得上 Novelive 需求的）

### 2.1 Claude Agent SDK（Anthropic，code.claude.com/docs/en/agent-sdk）

- **子 Agent = `AgentDefinition{description,prompt,tools?,disallowedTools?,model?,maxTurns?,background?,permissionMode?}`**（`agents` 参数传给 `query()`）。关键语义：
  - **上下文隔离**：非 fork 子 Agent 的 context 只有"自己的 system prompt + Agent 工具的 prompt 字符串"——**父对话历史、父 system prompt 一律不继承**。要传文件路径/决定就写进 prompt。
  - **fork**：`subagent_type:"fork"` 复制当前会话（可用 `disallowedTools:["Agent(fork)"]` 禁）。
  - **background**：默认子 Agent 异步跑（`status:"async_launched"`，报告在后序轮到达）；父要结果时阻塞拿 `completed`。
  - **输出消毒**（v2.1.210+）：子 Agent 最终消息返回父前被扫描——仿冒 `<system-reminder>` 类的控制 tag 加反斜杠中和、`Human:`/`Assistant:` 行首加 `\` 防伪造轮次边界（`sub-agents.md` "subagent-output-scanning"）。**Novelive 写手→审稿、子 Agent→主控的回传文本也应该过这层防提示注入。**
  - **`maxTurns`** 到限返回 partial 输出，可 resume 继续。
- **Hooks**：`PreToolUse`/`PostToolUse`/`Stop`/`SessionStart`/`UserPromptSubmit`/`SubagentStop` 等回调，返回 `{block/reason/...}` 控制行为——与 pi 的 `beforeToolCall`/`afterToolCall` 一一对应。
- **权限**：`allowedTools` 支持前缀模式 `"Bash(npm test *)"`；deny 规则 `Agent(fork)` 精确到子 Agent 类型。

### 2.2 OpenAI Agents SDK（openai.github.io/openai-agents-python）

- **编排两选一**（`multi_agent` 文档）：①**Handoffs**——分诊 agent 把整个对话交给专家（专家成为 active agent 接管本轮）；②**Agents as tools**——`Agent.as_tool()` 经理 agent 保留控制权，把专家当工具调、自己汇总。**Novelive 的角色是代码调度（写手→审稿→美术导演固定顺序），对应"orchestrating via code"而非 handoff；但子 Agent 回传结果用 as_tool 形态（调用者拿到返回继续）而不是 handoff 形态。**
- **Guardrails**（`guardrails` 文档）：三类——input guardrail（只在链路**第一个** agent 上跑）、output guardrail（只在**最后一个**）、**tool guardrails（每次被装饰的工具调用都跑）**。tool guardrail 可 `reject_content("...")` 替换输出或 `allow()`——**正好映射 pi 的 `beforeToolCall`/`afterToolCall`**；输入 tool guardrail 默认在人工批准后、执行前跑，可配 `pre_approval_tool_input_guardrails` 提前到批准前。tripwire = 异常 `*TripwireTriggered` 停整轮。**"便宜模型做 guardrail 挡在贵模型前"是他们明示的用法**——Novelive 的视觉审核同理。
- **Tracing**（`tracing` 文档）：内建、默认开，收 LLM 生成/工具调用/handoff/guardrail/custom span，processor 可插拔（Console/默认 backend/外部如 Braintrust、Langfuse、Logfire 等十几个）。`AdvancedSQLiteSession` 是会话存储参考实现。
- **Session 持久化语义细节**：output tripwire 拒绝最终输出时，runner 让 session 只持久化已完成的工具调用+输出、剔除被拒输出——**"持久化什么"是策略的一部分**。

### 2.3 LangGraph（docs.langchain.com/oss/python/langgraph）

- **Checkpoint = super-step 边界提交**（`checkpointers`、`fault-tolerance` 文档）：节点写只在该节点 attempt 成功后才落；失败 attempt 的写全部丢弃——**at-least-once 节点语义**。checkpoint 可 `exit`（每步同步落，适合崩溃恢复）/`async`/`shallow` 三档 durability。
- **`interrupt()`**：在节点内挂起等外部输入，`Command(resume=...)` 恢复；human-in-the-loop 的规范做法（`interrupts` 文档）。HITL middleware 还可对指定工具调用动态 interrupt（review/edit/approve）。
- **`RetryPolicy`**（`add_node(retry_policy=)`）：`max_attempts`/`initial_interval`/`backoff_factor`/`max_interval`/`jitter`/`retry_on`（异常类型或可调用；默认只重试 5xx 类瞬时错误，`NodeTimeoutError` 默认可重试）；`TimeoutPolicy{run_timeout,idle_timeout}` 分开，idle 被进度信号刷新。
- **幂等键教训（直接适用出图队列）**：重试重跑**整个节点**——副作用（生图、写文件）的幂等键必须**从已持久状态派生**（如 `f"img:{chapter}:{asset_id}"`），不能在节点内现生成靠返回值（crash 后重跑会生成新键重复扣费）。无业务键就先跑一个纯"分配键"节点落 checkpoint。
- **`node_attempt` / `task_id` / `checkpoint_id`** 经 `runtime.execution_info` 暴露——可按 attempt 切 fallback（第 2 次起换便宜 provider）。
- **time-travel**：从任意 checkpoint replay/fork（`use-time-travel`）——Novelive 会话条目树的等价物。

### 2.4 Mastra（mastra.ai/docs）

- **Workflow = `createStep`(输入输出 schema 校验) + `createWorkflow` 组合**；每步结果落 `snapshot`（可序列化的完整执行状态）→ `run.resume()` 从指定步续跑、`suspend()` 暂停收集外部输入、time-travel 从任意步重跑（`workflows/suspend-and-resume`、`snapshots`、`time-travel` 文档）。**step 级 schema + snapshot 续跑与 Novelive "每步存结果、停下从没做完的接着做"完全同构。**
- **Evals**（`evals/overview`）：**Scorer** 概念——量化的非确定性断言（LLM 判分 + 规则判分），`runEvals` 并发跑多 test case × scorer。与 vitest-evals 的 judge 同思想：judge 与 app 分离、阈值化。

### 2.5 Temporal / 持久执行（docs.temporal.io/ai、temporal.io/blog/temporal-agent-harness）

- **Durable Execution**：每次 model 调用是一个 Activity（可重试、有独立超时/重试策略），workflow 代码靠事件历史 replay 恢复；**重试交给 workflow 引擎而不是 LLM 客户端**（官方 cookbook 原话：留着客户端 retry 会与 engine 冲突——**只在一处重试**）。
- **Temporal Agent Harness**（2026-11 博客）：每个 agent 是一个 Workflow，human approval = Signal 进 workflow、暂停 = `workflow.condition` 等信号。
- **Inngest 同构**：step-memoization（`step.run`）+ event 触发 resume。vercel-labs/durable-harness 的 kernel 路就是这套思想的 pi 版（§1.4-B）。
- **对 Novelive 的映射**：1000+ 章流水线的"确定步骤+每步落库+幂等重放"不必引 Temporal——pi-durable 或自建 SQLite step 表就够；但要抄的是**"模型调用记 effect、工具调用记 effect、恢复时重跑最后未完成的 effect"**这条 fold 语义。

---

## 3. 综合：Novelive 应该抄的模式（含 pi 钩子映射）

pi-agent-core **1.6.0** 实测钩子面（`packages/agent/src/agent.ts`、`types.ts`）：
`transformContext(messages, signal)`（每轮请求前改写消息数组）、`prepareRequest(ctx)→AgentRequestUpdate`（每次请求前，可换 `context`/`model`/`thinkingLevel`）、`prepareNextTurn`/`prepareNextTurnWithContext`（轮次间，可追加 `messages` 或换 model）、`beforeToolCall(ctx)→{block,reason,terminate}`、`afterToolCall(ctx)→部分覆盖 result`、`finishTurn(turn)→{action:"continue"|"end"}`、另加 `convertToLlm`、`steeringMode`/`followUpMode`、`toolExecution`、`sessionId`、`thinkingBudgets`、`identity`。

### 3.1 首先重新评估：要不要直接用 pi-durable

`pi-durable` 1.6.0（experimental）几乎覆盖了 Novelive 自建清单的一半：会话存储（**SQLite 后端现成** `openNodeSqliteStorage`，支持 `{prefix:"pi_"}` 与 host 表共库）、崩后续跑（`harness.resume()`，任务 checkpoint）、请求幂等（`requestId` 去重）、压缩（reserveTokens/keepRecentTokens/backgroundTokens/modelOverrides 四层配置 + overflow 自动压缩重试）、子会话（task-owned conversation，子复制父 agent 再 configure 换模型摘工具）、工具权限（`beforeTool` hook、`replay:"safe"|"never"`）、turn 上限（`maxTurns`）、观测（`pi.live`/`pi.usage`/`onReport`/`watchTaskGraph`）、测试（`registerStorageConformance` + `fauxProvider`）。

**建议**：以 `pi-agent-core` 为底线方案（原计划），但同时做一份 pi-durable 的 spike（半天）：它已经把"确认点让出制作槽"（conversation busy/idle + parked work）、"停止后续跑"（resume）、"子 Agent"（task-owned conversation）做成了存储原语。风险：README 自标 experimental、API 可能变；应对是把会话/运行记录的持久化抽象成自己的接口（本来就要做），pi-durable 只作一种实现候选。vercel-labs/durable-harness 证明 pi-durable 的 `Storage` 接口可以整体替换（他们换成 Workflow event log），即就算用了 pi-durable，存储仍可控。

### 3.2 具体模式清单

| # | 模式 | 谁在做 | 映射到 pi/Novelive |
|---|------|--------|---------------------|
| 1 | **transformContext 做三层上下文组装**：宿主每轮注入 `<current_work_context>`（机械刷新的状态）+ `<host_execution_progress>`（从 tool result 收据算的真实进度，防摘要撒谎）+ `<conversation_summary>` | inkos `harness/agent-context.ts` | `transformContext`：制作中调用的每轮上下文由代码现拼（既定方案），进度/状态用受保护块注入 |
| 2 | **压缩切点只在轮边界**：`isTurnBoundary` 拒绝在 toolCall/toolResult 中间切（切了 Anthropic 400）；保留尾部 ~50% 阈值预算 | stavrobot `compaction.ts`；llm-space `planCompaction`；brigade | `transformContext` 内部切点选择 + SQLite 条目树上 compaction 条目 |
| 3 | **压缩三级降级 + 增量摘要**：LLM 摘要 → bullet 摘要 → 确定性截断兜底；先前摘要 fold-forward 只压增量 | stavrobot `escalatingSummarize`；inkos `extendsCache`；brigade `mid-turn.ts` | 整理角色做摘要失败时降级链；pi-durable `beforeCompact` hook 可供给自己的摘要 |
| 4 | **后台预摘要 + 摘要硬 deadline**：usage≥0.85 turn 结束后 fire-and-forget，120s hard deadline 防 provider stall 卡死后台 slot | electric `compaction-summarize.ts`（注释写明 pi-ai anthropic 无内部 retry 会永久 stall） | 对话面板会话：prepareNextTurn 后台触发；摘要请求必须自带 AbortController+超时 |
| 5 | **结构化输出 = 强制 tool call**：`toolChoice:"required"` + TypeBox schema + `Value.Parse` + 最多 N 轮修正，不 scrape JSON | inkos `runWorkerAgentTool`；vitest-evals judge 用 `responseFormat:{json,schema}` 注入 system prompt | 写手剧本、审稿问题列表、美术导演图清单：定义 "提交结果" 工具，`afterToolCall` 校验，未提交则续轮（`finishTurn:{action:"continue"}`） |
| 6 | **finish_turn / 终态强制**：唯一允许结束的方式是调交付工具，校验交付物 revision 未过期（`TURN_DELIVERY_STALE`） | inkos `turn-completion.ts` `hasDelivery` | `finishTurn` 钩子：美术导演未提交图清单、画师未交图就不许结束；防模型虚报完成 |
| 7 | **beforeToolCall 守卫链 + fail closed**：decode→unknown→path 守卫→config 守卫→loop 检测→exec 闸门，任一抛错=拦截；exec 类工具拒绝 cwd/env 覆盖 | brigade `composeBrigadeBeforeToolCall` | `beforeToolCall`：确认卡实现（生图前确认、重做章节确认）；写类工具的范围校验；链式守卫每个是纯函数可单测 |
| 8 | **确认 = 拦截+外置执行+回放**：需确认的动作先抛 `ConfirmationRequired`→宿主确认后 loop 外执行→把合成 toolCall+toolResult 注回 `agent.continue()` | inkos `resumeAction` + `ActionConfirmationRequiredError`；llm-space `terminate:true` 工具停轮等人 | `beforeToolCall` 返回 `{block,reason}` + 制作面板确认后代码执行 + `prepareNextTurnWithContext` 注入结果消息（或 llm-space 式 terminate 交还控制权） |
| 9 | **子 Agent 三件套**：独立会话 + 只传 prompt 字符串（不继承父历史）+ 输出消毒（中和伪 `<system-reminder>`/`Human:` 行） | pi-durable task-owned conversation；Claude SDK AgentDefinition+output scanning；llm-space `buildSubagentThread` | 主控派子 Agent：新建 Agent/会话，prompt 里带全所需路径与决定；回传文本过消毒（防注入父上下文）；`configure` 摘 spawn 工具防孙代 |
| 10 | **persistent worker + resetContext 复用**：子 Agent 池按 assignment 复用（`resetContext()`+`reconfigure(tools,systemPrompt)`），不新建会话 | YN `subagentSupervisor`（lifecycle 参考自 @gotgenes/pi-subagents） | 三个画师在出图队列上复用：同一画师会话 `reconfigure` 接下张图，省会话建立成本 |
| 11 | **run record = event-sourced ledger + owner_pid 崩溃回收**：SQLite `episodes`+`events` 两表；重启把 owner 已死的 running 标 failed | inkos `episode-store.ts`（node:sqlite WAL）；YN `yn.host-state.v2` delta + `interruptSubagentCards` 孤儿标记 | project.db 的 run 表：每步（写/审稿/演出/每张图）一条 ledger 行；utilityProcess pid 列，冷启动回收 interrupted |
| 12 | **lease anchor 代替心跳**：留未完成工作的提交带截止 anchor + 延迟 wake 任务检查持有者死活 | durable-harness `runWake`/`judgeAnchor` | 立即停止/崩溃续跑：每章任务落 `deadline+owner`；App 启动/定时检查过期 anchor→resume。无需心跳线程 |
| 13 | **重试策略矩阵**：错误分类 ~12 种 → 纯策略表（rate_limit→retry+rotate；billing→换模型；overflow→压缩后 1 retry；auth/format→fail fast） | brigade `error-classifier.ts`+`retry-policy.ts`；LangGraph `RetryPolicy.retry_on` | 包在 `streamFn` 外层（pi 的请求级错误）+ 角色调度层；**已持久化进度的失败不重试**（stavrobot `TurnProgressPersistedError`——重放会重复工具副作用） |
| 14 | **transport 横切全塞 streamFn 注入点**：idle watchdog（90s）/first-event deadline/空响应与 required-tool-missing 各重试 1 次/追踪 header | inkos `pi-stream.ts`/`llm/provider.ts`；electric `model-runner.ts` | `Agent({streamFn})` 自包一层：idle 超时（防 reasoning 长静默）、usage/trajectory 记录、per-role 修正（onPayload） |
| 15 | **工具结果进账**：每次 tool_call/tool_result/模型调用 started/completed/retry 都写 ledger（AsyncLocalStorage sink），token/cost 累计 | inkos `withExecutionEvidence`；electric stream 行；pi `pi.usage` doc | `afterToolCall` + `onResponse`/`onProviderStreamEvent` 写 run 表；制作面板"运行记录"直接查库 |
| 16 | **测试三件套**：①pi-ai 自带 `fauxProvider`/`fauxAssistantMessage` 假 provider；②tool replay cassette `sha256(stableStringify(args))`→JSON `auto/record/strict`；③monkey-patch `AgentTool.execute` 录 transcript | YN tests（fauxProvider 走真存储）；vitest-evals `replay.ts`+`withInstrumentedAgentTools`；durable-harness SIGKILL 测试 | ①单元测用 fauxProvider 注剧本/清单文本；②生图工具录 cassette 离线回归；③`fakeEventStream` 喂 EventStream 测 hook 链；④真 SIGKILL 子进程验证 resume |
| 17 | **judge/app 分离**：judge 用自己的 model client+system prompt+独立 harness，结构化 rubric 打分 | vitest-evals `judgeHarness`；Mastra scorer；p2 workflows "verifier 用另一模型家族、指令是反驳不是确认" | 视觉审核已在生图工具内（既定）；审稿=独立会话独立模型；断言 `expect(...).toSatisfyJudge` 式阈值 |
| 18 | **per-role 模型**：角色名→model override 查表，子 Agent 继承父模型但可按 task override | inkos `modelOverrides`；YN `subagentProviderId`；Claude SDK `AgentDefinition.model` | `prepareRequest` 每次请求前按当前角色换 `model`（pi-durable 则 `configure({model})`）；五个槽位设置→角色默认值映射 |
| 19 | **可变文档放最新 user message 开头**：保 system prompt 前缀稳定命中 KV cache；per-place 变量快照让旧前缀保留首渲值 | durable-harness `promptDocs`；llm-space `context.snapshot.variables` | 设定切片/本章原文按既定顺序放尾部；改编要求等一卷内不变的内容放前缀不动 |
| 20 | **LangGraph 幂等键**：副作用键从已持久状态派生 `f"img:{chapter}:{asset}"`，不在 step 内现生成 | LangGraph fault-tolerance 文档 | 出图队列：asset_id 落库后才允许生图工具跑；重跑同 chapter+asset 直接命中已存文件跳过 |
| 21 | **持久 worker 隔离（可选）**：plugins 跑专用 Unix 用户、目录 700、config 不给 LLM | stavrobot | 若将来执行用户脚本/外部技能包再考虑；本期不需要 |
| 22 | **SQLite 会话 + host 状态共库**：pi-durable `{prefix:"pi_"}` 与 host 表同一 db 文件 | pi-durable README Storage 节；YN host-state 进同一 JSONL | project.db：pi 会话条目树 + 制作状态 + run 表一个文件，事务一致 |

### 3.3 反模式（不要抄）

1. **单 Agent 实例 per-turn mutate `state.messages`**（stavrobot）：脆弱，需 re-entrancy 守卫擦屁股。Novelive 每角色/每会话各持 Agent 实例，制作调用干脆每次新建（context 本来每次现拼）。
2. **把整个 thread 快照当 run 记录**（llm-space snapshot-per-run）：重。改增量事件/ledger 行。
3. **460KB 单文件领域工具**（YN `ynDomainTools.ts`）/3.7k 行 agent-loop（brigade）：按角色拆。
4. **JSONL 每次 append 全量重读**（inkos transcript）：直接上 SQLite。
5. **LLM 客户端和 workflow 引擎两边都重试**（Temporal 官方告诫）：retries 只在一层——模型瞬时错误在 streamFn 包装层，步骤级重试在制作调度层，不混。
6. **偷读别家 CLI 凭证**（electric `~/.codex/auth.json` 默认读）：Novelive 只管自己配置的 key。
7. **pi 内部字段 hack**（brigade three-write、llm-space `patchedDependencies`）：能走 `transformContext`/公开 option 就别 patch dist；必须 patch 时用 `patchedDependencies` 留记录并 pin 版本。
8. **子 Agent 继承父上下文**（Claude SDK 默认不继承是有意的）：Novelive 角色各自独立会话，衔接靠代码注入材料，不靠共享 transcript。
9. **确认用弹窗打断**（YN 靠解析 tool result 文本判 "ask the user" 是 hack）：Novelive 用 `beforeToolCall` block + 确认卡 + 确认后回放的规范路径（模式 #8）。
10. **无 deadline 的后台 LLM 调用**（electric 注释：provider stream stall 永久占坑）：一切后台/摘要/审核调用必须 AbortController+超时。

### 3.4 对既定设计的修正建议

- **"pi 没有子 Agent" 已过时**：pi-durable 的 task-owned conversation（进程内、SQLite、崩溃安全）和 coding-agent 的子进程方案都是现成的。主控派子 Agent 建议照 pi-durable `examples/21/22` 写：子会话复制父 agent→`configure` 换模型摘工具→`ownership` 绑定使 abort 级联。
- **会话存储**：YN 已证明 pi 的 `Storage` 接口 + JSONL 可用，但 SQLite 直接是 pi-durable 的内建项；即便不用 pi-durable，inkos 的"账本+transcript 双轨"和 electric 的"append-only 行+投影"都指向同一形状——`id/parentId` 条目树放 SQLite，运行记录是同一库里的另一类表。
- **确认点**：既定"确认点让出制作槽"在 pi-durable 里是 busy/idle+inbox 原语；在自建方案里对应 `beforeToolCall` block + 队列让位，两者兼容。
