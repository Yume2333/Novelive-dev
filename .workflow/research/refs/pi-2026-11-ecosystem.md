# Pi 生态扩展调查报告

调查日期： 2026-11-21。数据来自 npm registry (`pi-package`/`pi-extension`/`pi-skill` 关键词）、pi.dev 官方 gallery、GitHub 搜索、`bubbleptr/awesome-pi`（Pi Index, 中文社区维护目录）、以及 `earendil-works/pi` 主仓库文档。

---

## 0. 生态概览

- **官方分发渠道**：npm 关键词 `pi-package` + pi.dev 包目录（`https://pi.dev/packages`，截至 2026-11 收录 ~5500+ 包，含主题/技能/提示词模板）。安装方式：`pi install npm:<pkg>` / `pi install git:<url>` / `pi -e <path>`。见 [packages.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)。
- **包格式**：一个 package 可含 `extensions/`（TypeScript 代码）、`skills/`（SKILL.md）、`prompts/`、`themes/`。`package.json` 的 `pi` 字段声明资源路径；`pi-package` keyword 让 npm 包进入 gallery。
- **扩展 API**：扩展是默认导出一个函数的 TS 模块，拿到 `ExtensionAPI`：`pi.registerTool()`、`pi.on("tool_call"/"session_start"/...)`、`ctx.ui.confirm/select/input/notify/custom()`、`pi.registerCommand()`、`pi.registerMcpServer()`、`pi.appendEntry()`。见 [extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)。
- **宿主包**：扩展运行时由宿主注入 `@earendil-works/pi-ai`、`pi-agent-core`、`pi-coding-agent`、`pi-tui`、`typebox`（应声明为 `peerDependencies: "*"`）。
- **嵌入相关性**：`pi-coding-agent` SDK（`createAgentSession()`）可以加载文件/内联扩展（`DefaultResourceLoader` + `extensionFactories`）。**多数社区扩展是 CLI/TUI-only**，因为用 `ctx.ui` 渲染；在 RPC 模式下 dialog 方法走 `extension_ui_request`/`extension_ui_response` 子协议，`ctx.ui.custom()` 返回 `undefined`（见 [rpc-extension-ui.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc-extension-ui.md)）。纯 `pi-agent-core` 宿主（不含 coding-agent 的 session/tools/TUI 层）**不能**直接跑 coding-agent 扩展——它们注册了 coding-agent 的工具与会话钩子。

**关键结论**：对 Novelive（自嵌 `pi-agent-core` + 自写编排）而言，社区扩展几乎没有"直接装就能用"的库形态；价值在于**设计参考**（工具 schema、状态机、持久化格式、提示词）。少数包（pi-bifrost router、webfox、mavam 的 webfox/durable、context-mode 的 SQLite 思路）有库或独立运行时形态。

---

## 1. 按功能分组的扩展清单

### 1.1 子代理 / 编排（Novelive 最关心）

| 名称 | 链接 | 星/月下载 | 更新 | 许可 | 一句话 | CLI-only / 库可用 |
|---|---|---|---|---|---|---|
| nicobailon/pi-subagents | [github](https://github.com/nicobailon/pi-subagents) | 4.2k★ / 1.10M | 2026-11 | MIT | 最成熟的社区子代理扩展：`subagent` 工具+后台 detached runner、FleetView、内置 scout/worker/reviewer/oracle、`/council`、跨扩展事件 | **CLI-only**（peer 依赖 pi-coding-agent+pi-tui） |
| tintinweb/pi-subagents | [github](https://github.com/tintinweb/pi-subagents) | 1.5k★ / 85k | 2026-11 | MIT | Claude Code 风格 `Agent`/`get_subagent_result`/`steer_subagent`，markdown 定义 agent 类型、`SubagentWorkflow` 确定性 JS 编排（`agent()`/`parallel()`/`pipeline()`）、嵌套子代理、worktree 隔离、定时任务、跨扩展 RPC | CLI-only |
| @fitchmultz/pi-subagents | [github](https://github.com/fitchmultz/pi-subagents) | — / 14k | 2026-11 | MIT | 极简：`delegate`+`agent_runs` 两工具；overseer 模式加 contract scoping、mid-run review、diff review | CLI-only |
| fitchmultz/pi-codex-goal | [github](https://github.com/fitchmultz/pi-codex-goal) | 207★ | 2026-11 | MIT | Codex 风格 goal tracking/continuation | CLI-only |
| mavam/pi-agents | [github](https://github.com/mavim/pi-agents) | 97★ / 4.2k | 2026-11 | MIT | **建在 pi-durable 上**：durable 命名 agent、agent graph、agent 间 message、可恢复 | CLI-only（但思路直接可借 durable） |
| boadij/pi-herdsman | [github](https://github.com/boadij/pi-herdsman) | 241★ / 11.5k | 2026-11 | Apache-2.0 | pi↔herdr 编排层：Manager→Lead→Agent 委派、权限/所有权边界、"定义边界不定义流程" | CLI-only + 依赖 herdr |
| QuintinShaw/pi-dynamic-workflows | [github](https://github.com/QuintinShaw/pi-dynamic-workflows) | — / 81k | 2026-11 | MIT | 一个请求→生成 JS 编排脚本→fan-out 隔离子代理→按任务路由模型→交叉校验→合成结果 | CLI-only |
| EremesNG/thoth-agents | [github](https://github.com/EremesNG/thoth-agents) | — / 2.9k | 2026-11 | MIT | 一个 Orchestrator + 五个固定 specialist 的"比例化 SDD"工作流（多 harness：OpenCode/Codex/Claude/Pi） | CLI-only（角色定义可借鉴） |
| pi-fabric | [github](https://github.com/fabric-runtime/pi-fabric) | 340★ / 44k | 2026-11 | MIT | 可编程工具+agent 运行时：`fabric_exec` 在 QuickJS 里跑受检 TS，统一调核心工具/MCP/agents/workflows/council | CLI-only |
| pi-crew | [npm](https://www.npmjs.com/package/pi-crew) | 57★ / 18k | 2026-11 | MIT | 协调 AI 团队、worktree、异步任务 | CLI-only |
| **官方示例** `examples/extensions/subagent` | [github](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions/subagent) | — | 随仓 | MIT | 官方示范：markdown 定义 agents（scout/planner/reviewer/worker）+ 子进程 spawn `pi` + 并行流式 + workflow prompts（scout→plan→implement→review） | 示例代码，可移植 |
| **官方 p2 插件** `apps/p2/plugins/subagents` | [github](https://github.com/earendil-works/pi/tree/main/apps/p2/plugins/subagents) | — | 随仓 | MIT | pi-durable 上的持久后台子代理：conversation handle、message、location（env+cwd）、task anchor | durable 插件形态 |
| **官方 codemode `tools.agent`** | [workflows.md](https://github.com/earendil-works/pi/blob/main/apps/p2/docs/workflows.md) | — | 随仓 | MIT | codemode 脚本里 `await tools.agent({prompt,schema,model,tools})` 一次性子代理，schema 校验结果、fan-out+对抗验证的官方配方 | durable/p2 |

**对 Novelive 的要点**：两个主流社区实现（nicobailon、tintinweb）都是"extension 注册 `subagent`/`Agent` 工具 + 子进程/子 session + TUI widget"。它们解决的正是 Novelive 要自己做的事——但代码绑在 coding-agent 的 session/transport 上。值得读的是：**agent 定义 markdown frontmatter**（model、thinking、tools、`allowed_subagents` 嵌套上限）、**workflow 脚本 DSL**（`parallel`/`pipeline`/`phase`/`gate`）、**completion notification**（后台结果作为消息回到父会话）、**worktree 隔离**、**`steer_subagent`**（运行中注入消息）。pi-durable 的 `tools.agent` + `subagents` 插件是"官方 2.0"路径，与 Novelive 的"会话=conversation、角色=独立子会话"模型最吻合。

### 1.2 规划 / Todo / 计划模式

| 名称 | 链接 | 星/月下载 | 更新 | 许可 | 一句话 | CLI-only |
|---|---|---|---|---|---|---|
| @narumitw/pi-plan-mode | [github](https://github.com/narumiruna/pi-extensions) | 795★(monorepo) / 40k | 2026-11 | MIT | Codex 式只读 `/plan`：阻塞 mutation、结构化问卷→可实施计划→批准后换会话执行、跨 compaction 恢复计划状态 | CLI-only |
| @tintinweb/pi-tasks | [github](https://github.com/tintinweb/pi-tasks) | 249★ / 5.6k | 2026-10 | MIT | Claude Code 式 task 工具 + 依赖 DAG + 跨会话文件锁 | CLI-only |
| @juicesharp/rpiv-todo | [github](https://github.com/juicesharp/rpiv-mono) | 966★(mono) | 2026-10 | MIT | 模型的 todo list：实时 overlay、4 状态机、依赖跟踪 | CLI-only |
| pi-plan-task | [npm](https://www.npmjs.com/package/pi-plan-task) | — / 1.4k | 2026-11 | MIT | 可配置、需批准、可恢复的 task workflow | CLI-only |
| @narumitw/pi-goal | [github](https://github.com/narumiruna/pi-extensions) | 同 monorepo | 2026-11 | MIT | `/goal` 自治单目标模式：保持工作直到完成 | CLI-only |
| @mjasnikovs/pi-task | [npm](https://www.npmjs.com/package/@mjasnikovs/pi-task) | 148★ / — | 2026-11 | MIT | 本地小模型的固定阶段编排 refine→research→grill→compose→critique，状态落盘可恢复 | CLI-only |
| gentle-pi | [npm](https://www.npmjs.com/package/gentle-pi) | — / 54k | — | — | SDD/OpenSpec + 严格 TDD 工作流 | CLI-only |

### 1.3 Ask-User / 确认（Novelive 的"确认卡片"）

| 名称 | 链接 | 月下载 | 更新 | 许可 | 一句话 | CLI-only |
|---|---|---|---|---|---|---|
| @juicesharp/rpiv-ask-user-question | [github](https://github.com/juicesharp/rpiv-mono) | 182k | 2026-10 | MIT | 最常用 ask_user：可搜索分栏选择 UI、多选、自由输入 | CLI-only（`ctx.ui.select/custom`） |
| pi-agent-ask | [github](https://github.com/alexshpunt/pi-agent-ask) | 3.3k | 2026-11 | MIT | agent 反问而不是猜，异步等回答并记住答案 | CLI-only |
| @eko24ive/pi-ask、@johnnywu/pi-ask | npm | ~2k | 2026-08/11 | MIT | `ask_user` 交互式澄清工具 | CLI-only |
| @plannotator/pi-extension | [github](https://github.com/ndom91/open-plan-annotator) | 102k | 2026-11 | MIT/Apache | 交互式计划审查+批注：给 agent 的计划/消息加 annotation，"confirm card"形态最贴近 Novelive | CLI-only |
| pi-interview | npm | — | 2026-10 | MIT | 交互式 interview 表单扩展 | CLI-only |
| 官方 `question.ts`/`questionnaire.ts`/`qna.ts` 示例 | [github](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions) | — | 随仓 | MIT | 官方示范 `ctx.ui.select/confirm/input` 的三种问法 | 示例，可移植 |

**对 Novelive**：所有 ask-user 都建立在 `ctx.ui`（TUI select/confirm/custom 组件）上，**不能**直接搬进 Electron utility process；但 RPC 模式下 dialog 走 `extension_ui_request`/`extension_ui_response` JSONL 子协议——Novelive 前端可以实现这个协议来驱动"确认卡片"。**这是最值得抄的机制**（见 rpc-extension-ui.md）。`plannotator` 的"annotate agent 输出→作为下一轮输入"是最贴近"视觉审核/审稿卡片"的社区实现。

### 1.4 记忆 / 上下文 / 压缩

| 名称 | 链接 | 星/月下载 | 更新 | 许可 | 一句话 | CLI-only |
|---|---|---|---|---|---|---|
| k0valik/pi-blackhole | [github](https://github.com/k0valik/pi-blackhole) | 300★ / 12.9k | 2026-11 | MIT | **算法式压缩替代 LLM `/compact`** + Observer/Reflector/Dropper 三个后台 worker 写 observational memory；作者明确标注 experimental、自负盈亏 | CLI-only |
| fitchmultz/pi-posthorse | [github](https://github.com/fitchmultz/pi-posthorse) | 288★ / 9k | 2026-11 | MIT | "无摘要上下文滚动"：保留 tail + 有界 recovery record + 模型写 handoff 笔记，`history`/`notes`/`new_context`/`get_context_remaining` 工具；有对照实验文档 | CLI-only |
| jonaslsaa/pi-optchat | [github](https://github.com/jonaslsaa/pi-optchat) | 449★ / 9.5k | 2026-11 | 自定义 | OptChat 摘要树持久记忆：每条消息一行、二叉树合并、每轮从 fresh context + 有界 memory view 开始，`zoom`/`date` 读原文 | CLI-only |
| chandra447/pi-hermes-memory | [github](https://github.com/chandra447/pi-hermes-memory) | 536★ / 32k | 2026-11 | MIT | 持久记忆+会话搜索+密钥扫描：SQLite FTS5、自动整合、后台学习循环、自称 368 测试 | CLI-only |
| jayzeng/pi-memory | [github](https://github.com/jayzeng/pi-memory) | 223★ | 2026-08 | MIT | 纯 markdown 长期记忆 + daily log + scratchpad，可选 qmd 语义搜索 | CLI-only |
| kunchenguid/compact-adviser | [github](https://github.com/kunchenguid/compact-adviser) | 235★ | 2026-10 | MIT | 检测"工作已完成/已记录"→提示 `/compact` 省 token | CLI-only |
| context-mode | [github](https://github.com/mksglu/context-mode) | 34k★ / 222k | 2026-11 | Elastic-2.0 | 工具输出留在本地 SQLite + sandbox/code-mode，只把 agent 要的部分放进上下文（跨 11 个 harness，HN 头条；**非 MIT**） | 独立进程+MCP，库可借思路 |
| pi-sleep-agent | npm | — | 2026-11 | MIT | 可审查的"睡眠+做梦"记忆固化循环 | CLI-only |
| pi-protokoll、pi-context-kit、pi-context-prune、@hypabolic/pi-hypa | npm/awesome-pi | 小 | 2026 | MIT | 分层协议压缩/过期工具输出替换/recall 找回原文 | CLI-only |

**对 Novelive**：压缩/记忆是 Novelive 明确要自建的。`pi-blackhole`（结构化 compile() 免 LLM 压缩 + 后台 observational worker）和 `pi-posthorse`（无摘要滚动+handoff 笔记）代表两条相反路线，都值得读源码；`pi-hermes-memory` 的 SQLite FTS5+学习循环最接近"run records + 复用经验"。

### 1.5 Web 搜索 / Fetch

| 名称 | 链接 | 星/月下载 | 更新 | 许可 | 一句话 | CLI-only |
|---|---|---|---|---|---|---|
| nicobailon/pi-web-access | [github](https://github.com/nicobailon/pi-web-access) | 1.8k★ / 1.50M | 2026-11 | MIT | 生态事实标准：20+ provider 回退链（Exa 免 key、OpenAI/Codex 复用 auth、Brave/Tavily/Firecrawl/Jina/Kagi/SearXNG/DDG…）、YouTube 理解、GitHub clone、可作为 MCP server 给别的 agent | CLI-only（工具可移植） |
| pi-mcp-adapter（同作者） | [github](https://github.com/nicobailon/pi-mcp-adapter) | 1.7k★ / 2.31M | 2026-11 | MIT | token 高效 MCP：~200 token 代理工具、惰性启动、语义 tool search、OAuth 进 keychain、Tasks 后台 | CLI-only |
| pi-mcp-extension | [github](https://github.com/irahardianto/pi-mcp-extension) | 11★ / 1.08M | 2026-11 | MIT | 全功能 MCP 客户端：stdio/SSE/HTTP、OAuth 2.1、健康检查、稳定工具名/顺序 | CLI-only |
| mavam/webfox | [github](https://github.com/mavam/webfox) | 94★ / 1.2k | 2026-11 | MIT | 多 provider 搜索/抽取/带来源回答/深研；**有独立 CLI+库形态，`webfox/durable` 可装进 durable 宿主** | **库可用** |
| @yandy0725/pi-web-tools | npm | 1.3k | 2026-11 | MIT | websearch+webfetch 工具 | CLI-only |
| @demigodmode/pi-web-agent | npm | 3.2k | 2026-11 | AGPL-3.0 | 明确 search/fetch/headless 边界的 web 访问 | CLI-only，AGPL |
| pi-researcher | [github](https://github.com/2h2d-co/pi-researcher) | — / 0.9k | 2026-11 | MIT | web 搜索+内容抓取+理解（早期 alpha） | CLI-only |

**对 Novelive**：小说改编管线（找参考、查资料）需要 web 工具。`pi-web-access` 是事实标准但绑 coding-agent；`webfox` 是少见的"库+CLI+扩展"三形态，最值得直接复用/参考。

### 1.6 模型路由

| 名称 | 链接 | 星/月下载 | 更新 | 许可 | 一句话 | CLI-only |
|---|---|---|---|---|---|---|
| iamaamir/pi-bifrost | [github](https://github.com/iamaamir/pi-bifrost) | 82★ / 2.3k | 2026-10 | MIT | 每条 prompt 按复杂度/价格/速度自动选模型；**`pi-bifrost/router` 提供独立 Router SDK**（`createRouter`，pi 为可选 peer，可独立消费） | **库可用（router 子包）** |
| pi-claude-bridge / @agimon-ai/po-claude-bridge | npm | 123k | 2026-11 | MIT | 用 Claude Code Agent SDK 当模型 provider | CLI-only |
| @gtrabanco/pi-agentic-workflow | [github](https://github.com/gtrabanco/agentic-workflow) | 25★ / 7.1k | 2026-10 | MIT | 一套 agentic-workflow skill + slash command + **per-command 模型路由** | CLI-only |
| win4r/pi-jev-router、pi-jev-model-router | npm | 小 | 2026 | MIT | Jev 判定模型在已配置模型间路由（需 TYPESAFE_API_KEY） | CLI-only |
| @pi-plugins/fast-mode | [github](https://github.com/k3dom/pi-plugins) | 2.7k | 2026-11 | MIT | fast service-tier 扩展 | CLI-only |

**对 Novelive**：per-role 模型路由（整理/主控/写手/画师各用不同模型）是自己的核心需求。`pi-bifrost` 的 router SDK 是唯一"库可用"的通用路由；`pi-agentic-workflow` 的 per-command 路由配置形态（每个命令绑定一个 model）最贴近 Novelive 的 per-role 设计。

### 1.7 沙箱 / 权限

| 名称 | 链接 | 星/月下载 | 更新 | 许可 | 一句话 | CLI-only |
|---|---|---|---|---|---|---|
| carderne/pi-sandbox | [github](https://github.com/carderne/pi-sandbox) | 312★ / 10k | 2026-11 | MIT | OS 级 bash 沙箱（Anthropic sandbox-runtime fork）+ read/write/edit allow/deny + 交互批准 | CLI-only |
| kenryu42/cc-safety-net | [github](https://github.com/kenryu42/cc-safety-net) | 2.1k★ | 2026-11 | MIT | 执行前拦截危险 git/fs 命令（`git reset --hard`/`rm -rf`/SSH key/.env），非沙箱 | CLI-only |
| @gotgenes/pi-permission-system | [github](https://github.com/gotgenes/pi-packages) | 446★(mono) / 47k | 2026-11 | MIT | allow/ask/deny 三层 + 通配 bash 规则 + MCP/skill 粒度 + 敏感路径 + **子代理 ask 转发到父 UI** + 审计日志 | CLI-only |
| DevMortimer/pi-warden | [github](https://github.com/DevMortimer/pi-warden) | 196★ | 2026-11 | MIT | Jev/OpenRouter 监督工具调用+项目规则，可离线 | CLI-only |
| a5c-ai/babysitter | [github](https://github.com/a5c-ai/babysitter) | 1.9k★ | 2026-11 | MIT | 强制 agent workforce "服从"：管理可执行工作流/校验 | CLI-only |
| pi-deltabox | npm | — | 2026-11 | Apache-2.0 | deltabox-lite 驱动的 agent-native 沙箱会话：diff/commit/abort | CLI-only |
| @themoltnet/pi-extension | npm | 2.3k | 2026-11 | MIT | Gondolin VM 沙箱执行+MoltNet 身份 | CLI-only |

**对 Novelive**：`pi-permission-system` 的"allow/ask/deny + 子代理 ask 转发到父 UI"几乎就是 Novelive"确认卡片"的安全版本；`pi-sandbox` 的 OS 沙箱思路对画师跑外部命令/图像脚本有用。

### 1.8 会话 / 持久化 / 运行记录

| 名称 | 链接 | 星/月下载 | 更新 | 许可 | 一句话 | 形态 |
|---|---|---|---|---|---|---|
| pi-session-backend-sqlite-node | [npm](https://www.npmjs.com/package/@earendil-works/pi-session-backend-sqlite-node) | 官方 | 2026-09 | MIT | **官方**：pi-agent-core session 的 Node SQLite 后端 | **库可用**（官方包） |
| @ayulab/pi-rewind、arpagon/pi-rewind | npm/github | 121★ | 2026-11 | MIT/GPL-3.0 | checkpoint/rewind：每轮一个 checkpoint，`/rewind` 回退 | CLI-only |
| pi-agent-reload、pi-agent-replicate | npm | 小 | 2026-11 | MIT | 单工具让 agent 请求运行时 reload / 自我复制并行任务 | CLI-only |
| jmfederico/pi-web | [github](https://github.com/jmfederico/pi-web) | 951★ | 2026-11 | MIT | Web UI 监督真实 workspace 里的持久 pi 会话（独立服务，RPC 驱动） | 独立 app |
| tintinweb/pi-schedule-prompt | [github](https://github.com/tintinweb/pi-schedule-prompt) | 131★ | 2026-11 | MIT | cron/一次性/后台 prompt 调度（heartbeat） | CLI-only |

### 1.9 Evals / 可观测性

| 名称 | 链接 | 星/月下载 | 更新 | 许可 | 一句话 | 形态 |
|---|---|---|---|---|---|---|
| alexshpunt/pi-coding-agent-test | [github](https://github.com/alexshpunt/pi-coding-agent-test) | 2★ / 28k | 2026-11 | MIT | 对**真实 pi 进程**的确定性 E2E 测试：TUI/RPC 传输、脚本化 assistant 响应、artifact 录制回放 | **测试库可用**（驱动真进程） |
| @langchain/langsmith-pi-extension | [github](https://github.com/langchain-ai/langsmith-pi-extension) | 6★ / 164k | 2026-10 | MIT | LangSmith tracing | CLI-only |
| @raindrop-ai/pi-agent | npm | 22k | 2026-11 | MIT | Raindrop 可观测性：subscriber/扩展自动 tracing | CLI-only + subscriber |
| @introspection-sdk/introspection-pi | npm | — | 2026-11 | Apache-2.0 | OTel GenAI 语义约定 span 的可观测扩展 | CLI-only |
| @grafana/agento11y-pi | npm | — | 2026-10 | Apache-2.0 | Grafana Agent Observability | CLI-only |
| dimk90/pi-context-view | [github](https://github.com/dimk90/pi-context-view) | 134★ | 2026-11 | MIT | 可视化 context 用量、查看隐藏部分（base prompt/工具 schema） | CLI-only |
| pi-cmux、osdy-pi、pi-powerline-footer、pi-tidy、pi-starline 等 | npm | 小-中 | 2026 | MIT | 纯 TUI 美化（status line/footer/折叠/主题） | CLI-only（对 Novelive 无直接价值） |

### 1.10 技能集合 / 工作流套件

| 名称 | 链接 | 星/月下载 | 更新 | 许可 | 一句话 | 形态 |
|---|---|---|---|---|---|---|
| narumiruna/pi-extensions | [github](https://github.com/narumiruna/pi-extensions) | 795★ | 2026-11 | MIT | 最大 monorepo：40+ 包（statusline/plan-mode/worktree/usage/lsp/firecrawl/goal/subagents/sync…） | CLI-only |
| juicesharp/rpiv-mono | [github](https://github.com/juicesharp/rpiv-mono) | 966★ | 2026-10 | MIT | rpiv-* 套件：pipeline（research→design→plan→implement→verify）、todo、ask-user-question、voice、advisor | CLI-only |
| mitsuhiko/agent-stuff | [github](https://github.com/mitsuhiko/agent-stuff) | — | 2026 | MIT | Armin Ronacher 的 15+ 小扩展（review/btw/goal/notify/todos） | CLI-only，质量高 |
| code-yeongyu/senpi | [github](https://github.com/code-yeongyu/senpi) | — | 2026 | MIT | OMO 移植的 15+ 扩展（lsp-client/ast-grep/websearch/sandbox） | CLI-only |
| pi-skillful | [github](https://github.com/jvm/pi-mono) | 1.7k | 2026-11 | MIT | skill 调用与可见性改进 | CLI-only |
| @jaybeeuu/agent-cortex | npm | 4.1k | 2026-11 | MIT | 个人 package：自定义 agents+skills+extensions | CLI-only |
| pi-shit | [github](https://github.com/ferologics/pi-shit) | 1.7k | 2026-11 | MIT | 个人捆绑（extensions+skills+Rose Pine 主题） | CLI-only |

---

## 2. 给 Novelive 的 Top 10（值得研究/借鉴）

排序依据：与 Novelive "嵌入式长运行内容管线（角色子代理+工具循环+压缩+确认卡片+run records+重试+eval）"的贴合度。

| # | 包 | 为什么值得研究 | 能直接用吗 |
|---|---|---|---|
| 1 | **earendil-works/pi `apps/p2` + `pi-durable`**（`tools.agent`、`plugins/subagents`） | "pi 2.0 支持子代理"最可能指这个：durable conversation handle + 后台持久子代理 + location/env + codemode 脚本编排（schema 校验、fan-out+对抗验证的官方配方）。Novelive 若用 pi-durable 做会话底座，角色子代理=child conversation 是官方路径 | ✅ 库（`@earendil-works/pi-durable`），实验性 |
| 2 | **nicobailon/pi-subagents** | 最成熟（1.1M 月下载）。后台 detached runner、FleetView 运行监督、内置 scout/worker/reviewer/oracle 角色、completion notification、`bg_wait`、`contact_supervisor` 决策回传——几乎覆盖 Novelive 全部角色编排需求 | 参考设计；CLI-only |
| 3 | **tintinweb/pi-subagents** | Claude Code 式 `Agent`/`steer_subagent`/`get_subagent_result`、markdown frontmatter 定义 agent（model/thinking/tools/`allowed_subagents` 嵌套）、`SubagentWorkflow` 确定性 JS 编排 `agent()`/`parallel()`/`pipeline()`/`gate`、worktree 隔离、跨扩展 RPC——**workflow 脚本 DSL 和嵌套权限边界可直接抄** | 参考设计；CLI-only |
| 4 | **pi 官方 RPC Extension UI 协议**（`rpc-extension-ui.md`） | `extension_ui_request`/`extension_ui_response` JSONL 子协议正是 Novelive "确认卡片"需要的宿主↔前端通信契约（select/confirm/input 走 RPC，TUI 才用 custom）。实现它就能在 Electron 前端渲染确认卡 | ✅ 协议规范，直接在自嵌宿主实现 |
| 5 | **@plannotator/pi-extension** | "annotate agent 的计划/输出→作为下一轮输入"的卡片式交互，最贴近"视觉审核/审稿卡"的社区形态 | 参考交互设计；CLI-only |
| 6 | **fitchmultz/pi-posthorse** | "无摘要上下文滚动"反路线：保留 tail + 有界 recovery record + 模型写 handoff 笔记 + `history`/`notes`/`get_context_remaining` 工具；有对照实验。对长内容管线比 LLM 摘要更可控 | 参考设计；CLI-only |
| 7 | **k0valik/pi-blackhole** | 算法式 `compile()` 压缩（免 LLM）+ Observer/Reflector/Dropper 后台 worker 写 observational memory。两条压缩路线之一，作者诚实地标了 experimental | 参考设计；CLI-only，实验性 |
| 8 | **chandra447/pi-hermes-memory** | SQLite FTS5 记忆+会话搜索+后台学习循环+密钥扫描（自称 368 测试），最接近"run records+经验复用" | 参考设计；CLI-only |
| 9 | **mavam/webfox** | 少见的"库+CLI+扩展"三形态 web 搜索/抽取/深研；`webfox/durable` 可装进 durable 宿主 | ✅ 库可用 |
| 10 | **@gotgenes/pi-permission-system** | allow/ask/deny + bash 通配 + MCP/skill 粒度 + 敏感路径 + **子代理 ask 转发到父 UI**——"确认卡片"的安全版 | 参考设计；CLI-only |

**荣誉提名**：`mavam/pi-agents`（durable 命名 agent+graph+消息，若在 durable 上建可直接参考其 store 设计）；`pi-coding-agent-test`（对真实 pi 进程的 E2E 测试库，可直接用于 eval 管线）；`pi-bifrost` 的 `pi-bifrost/router`（唯一库可用的通用模型路由 SDK）；官方 `examples/extensions/subagent`（最干净的 markdown-agent 定义范式）；`context-mode`（SQLite 工具输出索引，**Elastic-2.0 非 OSI**，只能借思路不能抄代码）；`a5c-ai/babysitter`（agent workforce 服从性/可执行工作流校验）。

**质量红旗**：`pi-blackhole` 作者自称"vibeslopped a lot on top"且 experimental；`pi-posthorse`/`pi-optchat` 的 memory 路线无受控对比（optchat 为自定义许可）；`pi-researcher`/`pi-deltabox`/`pi-crew` 等 0.x/alpha；大量 `@xxx/pi-*` 个人 package 单维护者、`UNLICENSED` 或无测试。star 数普遍虚高（社区半年内爆发，多数项目 <6 个月），下载量含 npm 镜像噪声——以"是否有 CI/测试/CHANGELOG"判断质量更可靠（tintinweb、irahardianto、chandra447、gotgenes 的 repo 有较完整 CI）。

---

## 3. 给我们自己开发用的扩展（用 pi 当 coding agent 跑 `.workflow/` flow-* 流程）

如果我们自己用 pi 写 Novelive 代码，这几个能直接装进 CLI 用（只列对 flow-spec/break/implement/verify 有用的）：

- `@narumitw/pi-plan-mode` — `/plan` 只读探索→问卷→可实施计划，正对 flow-spec/flow-grill。
- `nicobailon/pi-subagents` 或 `tintinweb/pi-subagents` — flow-break 拆分后并行 scout/review/implement。
- `@plannotator/pi-extension` — flow-verify 前给计划/diff 加批注。
- `pi-coding-agent-test` — 给自写扩展/流程做确定性 E2E。
- `nicobailon/pi-mcp-adapter` + `pi-web-access` — 接外部工具/查资料（research 阶段）。
- `@juicesharp/rpiv-todo`、`@tintinweb/pi-tasks` — task DAG/todo 跟踪，配合 flow-break。
- `pi-hermes-memory` 或 `pi-posthorse` — 跨会话记忆/上下文滚动，对长 `.workflow/` 会话有用。
- `pi-sandbox` / `cc-safety-net` / `pi-permission-system` — 跑 agent 时的安全网。

（主题/statusline/FleetView 等纯 TUI 包按个人口味装。）

---

## 4. 一句话总结

Pi 的社区扩展生态在 2026 下半年爆发（5500+ 包），**但几乎全部是 pi-coding-agent CLI/TUI 扩展，不能当库直接嵌进 `pi-agent-core` 应用**。对 Novelive，真正有价值的是：(a) `pi-durable`/`tools.agent`/`plugins/subagents` 这条官方"2.0"子代理路径；(b) 两个主流社区子代理扩展的 agent 定义/编排 DSL/steer/隔离设计；(c) RPC Extension UI 的确认卡通信协议；(d) blackhole/posthorse/hermes 三种压缩-记忆设计；(e) 少数库形态包（webfox、pi-bifrost/router、pi-session-backend-sqlite-node、pi-coding-agent-test）。
