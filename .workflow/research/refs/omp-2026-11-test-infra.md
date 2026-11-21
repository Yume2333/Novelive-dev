# oh-my-pi 测试与基准基建 — 可移植清单

调查 HEAD：/tmp/omp-src @ fbb8085。对照 `.workflow/specs/m0-skeleton.md` 测试节（第 69–74、92–95 行：录制回放假服务 + Vitest 单测 + Playwright e2e）。

## 一、测试目录总览

| 目录 | 文件数 | 总规模 | 形态 |
|---|---|---|---|
| `packages/agent/test/` | 57 个 .test.ts + helpers.ts + utils/2 个假工具 | ~30,200 行 | 全部 `bun:test` + `createMockModel`；无真 HTTP、无 snapshot 文件 |
| `packages/ai/test/` | ~600 个 .test.ts + helpers/ fixtures/ data/ registry/ providers/ | ~212,600 行 | provider 级，mockFetch 注入 + `E2E=1` 门控真调用（`oauth.ts`） |
| `packages/coding-agent/test/` | ~700 个 .test.ts + helpers/(27 个) + mcp-host/ rpc-wire/ 假进程 | 最大 | 会话级，`utilities.ts`+`helpers/` 做隔离 HOME/假时钟/假 fetch |
| `packages/metaharness/test/` | 6 个 .test.ts | ~1,000 行 | benchmark 适配器的纯函数单测 |
| `packages/typescript-edit-benchmark/test/` | 2 个 | 298 行 | hunks/verify 纯函数单测 |
| `packages/snapcompact/test/` | 1 个 | 2,164 行 | 压缩管线单测（构造消息夹具直调模块函数，不经 agent） |

没有 `__snapshots__` 目录、没有录制回放框架（omp 的「回放」测试如 `agent-session-openai-responses-replay.test.ts` 是手工构造 `ProviderPayload` 夹具，非磁带录制）。**omp 的测试风格：provider 用剧本式 mock，HTTP 用 mockFetch 注入，真调用一律 `E2E=1` 显式开关**。我们的「录制回放假服务」设计（M0 第 71 行）反而比 omp 更进一步——omp 没有这个，vitest-evals 的 cassette 思路（已在 pi-scaffolding.md 记录）才是正源。

## 二、值得移植的 helper / 模式（逐条）

### 1. MockModel —— 剧本式假 provider ★核心
- **什么**：实现 `Model<"mock">` 接口的假模型。`createMockModel({ responses: [...] })` 按次消费剧本；handler 可为静态 `MockResponse` 或 `(context, options) => MockResponse` 函数（能断言收到的 context）；支持 `Iterable`/`AsyncIterable` 剧本（generator 可边跑边决定下一个回复，如 `pauseForever()`/`leakForever()`）；`push()` 中途加剧本；`calls[]` 记录每次调用供断言；`MockResponse` 字段覆盖 content 块（text/thinking/toolCall，toolCall 参数自动 JSON 序列化）、stopReason、usage、`throw`、`delayMs`（honor AbortSignal）、`responseHeaders`+`onResponse` 回调。
- **路径**：`packages/ai/src/providers/mock.ts`，531 行。
- **依赖**：`AssistantMessageEventStream`（`packages/ai/src/utils/event-stream.ts`，273 行，无 Bun API）、`classifyModel`（pi-catalog，可 stub 成 `{family:"mock"}`）、`registerCustomApi`（可删，earendil pi-ai 有 `registerFauxProvider`）、无 Bun API。
- **判定**：**移植改写**。earendil 的 `fauxProvider` 已给剧本能力（pi-scaffolding.md 第 18 行），但 omp 版多三样我们要的：函数式 handler（断言请求内容）、`calls[]` 记录、`delayMs`+abort 测试取消路径。取这三点补在 fauxProvider 外面一层薄封装即可，不必全抄 531 行。落点：`packages/creator/testkit/faux-model.ts`。

### 2. Agent loop 测试驱动模式
- **什么**：`agentLoop(prompts, context, config, signal, streamFn)` 直接吃 mock.stream，断言「事件序列」（`agent_start/turn_start/message_start/...`）+ 最终消息数组 + `mock.calls` 长度三件套。`makeEchoTool(executions)` 模式：最小 schema 工具只记录参数返回 echo。raw `AssistantMessageEventStream` + `queueMicrotask(push)` 可手工编排事件流（测部分 toolcall 后 abort）。
- **路径**：`packages/agent/test/agent-loop.test.ts`（8,683 行，是模式教科书，本身别抄）；`helpers.ts`（51 行：`createUserMessage`/`createAssistantMessage`/`ZERO_USAGE` 夹具）；`test/utils/calculate.ts`、`get-current-time.ts`（最小假工具范本）。
- **判定**：**移植改写**。三件套断言形态 + echo 工具 + 手工推流，直接对应我们 role runner 的 submit_* 工具测试。落点：`testkit/loop-assert.ts` + `testkit/echo-tool.ts`。

### 3. Abort / race 测试模式
- **什么**：① 提供器调用前 `queueMicrotask(() => controller.abort())` 测最前取消；② 手工 streamFn 推到一半 abort（`agent-loop.test.ts:2627-2707` 测 toolcall 未完成时丢弃）；③ `delayMs` 剧本配合 abort 测"挂起中取消"；④ abort 后断言 `stopReason==="aborted"` 且 `errorMessage` 携带自定义 reason（`controller.abort("Interrupted by user")` 透传）。
- **路径**：`packages/agent/test/agent-loop.test.ts` L563-660、L2627-2710、L2992-3110；`packages/ai/test/abort.test.ts`（213 行，真 API 版同款思路：`text>=50 字就 abort` 模式）。
- **判定**：**只参考**（模式搬，代码不能搬——强耦合 agentLoop）。对我们的确认门取消、`call(command, payload, signal?)` 取消路径直接可套。M0 W2 已要求"回放注入取消时测试被中止"，此模式正好实现。

### 4. 压缩（compaction）测试分层
- **什么**：分三层：① 纯函数层——`resolveThresholdTokens`/`shouldCompact` 等直接喂 `CompactionSettings` 对象断言数值边界（`compaction-fixed-threshold.test.ts`，44 行，最干净的示范）；② 编排层——mock 模型跑真 compact 流程断言消息切割点（`compaction-cut-point`/`boundary`/`base-window`，各 ~100-175 行）；③ 遥测层——断言 compaction 事件字段（`compaction-telemetry.test.ts` 276 行）。
- **路径**：`packages/agent/test/compaction-*.test.ts`（14 个文件，共 ~1,900 行）；`remote-compaction.test.ts`（3,998 行，`fetchMock` 注入 fake HTTP 断言远端压缩请求体）。
- **判定**：**只参考**。分层思路直接可抄：我们的压缩也该纯函数（cut 点/阈值）与编排（summary 调用）分测。代码别搬——omp 的压缩实现本身复杂得多（native/server-side/v2-streaming 我们都不要）。

### 5. mockFetch / asGlobalFetch
- **什么**：把 `(input, init) => Response` 包成 `FetchImpl`，或加 `preconnect` 冒充全局 fetch。配合 compaction 测试里"逐请求断言 URL/body 再返回 SSE 字节"的写法。
- **路径**：`packages/coding-agent/test/helpers/fetch-mock.ts`（18 行）、`packages/ai/test/helpers/fetch-mock.ts`（8 行）。用法范例：`agent/test/remote-compaction.test.ts` L794 起。
- **判定**：**直接拷贝**（改成 node 类型即可，无依赖）。这是我们录制回放假服务的最小实现骨架：回放 = mockFetch 从录制文件读 SSE chunk 流回。落点：`testkit/fetch-mock.ts`。

### 6. fake-clock 驱动器
- **什么**：`vi.useFakeTimers()` 下驱动真实异步：`drive(work, holdClock)` 每事件循环 tick 拨 1ms、`driveTurn(session, work)` 跑到 `agent_end` 停表、`until(condition)` 等异步静默点、`flush(turns)`、`elapse(ms)`。带 testGeneration 防跨测试泄漏。93 行。
- **路径**：`packages/coding-agent/test/helpers/fake-clock.ts`。
- **判定**：**移植改写**（`Bun.sleep`→`setTimeout`，`bun:test`→vitest，其余纯 node）。我们若有 debounce/idle 触发（如确认卡超时、后台综合）会用到；若没有定时行为可缓做。落点：`testkit/fake-clock.ts`。

### 7. until() 条件等待
- **什么**：先空转 500 个 microtask（多数内存内操作在期间完成），再 2ms 轮询 + 2s deadline 抛带标签错。假时钟下也能跑。
- **路径**：`packages/coding-agent/test/mcp-host/scripted.ts` L41-50（该文件其余是 MCP 专用，不要）。
- **判定**：**直接拷贝** 10 行。落点：`testkit/until.ts`。

### 8. 隔离 HOME / 会话夹具
- **什么**：`cleanupTempHome(getState)` 还原 `process.env.HOME` 并递归删临时目录；`createInMemoryAuthStorage()` 用 `Database(":memory:")` 隔离凭证库；`getTestModel(provider, predicate)` 从 catalog 按行为选模型而非写死 ID（抗 catalog 变动）；`createTestSession` 全套真对象（Settings/AuthStorage/SessionManager/AgentSession）+ tmpdir 模式。
- **路径**：`helpers/temp-home-cleanup.ts`（24 行）、`helpers/agent-session-setup.ts`（61 行）、`helpers/model-fixtures.ts`（11 行）、`test/utilities.ts`（137 行）。
- **判定**：**移植改写**。把 `bun:sqlite`→`node:sqlite`、AuthStorage→我们的 project.db。对我们的 creator 进程测试：tmp HOME + `:memory:` SQLite + 真 role runner = 同款中量测试。落点：`testkit/tmp-env.ts`、`testkit/session.ts`。

### 9. 请求侧断言：捕获 provider context
- **什么**：`streamFn: (_model, context) => {...}` 自定义实现把每次请求的 `Context` 存数组，断言发给模型的消息形状（`sent-tool-definitions.test.ts` L56-70）；MockModel 函数式 handler 同样拿得到 context。这是 omp 测"提示词发出什么"的方式——**没有文件快照，全是结构断言**（tools 数组、messageIndex、角色序列）。
- **判定**：**只参考**。我们要测提示词组装（主控系统提示词塞了什么）时用这个，比快照文件耐 refactor。可在 faux 封装里加 `onRequest(context)` 钩子，几行。

### 10. CI 分桶 + 计时驱动分片
- **什么**：`scripts/ci-test-ts.ts`（1,375 行）把 coding-agent 700 个测试文件按路径正则+内容标记分 4 桶（singleton 全局态/ui/runtime/native），每桶再按历史耗时文件 `omp-test-timings.json` 最重优先装入 chunk（防单进程 OOM、慢文件不聚堆）；junit 报告回写耗时。GitHub workflow `ci.yml`（1,254 行）把桶摊成并行 job，`bun test --only-failures` 安静模式、--smoke-test 冒烟 job。
- **判定**：**只参考**。规模差三个数量级——我们只要：`test` 与 `test:e2e` 分开、junit/耗时文件留接口、单测禁真网（现在 M0 已这么定）。分桶逻辑等我们测试过百再说，别提前搬。

## 三、typescript-edit-benchmark：机制与我们的复用判定

**机制**（`packages/typescript-edit-benchmark/src/`）：
- `mutations.ts`（1,599 行）：Babel AST 变异库，8 类变异（operator/literal/access/call/regex/unicode/identifier/duplicate）给真实 TS 文件植入小 bug。
- `generate.ts`（1,269 行）：扫 pi-mono 仓库文件→选难上下文（重复行、300+行、相似块、深嵌套）→应用变异→`hunks.ts` 把变异渲染成"替换 oldBlock 为 newBlock"的任务，**并反解 hunk 证明提示词有唯一字节级答案**（`solveRenderedHunks`）；按难度分 easy/medium/hard/nightmare 四级（差别在给的定位信息多少）。
- `tasks.ts`（263 行）：fixtures 目录或 tar.gz 加载 `EditTask`（inputDir + expectedDir + prompt + metadata）。
- `verify.ts`（338 行）：expected vs actual 逐文件 diff；**字节级精确匹配为主**，另有 indent distance 评分、空行归一化（语义空白扩展名清单）、compact diff 生成。
- `in-process-client.ts`（229 行）+ `metaharness/adapters/edit/runner.ts`（2,185 行）：跑法——把 inputDir 复制到 scratch，in-process AgentSession 喂任务提示词（`benchmark-system.md`/`benchmark-task.md` Handlebars 模板），模型自由用 read/edit 工具改文件，跑完 verify 目录 diff；`earlyStopOnMatch` 每事件后提前 verify 匹配即 abort；支持 retry（`benchmark-retry.md` 二次提示）、`runsPerTask` pass@k、并发。
- 度量：pass/fail per task（exact diff）、indent score、token/cost/时长，report.md 汇总。

**对我们 writer/director 的复用判定**：**机制只参考，不搬；但骨架思路可直接造我们的场景评测**。
- 不适用点：它测的是「编辑工具调用的字节级精度」（edit 工具格式对比是它的真实目的），我们写手输出 `.nvs` 全文不是 patch，导演输出结构化 JSON 提案，没有"diff 一个目录"的评分面。
- 可搬的点：① **夹具结构 inputDir/expectedDir + metadata.json 原样可用**——把"输入"换成书稿章节文件+"expected"换成金标改写结果；② **verify 的归一化比较**（行尾差异、空行、indent distance）可改造成 `.nvs` 的行级对齐比对（我们的 diff 维度是句子 ID 对齐，novelive-agent.md 第 108 行已有比对规格）；③ **"提示词必须唯一确定答案"的自校验**（solveRenderedHunks）思路值得抄——金标夹具生成时反解一遍防出"多解"题；④ 难度分级按"提示词给多少定位信息"划分，比我们按文本长度分级更贴模型失误模式。
- 结论：**不要**移植该包；M2 做评测集时用它的夹具组织 + 自校验思路，写一个 ~200 行的 `eval/nvs-bench`（场景：给定章节+指令→写手→按句子 ID 对齐金标，pass% + 行对齐距离）。现在 M0 不做。

## 四、metaharness：是什么、瘦身版是否值得

**是什么**（`packages/metaharness/`）：多 benchmark 的统一实验管理器。`src/store.ts`（647 行 SQLite：run/trace/experiment 表）、`src/runner.ts`（1,798 行 Harbor 编排：容器、模型路由走 host auth-gateway、trial 轮询 result.json）、`src/experiments.ts`（375 行：experiment=job 名前缀分组→arm 对比→**Rasch 式难度校准通过率投影** calibratedFinalPassPct，用兄弟 arm 的 per-task 通过率拟合难度，避免"先跑的 arm 全是水题显得 100%"）、`src/server.ts`（783 行 REST/SSE+仪表盘）、`src/benchmarks.ts`（272 行：BenchmarkDefinition/Trace/Snapshot 统一接口，edit/harbor/snapcompact 三适配器各自把原生 artifact 归一成统一行）、`src/tb/`（terminal-bench 微 VM 直跑，~1,600 行）。adapters/edit 即上一节的 runner。

**瘦身版判定**：**要，但只取 3 件共 ~150 行，不取框架**。
- 值得取：① `BenchmarkSnapshot`/`BenchmarkTrace` 的归一化行格式（run→task→pass/fail+cost+时长+dump 路径）作我们 eval 结果 JSON schema——50 行的类型约定，不写框架；② `summarizeArm` 的 **decided-trials-only 统计**（pass%、$/task、meanTrialMs 同分子分母取自同一子集，91-127 行）——12 行函数直接抄；③ `calibratedFinalPassPct`（147-190 行）在小样本多配置对比时有用，~60 行纯函数可整段搬，当我们对比两个系统提示词版本且只跑了部分题时防误读。
- 不要取：server/dashboard/SSE（我们 UI 自己渲）、SQLite store（run 结果写 JSONL 文件足够，project.db 已有表的话放一张 eval_runs 表也行但别建框架）、tb/vmon/Harbor 全套。
- 落点：`packages/creator/eval/stats.ts`（decided-only 汇总 + 校准投影两个函数）+ `eval/types.ts`（snapshot 行格式）。M0 不建，eval 集第一次跑时建。

## 五、对照 M0 规格的 gap（我们的测试计划缺什么）

M0 已有：回放假服务（W2/W3）、单测+Playwright e2e、取消/断线注入、SQLite 冒烟。对照 omp 实践，缺：

1. **剧本式 faux provider 的函数 handler 与 calls[] 断言**（上述 #1）——M0 只有 HTTP 层回放，缺"断言发给模型的 context"层；role runner 的 submit_* 循环测试需要它。补进 testkit 设计。
2. **取消的三种注入点全覆盖**（#3）——M0 W2 只写了"回放注入取消"；omp 还测 abort-before-events、abort-mid-toolcall、abort-during-delay 三个时序点。我们的 `call(..., signal)` 取消也应按这三点列用例。
3. **压缩测试分层**（#4）——骨架计划里 compaction 还没排测试项；至少把阈值/cut 点做成纯函数断言层。
4. **测试按桶隔离全局态**（#10 的雏形）——`vi.useFakeTimers`/`process.env`/单例类需要单独文件或串行桶；M0 没提。vitest 的 `pool:'forks'` + `isolate` 即可，写进 testkit README。
5. **假时钟驱动器**（#6）——若任何 idle/debounce 行为进 M0+（确认门等待、综合后台任务），需要 `drive/until` 而不是 sleep。
6. **E2E=1 式真模型开关**——omp 的 `e2eApiKey`（oauth.ts L19-28）双门：env 变量 + opt-in flag。M0 W3 真实接口录制正是这个模式，已隐含但没写成 helper；加一个 `e2eOnly()` 包装防本地误触 API。
7. **eval 结果统计的 decided-only 口径**（第四节的 summarizeArm）——以后跑 eval 集时 pass% 分母只算已完成任务，别拿 run 总数。

## 六、Top-10 排序（按对 Novelive 价值）

1. `providers/mock.ts` MockModel 剧本模式（函数 handler + calls[] + delayMs abort）→ `testkit/faux-model.ts`
2. agent-loop 三件套断言形态（事件序列 + 消息数组 + 调用记录）→ 全部 role runner 测试
3. `helpers/fetch-mock.ts` 18 行 → 回放假服务骨架，`testkit/fetch-mock.ts`
4. abort 三时序注入点模式 → `call(signal)` 取消用例清单
5. 压缩纯函数/编排分层测法 → compaction 测试结构
6. `sent-tool-definitions` 的 context 捕获断言 → 提示词组装测试（免快照文件）
7. `temp-home-cleanup` + `:memory:` SQLite + `getTestModel` → creator 进程隔离夹具
8. metaharness `summarizeArm`+`calibratedFinalPassPct`（~110 行纯函数）→ `eval/stats.ts`
9. edit-benchmark 夹具组织（inputDir/expectedDir/metadata + 反解自校验）→ `eval/nvs-bench` 夹具规范
10. `until()` + `fake-clock.ts` → testkit 等待原语

**明确不要**：metaharness server/store/tb 全框架；typescript-edit-benchmark 包本体（mutations/hunks/in-process-client）；ci-test-ts.ts 分桶器；snapcompact 包；omp 的 stats 仪表盘。

## 七、我们设计里的 gap（除 M0 清单外）

- faux provider 与 HTTP 回放是两层，规格只写了 HTTP 层；补"模型剧本层"进 testkit 边界（否则 submit_*/finishTurn 单测只能靠录全文流式响应，写用例成本高一档）。
- 评测统计口径（decided-only、校准投影）规格没提；eval 集落地前在 spec 补一句。
- omp 无录制回放框架，我们的 cassette 设计（vitest-evals 式，pi-scaffolding.md §67 已记）是独有项，没可抄实现——确认自己写：record 时拦截 fetch 存 SSE 字节流+请求哈希，replay 按哈希取流，注入点在 FetchImpl。
