# R2 审查：Agent/工程设计对抗性审查

审查范围：`.workflow/research/{pi-scaffolding,agent-orchestration,novelive-agent,agent-harness,handoff-defaults,character-consistency}.md`、`.workflow/specs/m0-skeleton.md`、`docs/{architecture,creation-pipeline}.md`，对照 `decisions.md` 与 `gap-ledger.md`（也顺带核对了 `docs/{work-format,bible,visuals,ux,player,product}.md`）。基准问题：**实现者明天能否不猜就开始 M0，然后 M1a？**

## 1. 结论

1. M0 可以开工，但 spec 有两处与同日 `handoff-defaults.md` 直接打架，照 spec 写第一天就错：`call()` 取消签名（AbortSignal 过不了 contextBridge）和图片编辑测试的输入图（链式 vs 内置测试图）。
2. `events.list`/ring buffer 机制在 M0 没有任何生产者和 scope 词表——W2 单测没有可测对象；要么最小定义 scope（如 `app`/`work`），要么把 events.list 推到 M1b。
3. "pi 内置模型目录查上下文长度"在三处写了（m0 规格、architecture、agent-orchestration），但 round-1 的 pi 调研和 gap-ledger 都没有 pi 自带目录的证据；gap-ledger 推荐的是打包 LiteLLM 数据。需验证，否则 M0 的"查得到就自动填"退化为永远手填。
4. `novelive-agent.md:90` 与 binding decision（`decisions.md:486`）直接冲突：图清单"已有/要新画"一处说模型标、一处说代码算且模型不填。按"模型不填代码能算的东西"原则应采纳 novelive-agent 版、改另两处措辞。
5. `pi-scaffolding.md:91` 写 `run_step` 落在 `onResponse` 钩子——该钩子不在同文档第 9 行列出的 pi 钩子清单里，pi 1.6.0 没有它；模型调用步实际应走 `subscribe` 的 `turn_end`/`message_end`（novelive-agent:25 正是这么写的）。
6. 制作队列/出图队列/任务状态没有任何表结构归属：`run`/`run_step` 是"记录"不是"队列"；`work-format.md` 只写"任务状态"在 project.db。章优先级、基准图→差分依赖、队列排序、"输入已改需要重跑"状态映射全部无落点——M1a 规格必须补任务/队列表，M0 不阻塞。
7. 确认点 1 的候选（角色设定 3 版、主视觉 3 版）写"提议存 project.db 提议表"，但提议表是为对话面板 `propose_*` 设计的：`对话消息 ID` 字段对流水线提议无值、kind 枚举不含"选设定/选主视觉"。机制能复用，schema 要补。
8. 对话面板 park 语义有三处未定义失败转移：park 中创作者又发消息、park 中应用退出、park 中子 Agent 是否停。
9. `agent-orchestration.md:110` "风格与主视觉=主控+美术导演"与 `handoff-defaults.md:42` "场景画师出图"冲突——按 2026-11-21 出图分工决策，美术导演不再出图，前者是陈旧行。
10. `docs/ux.md:30` "自动重试两次，不自己另做重试"是过时文案：最终决策（2026-11-21 两层重试）就是我们自己写第二层。同理 `handoff-defaults.md:40` "章失败整部作品暂停+行内重试"在 docs 里找不到依据。
11. 审稿工具清单两套：`pi-scaffolding.md:121` 和 `handoff-defaults.md:39` 不一致（find_term/read_chapter_summary vs read_chapter_preview/read_glossary/read_scene），且都没有 `read_bible`。
12. 无过度设计进 M0 的证据：events/录制/SQLite 冒烟/断路器都是 spec 明确列入的底座；唯一可议的是 events.list 机制（见第 2 条），建议保留机制、最小定义 scope，不删。
13. M1a 可开工面：指令全集本身是 M1a 的产出任务；任务表 schema（见第 6 条）和 BiblePatch 的 `major` 字段（只在 handoff:45）需在 M1a 规格里补齐。

## 2. 证据

### 2.1 M0 规格层（开工即撞）

- **C1 取消签名冲突（高）**：`.workflow/specs/m0-skeleton.md:42` 写 `call(command, payload, signal?)`「call 可传 AbortSignal」；`.workflow/research/handoff-defaults.md:7` 写「AbortSignal 不能跨 contextBridge。preload 侧暴露 `call(cmd, payload)` 返回 promise + `cancel()`」。contextBridge 参数走 structured clone，AbortSignal 不可克隆——handoff 版正确，spec 版写不通。修法：spec 改 handoff 的 `cancel()` 句柄设计。
- **C2 图片编辑测试输入冲突（高）**：`m0-skeleton.md:57`「图片编辑（用刚生成的图加一次编辑）」vs `handoff-defaults.md:23`「编辑测试用内置小测试图做输入，文生图失败不阻塞编辑项」。handoff 版与 decisions:528-534「三项分别显示结果」意图一致（独立测三项）。修法：spec 改内置测试图。
- **C3 events scope 未定义（高）**：`m0-skeleton.md:44`/`architecture.md:69`/`handoff-defaults.md:8` 三处一致写 envelope `{seq, scope, scopeId, at, event}` + `events.list {scope, scopeId, afterSeq}`，但全仓库没有任何 scope 取值枚举；M0 唯一事件 `creator.ready`/`creator.down` 由主进程代发（m0:47、handoff:12），不经过创作端 ring buffer。W2（m0:95）要测 afterSeq 补漏，却没有合法 scope 可传。修法：最小定义 scope 词表（建议 `app`/`work` 起步）并把 ring buffer 建在创作端（ready/down 仍可豁免 catch-up）；或把 events.list 推到 M1b。
- **C4 `webContents.destroyed` 归属错（中）**：`m0-skeleton.md:42`、`handoff-defaults.md:7`、`architecture.md:69` 都写「预加载维护 requestId→AbortController 映射，窗口 `webContents.destroyed` 时批量 abort」。`webContents` 是主进程 API，preload 拿不到这个事件。可行机制是 port 随渲染进程销毁被 GC、创作端监听 port close 后 abort 在途；或主进程通知。修法：把归属改成「port 销毁时创作端 abort 在途请求」。
- **C5 "pi 内置模型目录"未验证（中）**：`m0-skeleton.md:14`、`architecture.md`（creation-pipeline.md:100）、`agent-orchestration.md:79` 均写「pi 内置模型目录里查得到就自动填上下文长度」。`gap-ledger.md:542` 推荐的是打包 LiteLLM `model_prices_and_context_window.json`；pi 调研（`pi-scaffolding.md`、refs/pi-2026-11-core.md）未记录 pi 有上下文长度目录。修法：验证 pi 1.6.0 API 面有无目录；没有则按 gap-ledger 打包 LiteLLM 数据或 M0 先手填。
- **C6 cassette schema 微差（低）**：`m0-skeleton.md:73` 行内字段无 `tags`；`handoff-defaults.md:15` 有 `tags`。修法：规格补齐或删 handoff 字段。
- **C7 断路器复位语义（低）**：`m0-skeleton.md:65`/`architecture.md:71`「基础设施失败连续 3 次后不再自动拉起」——`creator.ready` 成功握手后失败计数是否清零未写。修法：补一句「ready 后清零」。
- **C8 `creator.ready` 发送方（低）**：`m0-skeleton.md:47` 只说「启动和重连后发一次」未写谁发；`handoff-defaults.md:12` 明确「由主进程代发，与 creator.down 对称」。修法：spec 抄 handoff。
- **C9 `NL_IMAGE_*` 环境变量歧义（低）**：`m0-skeleton.md:51` 只提 `NL_IMAGE_BASE_URL`/`NL_IMAGE_API_KEY`；`decisions.md:546` 写「文本和图片共用这一组」。修法：spec 注明文本测试也读同一组。
- **C10 config.update 合并语义（低）**：`m0-skeleton.md:51` 未写 update 是整体替换还是部分合并（掩码哨兵已写）。实现者可自行定，建议 spec 写「按字段合并」。
- **C11 `gap:true` 快照形状（低）**：`architecture.md:69`/`m0-skeleton.md:44`「ring 溢出时响应带 gap:true 和最新快照」——各 scope 的"快照"是什么没有定义（M0 无快照可给）。与 C3 一并处理。

### 2.2 Agent/编排层（M1a-M2）

- **A1 图清单"已有/新画"标记冲突（高）**：`novelive-agent.md:90`「是否已有、派生自哪张基准图由代码按素材名和已登记素材算出，**模型不填**」vs `decisions.md:486`「列出这一章要用的图（已有的、要新画的）」+ `agent-orchestration.md:50`「每张图标出已有还是要新画」+ `creation-pipeline.md:56` 同文。novelive-agent 版更符合「模型不填代码能算的东西」（decisions:611-616）；建议改决策措辞为"清单区分已有/新画（由代码判定）"、保留 novelive-agent 实现。
- **A2 `onResponse` 钩子不存在（高）**：`pi-scaffolding.md:91`「`afterToolCall`、`onResponse` 钩子里写」；同文档第 9 行列出的钩子是 `transformContext`/`prepareRequest`/`prepareNextTurn`/`beforeToolCall`/`afterToolCall`，无 `onResponse`。模型调用步的正确写入点是 `subscribe` 的 `turn_end`/`message_end`（`novelive-agent.md:25`）。修法：改为「`afterToolCall` 钩子与 `subscribe` 事件里写」。
- **A3 任务/队列表无归属（高）**：`work-format.md:106` 只说 project.db 存"任务状态"；`pi-scaffolding.md:90-92` 的 `run`/`run_step` 是运行记录（无 queued 状态、无优先级、无依赖列）。章优先级（creation-pipeline:52）、出图队列基准图→差分依赖（creation-pipeline:57）、多作品排队（decisions:102-107）、propose 的 `redo_chapter` 进队列（novelive-agent:145）都没有表。修法：M1a 规格补 `task`/`job` 表（或明确 run 表兼任队列加 `queued`/`priority`/`depends_on` 列）。
- **A4 确认点 1 候选存储借用提议表（中）**：`novelive-agent.md:69`「提议存 `project.db` 的提议表（见对话面板）」；`novelive-agent.md:145` 提议字段含「对话消息 ID」——流水线候选没有对话消息；kind 枚举（propose_bible_change 等，novelive-agent:137-143 + handoff:55 `add_text_marker`）不含"选设定版本/选主视觉"。修法：提议表加 `chat_message_id NULL` + kind 加 `pick_character_design`/`pick_main_visual`，或确认点候选另建表。
- **A5 审稿工具清单两套（中）**：`pi-scaffolding.md:121` 写 `read_source_range`、`find_term`、`read_chapter_summary`、`submit_review`；`handoff-defaults.md:39` 写 `read_source_range`、`read_chapter_preview`、`read_glossary`/`read_scene`（无 find_term、无 submit_review）。且 `read_chapter_summary` 与全库通用的 `read_chapter_preview`（novelive-agent:130）命名不一致；审稿查设定集需要 `read_bible`（novelive-agent:131），两份清单都没有。修法：以一份为准并补齐 `read_bible`。
- **A6 park 三态未定义（中）**：`pi-scaffolding.md:95` 定义 park+唤醒补结果，但：①park 中创作者再发消息——steering 只在"工具批次之间"注入（pi-scaffolding:52），park 的会话阻塞在挂起的工具调用上，新消息注入语义未写；②park 中应用退出——`novelive-agent.md:147` 说重开从 project.db 重建 Agent，但 park 的会话有一条无结果的工具调用，重建时补拒绝结果还是重新出卡未写；③park 中子 Agent 是否停——"父停子停"（pi-scaffolding:96）对 park 是否算"停"未写。
- **A7 主视觉负责人冲突（中）**：`agent-orchestration.md:110`「风格与主视觉｜主控 + 美术导演」vs `handoff-defaults.md:42`「由场景画师出图…确认点 1 给 3 版候选必选」。按 decisions:486 美术导演不再出图。修法：改 agent-orchestration:110 为「主控 + 场景画师」。
- **A8 综合"整卷重跑"vs"中途落盘可续"（中）**：`novelive-agent.md:63`「任务粒度到卷，中断整卷重跑」vs 同文档 :54 与 `handoff-defaults.md:35`「产物中途落盘可续跑」。修法：改为"中断后从已落盘进度续跑，不重头重跑"。
- **A9 修改历史存内容 vs 存清单（低，M2）**：`novelive-agent.md:118`「修改历史记到 project.db（原文快照 + 新内容）」vs `handoff-defaults.md:62`「持久保存条目清单…不持久快照」。修法：以 handoff 为准（清单+审计），M2 规格统一。
- **A10 章失败"整部作品暂停"无出处（中）**：`handoff-defaults.md:40`「某章生成失败整部作品暂停…行内重试把该章排回队列头部」标注依据 `docs/creation-pipeline.md`、`docs/ux.md`，但两份 docs 只写"标'需要处理'""停下"，没有"整部作品暂停"和"行内重试"UI。该规则本身合理（写手串行），但 docs 缺这条状态转移。修法：把这条写进 creation-pipeline.md 4.2。
- **A11 ux.md 重试文案过时（低）**：`docs/ux.md:30`「临时错误…自动重试两次，不自己另做重试」——最终决策两层重试就是我们自己写第二层（decisions:636-642）。修法：改为「自动重试，重试都失败标'需要处理'」不展开层数。
- **A12 写手降敏规则无归属（中）**：`creation-pipeline.md:65`/`novelive-agent.md:12`/`pi-scaffolding.md:67` 都写「写手那章先按降敏规则改写一次」，但降敏规则具体内容只在图片侧有（visuals.md:46 去具象词）；文本侧规则正文没有文档持有。修法：写手内置提示词里写（M1b 提示词任务）。
- **A13 `spawn_agent` 工具不在主控工具表（中）**：`novelive-agent.md:130-144` 主控工具清单没有派子 Agent 工具（只在 `pi-scaffolding.md:96,124` 出现且未命名）；`handoff-defaults.md:55` 新增的 `list_assets`/`read_chapter_manifest`/`read_task_result` 三个读工具也不在 novelive-agent 清单里。修法：novelive-agent.md 工具表补齐 spawn + 三个读工具。
- **A14 `run.kind` 枚举不全（低）**：refs/ext-2026-11-evalops.md:104 给 `chapter|image|review|staging|chat|eval`；制作还有 preview/synthesis/redo/resynthesize/chat-side 等，`pi-scaffolding.md:90` 未列。修法：M1a 规格定枚举。
- **A15 `prompt_version` 列缺失（低）**：refs/evalops:158 推荐 `run_step.prompt_version` 做 M1b 评测基线，但 §5 DDL（refs:101-139）和 `pi-scaffolding.md:91` 都没有这列。修法：DDL 补列。
- **A16 "输入已改，需要重跑"状态映射（低）**：`creation-pipeline.md:66`/`novelive-agent.md:26` 的状态文案没有 run.status 对应值（枚举 `running|done|needs_attention|cancelled|interrupted`，pi-scaffolding:90）。修法：映射 `needs_attention` + `error_type='input_changed'`，写进 M1a 规格。
- **A17 看门狗阈值/ring N/loop-guard N 未给值（低）**：`pi-scaffolding.md:65`「最新事件间隔超阈值」无数值；`architecture.md:69`/`m0-skeleton.md:44`「最近 N 条」无 N（gap-ledger:489 提到 YN 用 500）；`pi-scaffolding.md:83`「连调 N 次」无 N。实现者可定，建议 handoff 补默认值。
- **A18 hash 核对粒度（低）**：`creation-pipeline.md:66`「记下所用原文和设定的哈希」——"所用"的范围（整章原文？相关 bible 条目？）未定，粒度不同误报率不同。M1b 规格定。
- **A19 refs §5 DDL 的 `owner_pid` 与 claim 式并存说明（低）**：refs/ext-2026-11-evalops.md:107 只有 `owner_pid`；`pi-scaffolding.md:92` 已升级为 `suspended_at`+`resume_attempts` claim 式（"替代裸 pid"）。以 pi-scaffolding 为准即可，refs 是输入材料不算冲突，但实现者若直接照抄 §5 DDL 会少两列——建议 M1a 规格落最终 DDL。
- **A20 BiblePatch 缺 `major`（低）**：`handoff-defaults.md:45` 要求角色条目加 `major: boolean`（确认点 1 名单依据）；`novelive-agent.md:58` BiblePatch 字段清单未列 `major`。修法：novelive-agent.md 或 M1a 规格补。
- **A21 spawn 花名册未定义（低）**：`pi-scaffolding.md:96`「附可用角色花名册」——能派哪些角色（9 个全部还是子集）未定。
- **A22 章步骤显示词 vs 任务粒度澄清（低）**：`creation-pipeline.md:53`"停下后从没做完的一步接着做"与 `novelive-agent.md:77`"任务到章粒度，中断整章重跑"语义其实一致（任务=章内的"写"这一步，步级续跑），但措辞易误读为"整章三步全重跑"。M1b 规格写清：任务=（章，步骤）对。

### 2.3 已核对无冲突（抽查）

- 两层重试、看门狗、abort 归因、审核拒绝分类：`pi-scaffolding.md:64-67` = `novelive-agent.md:12` = `decisions.md:636-642` ✓
- 软预算（1.5× 硬停 + 5 次收尾）：`pi-scaffolding.md:68-82` = `decisions.md:618-623` ✓
- 三级上下文维护 + 触发线 + bytes/4 计量：`pi-scaffolding.md:98-108` = `decisions.md:625-634` ✓
- claim 式崩溃回收：`pi-scaffolding.md:92` = `handoff-defaults.md:53` ✓
- 确认闸门 + feedback 列：`pi-scaffolding.md:95` = `novelive-agent.md:145` = `docs/ux.md:40` ✓
- generation 帧：`m0-skeleton.md:43` = `architecture.md:67` = `handoff-defaults.md:8` ✓
- 占位图三类 + 尺寸：`creation-pipeline.md:59` = `handoff-defaults.md:49` ✓
- 剧本检查局部修复、同义表情合并、t2vn 判定表：各处一致 ✓
- 造型基准图重画 + 表情编辑派生：`character-consistency.md` = `visuals.md:20-22` = `decisions.md:410-415` ✓
- 原型已按最新决定更新（git 6223465 画师分工/三项测试），M0 W5 前置条件成立。

## 3. 对照现有设计

| 发现 | 判定 | 依据 |
| --- | --- | --- |
| C1 AbortSignal 签名 | 冲突 | `m0-skeleton.md:42` vs `handoff-defaults.md:7`（同日、同一交接默认） |
| C2 编辑测试输入 | 冲突 | `m0-skeleton.md:57` vs `handoff-defaults.md:23` |
| C3 scope 词表 | 缺口 | `m0-skeleton.md:44`/`architecture.md:69` 有机制无取值；应落 contract 或 m0 spec |
| C4 destroyed 归属 | 冲突 | `m0-skeleton.md:42` preload 拿不到 `webContents` 事件 |
| C5 pi 内置目录 | 缺口/待验证 | `gap-ledger.md:542` 推荐 LiteLLM；pi 调研无目录证据；应落 `pi-scaffolding.md` 或 m0 spec |
| C6 cassette tags | 缺口 | `handoff-defaults.md:15` 有、m0:73 无 |
| C7-C11 | 缺口 | 均落 `m0-skeleton.md` 修订 |
| A1 图清单已有标记 | 冲突 | `novelive-agent.md:90` vs `decisions.md:486`/`agent-orchestration.md:50`/`creation-pipeline.md:56`；建议采纳 novelive-agent 语义 |
| A2 onResponse | 冲突 | `pi-scaffolding.md:91` vs `pi-scaffolding.md:9` 自身钩子清单 |
| A3 任务/队列表 | 缺口 | `work-format.md:106` 只有类别名；应落 M1a spec（project.db schema） |
| A4 确认点 1 候选 kind | 缺口 | `novelive-agent.md:69,145`；应落 M1b spec 或 novelive-agent.md |
| A5 审稿工具清单 | 冲突 | `pi-scaffolding.md:121` vs `handoff-defaults.md:39`；落 M1b spec 时统一 |
| A6 park 失败转移 | 缺口 | `pi-scaffolding.md:95`；应落 pi-scaffolding 通用层 4 |
| A7 主视觉负责人 | 冲突 | `agent-orchestration.md:110` vs `handoff-defaults.md:42`/`decisions.md:486` |
| A8 卷重跑粒度 | 冲突 | `novelive-agent.md:63` vs `novelive-agent.md:54`/`handoff-defaults.md:35` |
| A9 修改历史 | 冲突 | `novelive-agent.md:118` vs `handoff-defaults.md:62` |
| A10 章失败语义 | 缺口 | `handoff-defaults.md:40` 引用的 docs 无此文；应落 `creation-pipeline.md` §4.2 |
| A11 ux 重试文案 | 冲突 | `docs/ux.md:30` vs `decisions.md:636-642` |
| A12 文本降敏规则 | 缺口 | `creation-pipeline.md:65` 无规则正文；应落写手提示词任务（M1b） |
| A13 主控工具表不全 | 缺口 | `novelive-agent.md:130-144` 缺 spawn/`list_assets`/`read_chapter_manifest`/`read_task_result`（`handoff-defaults.md:55`） |
| A14-A22 | 缺口/低 | 落 M1a/M1b 规格或 handoff 补默认值 |
| 里程碑越界 | 已覆盖 | M0 spec 无越界项；events.list 属边界（见 C3，建议留机制补词表）；`m0-skeleton.md:37,80-84` 显式排除越界内容 ✓ |
| 不做防御性设计 | 已覆盖 | 预算/重试/并发/重画均为决策批准的"必要上限"（decisions:499-505,618-623）；未发现新增防御项 |

## 4. 可拷资产

本任务为文档审查，无新资产建议。round-1 `gap-ledger.md` D 区资产清单（行 368-551）已按落点分组、标注许可，可直接沿用；本次审查未新增可拷代码。

## 5. 需要所有者取舍的事

1. **图清单"已有/新画"谁来判**（A1）：(a) 模型标（decisions:486 字面）；(b) 代码算、模型不填（novelive-agent:90）。**推荐 (b)**：素材存在性是代码可查的事实，让模型标违反"模型不填代码能算的东西"原则（decisions:611-616），且模型标的"已有"若错会漏画。代价是改决策条目措辞或加 supersedes 注记。
2. **pi 上下文目录**（C5）：(a) 验证 pi 1.6.0 确有内置目录则用；(b) 打包 LiteLLM `model_prices_and_context_window.json` 精简表（~50KB，MIT）；(c) M0 全部手填。**推荐先 (a) 验证、大概率落 (b)**：gap-ledger 已选 (b) 为数据源，"pi 内置目录"写法可能只是误称。
3. **events.list 在 M0 的去留**（C3）：(a) 保留机制并最小定义 scope 词表（`app`/`work`），W2 用一个 `app` scope 事件做补漏测试；(b) events.list 推到 M1b 有真事件源时。**推荐 (a)**：机制已写入三份文档且 W2 依赖它，删了 M1b 还要加回来；补一行 scope 枚举即可。
4. **章失败"整部作品暂停"**（A10）：handoff 规则本身合理（写手串行必须停），但 docs 缺状态转移。**推荐**写进 `creation-pipeline.md` §4.2：章失败→作品暂停、行内重试排回队首、成功后恢复；同时定义"需要处理"的章是否阻塞后续章（暂停=阻塞）。
5. **任务/队列表归属**（A3）：(a) 新增 `task`/`job` 表专职队列+依赖；(b) `run` 表加 `queued`/`priority`/`depends_on` 兼任。**推荐 (a)**：run 是事实记录、队列是意图，混表会让"重跑"语义含糊（重跑=关旧 run 开新 run 还是改状态）；此条可 M1a 规格内定，不必所有者拍板。
6. **park 失败转移三态**（A6）：建议默认：park 中新消息排队到唤醒后注入；park 中退出→提议保持 pending，重开不出卡、创作者可在提议列表处理，会话把"等待已确认/已拒绝"补成工具结果；park 视为"停"→子 Agent 停。此条是实现默认值，可 agent 自定记入 handoff。
7. **审稿工具清单统一**（A5）：建议合并为 `read_source_range`/`find_term`/`read_chapter_preview`/`read_bible`/`submit_review`（`read_glossary`/`read_scene` 可留作备选），M1b 规格定稿。agent 可自定。
8. **确认点 1 候选存法**（A4）：建议提议表 kind 加 `pick_character_design`/`pick_main_visual`、`chat_message_id` 可空；实现级取舍，agent 可自定。

## 附：M0 就绪评估

**已就绪可直接进任务**（不猜）：包结构/技术栈、Electron 外壳+utility process+MessagePort+generation、contextBridge 面（除 C1）、config.json 存储+加密+掩码+原子写、设置页布局与三个测试命令的意图、novelive://cache 协议（含越界规则见 handoff:10）、崩溃横幅+断路器+ready/down、SQLite 冒烟、cassette schema 与录制流程、Vitest/Playwright/Biome/Stylelint/CI、dev-bridge 架构与端口、日志目录与命名、全部 W1-W7 验收点。

**需先定再进任务**：C1（cancel 句柄）、C2（编辑测试输入图）、C3（scope 词表）、C4（销毁归属措辞）、C5（上下文长度来源——可降级为"先查表查不到手填"，不阻塞开工但影响"自动填"验收表述）、C6-C11 小项。

**M0 任务分解 sanity check**（只指缺口）：spec 未列的前置任务——①contract 包的 pi-schema 定义（命令/事件/配置 schema）本身需要独立成任务，spec:33 提了但没单独验收点；②`tools/dev-bridge` 的 WebSocket 帧协议与 contract 复用方式需要一节（spec:35 只有一句）；③原型→正式控件库的搬运清单（spec:32 一句"整套控件库"）建议列组件数对照 W5；④`pnpm check` 的四个子命令定义（typecheck/biome/stylelint/vitest 各自 script 名）未写；⑤C5 的 LiteLLM 数据打包若采纳需一个资产任务。这些都在 spec 内隐含，不是新增范围。
