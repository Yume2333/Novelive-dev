# Luker 调研报告

## 一、Luker 是什么

Luker 是 SillyTavern 的**深度重构分支**（fork），定位"LLM Frontend for Power Users"，AGPL-3.0，JS（Node 24 后端 + 原生前端，非 React）。与 SillyTavern 数据 100% 双向兼容：角色卡、世界书、预设、聊天直接互拷。原创功能全部以**前端扩展**（`public/scripts/extensions/*`）+ 少量后端新增（`src/luker-dispatch/`、`src/endpoints/backends/luker-generation.js`）形式叠加在 SillyTavern 内核上。

**Luker 原创**（非 SillyTavern 继承）：多 Agent 编排器、Memory Graph、Skills、Workbench/AI 迭代、Run Panel、预设解耦、卡绑定预设、插件正则 Provider、世界书激活追踪、预设关联世界书、统一生成层、后端实时存储/增量同步/WebSocket 生成流、函数调用统一运行时（含纯文本 tool-call 降级）、聊天合并/拆分。

**SillyTavern 继承**：PromptManager 与提示词有序列表/注入位置/深度机制、正则脚本引擎骨架（placement、ephemeral、trimStrings、深度过滤）、世界书关键词/常驻/概率/递归扫描/扫描深度、swipe/分支/消息编辑、角色卡格式、slash commands、`script.js` 的 `Generate()` 主路径。

## 二、Agent/工作流编排（原创核心）

位置：`public/scripts/extensions/orchestrator/`（~100 文件）。触发时机：普通回复/continue/regenerate/swipe，在**世界书解析之后、主模型请求之前**。

五种执行模式（`main.js`、`defaults.js`）：

| 模式 | 文件 | 机制 |
|---|---|---|
| **Spec**（默认） | `spec-runtime.js` | 固定 `{stages:[{id,mode(serial/parallel),nodes}]}` 图。节点两类：**worker**（每次一次 LLM 调用，用 `luker_orch_node_output` 工具提交输出）和 **review**（只审上一阶段，`luker_orch_review_approve` / `luker_orch_review_rerun` 指名节点重跑，默认上限 2 次）。末阶段合成"编排结果"。 |
| **Single** | — | 单节点 Spec 特例。 |
| **Agenda** | `agenda-runtime.js`, `agenda-profile.js` | planner agent 持 todo 列表，通过工具调用**动态派遣 worker 池**，可并行、可根据中间结果重规划；finishing agent 合成结果。要求连接支持 function calling。 |
| **Loop** | `loop-runtime.js` | 单 agent 单会话工具循环；`finalize(capsule_text)` 是唯一正常出口。保护：maxRounds(40)、wall_clock(300s)、连续 3 轮无工具调用提前收尾（取最后文本为结果）。工具错误序列化为 `{ok:false,error,code,hint}` 的 `role:tool` 消息喂回去自愈（`ToolError`，跨模块用鸭子类型判定 `isStructuredToolError`）。 |
| **Director** | `director-runtime.js`, `director-tools.js`, `director-defaults.js`, `director-default-prompt.js` | 接管模式：主 agent 在编排器内直接产出可发送消息，主模型本轮不参与。工具循环：每轮**必须**产生至少一次工具调用，否则当失败重试（`toolCallRetryMax`）；`finalize` 正常结束，`maxRounds`(40) 兜底自动 commit。工具：`dispatch_subagent`（按 profile 配置）、`dispatch_inline_subagent`（临时定义 systemPrompt）、`await_subagents`、`cancel_subagent`、`write_message`(append/replace)、`apply_message_patches`（**context_replace**：要求 `oldString` 全文档唯一、字节级精确，失败整块回滚）、`get_draft`、`draft_search`（regex grep 草稿）、`finalize` + 全部 loop 查询工具。sub-agent 跑自己的工具迷你循环（上限 40 轮，零工具调用轮即输出），不能再 dispatch、不能 finalize。 |

默认 Director 团队（`director-default-prompt.js`）：pre-draft scouts（intent/memory/lorebook/notes_pickup/canon/epistemic 六个正交侦察）、`plot_brainstormer`、post-draft `voice_critic`/`continuity_critic`、housekeeping `notes_curator`/`memory_curator`。主 agent 决定派谁，**不是**固定流程——"direction-not-verdict"原则。

关键工程细节（对 Novelive 有直接参考价值）：
- **`<story_context>` 包装**（`director-runtime.js` 的 `buildAgentTaskMessages`）：agent 消息 = `<story_context>` + 主流程拼好的 contentPayload 消息 + `</story_context>` + agent 自己的 systemPrompt 放最后（利用 recency bias）；易变的 open-notes/skills 目录放尾部 `<runtime_state>` user 消息，**保证系统前缀字节不变以命中上游 prompt cache**。
- **first-chunk barrier**（`dispatch-barrier.js`）：同一轮并行 dispatch 多个 sub-agent 时，后续 dispatch 等第一个的首 chunk 到达再发请求，让 provider prompt cache 暖起来命中 cache-read 而非冷写。
- **sub-agent 完成通知**：完成的 sub-agent 进队列，下一轮开头以 `role:system` 消息通知主 agent，主 agent 再 `await_subagents` 取结果——异步但不轮询。
- **编排结果注入**（`capsule-injection.js`）：复用世界书注入位置枚举（before/after/atDepth）+ depth + role(System/User/Assistant) + 自定义前缀；绑定到触发楼层，swipe 同楼层**复用**结果不重复跑。
- **接管协议**：`GENERATE_TAKEOVER_DISPATCH` 事件 + `createMessageEditorHandle`（commit/abort/discard 三态，`handle.complete` promise 供内核 await）。abort=保留部分输出跳过 finalize 管线，error=commit 保留半成品。
- **tool 权限三层**：profile 默认 `tools.<ns>.<verb>` flag 树 → 每 agent override → Layer-3 自定义工具（`custom-tools`，read/write 模式，write 工具在模拟审查中默认用 simulate 替身）。

内置工具集（`loop-tools.js` 注册表）：`chat_read_range`/`chat_search`(regex)、`lorebook_search`/`lorebook_get`/`lorebook_list`/`world_book_list`/`lorebook_force_activate`、`note_open`/`note_close`，记忆图与搜索插件经 `getExtensionApi('orchestrator').registerOrchestrationTool` 注册 Layer-2 工具。

## 三、多模型/多角色

每个 agent（含每个 sub-agent）独立持有 `apiPresetName` + `promptPresetName`，为空回落编排全局默认（`settings.llmNodeApiPresetName`/`llmNodePresetName`）；解析顺序 **卡内嵌预设 → 本地预设库 → 运行时默认**（`agent-preset-resolver.js` 的 `resolveCardFirstPresetName`）。文档明确建议：侦察/规划用小模型，评审/写作用强模型。编排预设（各模式独立库）与提示词预设、连接配置是**三个独立层**，编排预设只按名字引用后两者（`docs/features/orchestrator/presets.md`）。

## 四、预设与提示词组装

- **继承**：SillyTavern `PromptManager.js`（拖拽排序的 prompt 条目列表、每条目开关/token 数、marker 条目如 chatHistory/worldInfo、深度注入 `INJECTION_POSITION`）。
- **Luker 原创**：
  - **预设解耦**（`improvements/preset-decoupling`）：字段分"连接字段"（URL/Key/模型）与"生成参数字段"（采样/提示词），切预设跳过连接字段——这是卡绑定预设、预设分享不泄 key 的前提。
  - **预设分组**、**预设关联世界书**（切预设自动激活绑定世界书）。
  - **编排预设库**：全局/角色卡两作用域，随卡导出；保存到卡时预检引用的提示词预设，可一键"全部内嵌"。
  - **Director 预设建议**（director.md）：接管模式下主 agent 的提示词预设应关掉角色卡字段/persona/例句/世界书占位（编排器已喂了），保留聊天历史、文风指令、越狱、反公式指令——"工具循环预设≠写正文预设"的思路。

## 五、正则脚本（继承+原创扩展）

引擎：`public/scripts/extensions/regex/engine.js`（继承 SillyTavern，`SCRIPT_TYPES`: GLOBAL/SCOPED/PRESET 有序优先级；`regex_placement`: USER_INPUT/AI_OUTPUT/SLASH_COMMAND/WORLD_INFO/REASONING；min/max depth；`substitute_find_regex`；`trimStrings`；ephemeral 双位：`仅格式显示` / `仅格式提示词`，都不勾才改写聊天文件本体）。

Luker 原创：
- **plugin lanes**（`getPluginLanes`）：`request`/`reply` 两条插件专用道——`request` 处理进入插件请求的文本（楼层、插件消息、世界书条目），`reply` 处理插件返回正文，且**不受 ephemeral 影响**。这是给编排/记忆这类"插件消费文本"场景开的口子。
- **正则 Provider 机制**（`registerRegexProvider`/`registerManagedRegexProvider`）：插件动态注册/增删规则，与静态规则同管线执行；记忆图是主要使用者。
- **ReDoS 防护**（`redos-reporter.js`）：脚本执行记录与暂停机制。
- 预设级正则存进预设的 extension field（`writePresetExtensionField`），随预设走。

## 六、记忆与上下文压缩（原创）

**Memory Graph**（`public/scripts/extensions/memory-graph/`）：
- **抽取**（`extraction-schedule.js`）：每轮回复后后台跑，按**类型** schema（默认 character/location/event/plot thread，可自定义）+ 每类型独立 `extractEveryN` 间隔与提取指令；聊天被编辑/删除/swipe 时记忆**回退到该楼层之前**的状态；同楼层重新生成**复用**召回结果。
- **召回**（`retriever.js`）：默认 LLM 判相关性，可选 RAG 向量召回——向量预筛 → **按类型分桶**（避免 event 节点数量碾压其他类型）→ 可选 rerank → 合并裁剪；查询可用 LLM 重写。
- **压缩**：旧 event 自动合并成高层摘要，细节留在图里可再召回（层级折叠）。
- **常驻注入**：指定类型"始终可见"，可设回溯楼层上限，超出的退回按需召回池。
- **Tag filter**：抽取/召回前剥掉 thinking 块、状态栏等噪声。
- 也可把提取委派给编排器的 memory_curator sub-agent。

**Notes**（`open-notes-injection.js`）：agent 自管的"未来承诺"台账（伏笔/已埋线索），存楼层态命名空间；**读取对所有 agent 开放、写入靠工具开关**——很干净的权限分离。

**Skills**（Claude Skills 兼容，`SKILL.md`+frontmatter）：三作用域 global/preset/character，同名后者覆盖；运行时只注入名字+描述目录，agent 按需 `skill_read` 读正文——把"长系统提示词"拆成按需加载。

## 七、工具/函数调用

统一运行时（`improvements/function-call-runtime`）：原生支持则走模型 tools 字段；不支持则系统提示注入协议 + 文本正则提取，对上层透明；支持并行工具调用；`toolCallRetryMax` 统一控制"没产出工具调用"的重试。编排工具错误回喂 `{ok,error,code,hint}` 结构化 JSON。

## 八、聊天前端（继承为主 + 原创运行面板/后台生成）

- **继承**：swipe（同楼层多版本，滑到最后再滑=重新生成）、分支、消息编辑/删除、regenerate/continue/impersonate；消息含 `extra.reasoning`。
- **原创**：
  - **Run Panel**（`/scripts/run-panel/store.js` + orchestrator `run-state/`）：统一的 run→round→section(reasoning/text/tool_call/tool_result) 流式状态树，四种模式都写它；可停靠面板实时渲染 thinking、文本、工具调用参数与结果，可导出 JSON trace，"结果不满意？AI 诊断"直跳 AI 迭代。
  - **后台生成**：生成在后端跑，WebSocket 流推前端；关标签页/断网不中断，重连接上继续（`improvements/backend-storage` + `generation-layer` + ws-proxy 流偏移恢复）；Generation Acknowledge——后端落盘后才 ack 前端。
  - **Director 流式**：`write_message`/patch 直接写 placeholder 消息槽，用户实时看到正文长出来；sub-agent 输出只进 Run Panel 不进聊天。
  - 聊天合并/拆分（`chat-merge-split.js`）。

## 九、对 Novelive 的启示

1. **编排模式分级值得照搬**：固定流水线（Spec）/ 调度员动态派遣（Agenda）/ 单 agent 工具循环（Loop）/ 接管式写作团队（Director）四档对应不同任务形态。Novelive 的"全书预览→卷综合→分场→逐场写"更像 Spec 固定流水线，但"review 节点可指名上一阶段节点重跑（上限 N 次）"是现成的低成本质检机制，可对应剧本校验退回重写的语义（`spec-runtime.js` 的 review/rerun 设计）。
2. **Director 的"主笔+子代理团"直接对应小说改剧本**：scout（侦察本章相关设定/伏笔切片）→ draft（写 `.nvs`）→ critic（一致性/文风审）→ revise（`apply_message_patches` 唯一子串精确替换补丁）→ finalize。patch 失败整块回滚+错误码回喂的契约（`executeApplyPatchesTool`）可直接借用到 Novelive 的"差异列表"生成。
3. **每个 agent 独立的 (连接, 提示词预设) 二元组 + 三层回退**（agent → 编排默认 → 运行时默认）是干净的多模型角色实现；Novelive 的"快速/创作/图片/多模态"角色可直接映射为 agent preset 引用。
4. **`<story_context>` 包装 + 指令放尾部 + 易变状态进 `<runtime_state>` user 消息**的提示词组装法，用字节稳定换 prompt cache 命中率——Novelive 把章节正文/设定切片放前、阶段指令放尾、每章变的规则快照放尾部 user 消息即可复用。
5. **Memory Graph 的类型化抽取+分桶召回+层级压缩**比 Novelive 草稿的"章节预览 JSON"更通用：Novelive 已有 `ChapterPreview`，但"每类型独立提取间隔""向量召回按类型分桶防 event 碾压""编辑/删除消息时记忆回退到楼层前"三个细节值得吸收；Notes 的"agent 自管伏笔台账"可直接对应改编剧情的伏笔追踪（比塞进 bible 更轻）。
6. **正则三分层**（显示/提示词/落盘）+ **插件 request/reply 双道**：Novelive 的"SillyTavern 式正则调质量"需求里，`仅格式提示词`（改发给模型的文本不动文件）是防污染作品文件的关键设计；`reply` 道可用来做剧本后处理（状态栏剥离、格式规范化）而不碰 `.nvs` 源文件。
7. **工具错误的结构化回喂**（`{ok,error,code,hint}` 作为 role:tool 消息）和"无工具调用轮=丢弃重试，历史不留痕"两条规则，比 Novelive 草稿"JSON 解析失败再补一轮"更通用——同样适用于 `.nvs` 解析错误回喂场景。
8. **Run Panel 的 run→round→section 流式状态树**正好是 Novelive 侧边栏要的三件套（流式正文 + thinking 展示 + tool-call 展示）的统一数据模型；前端渲染只需订阅 store。Director 的"正文写消息槽、过程写面板"分离避免了把 agent 内部状态混进作品数据。
9. **避免照搬的点**：Luker 编排器跑在浏览器前端、深度耦合 SillyTavern 全局（`Luker.getContext()`、扩展设置、PromptManager payload），不可整体移植；其 capsule 注入复用世界书位置枚举的做法在 Novelive 自建 pi 栈里没有对应物，按自己 TypeBox 契约注入即可。自定义工具的"页面上下文执行 JS"安全模型（custom-tools.js 警告：同权限跑任意代码）在 Electron utility process 里应换成受限解释器或干脆只开放预定义工具。
10. **值得留意的细节**：first-chunk barrier（并行 dispatch 共享前缀时等第一个暖缓存再发）；sub-agent 完成用 system 消息异步通知而非阻塞 await；技能目录只注入 name+description、正文按需读（对应 Novelive 的改编规则/文风包按需加载）；swipe 同楼层复用编排结果（对应 Novelive 重生成时缓存设定切片）。