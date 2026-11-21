# R2 调研：Novelive Agent 对话面板（assistant-ui + streamdown over Electron IPC）

日期 2026-11-21。实测环境：React 19.2 + `@assistant-ui/react` 0.15.37（2026-11-18 发布）+ streamdown 2.8.0（2026-11-17 发布），Vite 7 构建，Playwright 1.65 headless Chromium 实测通过。试用代码在 `/tmp/nl-r2/ChatPanel/trial/`（可复现）。

## 1. 结论（最重要的先说）

1. **Runtime 选型：ExternalStoreRuntime + `messageRepository`（完整消息树）**，不是 LocalRuntime、也不是 AssistantTransport。理由：我们的会话本来就是 `id/parentId` 条目树存 `project.db`，`messageRepository: {headId, messages:[{message,parentId}]}` 形状与之一一对应；创作端是唯一事实源，UI 只做投影。LocalRuntime 的 `ChatModelAdapter.run` 是"一问一答生成器"模型，表达不了"会话 park 等确认卡"和"后端主动改历史"；AssistantTransport 要求后端讲 assistant-stream 协议、本质是 HTTP/SSE 语义，强套到 MessagePort 上只是把序列化问题搬了家。
2. **试用结论（实测可跑）**：ExternalStoreRuntime 下 text_delta/reasoning_delta/工具卡/确认卡（approve/reject+reason，park 期间 isRunning=false 但仍阻塞续跑）/编辑重发成 BranchPicker 分支/BranchPicker 切换分支，全部工作。关键坑：喂进 `messageRepository` 和 `convertMessage` 的消息**必须过 `fromThreadMessageLike` 归一化**（补 `metadata.unstable_state` 等），否则 runtime 内部读 `.metadata.unstable_state` 直接抛 undefined。
3. **分支**：`unstable_onBranchChange` 回调给 `{headId, visibleMessageIds}`，我们用它向创作端发 `chat.switchBranch`；UI 侧无需自己算路径。编辑重发走 `onEdit`（message.sourceId=被编辑消息 → 作为兄弟节点追加 = 天然分支）；regenerate 走 `onReload`。试用实测编辑后 `2/2`→`1/2` 切换正常。
4. **确认卡 = `tool-call` part 上的 `approval` 字段**（0.15.x 原生 HITL 面）：`propose_*` 工具调用部分挂 `approval:{id,prompt}`，消息状态 `{type:"requires-action",reason:"interrupt"}`；用户在卡里点确认/拒绝+理由 → `onRespondToToolApproval({approvalId,approved,reason})` → 我们经 MessagePort 回给创作端，唤醒 park 的会话把结果补成工具结果。与 B1（park 帧）+ B3（feedback 回模型）严丝合缝，不用再发明轮子。
5. **流式吞吐**：不要逐 token 帧推——创作端把 pi `AssistantMessageEvent` 增量累积成本地 `partial` 消息后，**按 ~30-50ms 或 ~2-4KB 一批**把"整条 assistant 消息的当前快照"作为一个事件帧推给 UI（react-pi 的成熟做法：事件即快照，`partial` 共享 live response，UI 不自攒 delta）。seq 单调 + ring buffer + `events.list` 断线重放已覆盖乱序/丢帧。
6. **streamdown 2.8.0 实测**：CJK 正文流式渲染正常（bold/list/blockquote/inline-code/代码块），未闭合 `**`/```` ``` ```` 由 remend 修补不产生裸标记闪烁；`$x^2$` 不渲染（KaTeX 是可选 plugin，默认未装——剧本/讨论面板不需要可接受）；有原生 `plugins.cjk` 槽位（remark-cjk-friendly 类），需要时再挂。gzip 后 aui 118KB + streamdown 166KB + 业务 60KB ≈ 285KB（不含 React）。
7. **ThreadList（多会话列表）**：`InMemoryThreadList` / `SingleThreadList`（`@assistant-ui/core/store`）或外部 store 的 `adapters.threadList`（deprecated 标记但仍维护）。会话元数据（id/title/改名/删除）本来就在 `project.db`，推荐自管 thread-list store + `ThreadListPrimitive`，不要 `useRemoteThreadListRuntime`（它假设远端 HTTP 资源语义）。
8. **插话（steer）**：pi-agent-core 1.6.0 有原生 `Agent.steer(message)` + `getSteeringMessages` 钩子 + `steeringMode` 队列；assistant-ui 侧 `ExternalThreadQueueAdapter{enqueue,steer}` 正好映射"运行中继续输入 → steer 插队 / followUp 排队"。这条链路是现成的，0.15.x 的 queue adapter 就是为此设计的。

## 2. 证据

### 版本与许可（逐项核实）

- `@assistant-ui/react` 0.15.37，npm latest，发布 2026-11-18，**MIT**（package/LICENSE，AgentbaseAI Inc.）。依赖 `@assistant-ui/core` 0.3.37（MIT）、`assistant-stream`、`zustand`、`zod`、`radix-ui`；peer `react ^18||^19`。→ `npm view` + `/tmp/nl-r2/ChatPanel/package/package.json`。
- `streamdown` 2.8.0，发布 2026-11-17，**Apache-2.0**（dist LICENSE，Vercel）。AGPL-3.0 兼容（Apache-2.0 与 AGPL-3.0 单向兼容：可并入 AGPL 作品）。依赖 marked 18、remend、unified/remark/rehype 全套、`tailwind-merge`（仅类名合并工具，不引入 Tailwind 样式）。→ `/tmp/nl-r2/ChatPanel/streamdown-pkg/`。
- `@earendil-works/pi-agent-core` 1.6.0、`@earendil-works/pi-ai` 1.6.0，npm 最新即 1.6.0 → `/tmp/nl-r2/ChatPanel/piagent/`、`/tmp/nl-r2/ChatPanel/piai/`。
- assistant-ui 官方仓库 clone `3b848877`（2026-11-21），examples 目录有 `with-external-store`、`with-assistant-transport`、`with-custom-thread-list` 等 30+ 例。→ `/tmp/nl-r2/ChatPanel/aui-repo/`。

### ExternalStoreAdapter 关键字段（0.15.37 `.d.ts` 实测）

- `messages`（可见路径）与 `messageRepository`（全树 `{headId, messages:[{message,parentId,runConfig}]}`）二选一或并给；`messageRepository` 给全树时 runtime 自己算分支。→ `core/dist/runtimes/external-store/external-store-adapter.d.ts:110-111`。
- `setMessages` 是分支切换的前置（`switchToBranch` 无它直接 throw `"Runtime does not support switching branches"`）→ `external-store-thread-runtime-core.js:625-626`。
- `unstable_onBranchChange({headId, visibleMessageIds})` 用户点 BranchPicker 时触发（去重、跳过 optimistic）→ `external-store-adapter.d.ts:144-160`。
- 命令回调全套：`onNew`（发新消息）、`onEdit`（编辑重发，`AppendMessage.sourceId`）、`onReload(parentId, config)`、`onCancel`、`onDelete`、`onAddToolResult`、`onRespondToToolApproval({approvalId,approved,optionId,text,answers,reason})`、`onResumeToolCall` → `external-store-adapter.d.ts:164-197`。
- `isRunning` 外部可控（park 期间可置 false 同时保持待答卡）；`isLoading`/`hasEarlier`/`onLoadEarlier` 支持长会话分页 → `external-store-adapter.d.ts:79-109`。
- `queue?: ExternalThreadQueueAdapter{items,steerItems,enqueue,steer,move,edit,remove}` 对应 steer/followUp 双通道 → `core/dist/runtime/queue/external-thread-queue-adapter.d.ts:12-37`。
- `adapters.attachments`：`{accept,add,remove,send}`，自带 `SimpleImageAttachmentAdapter`/`SimpleTextAttachmentAdapter`/`CompositeAttachmentAdapter` → `core/dist/adapters/attachment.d.ts:4-56`。

### 消息部件模型（确认卡/工具卡的落点）

- `ToolCallMessagePart`：`{toolCallId,toolName,args,argsText,result,isError,isPreliminary,artifact,modelContent,approval,messages}`——`argsText` 是流式原始 JSON 串（args 为部分解析），`isPreliminary` 标"工具还在跑但已有中间输出"，`approval` 就是 HITL 闸门，`messages` 可挂子 Agent 嵌套转录 → `core/dist/types/message.d.ts:279-342`。
- `approval` 字段全家桶：`{id,prompt,display:"select"|"text"|"questions",allowFreeform,dismissible,approved,reason,options,optionId,text,resolution:"cancelled"|"expired"}`——拒绝理由走 `reason`/`text`；会话 park 恢复后 `resolution` 可补终态 → `message.d.ts:318-341`。
- `MessageStatus`：`running | requires-action{reason:"tool-calls"|"interrupt"} | complete | incomplete{cancelled|tool-calls|length|content-filter|other|error}`——pi `stopReason` 到 UI 状态的映射表可直接照抄 → `message.d.ts:400-412`。
- 消息 part 类型：`text | reasoning | tool-call | source | file | image | data | generative-ui`——"可折叠思考"=`reasoning` part；子 Agent 嵌套=tool-call 的 `messages` 或 `data` part → `message.d.ts:374`。

### 试用实测（Playwright headless，React 19.2，ExternalStoreRuntime）

场景脚本 `/tmp/nl-r2/ChatPanel/trial/trial.spec.ts`，截图 `shots/01-07`：

- **流式**：30ms 一批推送"partial assistant 消息快照"，reasoning 块 + CJK markdown 正文 + `read_chapter` 工具卡（argsText 逐段填充 → result 落位）全部正确渲染，无裸 `**`/```` ``` ```` 残留（截图 01/02）。
- **确认卡**：`propose_redo_chapter` part 挂 `approval` 后 UI 出卡，点"拒绝"+填理由 → `onRespondToToolApproval` → 后端把 `{approved:false,reason}` 补成工具结果续跑，卡片落"已拒绝：理由"终态，结尾文本流出（截图 03）。点"确认"同路径（截图 05）。
- **分支**：编辑已发消息重发 → 新节点作兄弟挂同一 parent → BranchPicker `2/2`；`branch-prev` 点击 → `unstable_onBranchChange` → 切回 `1/2`，可见路径只剩分支 1（截图 06/07 + `verify-branch.ts` 输出 `after prev: 1/2`）。
- **坑（已在试用中踩实）**：`messageRepository` 里的消息必须过 `fromThreadMessageLike` 归一化，否则 `base-thread-runtime-core.js:64` 读 `metadata.unstable_state` 抛 undefined；同理 `status` 字段只许挂 assistant 消息（user 消息带 status 抛 `"status is only supported for assistant messages"`）。
- **bundle 实测（Vite production build, manualChunks）**：`@assistant-ui/react` 399.9KB min / **118KB gzip**；`streamdown` 553KB min / **166KB gzip**（含 GFM+sanitize+harden；KaTeX/mermaid 是懒 chunk 不占主包）；React 19 60KB gzip。合计面板增量 ≈285KB gzip。

### pi-agent-core 1.6.0 → assistant-ui 事件映射（类型实测）

`AgentEvent` 联合（`piagent/dist/types.d.ts:461-493`）与内层 `AssistantMessageEvent`（`piai/dist/types.d.ts:592-635`）：

| pi 事件 | UI 侧动作（ExternalStore 投影） |
| --- | --- |
| `agent_start` | `isRunning=true`；新建 assistant 占位消息 |
| `message_start{message}` | 追加/重置当前 assistant 消息 |
| `message_update{assistantMessageEvent:{text_start/text_delta/text_end}}` | 更新对应 contentIndex 的 `text` part（读 `partial.content[i]`，不自攒 delta） |
| 同上 `thinking_*` | 更新 `reasoning` part |
| 同上 `toolcall_start/toolcall_delta/toolcall_end` | 更新 `tool-call` part 的 `argsText`/`args` |
| `tool_execution_start{toolCallId,toolName,args}` | part 补 `args`，标 running |
| `tool_execution_update{partialResult}` | part `result=partialResult, isPreliminary:true` |
| `tool_execution_end{result,isError,durationMs}` | part `result,isError`，清 `isPreliminary` |
| `turn_end{message,toolResults}` | toolResults 按 toolCallId 配对进 part.result（react-pi `buildToolResultMap` 同款） |
| `agent_end{messages}` | 落终态 `complete{reason:"stop"}` 或按 stopReason 映射 incomplete |
| （pi 无确认事件——`beforeToolCall` 拦下后由我们发） | part 挂 `approval{id,prompt}` + 消息 `requires-action:interrupt` + `isRunning=false`（park 让槽） |

对照实现：assistant-ui 仓库 **`@assistant-ui/react-pi`**（`aui-repo/packages/react-pi/src/`，MIT）就是为 `pi-coding-agent` 写的同款适配层：`runtime/messageProjection.ts`（920 行，transcript→ThreadMessageLike 投影，含"assistant+toolResult 合并为一个 assistant 消息、toolCallId 配对、isPreliminary、approvalForRequest"）、`runtime/threadState.ts`（442 行 reducer：snapshot 权威 + 事件补丁 + hostUiRequests）、`runtime/hostUi.ts`（170 行，Pi `confirm/select/input/editor` ↔ approval/RespondToToolApprovalOptions 双向映射）。我们的事件面比它小（无 SSE/HTTP），**照抄其投影思路约 300-500 行即可**；注意它依赖的是 `pi-coding-agent` 的会话条目/host-ui 语义，我们只借映射表不借其 session/entry 类型。

## 3. 对照现有设计

- **「对话前端用 assistant-ui + streamdown」**：已覆盖（`docs/architecture.md:56`、`.workflow/research/agent-orchestration.md:15-18`）。本调研落实了 runtime 选型 = **ExternalStoreRuntime**（文档未指明哪个 runtime → **缺口**，应写进 `pi-scaffolding.md` 通用层或新建 panel 设计节）。
- **「数据由创作端通过 MessagePort 推给界面，不走 HTTP」**：已覆盖（`agent-orchestration.md:101`、`docs/architecture.md:67`）。**缺口**：未写"推快照不推 delta、~30-50ms 批处理、seq+ring buffer 重放"——应并入 `architecture.md` 事件 envelope 一节（`seq/scope/scopeId` 已够，只需补"事件载荷 = 投影后的消息快照 + headId"）。
- **确认卡协议**：B1（park + `RpcExtensionUIRequest method:"form"` 帧形）与 B3（feedback 回模型）在 gap-ledger 已登记。**本调研更新**：落点可直接用 `tool-call.approval` + `onRespondToToolApproval`（比裸 `extension_ui_request` 更贴 assistant-ui 0.15 模型）；`prompt` 字段放"要做什么+影响哪些章节"，`reason`/`text` 放拒绝理由。仍**缺口**：`pi-scaffolding.md:95` 写的是照 omp 帧形，建议改为"propose_* 工具 part 挂 approval + RespondToToolApprovalOptions 语义"。
- **分支/编辑/重发**：`ux.md:42` 写"改写一条消息后重新发送会形成分支，可以在分支之间切换"——已覆盖语义；**缺口**：实现路径（`onEdit`→兄弟节点、`onReload`→同级重跑、`unstable_onBranchChange`→`chat.switchBranch` 命令）未写进任何 doc，应入 `agent-orchestration.md` §5 或 panel 设计节。
- **会话列表**：`ux.md:42`"每部作品可以有多个会话，能新建、改名、删除"——已覆盖语义；**缺口**：`ExternalStoreThreadListAdapter`/`InMemoryThreadList`/`ThreadListPrimitive` 三选一未决（推荐自管 store + primitives，理由见 §1.7）。
- **插话（运行中发消息）**：`pi-scaffolding.md:52` 已写"用户新消息在工具批次之间注入（steering）"——已覆盖；本调研补 UI 侧落点 `ExternalThreadQueueAdapter{enqueue,steer}`。
- **attachments**：`ux.md`/`agent-orchestration.md` 均未提创作者能否在面板贴图（如给主控看参考图）——**缺口**，若要做：`AttachmentAdapter{add,send,remove}` + `CompleteAttachment` 走 `novelive://` 资源或 base64，命令载荷里带 `images:ImageContent[]`（pi `prompt(input, images)` 原生支持，`agent.d.ts:124`）。
- **子 Agent 显示**：`ux.md:43`"派出的子任务"展开为嵌套内容——已覆盖语义；**缺口**：落点建议 `tool-call.messages`（嵌套 ThreadMessage）或 `data` part，文档未定。
- **长会话分页**：`hasEarlier`+`onLoadEarlier`（0.15 新加）正配"过长时较早内容压缩成摘要"+按页加载——**缺口**，`project.db` 会话条目树的分页读取命令（`chat.list {sessionId, beforeEntryId, limit}`）未定义。
- **冲突**：无与已定决策的硬冲突。唯一注意点：`agent-orchestration.md:15` 说"assistant-ui…能接我们自己的数据源"——ExternalStoreRuntime 正是此意，但**需要 `fromThreadMessageLike` 归一化**这个细节文档没有，属实现坑而非冲突。

## 4. 可拷资产

| 资产 | 位置 | 许可 | 体量 | 用途 |
| --- | --- | --- | --- | --- |
| `@assistant-ui/react-pi` 的 `messageProjection.ts` 投影逻辑 | `aui-repo/packages/react-pi/src/runtime/messageProjection.ts` | MIT | ~920 行（取 ~300-400 行思路） | transcript→ThreadMessageLike：assistant+toolResult 合并、toolCallId 配对、isPreliminary、approvalForRequest、status 映射 |
| `hostUi.ts` approval 双向映射 | `…/runtime/hostUi.ts` | MIT | 170 行 | `PiHostUiRequest`(confirm/select/input/editor) ↔ `approval`/`RespondToToolApprovalOptions`；我们的 propose_* 卡可照此把 `reason` 回传 |
| `threadState.ts` reducer | `…/runtime/threadState.ts` | MIT | 442 行 | snapshot 权威 + 事件补丁的 store 形状（toolExecutions/hostUiRequests/runStatus），我们 FakeCreatorBackend 已按此实现 |
| `thread.aui.tsx` minimal 模板 | `aui-repo/templates/minimal/components/assistant-ui/elements/thread.aui.tsx` | MIT（模板） | 521 行 | Thread/Composer/Message/BranchPicker/ActionBar 组装参考；需剥 Tailwind 类名改 CSS Modules |
| `tool-fallback.aui.tsx` | `…/elements/tool-fallback.aui.tsx` | MIT | ~500 行 | 通用工具卡 + approval 渲染参考（含 options/questions 分支） |
| 试用工程本体 | `/tmp/nl-r2/ChatPanel/trial/` | 我方 | ~400 行 | FakeCreatorBackend（id/parentId 树 + park 语义）+ ExternalStoreRuntime 接线 + ProposalCard，可直接演化成 `packages/ui` 面板骨架 |

（pi-agent-core/pi-ai 1.6.0 类型在 `/tmp/nl-r2/ChatPanel/{piagent,piai}/dist/types.d.ts`，事件名以 §2 表为准。）

## 5. 需要所有者取舍的事

1. **事件帧推"快照"还是推"delta"**——推荐**快照**（整条 assistant 消息最新内容 + headId，30-50ms/批）：创作端反正维护 `partial`，UI 不自攒就不用做 delta 乱序合并；代价是重复传已发的文本。若在乎 MessagePort 流量，可退化到"delta+contentIndex"（pi `AssistantMessageEvent` 天然带 contentIndex），但 UI 侧要复刻 partial 累积逻辑。**推荐快照**——长回复几 KB 级，MessagePort 结构克隆成本可忽略，换来"断线重放=重放最近 N 帧快照"的极简恢复。
2. **确认卡 UI 落点**：(a) `tool-call.approval`（react-pi 路线，原生 BranchPicker/审批语义打通，推荐）vs (b) `data` part 自渲染（更自由但要自己管终态）。推荐 (a)，`propose_*` 之外的表单类请求（若有）再退 `data`。
3. **会话列表**：(a) 自管 Zustand store + `ThreadListPrimitive`（推荐：会话本就在 project.db，命令已有 `新建/改名/删除`）；(b) `adapters.threadList`（deprecated 标记，功能少）；(c) `InMemoryThreadList`（内存态，重启丢列表顺序）。推荐 (a)。
4. **attachments 做不做**：面板贴图（给主控/美术导演看参考图）有真实场景（确认点 1 参考图讨论）。`pi.prompt(input, images)` 与 `AttachmentAdapter` 都是现成的，成本≈1 天；但 `ux.md` 未写。**建议列入"第一版可做可不做"**，若做按 §3 attachments 缺口补设计。
5. **streamdown 的 KaTeX/mermaid**：默认未启用可省 ~100KB gzip 懒块；剧本/讨论面板用不上公式和图，**建议不启用**，保留 `plugins.cjk` 槽位备用。
6. **子 Agent 嵌套显示**：用 `tool-call.messages`（assistant-ui 原生嵌套转录）还是 `data` part + 自定义折叠组件——前者零自绘但受限于其渲染递归，后者自由。**建议先 `data` part + 折叠**（运行记录同一套组件复用要求更高自由度）。
