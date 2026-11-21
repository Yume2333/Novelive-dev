# 研究：Agent 流水线的测试、评测与运行（无付费 Key 的 CI）

2026-11-21。任务：录制回放、确定性测试、评测框架、LLM 判分、追踪观测、用量计费、提示词版本、限流队列。对照 M0 规格（`.workflow/specs/m0-skeleton.md`）和既定设计（`pi-scaffolding.md` 通用层 1-8）。

## 一句话结论

我们的方向（自写录制回放假服务 + pi `fauxProvider` + 工具结果 cassette + SQLite 运行记录）和业界做法一致，已被 inkos、vitest-evals、durable-harness 验证。最大发现：**回放层放在 SDK `fetch` 注入点最稳**（实测见下），比 nock/msw 拦截或起一个假服务更薄、更好注入故障；**运行记录列直接照 OTel GenAI 属性命名**，评测框架一个都不装（evalite 思路可取，v1 beta 再评估）。


## 1. 录制回放 LLM HTTP（已在 Node 24 实测）

### 实测结果（/tmp/evalops-test，Node v24.18.0，openai npm 最新版）

| 方案 | 结果 | 说明 |
| --- | --- | --- |
| **`fetch` 注入点**（`new OpenAI({fetch: fn})`、`new Anthropic({fetch: fn})`） | ✅ 录制→杀服务→回放，SSE 流和图片响应逐字节一致；同 key 多请求按序消费；注入 500/截断流/abort 全部按预期；**Anthropic SDK 同样带 `fetch` 选项，SSE 流回放验证通过** | ~60 行零依赖代码 |
| **msw 3.0.7** `setupServer` | ✅ 拦截 openai SDK 的 SSE 流正常 | 但它是“手写 handler”，不是录制回放；录要自己写 persister |
| **本地假 HTTP 服务**（M0 规格原案） | ✅ openai SDK 对 `http.createServer` 假服务跑通（含流式 + images.generate + 三项能力） | 需要维持服务进程，E2E 里多一个活动件 |
| **nock 15.0.6** | ✅ `.reply(200, sse)` 回放流正常 | 老牌但生态在收缩；nock back 模式多年没大更新 |

**判定**：三种都工作。推荐 **fetch 注入层**作为单元/回放测试的主力（pi 的 `streamFn` 包装层天然同一位置），**本地假服务**作为 E2E（Playwright 真起应用，改不了注入 fetch）的第二选择。两者共用同一种 JSONL cassette 格式。

### 各库逐个判定

| 库/做法 | 许可 | 结论 |
| --- | --- | --- |
| **`fetch` 选项注入 cassette**（openai SDK `fetch` 参数；pi-ai 的 `streamFn` 同理包住） | 无依赖 | **直接拷贝**：cassette = 每行一个 JSON 条目 `{key, method, path, reqBody, status, headers, body(b64)}`，key = `sha256(method+path+canonicalBody)` 取前 16 hex。Mode: `record/replay/strict` 仿 vitest-evals。录时把请求改打到 `NL_*_BASE_URL`，响应体 tee 一份。落 `packages/creator` 测试件（通用层 7） |
| msw 3.x | MIT | **只参考**：E2E 若想不改配置注入拦截可用它（它 patch `fetch`/http），但我们已有 `novelive://` 与设置项指向假服务，不需要。若将来拦截“任意 baseURL 的用户请求”再上 |
| nock | MIT | **不要**：能用但不如 fetch 注入薄；nock back 格式私有 |
| Polly.js | Apache-2.0 | **不要**：Netflix 2021 后基本停维护（CHANGELOG 停在老版本），adapter/persister 体系过重 |
| retake（本地代理式 LLM VCR） | 见 zecrari.github.io/retake | **只参考**：思路=起本地代理改 baseURL 录制，和我们假服务一致；不建议引入新工具 |
| LiteLLM proxy cache | MIT（核心） | **不要**：Python 代理，架构不符；其“cache key 含 messages 全量 JSON”的键设计我们已用 sha256 覆盖 |
| vitest-evals `replay.ts` | Apache-2.0（Sentry） | **移植改写**：~340 行零依赖，key = `sha256(stableStringify({toolName,input,version}))` + `auto|record|off|strict` 四模式 + 录错误用例（回放重 throw）。这是**工具层** cassette（录 `draw_image` 等工具的返回），与 HTTP cassette 互补，通用层 7 照抄 |
| pi `registerFauxProvider`/`fauxAssistantMessage`/`fauxText` | MIT（pi-ai 1.6.0） | **直接拷贝（用 API）**：单测假模型首选，不碰 HTTP 层；YN 先例：faux provider + 真存储跑全流程 |
| Vercel AI SDK `MockLanguageModelV3` + `simulateReadableStream` | Apache-2.0 | **只参考**：我们不用 AI SDK；其 mock 思路（model 接口注入 fake）= pi faux provider 的等价物，印证方向 |

### 建议的 cassette schema（`tests/fixtures/llm/*.jsonl`，进仓库，脱敏后）

```json
{"key":"a1b2c3d4e5f6a7b8","method":"POST","path":"/v1/chat/completions","reqHash":"sha256-of-body","status":200,"headers":{"content-type":"text/event-stream"},"body":"<base64>","recordedAt":"2026-11-21T...","case":"chat-completions/stream-ok","tags":["sse","usage"]}
```

- 一行一交互；`case` 给人工命名（`stream-ok`/`truncated`/`rate-limited`/`moderation-blocked`），回放按 case 或按请求 key 命中。
- 录制时剥离 `authorization` 头、重写 `baseURL` 为占位符。
- 注入故障不录进 cassette，由回放层按参数触发：`inject=midcut|disconnect|cancel|http500|bad-image`——对应 M0 验收 W2 的取消/断线用例。

## 2. 确定性 Agent 测试（无真模型的分层）

业界（vitest-evals、YN、durable-harness、brigade）和我们已定的“测试三件套”一致，补齐成四层：

| 层 | 喂什么 | 来源/先例 | 判定 |
| --- | --- | --- | --- |
| **L1 假 provider** | `registerFauxProvider` 注入排好的 `AssistantMessage`（文本+工具调用），走真 agent 循环、真存储 | pi-ai 自带（MIT）；YN `piNativeCompaction.test.mjs` | **直接用** |
| **L2 工具 cassette** | 真 LLM 跑过一次的 `draw_image`/`read_scenes` 结果按参数哈希回放 | vitest-evals `replay.ts`（Apache-2.0） | **移植**：~150 行 |
| **L3 HTTP cassette** | 整条 streamFn 走录制好的 SSE；测到 SDK/解析层 | 本报告 §1 实测 | **直接拷贝** ~80 行 |
| **L4 子进程崩溃** | 真 `SIGKILL` utility process，重启验证 owner_pid 回收 + 任务续跑 | durable-harness `pi-durable-sigkill.test.ts`（Apache-2.0）；inkos `recoverInterruptedEpisodes` | **抄测试做法**，M0 崩溃横幅用例同源 |

**Monkey-patch `AgentTool.execute`**（vitest-evals `withInstrumentedAgentTools`，Symbol 防重复 patch）：不改 pi 代码就能录 transcript + 断言调用序列。**移植**进测试件，用于“写手必须先 read_scenes 再 submit”这类顺序断言。

**断言“结束状态”而非“逐条消息”**：录制回放里模型路径是确定的，但断言写到 `finishTurn` 结果、`submit_*` 参数、落库行数上，不断言中间 token——LLM 输出字节级断言脆弱（CheckEval/LLM-as-judge 文献一致建议）。

## 3. 评测框架（质量评测集 M1b 起）

| 框架 | 许可 | 形态 | 对我们的适用 | 判定 |
| --- | --- | --- | --- | --- |
| **evalite**（mattpocock） | MIT | Vitest 风格 TS runner + 本地 web UI + scorer 列表 + JSONL trace | 最贴：TS、本地、Vitest 心智、scorer=自定义函数可包 LLM judge；结果存本地 | **只参考**：M1b 质量评测集照它的 `evalite("name", {data, task, scorers})` 形状写我们项目里的 `evals/` 脚本，先不装依赖（v1 beta 观察中）。它的 scorer 签名 `{input,output,expected}` 照抄 |
| **vitest-evals** | Apache-2.0 | Vitest expect 扩展 `toSatisfyJudge` + judge/app 分离 | judge 用独立 model client + `responseFormat:{json,schema}` 结构化判定 | **移植判定模式**：judge = 快速模型槽 + pi `completeSimple` 等价物 + pi-schema rubric；`expect(score).toBeGreaterThan(0.7)` 阈值 |
| **promptfoo** | MIT | YAML 声明式 eval + 模型对比矩阵 | 声明式表格对我们不适用（我们的测试用例是整章片段+多维标注）；但“改提示词→跑对比矩阵”工作流一致 | **只参考**：不装；其 `assert` 类型表（contains/json-schema/llm-rubric/similarity）可当 rubric 清单抄 |
| **Inspect AI**（UK AISI） | MIT | Python，solver/scorer/sandbox，200+ 现成 evals | Python 栈、重型，为 benchmark 设计不为嵌入产品 | **不要** |
| **DeepEval** | Apache-2.0 | Python pytest 风格 | 同上 | **不要** |
| **OpenAI evals** | MIT（registry 数据混） | Python，大量 benchmark 数据 | 同上 | **不要** |
| **Braintrust autoevals** | Apache-2.0（库）/ SaaS | JS+PY scorer 库 `autoevals` | 纯 scorer 函数库（Factuality、Possible、Summary 等几十种 rubric 提示词现成） | **抄提示词**：`autoevals` npm 包里每个 scorer 的 rubric prompt 可读，“改编忠实度”判分提示词可改写其 `Factuality`/`ClosedQA` 模板 |

### 改编忠实度的 LLM 判分（我们的特殊需求：剧本 vs 原著）

文献与实践收敛到这套做法，全部可直接用：

1. **Rubric 多维判分**（LLM-Rubric, ACL 2024）：每个维度 1-5 分 + 一句话理由。我们的维度：原文事件保留、对白还原、角色名/术语一致、新增内容是否越权、演出指令可执行。
2. **Checklist 化**（CheckEval, EMNLP 2025）：把“忠实”拆成布尔问题清单（“这段对白出现在原文吗”“这个设定和 bible 冲突吗”），比自由打分稳。
3. **判分模型 ≠ 被测模型家族**（vitest-evals、p2 verifier 一致做法）：审稿用独立会话独立模型（已定）；评测 judge 用快速模型槽。
4. **结构化输出**：`responseFormat:{json,schema}`（vitest-evals）或我们的 `submit_*` 工具拿 `{score, reasons[], failedChecks[]}`。
5. **质量评测集**（已定 M1b）：人工标注片段（别名、伏笔、换装、超长章）+ 期望断言；改提示词或换模型后重跑比分数——正是 promptfoo/evalite 的工作流，但我们用自己的 runner 就够了，因为 data/task/scorer 三件事各是 ~50 行。

## 4. 追踪与观测（本地桌面 + SQLite，不要 SaaS）

| 项 | 许可 | 判定 |
| --- | --- | --- |
| **OTel GenAI 语义约定** `gen_ai.*` | Apache-2.0 spec | **抄属性命名**到运行记录列（见 §5 schema），不引 OTel SDK/Collector——本地单进程不需要 span 导出管线，列名对齐就行，以后想接 Langfuse 零成本 |
| **Langfuse**（自托管） | MIT core | **不要**进产品；但它值得**开发期可选**：`streamFn` 里多一个可选 OTLP exporter（几十行），开发时指向本地 Langfuse docker 看 trace 树。产品发行不依赖 |
| **Arize Phoenix / OpenInference** | ELv2 / Apache-2.0 | **不要**：Phoenix 许可非 MIT/Apache；OpenInference 属性集与 OTel GenAI 高度重叠，跟官方 semconv 走 |
| **Helicone** | Apache-2.0（proxy 型） | **不要**：代理式观测，我们管道内自记 |
| **vitest-evals `NormalizedTrace`/`UsageSummary`** | Apache-2.0 | **抄形状**：`{provider,model,input,output,costUsd,toolCalls,retries}` 就是我们的 usage 行核心 |
| **omp `run-collector.ts` `AgentRunSummary`** | MIT | **直接拷贝列设计**：每 chat 一步（model/provider/stopReason/各 token 项/costUsd/latency）+ 每工具计数（ok/error/blocked/timeout/aborted + 总延迟）——这就是“一步一行”的字段模板 |
| **omp `stats` 包列设计** | MIT | **抄列**：per-message usage/cost/tool 计数、`cost_unpriced` 标记、按路径分类 AgentType、日 rollup。`bun:sqlite` 实现不可抄，列设计可抄 |

## 5. 建议的运行记录 schema（对齐 OTel GenAI 命名，project.db）

两表：`run`（一次任务/章/图）+ `run_step`（一步 = 一次模型调用或一次工具调用）。列名直接借 OTel `gen_ai.*` 去前缀后 snake_case：

```sql
CREATE TABLE run (
  run_id          TEXT PRIMARY KEY,        -- nanoid
  work_id         TEXT NOT NULL,           -- 作品
  kind            TEXT NOT NULL,           -- 'chapter'|'image'|'review'|'staging'|'chat'|'eval'
  ref             TEXT,                    -- 章节号 / asset_id / volume
  status          TEXT NOT NULL,           -- 'running'|'done'|'needs_attention'|'cancelled'|'interrupted'
  owner_pid       INTEGER,                 -- 崩溃回收（inkos 同款）
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER,
  usage_input     INTEGER, usage_output INTEGER,
  usage_cache_read INTEGER, usage_cache_write INTEGER,
  cost_usd        REAL, cost_priced INTEGER DEFAULT 0,  -- 0=未定价
  error_type      TEXT, error_message TEXT,
  meta            JSON
);
CREATE TABLE run_step (
  step_id         TEXT PRIMARY KEY,
  run_id          TEXT NOT NULL REFERENCES run(run_id),
  seq             INTEGER NOT NULL,
  operation_name  TEXT NOT NULL,           -- gen_ai.operation.name: 'chat'|'execute_tool'|'generate_content'
  role            TEXT NOT NULL,           -- 整理/写手/审稿/美术导演/立绘画师/.../judge/compaction
  purpose         TEXT,                    -- omp model_usage 的 purpose：'script'|'compaction-summary'|'image-gen'|'qa'
  provider_name   TEXT, request_model TEXT, response_model TEXT,   -- gen_ai.request.model / response.model
  response_id     TEXT,                     -- gen_ai.response.id
  finish_reasons  JSON,                     -- gen_ai.response.finish_reasons
  usage_input INTEGER, usage_output INTEGER,
  usage_cache_read INTEGER, usage_cache_write INTEGER,
  usage_reasoning INTEGER,                  -- gen_ai.usage.reasoning.output_tokens
  cost_usd REAL, cost_priced INTEGER DEFAULT 0,
  ttfc_ms INTEGER, duration_ms INTEGER,     -- time_to_first_chunk
  retries INTEGER DEFAULT 0,
  tool_name TEXT, tool_call_id TEXT,        -- gen_ai.tool.*（execute_tool 行）
  status TEXT NOT NULL,                     -- gen_ai.response.status: completed/failed/cancelled
  error_type TEXT, error_message TEXT,
  content_ref TEXT,                         -- 大内容外置（spill）引用，消息本体进会话存储不进本表
  started_at INTEGER NOT NULL, ended_at INTEGER
);
CREATE INDEX idx_step_run ON run_step(run_id, seq);
CREATE INDEX idx_step_tool ON run_step(run_id, tool_name);
```

要点：①`run` 行 = inkos `creative_episodes` 同款 owner_pid 回收；②`run_step` 的 `role/purpose` 列吸收 omp `model_usage` journal 的“转录外调用也记账”（压缩摘要、会话标题）；③`cost_priced=0` 标未定价请求（omp stats `cost_unpriced`）；④模型内容不进本表——内容在会话条目树/spill，`content_ref` 挂引用（OTel `*_ref` 属性同款做法）。

## 6. 用量计费与价格目录

| 源 | 许可 | 判定 |
| --- | --- | --- |
| **pi-ai `AssistantMessage.usage.cost`** | MIT | **首选**：pi 已按内置目录算 cost，我们只落库汇总。已定方案，不变 |
| **LiteLLM `model_prices_and_context_window.json`** | 仓库 MIT（数据文件随仓库） | **抄数据源**：单文件 ~2.3MB JSON，2341 模型 × {input_cost_per_token, output_cost_per_token, cache_read/write_input_token_cost, max_input_tokens, litellm_provider}。用户填的模型名命中 → 自动填上下文长度（M0 设置页已有此需求！）+ 未定价标记。**打包一份精简版**进 `packages/creator`（开发默认模型 + 常见中转模型 ~200 条 ~50KB），全量不打包 |
| **models.dev**（sst/anomalyco） | MIT | **备选数据源**：`api.json` 全量目录（context/output/price/capabilities），按 provider 组织；若 LiteLLM 文件结构不合可换这个，更新频率高 |
| omp `pi-catalog` `models.json`/`calculateCost` | MIT（npm 只发 .ts，Node 24 加载不了） | **不装包，抄思路**：它和 LiteLLM 目录同构 |
| 注意 | — | 中转/自托管端点的价格和上游不一定一致；**cost 只作统计参考**（已定“花费只做统计参考”），`cost_priced=0` 兜底 |

## 7. 提示词管理与版本

| 做法 | 来源 | 判定 |
| --- | --- | --- |
| **提示词 = 仓库文件 + git 历史** | Langfuse/LangSmith 之外的业界共识（Kipt/LLMOps.si 指南） | **采用**：`packages/creator/prompts/{role}.md`（或 .ts 模板），版本就是 git；运行记录里记 `prompt_version = git hash 或内容 sha256 前8位`（OTel `gen_ai.prompt.name`/`prompt.version` 对齐）——M1b 评测集回归靠这列定位是哪个提示词版本跑的 |
| Langfuse prompt registry | MIT | **不要**：服务端依赖 |
| LangSmith / Braintrust registry | 商业 | **不要** |
| Frontmatter + 变量插值 | omp `pi-utils` `parseFrontmatter`/`prompt.render`（MIT，Bun 依赖只在外壳） | **移植**：提示词文件带 YAML frontmatter（模型参数、温度、版本号），js-yaml 替换 bun YAML；`{{var}}` 插值 ~50 行自写 |
| 运行时改提示词 | 设置页高级设置（M1b 写手预设） | 用户覆盖存 `project.db` `prompt_override` 表 `{role, base_version, content, updated_at}`；运行记录记实际用的版本号 |

## 8. 限流队列（出图/文本批量调用）

| 库/做法 | 许可 | 判定 |
| --- | --- | --- |
| **p-queue** | MIT（sindresorhus） | **直接装**：`new PQueue({concurrency: 8})` 就是“同时出图数”；`interval/intervalCap` 给限流型中转加每分钟上限。零依赖、EventTarget、带 `timeout`/`throwOnTimeout` |
| **bottleneck** | MIT | **不要**：更全（Redis 集群、reservoir 令牌桶）但我们不需要集群；p-queue 已够，别带第二个并发库 |
| **SQLite 持久任务队** | node:sqlite | **自写 ~100 行**：出图队列表 `image_job(asset_id PK, chapter, state 'pending'|'running'|'done'|'failed', depends_on, retries, owner_pid, payload JSON)`，`BEGIN IMMEDIATE ... UPDATE ... RETURNING` 原子领取（SQLite forum 标准做法；DurableQ/zeroexp 文章同款 SQL）。重启时 pending/running 还在库里 → 续跑；“基准图画完差分才开始”就是 `depends_on` 自引用。workpool/graphile-worker 之类不装 |
| emremy/DurableQ | MIT | **只参考**：证明 node:sqlite 队列可行，但它为 worker_threads RPC 设计，我们 utility process 单线程直接用 SQL 即可 |
| 出图并发来自队列worker数 | — | 与“同时出图数=8”对齐：spawn min(8, pending) 个 worker 循环领 job；文本调用不入此队（已定文本不限并发） |

## 9. 和我们现有设计的冲突或缺口

1. **M0 规格 §71「本地假服务」建议收窄为“fetch 注入 cassette + 可选假服务”**：实测证明 fetch 注入层能完成同样的回放+故障注入且更薄（不起进程）。假服务仍保留给 E2E（Playwright 起真应用时改不了 SDK 构造参数——不过可以：M0 的 `model.testText` 走我们包的 streamFn，可在 dev/test 模式下注入 cassette fetch）。建议：单测用 fetch 注入，E2E 两种都支持，`NL_REPLAY_DIR` 环境变量切。
2. **录制格式缺口**：M0 只说“录制文件”，没定 schema。建议采用 §1 的 JSONL cassette（一行一交互、case 命名、请求体 sha256 作 key）——handoff-defaults 里“定义录制文件 schema”这条已有着落。
3. **运行记录 schema 缺口**：`novelive-agent.md` §25 只定了 usage 行的字段，没有“一步一行”的 step 表、没有 run 表的 owner_pid/状态机、没有 cost_unpriced 标记。§5 schema 补齐（inkos+omp+OTel 三源合一）。
4. **judge/评测 runner 缺口**：决策已立“质量评测集 M1b 起”，但没有 runner 形状。建议照 evalite 的 `data/task/scorer` 签名 + vitest-evals 的 judge/app 分离写 `packages/creator/evals/` 内部模块，不装框架。
5. **pi-durable 的 `replay:'safe'|'never'` 语义我们漏了**：durable-harness/inkos 都强调“已持久化副作用的工具崩溃后不可重跑”。我们的 `draw_image` 写文件后有副作用——出图队列 job 表要把“已落盘”和“调用中”分开，`interrupted` 状态回收时查文件是否已存在再决定重跑还是标完成。这已在 inkos 模式里暗示，但我们文档没写明。
6. **cost 列名冲突**：M0/现文档写 `cost.total`（pi-ai 字段名），OTel/omp 用 `cost_usd`。统一建议列 `cost_usd REAL` + `cost_priced INTEGER`，pi 的 `cost.total` 映射进来。
7. **E2E 回放取消注入缺实现路径**：W2 要求“回放注入取消时这次测试被中止”。取消是 UI→创作端 AbortSignal，不是服务端行为——录制层不用管取消，只回放普通响应，取消用例 = 起慢流（回放 chunk 间插 delay）+ 前端 abort。cassette 需支持 `delayMs` 字段。
8. **prompt 版本列**：运行记录/usage 行缺 `prompt_version` 列（§7），M1b 对比实验必需。
9. **图片 b64 入 cassette 体积**：一张图 b64 ~几百 KB–几 MB，JSONL 单条目会很大。建议 `body` 超过 256KB 时外置文件 `cassette-files/<sha>`，cassette 行只留引用（spill 模式同款）。或图片接口单独用二进制录制目录。
10. **不缺 but 确认**：Anthropic Messages 格式走 pi-ai 不经过 openai SDK——cassette fetch 注入点在 pi `streamFn` 包装层依然有效（streamFn 内部是我们可控的 fetch/SDK 构造），需要 pi-ai 支持注入 fetch 或我们把 http 层也包进 cassette。已确认 openai SDK 有 `fetch` 选项；Anthropic SDK 同样有 `fetch` 选项（官方参数），HTTPS 层一致。

---

## 采纳清单（排序）

1. **fetch 注入 cassette**（~80 行自写，通用层 7）— 录制/回放/strict 三模式，sha256(method+path+body) key，SSE 逐字节回放已实测。
2. **pi `registerFauxProvider` + `fauxAssistantMessage`**（MIT，现成）— 全部角色单测的假模型。
3. **vitest-evals `replay.ts` 工具 cassette**（Apache-2.0 移植 ~150 行）— `draw_image` 等工具结果按 `sha256(toolName+input+version)` 回放，四模式含错误录放。
4. **运行记录两表 schema**（§5，OTel GenAI 命名 + omp run-collector 列 + inkos owner_pid）— 通用层 3 直接采用。
5. **p-queue**（MIT 装包）— 出图并发与可选每分钟限流；队列本体是 SQLite job 表自写 ~100 行（原子领取 + depends_on + owner_pid 回收）。
6. **monkey-patch AgentTool.execute 录 transcript**（vitest-evals 做法）— 测试件，断言调用顺序。
7. **SIGKILL 崩溃测试**（durable-harness 做法）— 真杀 utility process 验证回收续跑，M0 横幅+E2E 同源。
8. **LiteLLM prices JSON 精简打包**（MIT 数据）— 模型名命中自动填上下文长度 + 计价；`cost_priced` 标记。
9. **提示词 = 仓库文件 + git 版本 + run_step.prompt_version 列**（共识做法 + omp frontmatter 移植）— M1b 评测回归基线。
10. **evalite 形状的自写 eval runner**（MIT 只参考）— `data/task/scorer` + rubric scorer 函数，judge 走快速模型槽 + pi-schema 结构化输出。
11. **LLM 判分多维 rubric + checklist**（LLM-Rubric/CheckEval 文献 + autoevals 提示词改写，Apache-2.0）— 改编忠实度、审稿质量、视觉 QA 文字部分。
12. **`withInstrumentedAgentTools` 模式断言**（vitest-evals）— 顺序/参数断言不打字节级内容断言。
13. **cassette 大体外置**（omp spill 模式）— 图片响应 >256KB 进 `cassette-files/`。
14. **可选 OTLP exporter 挂 streamFn**（OTel GenAI semconv，开发期指向本地 Langfuse）— 不进产品依赖。
15. **prompt_override 表**（自写）— 用户高级设置覆盖内置提示词，版本号进运行记录。

## 不装/不抄汇总

Polly.js（停维护）、nock（被 fetch 注入取代）、msw（备选）、retake、LiteLLM proxy、Inspect AI、DeepEval、OpenAI evals、promptfoo（只抄工作流）、Braintrust SaaS、Helicone、Phoenix（ELv2）、Langfuse 产品依赖、bottleneck、DurableQ、pi-durable 本体（已定）。
