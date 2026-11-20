# oh-my-pi 各包对 Novelive 的可用性调研

2026-11-21。源码：`/tmp/omp-src`（HEAD `fbb8085`，2026-11-20）。npm 全包同号 **19.0.1**，MIT。上游是 `badlogic/pi-mono`（Mario Zechner），和 earendil 的 pi 同源。README 自述："Fork of Pi by @mariozechner … extended with a batteries-included coding workflow."

## 0. 结论先行

**几乎所有 `@oh-my-pi/*` 包都不能在 Node 24 直接用。** 它们 `package.json` 的 `engines` 写的是 `bun >=1.4.4`，发布产物几乎不带编译后的 JS——`exports` 的 `import` 直指 `./src/*.ts`，依赖 Bun 原生跑 TS、且热路径里直接调 `Bun.*`。我们在 `/tmp/nodetest`（Node v24.18.0）实测：8 个包逐个 `import()`，**只有 `@oh-my-pi/omptype` 加载成功**，其余全部报错。

对 Novelive：把底座换成 omp 的 `pi-ai`+`pi-agent-core` 在技术上不可行（跑不进 Electron 的 Node 24 utility process），也不该做（fork 已大幅分叉、不再跟随 earendil）。**能直接复用的只有 `@oh-my-pi/omptype`（schema 库），但它和我们的 pi-schema 路线冲突，建议只抄不装。** 其余一律"抄设计"。omp 真正值得我们抄的是：`pi-agent-core` 的 compaction 子模块和模型角色解析（`model-roles.ts`/`model-resolver.ts`）的**思路**，不是代码。

---

## 1. 与 earendil pi 的关系：硬分叉，已停止跟随上游

是硬分叉。omp 把 `badlogic/pi-mono` 整库改写成一个面向编码的 CLI（omp / pi-coding-agent），`packages/ai` 7.4 MB、`packages/coding-agent` 30 MB、`packages/tui` 9 MB，远非一个库。

**分叉证据（同一 upstream、各自演进）：**

- omp 用 Bun loader 把旧包名 `@mariozechner/*` 和 `@earendil-works/*` **重定向到自己的副本**（`docs/extension-loading.md:290`、`packages/coding-agent/src/extensibility/legacy-pi-ai-shim.ts`、`legacy-pi-compat.ts`）。它知道 earendil，但只是给"为上游写的插件"做兼容，不是跟随 earendil。
- omp 缺 earendil 1.6.0 的新 API：`finishTurn`、`prepareRequest`、`prepareNextTurn`/`prepareNextTurnWithContext`、`setDefaultStreamFn`、`cleanupSessionResources`、`registerFauxProvider` 在 omp 源码里**全部不存在**（grep 无命中）。这些是 earendil 1.6 给"嵌入当库"加的东西，omp 没跟进。
- `getApiKey` 签名不同：earendil 是 `(provider: string)`，omp 是 `(model: Model)`（`packages/agent/src/agent.ts:194`）。

**API 分叉程度（对照 earendil 1.6.0 `dist/*.d.ts`）：**

| 项 | earendil 1.6.0 | omp 19.0.1 |
| --- | --- | --- |
| `transformContext` | 有 | 有，同签名 |
| `beforeToolCall`/`afterToolCall` | 有 | 有，同签名 |
| `finishTurn` | 有 | **无** |
| `prepareRequest` | 有 | **无** |
| `prepareNextTurn*` | 有 | **无** |
| `streamFn` | `StreamFn`（必填，可 `setDefaultStreamFn`） | `streamFn?`，默认 `streamSimple` |
| `getApiKey` | `(provider: string)` | `(model: Model)` |
| AgentEvent | agent/turn/message/tool_execution + `toolCall` 等 | 几乎同形（`agent_start/end`、`turn_start/end`、`message_start/update/end`、`tool_execution_start/update/end`），但载荷字段已分叉 |
| Tool | `{name,description,parameters,constrainedSampling?}` | 同形但多了一堆字段：`strict`、`deferLoading`、`customFormat`、`customWireName`、`native`、`examples`（`packages/ai/src/types.ts:1752`） |
| `Context` | `{systemPrompt?, messages, tools?}` | 多了 `inactiveTools`（Anthropic 延迟工具） |
| schema 库 | `@earendil-works/pi-schema`（零依赖） | **自己的 `@oh-my-pi/omptype`**（ArkType 兼容 + TypeBox 门面） |
| 额外 hook | — | `transformProviderContext`、`onSseEvent`、`onAssistantMessageEvent`、`onHarmonyLeak`、`providerSessionState`、`sentToolDefinitions`、`serviceTierResolver`、`interruptMode`、`deadline`、工具 `concurrency`/`interruptible`/`intent` |

omp 自己加的能力大体是"编码 CLI 需要、嵌入不需要"的（意图注入、speculative execution、live steering、provider 会话态、Anthropic 托管工具等）。**同步上游已停**：omp 走自己的版本号（19.x），CHANGELOG 全是自己的 issue/PR，没有把 earendil 1.6 的库化改动搬回去。

## 2. 分包评估

| 包 | 用途 | reuse / copy / ignore | 理由（含 Node 实测） |
| --- | --- | --- | --- |
| `@oh-my-pi/omptype` | ArkType 兼容 schema 校验 + TypeBox/Zod 门面 + `fromJsonSchema` | **reuse directly（可用但建议不引入）** | 唯一 Node 原生包：发的是编译后 ESM，`engines.node>=20`，零依赖。**Node 24 `import()` 成功**（25 个导出：`type`、`Type`、`fromJsonSchema`、`irToJsonSchema`…）。但 Novelive 已定 `pi-schema`；omptype 与 pi-schema 的 `TSchema`/`Static` 不完全兼容，混用两套 schema 是自找麻烦。想要它的 `fromJsonSchema`（JSON Schema→schema）思路可抄。 |
| `@oh-my-pi/pi-wire` | collab 实时会话协议的纯 JSON 类型 | ignore | 0 个 `Bun.*`，纯类型，但内容是 omp collab 房间/共享会话的协议，跟 Novelive 无关。 |
| `@oh-my-pi/pi-natives` | Rust N-API 原生能力：ripgrep 引擎、find/glob、SIXEL、音频、WebRTC、IPC、PDF→Markdown、二进制补丁、文件锁 | ignore | 唯一发 `.js` 的包，但 `loader-state.js` 用 `import.meta.dir`（Bun 专属性），**Node 24 `import()` 抛 `path argument undefined`**。功能面向它的 TUI/shell，Novelive 用不上；PDF/图像我们有自己的路。 |
| `@oh-my-pi/pi-utils` | 日志、prompt 组装、杂项工具（266 个 .ts） | copy design | Node 加载失败；散件工具库，按需抄小段。 |
| `@oh-my-pi/pi-catalog` | 模型/供应商目录（213 个 .ts）：`Model`、`Api` 联合、`getBundledModel`、`roleDefaultModels`、定价/能力元数据 | copy design | Node 失败。我们的模型目录需求小得多；抄它"按能力分模型 kind（chat/tiny/judge/search/image/tts/stt）"和"角色默认链"的数据结构设计。 |
| `@oh-my-pi/pi-ai` | LLM 流层：`streamSimple`/`completeSimple`/`stream`，海量 provider | copy design | **Node 失败**（import 指向 `.ts`，且 `stream.ts` 用 `Bun.SHA256/sleep/write`、`anthropic.ts` 用 `Bun.hash/deepEquals`）。设计可抄：`onPayload/onResponse/onSseEvent` 探针、`providerSessionState`、`maxRetryDelayMs` 上限、思考探测 `withProbedThinking`。 |
| `@oh-my-pi/pi-agent-core` | Agent/loop/事件 + **compaction 子模块** + 暂停闸、tokenizer、sent-tool-definitions | copy design | **Node 失败**（`agent.ts` 用 `Bun.env`，发布无 JS）。`agent-loop.ts`/`types.ts` 的 hook 形状和 earendil 几乎一样——正好印证我们照 earendil 写的脚手架方向对。compaction 见 §5。 |
| `@oh-my-pi/snapcompact` | "快照压缩"：把中间不重要段落渲染成 PNG 塞进上下文（image compaction） | copy design | **Node 失败**，且依赖 `pi-natives` 的 `renderSnapcompactPng`（原生）+ `Bun.stripANSI`。思路新颖（用图像承载历史，省 token），可做 Novelive 长循环压缩的候选设计。 |
| `@oh-my-pi/pi-mnemopi` | 记忆抽取/固化（Mnemopi） | copy design | 面向它自己的记忆系统；可参考其"memory 角色走 tiny→smol 链"的做法。 |
| `@oh-my-pi/omp-stats` | 用量/成本统计 + React 组件 | ignore | TUI 报表，含 React 依赖，无关。 |
| `@oh-my-pi/pi-tui` | 终端 UI（9 MB） | ignore | 终端界面，Electron 用不上。 |
| `@oh-my-pi/pi-coding-agent` | 完整编码 CLI（30 MB，1265 个 `Bun.*`） | copy design | 不是库；但 `model-roles.ts`/`model-resolver.ts`/`model-presets.ts`/`settings.ts` 的**模型角色系统**是 Novelive 五槽位最好的现成参照（§4）。 |
| `@oh-my-pi/browser-relay` / `collab-web` / `pi-metaharness` / `typescript-edit-benchmark` | 浏览器中继 / collab 前端 / 元 harness / 评测 | ignore | 全是 `private:true`，未发布，且都是 omp 产品内部件。 |

> Node 24 实测记录（`/tmp/nodetest`，`node -e "import('…')"`）：`pi-agent-core`/`pi-ai`/`pi-catalog`/`pi-utils`/`pi-wire`/`snapcompact` 报 `Stripping types is currently unsupported for files under node_modules`；`pi-natives` 报 `path argument must be of type string`（`import.meta.dir` undefined）；`omptype` 正常返回 25 个导出。

## 3. 大问题：要不要改用 `@oh-my-pi/pi-ai` + `@oh-my-pi/pi-agent-core` 当底座

**不要。** 结论由"能否运行"直接锁死，其余都是次要论据。

**反对（决定性）：**

1. **Node 跑不起来。** Electron utility process 是 Node 24，不是 Bun。omp 的包发布的是 `.ts` 源（`import: ./src/index.ts`），Node 拒绝对 `node_modules` 里的 `.ts` 做类型剥离；即便绕过，热路径里的 `Bun.env`/`Bun.SHA256`/`Bun.sleep`/`Bun.write`/`Bun.hash`/`Bun.deepEquals`（`agent.ts:871`、`stream.ts:173,355,493`、`anthropic.ts` 多处）也会让进程当场崩。要让 omp 在 Node 跑，得自己起一个 build 步骤把整套 `.ts` 编出来 + 给所有 `Bun.*` 写 shim——维护成本远超收益。
2. **它不再是库，是产品。** earendil 的 pi 明确朝着"可嵌入的库"走（1.6 加的 `cleanupSessionResources`、`registerFauxProvider`、精简依赖）。omp 往反方向走——`pi-ai` 拖进 auth-broker/auth-gateway/OAuth/usage-tracking，`pi-agent-core` 拖进 OpenTelemetry、speculative execution、intent tracing。我们嵌入要的是小而稳的循环，omp 是个操作系统。

**支持（次要看点，改变不了结论）：**

- provider 覆盖面确实大：`openai-completions`、`openai-responses`、`azure-openai-responses`、`anthropic-messages`、Bedrock、Vertex、OpenRouter、Kiro、Kimi、Codex、Mistral、`gitlab-duo-agent`、`factory-droid-agent` 等几十个（`packages/ai/src/providers/`）。自定义 `baseUrl` 是 `Model` 的一等字段，`stream.ts` 按 `api`+`baseUrl` 分派——理论上"自建 OpenAI 兼容/Anthropic 兼容网关"它能直接接。这点 earendil 也有（`openai-completions`/`openai-responses`/`anthropic-messages` + `baseUrl`），够用。
- 重试/abort 设计更成熟：`maxRetryDelayMs` 上限、`stream.ts` 的 stall 检测、`AbortError` 语义干净。这些是我们可以**抄进自己 `streamFn` 包装层**的点。
- 但 earendil 才是被当库维护的那条线，且我们的研究（`pi-scaffolding.md`）已经按 earendil 1.6.0 定好脚手架和决策。

**能不能混用（earendil `pi-agent-core` + 某个 omp 模块）？** 不能。两边的 `Model`/`Tool`/`Context`/`Message` 类型已分叉（omp 的 `Tool` 多了 `deferLoading`/`native`/`customFormat`，`Context` 多 `inactiveTools`，schema 用 omptype 不是 pi-schema）。类型层面互不赋值；而且 omp 模块在 Node 根本加载不了。混用既无运行时可行性也无类型兼容性。

**bus factor / 发布节奏：** omp 是 Stencil Labs 的商业产品 fork，发布频繁（11-17~11-20 连发 17.x/18.x/19.x），但每个 minor 都带 breaking 行为变更（CHANGELOG 全是 provider 语义改动），且从不承诺 API 稳定或向后兼容 earendil。跟踪它等于把底座绑在一个快速移动、方向不同的产品上。

## 4. 模型角色系统：omp 怎么做，能不能映射到我们的五槽位

**实现位置：** `packages/coding-agent/src/config/model-roles.ts`（角色元数据）、`model-resolver.ts`（解析+回退链）、`model-presets.ts`、`settings.ts`（`modelRoles` 分层存取）。角色 selector 用 `@<role>`（`MODEL_ROLE_ALIAS_PREFIX`，`model-roles.ts:17`），兼容旧前缀 `pi/`。

**机制：**

- 内置角色表 `MODEL_ROLES`（`model-roles.ts:51`）：`default / smol / slow / vision / plan / commit / tiny / memory / task / advisor / widget`（chat 类），加 `image / web / speech / dictation / judge`（按模型 `kind` 门控的非 chat 类）。每个角色带 `accepts(model)` 谓词，按 `modelKind(model)`（chat/tiny/judge/search/image/tts/stt）过滤候选池。
- **配置：** `settings.modelRoles.<role> = "<pattern 或 pattern 列表>"`，`settings.getModelRole(role)` 读；可分层（全局/项目/运行时 override，`settings.ts:2017+`）。pattern 可以是具体 `provider/model`、glob（`anthropic/*`）、或另一个 `@role` 别名（支持嵌套，带 `visited` 防环，`model-resolver.ts:1240`），可挂 `:thinking` 后缀。
- **解析+回退链：** `resolveRoleSelection(roles[], settings, available)`（`model-resolver.ts:1929`）按序尝试，返回第一个命中 `{role, model, thinkingLevel}`。角色没显式配时走两级兜底：`ROLE_PRIORITY_ALIAS`（advisor→slow、memory/tiny/widget→smol）和 `ROLE_CONFIGURED_FALLBACK`，最后落到 `roleDefaultModels()` 的内建目录默认链（`pi-catalog/compat/behavior`）。
- **消费：** 各功能点拿角色列表去问，不写死模型——commit 用 `["commit","smol",…CHAT]`、auto-repair、skill 描述用 `["tiny"]`、sharpshooter、在线 title 等。

**能不能映射到我们的"五槽位 + 每角色 override"：** 思路完全对应，且比我们设计得更通用。我们的"五个模型槽位"相当于它的 chat 类角色集，`resolveRoleSelection` 的"按序角色回退 + 每角色可单独 override + glob/别名 pattern + thinking 级别后缀"就是我们要的"每角色 override 落到具体模型"。差异：它把角色硬编码进 `MODEL_ROLES` 表，且 `accepts` 依赖它那套 `modelKind` 目录；我们角色是固定的五种业务角色（主控/审稿/美术导演/画师/写手），不需要它的 `kind` 门控那么宽。

**可抄的点：**（a）角色→模型的解析做成纯函数 `resolveRoleSelection(roles优先级数组, settings, 可用模型)`，返回具体 `Model`+可选 thinking level，消费方只报角色名；（b）未配置角色的**有序兜底链**（advisor→slow→目录默认），避免"没配就崩"；（c）`@role` 别名 + 嵌套解析 + 防环 `visited` 集合；（d）pattern 支持 `provider/model` 精确、glob、`@alias` 三种形式。代码本身 Bun/耦合重，只抄设计。

## 5. compaction（omp 的亮点，顺带说明）

omp 把压缩拆两处：`pi-agent-core/src/compaction/`（turn 级压缩、剪枝 `pruning.ts`、工具保护 `tool-protection.ts`、shake、各 provider 适配 `anthropic.ts`/`openai.ts`/`bedrock.ts`、token 记账 `transcript-tokens.ts`、prompt 模板）和独立的 `@oh-my-pi/snapcompact`（把历史快照渲染成 PNG 复用上下文图像能力）。`compaction.ts` 2561 行、`snapcompact.ts` 2721 行，设计成熟但深度耦合 `pi-catalog`/`pi-natives`/`pi-utils`/`Bun.*`。**结论：抄算法与分层（turn 边界切 + 工具输出保护 + 按 provider 适配），代码不可直接用。** 这正好覆盖 pi-scaffolding 里"照 pi-coding-agent 移植压缩算法"那条——om p 的 `compaction/` 是比 earendil 更全的参照实现。
