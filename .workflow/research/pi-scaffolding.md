# Research: pi 现状、生态与我们要写的脚手架

2026-11-21 调研。原始报告在 `refs/pi-2026-11-core.md`（pi 本体）、`refs/pi-2026-11-ecosystem.md`（社区插件）、`refs/pi-2026-11-products.md`（基于 pi 的产品和成熟框架）。`refs/pi.md`（1.5.2）里关于子 Agent 的结论已过时，以本文为准。

## Settled & ruled out

- **版本**：npm 最新 1.6.0（2026-11-20），全包同号，MIT，要求 Node ≥ 22.19。没有叫 2.0 的东西。
- **子 Agent 在 pi 里有了，但不在我们用的两层**：
  - `pi-agent-core` 1.6.0 仍然没有子 Agent，只有循环和钩子；子 Agent 照旧是“在工具里再起一个 `Agent`”。
  - `pi-durable`（实验性）有原生子会话：工具建一个归属于自己的子会话，换模型、摘工具，父停子停；后台子会话、挂起等外部信号、答案落地前退回重做的钩子都有。
  - `apps/p2`（自托管网页版，README 写明“很快会删”）在 durable 上做了常驻子 Agent 插件和一次性子 Agent `tools.agent`（结果按 schema 校验，失败重试 3 次），`apps/p2/docs/workflows.md` 给了四种编排：并行审查后另派模型反驳、多稿加评审、改到检查通过、搜到没有新发现。`apps/p3` 是它的后继，要 Node 26。
  - `pi-coding-agent` 的 `examples/extensions/subagent` 是每个子 Agent 起一个 `pi` 命令行进程，不适合嵌入。
- **社区插件不能直接装**：pi.dev 上 5500 多个包几乎都是 `pi-coding-agent` 命令行扩展，依赖它的会话、工具和终端界面，嵌在 `pi-agent-core` 上跑不起来。能借的是设计，不是代码。少数库形态的包（webfox 搜索、pi-bifrost 路由）我们用不上。
- **不用的包**：`chord`、`pi-env`、`pi-tui`、`pi-codemode`、`pi-telemetry`；`pi-evals` 没发布；`pi-coding-agent` 只抄压缩和会话条目树的做法（原结论不变）。
- **要注意的 pi-ai 行为**（读 1.6.0 dist 确认）：
  - **默认不重试**。`retryProviderRequest` 的 `maxRetries` 默认 0，官方 SDK 自己的重试被设成 0，`Agent` 不传这个参数。原设计“临时错误只靠 SDK/底座自带重试”实际等于不重试，要在我们的 `streamFn` 里显式传 `maxRetries`。
  - 1.6.0 新增 `cleanupSessionResources(sessionId)`：会话结束要调，否则 Anthropic 线程状态、strict 降级记录会留着。
  - 自带假模型 `registerFauxProvider`（从 `@earendil-works/pi-ai` 导出），单元测试可以直接用，和我们的录制回放互补。
  - `pi-agent-core` 已经依赖 `pi-schema`（零依赖，带 `Static` 类型推导，也能推 TypeBox 1.x 的类型）；pi 全系 1.5.0 起不再用 TypeBox。

## 基于 pi 的产品怎么做（挑和我们相关的）

| 项目 | 和我们像在哪 | 值得抄的 |
| --- | --- | --- |
| YN-translation-workshop（Electron 小说翻译，MIT） | 最像：Electron + pi-ai/pi-agent-core | 常驻子 Agent 池按任务复用会话；冷启动把进程退出时还在跑的子 Agent 标“中断”；测试用 pi 的假模型走真存储。反面：pi 跑在主进程，领域工具 460KB 单文件 |
| inkos（小说/剧本 Agent，AGPL，只看不抄） | 题材最近 | 结构化输出用“强制调一个提交工具”代替解析文本 JSON；只有调用交付工具才算结束；每轮注入由代码算的真实进度，防摘要说错；`node:sqlite` 运行账本带进程号，重启回收 |
| brigade（个人助理，MIT） | 工具权限 | `beforeToolCall` 守卫链，任何一环出错就拦；错误分类表 |
| vercel-labs/durable-harness（Apache-2.0） | 崩溃续跑 | 未完成工作带截止时间和持有者，不用心跳；工具标“崩溃后能不能重跑”；真 SIGKILL 测试 |
| stavrobot（AGPL，只看不抄） | 重试边界 | 已经落了进度的轮次失败就不重试，否则会重复副作用；压缩只在轮次边界切 |
| vitest-evals（Sentry，Apache-2.0） | 测试 | 工具结果按参数哈希录制回放；评审模型和被测 Agent 分开 |
| electric、llm-space | 压缩、运行记录 | 后台压缩带硬超时；可变内容放最新 user 消息开头，保系统提示前缀不变以命中缓存 |

OpenClaw 只用了 `pi-tui`，不嵌 pi 的 Agent，不算先例。

成熟框架里对得上的：Claude Agent SDK 的子 Agent 不继承父对话、只拿任务说明，回传文本先中和伪造的控制标记；OpenAI Agents SDK 的“Agent 当工具”（调用方拿结果继续）和逐工具 guardrail；LangGraph 的幂等键从已存状态派生（出图队列按章和素材名），重试只在一层做。

## 我们要给 pi 写的东西

都是 `pi-agent-core` 外面的一层，放在创作端，按角色分文件。

**通用层**

1. **角色运行器**：按角色建 `Agent`，设模型、系统提示、工具；`streamFn` 包一层，统一传 `maxRetries`、记用量和运行记录、会话结束调 `cleanupSessionResources`。
2. **提交工具 + 结束检查**：工具循环角色用 `submit_*` 工具交结果，参数就是输出 schema；`finishTurn` 里没交就让它继续，交了且通过校验才结束。单次调用角色（整理、写手、视觉审核）维持文本输出加校验。
3. **运行记录**：`afterToolCall`、`onResponse` 写 `project.db`，一步一行，带进程号；启动时把进程已死的“进行中”标为中断，交给“重跑被中断的任务”。
4. **确认闸门**：需要确认的工具在 `beforeToolCall` 拦下，登记提议、出确认卡；确认后由代码执行，把结果作为工具结果补回会话再继续。
5. **派子 Agent 工具**（只给主控）：按角色定义建新 `Agent`，只传任务说明，不传父对话；子 Agent 没有这个工具；回传文本先中和控制标记；父停子停。
6. **压缩**：只用于对话面板和美术导演的长循环；在轮次边界切，按 `pi-coding-agent` 的算法移植。
7. **测试件**：单测用 `registerFauxProvider`；工具结果按参数哈希录制回放；HTTP 层的录制回放照 M0 规格做。

**各角色的工具**

| 角色 | 工具 |
| --- | --- |
| 审稿 | `read_source_range`、`find_term`（术语出现位置）、`read_chapter_summary`、`submit_review` |
| 美术导演 | `read_scenes`（按场景分批读）、`list_assets`（已登记的造型、表情、变体）、`apply_staging_patch`（解析器校验，错了退回）、`submit_image_manifest` |
| 三个画师 | `read_reference`（基准图、设定字段）、`generate_image`、`edit_image`（工具内做技术检查和视觉审核，返回通过或原因）、`give_up`（用占位图并标“需要处理”） |
| 主控（对话面板） | `novelive-agent.md` 已列的读工具和 `propose`、`list_proposals`，加派子 Agent |

## Open questions

- [x] **编排底座**：继续 `pi-ai` + `pi-agent-core`，照 durable 和 p2 的设计自己写；durable 去掉实验标记后再评估。见 `decisions.md` 2026-11-21「编排继续用 pi-agent-core，不用 pi-durable」。
- [x] **Schema 库**：改用 `pi-schema`。见 `decisions.md` 2026-11-21「Schema 改用 pi-schema」。
- [x] **模型临时错误的重试次数**：`streamFn` 统一传 `maxRetries: 2`。见 `decisions.md` 2026-11-21「模型临时错误重试 2 次」。
