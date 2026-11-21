# R2 对抗性一致性审查：docs/*.md、DESIGN.md、原型

范围：docs/product/ux/player/work-format/visuals/bible/creation-pipeline/architecture.md、DESIGN.md、`prototype/src` 全部页面与 mock、`.workflow/decisions.md`（含 Supersedes 链）、`.workflow/glossary.md`。逐行核对，未做外部调研。

## 1. 结论

1. 文档整体质量高：round 1 的决定（pi-schema、两层重试、审稿拆两档、出图分工、有损 WebP q90、2K/4K、M1a/M1b 拆分）已正确渗透进 docs；未发现与最新决定直接打架的正文。
2. **最重要的实现级歧义**：章节"已发布"的定义。docs 说"一章的图都齐即为已发布"（ux.md:24、creation-pipeline.md:59），但占位图章也算"图都齐"还是标"需要处理"？两文档同时说"用占位图也能玩，并标需要处理"——那它同时是"已发布"还是"需要处理"？原型把它做成互斥状态（`ChapterStatus` 四选一，attention 章也可玩，PlayerPage.tsx:1100 把 attention 当可玩），docs 没说清"需要处理"是叠加标记还是替代状态。blocks-implementation。
3. **原型与最新决定不同步**：①审稿开关仍是旧设计——原型只有一个"审稿"开关默认关（mock/types.ts:70-71、WorkPage.tsx:317-320、production 的 steps 按 reviewEnabled 二选一），最新决定是忠实度检查默认开 + 文风审稿默认关两档；②对话面板没有"拒绝理由"输入（ux.md:40 要求）；③播放器设置里有"只跳过已读"开关（PlayerPage.tsx:1142），docs 明说"不做跳过未读"（player.md:71）——这个开关要么删要么改成只读说明；④AppShell 快捷键提示写死"Ctrl J"（AppShell.tsx:155），docs 写 Ctrl/⌘+J。
4. **状态词不齐**：DESIGN.md 固定章节状态四词"已发布/制作中/等待/需要处理"，但全局制作状态第四词在 docs 是"待确认"（ux.md:12），原型 globalStatusMeta 用"待确认"（production.tsx:74）——一致；但 work 层面 prototype 的 `phase='preview'`（全书预览与综合期）在 DESIGN.md 四词里没有对应状态词，侧边栏只能显示"制作中"，实现时要自己定。unclear。
5. **数字/事实两处自相矛盾**：①ux.md:30 写"自动重试两次"但 creation-pipeline.md:64（与 11-21 决定一致）写两层重试 `maxRetries:2` + 外层最多 2 次重发——"两次"指哪层没说，且 ux 省略了第二层；②系统通知：ux.md:32 列三种加括号补第四种（播放器章末），creation-pipeline.md:69 只写三种漏了括号那项；work-format.md:57 说"每张通过检查的图立即保存"但 decisions 2026-11-21 说某章失败整部作品暂停——docs 完全没提这个"整部作品暂停"。
6. **未定义术语**："红线"（creation-pipeline.md:35）、"降敏规则"（visuals.md:46、creation-pipeline.md:65）、"安全区"在 glossary 有但"占位图"、"过期"没有……（更正：需要处理/过期已在 glossary:57-58；真正缺的是"占位图"、"红线"、"降敏"、"槽位"、"锚点特征"、"主视觉"的准确定义——"主视觉"glossary:55 说"角色设定与画风基准"但 visuals/confirm 页里它是和角色并列的一项，实现时不知道是图还是描述）。
7. 原型里存在 docs 没有的能力：导入向导第三步"改编设置"（ImportPage 有"新建系列/加入已有系列"选项）——"加入已有系列"在 docs 完全没写，一个工程=一个系列但向已有工程追加原文是什么语义没人定义。
8. M1 实现者最大未知数集中在：剧本指令全集（只给了参数集，指令全集 M1a 定稿）、project.db 表结构、"生成预览流"是什么（architecture.md:55 突兀出现未解释）、`novelive://` 协议 URL 形态。

## 2. 证据

### A. 状态机 / 流程缺口（谁置位、UI 怎么显示、怎么清除）

**A1. "已发布"与"需要处理"的关系未定义** — blocks-implementation
- ux.md:24「一章的图都齐即为"已发布"，自动可玩」+ ux.md:30「图片最终失败的章节使用内置占位图也能玩，并同样标"需要处理"」
- creation-pipeline.md:59 同样两句并列；player.md:93「标为"需要处理"…也能游玩」
- 原型把二者做成互斥枚举（mock/types.ts:4 `ChapterStatus` 四值；PlayerPage.tsx:1100 `isPlayable = published || attention`）。
- 没写清的：占位图章到底算不算"已发布"？如果算，章节状态显示哪个词？制作面板"全部章节已发布"（WorkPage.tsx:101）在含占位图章时成不成立？修好后章节回退到"已发布"还是另有"已修复"？
- 建议：把"需要处理"定义为叠加在已发布上的标记（可玩但带提醒），文档里明确"已发布 = 可玩"，"需要处理 = 有可玩占位 + 待处理任务"。

**A2. 全书预览/综合期没有全局状态词** — unclear
- DESIGN.md:53 全局状态只有 空闲/制作中/已停止/待确认；原型 WorkPhase 却有 `preview`（mock/types.ts:18），作品页显示"当前阶段·全书预览"（WorkPage.tsx:22-39）。
- 侧边栏此时显示什么？prototype 的 GlobalStatus 显示「{work.title}·全书预览」（AppShell.tsx:172）归在"制作中"下，docs 未说明。
- 建议：ux.md 加一句"全书预览与综合期间全局状态记为制作中"。

**A3. "等待"章的进入条件** — unclear
- ux.md:24 列了"等待"，但全文没有说一章何时从"等待"转"制作中"、排队中的章是否显示"等待"。creation-pipeline.md:58 说写与画出图重叠——那"等待"章是"剧本未写"还是"在队列里"？prototype 只对未开始章用 waiting。
- 建议：定义 等待=未开始（未写剧本）或=排期未到。

**A4. 章失败时"整部作品暂停"没进 docs** — wrong
- decisions.md:582「某章生成失败时整部作品暂停（写手要接上一章的结尾），重试成功后恢复」、owner-review.md 同。
- creation-pipeline.md:64-65 只说"重试用完就停下，标需要处理"，没说停的是这部作品的全部制作；ux.md:30 同样只提章。
- 影响：实现者会按"单章停"做调度器，与设计相反。
- 修复：creation-pipeline.md §4.2 补"一章最终失败时这部作品停止制作（写依赖上一章结尾），处理后恢复"。

**A5. 崩溃恢复的"已停止"如何显示** — unclear
- ux.md:86「异常退出后重新打开时，制作保持停止状态，由创作者确认后才继续」；prototype 用 crashed 标志 + 横幅。但全局状态词没有"上次异常退出"一说；实现时要知道 crashed 是否等同于 stopped + 标志位。小，写 spec 时定。

### B. 决定渗透不一致 / 自相矛盾

**B1. ux.md:30 "自动重试两次"与两层重试矛盾** — wrong
- ux.md:30「临时错误…自动重试两次，不自己另做重试；重试都失败就停下」
- creation-pipeline.md:64 与 decisions 2026-11-21「模型调用两层重试」：`streamFn` 里 `maxRetries:2` + 外层整条消息重发最多 2 次（流断/空回复/200 后掉线），还有空闲超时。
- ux 只写了"两次"，既没区分两层，还写"不自己另做重试"——但现在外层重发就是我们自己包的。修复：ux.md 改成"文本调用两层自动重试（见创作流水线），都失败标需要处理"。

**B2. 系统通知：ux 四种 vs pipeline 三种** — wrong
- ux.md:32「只在三种情况发送——停在确认点等待处理、有任务需要处理、整部作品制作完成。（播放器在后台等待本机连载新章时也会发通知。）」
- creation-pipeline.md:69 只写那三种，没有括号补充。
- player.md:89 确认有第四种。
- 修复：creation-pipeline.md:69 加第四种或写"另见 ux.md"。

**B3. 审稿档在 docs 已更新、原型没改** — wrong（原型侧）
- ux.md:72、work-format.md:133、creation-pipeline.md:55,85：忠实度检查默认开 + 文风审稿作品开关默认关。
- 原型 mock/types.ts:70-71 `reviewEnabled` 单开关注释"默认关"；WorkPage.tsx:317-320 一个"审稿"Toggle；production steps 按 `reviewEnabled` 二选一（ProductionPage.tsx:52）。按新决定，忠实度检查始终应出现在 steps 里。
- 修复：mock 改 `fidelityCheck`(恒真/可关？) + `styleReview` 两字段；设置抽屉显示两个开关；steps 固定四步、文风审稿关时省略显"审稿"档还是显示但标跳过——要定。
- 附带发现：docs 没说"忠实度检查可关吗"。ux.md:72 写"审稿（忠实度检查默认开，文风审稿默认关）"读起来两者都是开关，creation-pipeline.md:55 说"忠实度检查默认开…文风审稿是作品开关、默认关"——忠实度是不是"开关可关但默认开"？建议明确忠实度也可关、默认开。

**B4. 决定里的实现默认没进 docs** — unclear
- decisions.md:582：修改历史持久保存、撤销只在本次打开内有效；注册 `.novelive` 文件关联、新版替换时旧包进回收站；放大用可随包分发二次元模型、不依赖 NVIDIA。
- docs：ux.md:49 只说"支持撤销并保留修改历史"（没说撤销是会话级的）；ux.md:77-78/work-format.md 没说文件关联和回收站；visuals.md:55 没说放大模型选型约束。
- 影响：实现 M2/M5 时这些约束会丢。建议进 ux.md（撤销语义）、work-format.md（文件关联/回收站）、visuals.md（放大模型选型约束）。

### C. 术语未定义（glossary 查无，但 docs 在用）

**C1. "红线"** — unclear：creation-pipeline.md:35 首次出现，"违反即整章作废的可检查断言"，glossary 无；谁来断言（代码 or 模型）、"人工必审"是什么意思没解释。
**C2. "降敏规则"** — unclear：visuals.md:46 给了大概内容但名称未定义；creation-pipeline.md:65 直接用。
**C3. "槽位"** — glossary 无；player.md:24、work-format.md:76 用"位置槽"管理立绘，语义可猜但实现需要精确（几个槽？left/center/right 是枚举还是自由值？）。
**C4. "锚点特征 anchorFeatures"** — bible.md:48、visuals.md:22 定义了用途，glossary 无（可接受，但 keep-list 的"由代码从角色外貌字段拆出"要求外貌字段结构化，bible.md:46 只说"外貌"是文本，字段里没写 anchorFeatures 的存储形态——实现会要决定是子字段还是独立数组，已在 bible.md:48 暗示子字段，够）。
**C5. "占位图"** — 三类占位图（角色/背景/CG）在所有文档用，glossary 无；谁画/内置资源形态未说（内置三张图还是纯色？docs 只说"内置占位图"）。
**C6. "主视觉"** — glossary:55「作品的角色设定与画风基准」太抽象。visuals.md:32 把"角色设定 / 主视觉"当一个确认点；ConfirmVisualPage 把"主视觉"作为风格候选图单独选择（styleSel）。实现时不知道主视觉是一张图、一组设定还是风格描述+参考图。unclear。
**C7. "工作流"** — ux.md:38、ChatPanel 用作"发起工作流"，glossary 无；含义可猜（=一种后台任务），建议进 glossary。
**C8. "运行记录"** — glossary:46 有但 ux.md:29 说"和 Agent 面板同一套显示"，没说它记不记入 project.db（work-format.md:137 说在），够。
**C9. "生成预览流"** — architecture.md:55「图片模型用 openai 官方 SDK（多参考图编辑、透明底、生成预览流、识别审核拒绝）」——"生成预览流"是什么能力？partial images streaming？没定义，其他文档没提。unclear。

### D. 数字/默认值重复出现是否一致

- 同时出图数默认 8：ux.md:71、creation-pipeline.md:57,102、visuals.md:42、glossary:40、mock/settings.ts:66 — **一致**。
- 生图失败重试默认 3：同上各处 + decisions — **一致**。
- WebP q90 有损默认：work-format.md:131、visuals.md:56、ux.md:71、SettingsPage radio — **一致**（Supersedes 链已正确更新：旧决定"统一无损"被 11-20「图片默认有损」替换）。
- 2K=2560×1440：architecture.md:26、visuals.md:55 — **一致**；4K 未给像素值（实现会猜 3840×2160，[INFERENCE] 建议写明）。
- 换表情混合约 200ms：player.md:24 — 单处，无冲突。
- 舞台 16:9/1920×1080：visuals.md:60、player.md:17-18（player 没写 1920×1080 但同义）— **一致**。
- 重试次数："ux 两次" vs "creation-pipeline maxRetries:2+外层2" — **矛盾**（见 B1）。
- 伏笔上限：bible.md:85「单章最多收约 2 条、常驻伏笔最多 12 条、30 章未回收标该收了」— 单处，无冲突。
- 出图阶段"同一张图只画一次/基准图先于差分"：visuals.md:42、creation-pipeline.md:57、glossary:39 — **一致**。
- Electron 45.x / Node 24：architecture.md:46,54 — 一致。

### E. 原型 ↔ docs 差异（UI 功能有无）

**E1. 原型有、docs 没有**
- 导入向导第三步"改编设置"（强度/密度/要求/pauseOnRef，ImportPage.tsx:357-426）：docs 把改编设置放在作品设置（ux.md:72）和导入向导一步都没提。docs 的向导只说"核对作品信息和章节划分"（ux.md:18、product.md:14）。**改编设置在导入时定还是在作品设置里定？**现在原型两处都有，docs 只认后一处。建议 docs 明确导入向导是否含改编设置步。
- "加入已有系列"（ImportPage.tsx:139-171）：docs 没写可以把原文追加进已有工程/系列。一个工程=一个系列（work-format.md:17），那追加的是新卷还是新作品？未定义。blocks-implementation（M4 系列功能前可先搁置）。
- 播放器"只跳过已读"开关（PlayerPage.tsx:1142）：docs 说"不做跳过未读"（player.md:71），那这开关没有意义。要么删，要么 docs 写"跳过固定只跳过已读"。
- 播放器设置多了"对话框不透明度"（PlayerPage.tsx:1132）、"全屏"、"自动播放速度"：docs 列"文字速度和字号"（ux.md:62、player.md:61）没提这几个。属于原型超前，docs 缺。小。
- "对话框样式"两选（PlayerPage.tsx:1159-1173）与 DESIGN.md:27/work-format.md:100 一致。✓
- 章行内操作"全部重试"（ProductionPage.tsx:266-278）：docs 说"重试都失败就停下，标需要处理"，没说可以"全部重试"一键——属于合理的 UI 补全，建议 ux.md 提一句。
- 全局状态点开看队列（AppShell.tsx:163-289）含"调整排队顺序"按钮和"等你确认"列表：docs ux.md:12,26 一致。✓
- 模拟异常退出（QueueDrawer "更多"菜单）只是原型演示。✓

**E2. docs 有、原型没有/不一致**
- 拒绝理由（ux.md:40「提议被创作者拒绝时可以填一句拒绝理由，随卡一起退回」）：ChatPanel onReject 直接置 rejected，无输入框。blocks 无、wrong（原型漏做）。
- "预览：在编辑器舞台上从当前句往下播放"（ux.md:56）：EditorPage 有 startPlay（line 430+）。✓
- 差异列表勾选（ux.md:51）：applyDiffs 有。✓
- 存为规则（ux.md:53）：EditorPage saveRule 有本章/本作品二选。✓（但"新规则只影响还没开始的任务"在原型无法体现）
- 修改历史（ux.md:49）：Drawer 有。✓（"撤销只在本次打开内有效"未体现也没法体现，属于 docs 缺口见 B4）
- Agent 面板"编辑器、设定集会把当前位置带给面板"（ux.md:36）：AppShell chatContext + EditorPage "问 Agent"按钮有。✓
- 九个 Agent 角色单独换模型（ux.md:71）：agentRoles 九个全（mock/settings.ts:93-103）。✓
- 图片模型三项能力测试（ux.md:71）：ImageTestResult 三项（SettingsPage.tsx:164-201）。✓
- API Key 掩码（ux.md:71）：原型 TextInput type=password，docs 要求显示"••••"掩码哨兵而非可编辑密文——实现语义不同：docs 是"返回掩码、发回掩码/空串保留旧值"（architecture.md:9），原型是普通密码框。unclear（实现时按 architecture 做即可，原型可忽略）。
- 快捷键 Ctrl/⌘+J（ux.md:36、DESIGN.md:20）：AppShell.tsx:155 显示"Ctrl J"不含 ⌘。小。
- 作品设置包含全部项（ux.md:72）：SettingsDrawer 覆盖改编/出图/播放器/规则四组，**缺"改编要求"可编辑、缺"忠实度/文风审稿"两个开关、缺"章级规则"**——改编要求 textarea 有（WorkPage.tsx:304），审稿只有一个旧开关（见 B3），章级规则没有入口（docs 说规则作用域本章或本作品，work 设置抽屉只有本作品规则；章级规则靠编辑器"存为规则"，可以接受）。
- "导入的作品"栏显示 vN（LibraryPage.tsx:339）✓；版本更新替换提示（ux.md:78）ImportPackageModal 有 sameId 检测。✓
- "需要处理章节导出提醒"（ux.md:80）：ExportModal 有 Banner 列章。✓
- 用量统计"按作品、阶段、模型和时间（天/月）"（creation-pipeline.md:106）：UsagePage 全覆盖。✓（阶段列表含"对话"——docs 没说用量面板按"阶段"分哪些，mock/usage.ts:23 的阶段词与制作步骤词不完全对应：制作步骤显示词是 写/审稿/演出/出图，用量阶段是 全书预览/综合/写剧本/审稿/演出/出图/对话——"写"vs"写剧本"不统一，小）
- "全局制作状态"四词（DESIGN.md:53）：globalStatusMeta 四词完全对应。✓
- 章状态四词（DESIGN.md:54）：statusMeta 四词对应。✓

### F. UI 文案 vs DESIGN.md 文案原则

- 状态用词：原型全部用 DESIGN.md 规定的四+四词，未发明新词。✓
- "待确认"（globalStatusMeta）与"确认点 1/2"（LibraryPage.tsx:309、WorkPage.tsx:50）并存——"确认点"是 glossary 术语、用户可见，DESIGN.md 没禁；建议保留但统一叫法（卡片写"确认点 1"、确认页 eyebrow 写"确认点 1 / 2"，一致）。✓
- DESIGN.md「不写说明性小字」：原型有少量 subtitle 和 Tooltip（如 ConfirmFirstPage subtitle tooltip、ProductionPage 预览进度卡说明文），属 ⓘ 提示范畴，可接受。
- "运行记录"按钮（ProductionPage.tsx:130）——glossary 术语用于 UI，一致。✓
- PlayerPage.tsx:141「角色占位图/背景占位图/CG 占位图」——"占位图"未进 glossary 但语义直白，建议进 glossary。
- 内部术语泄漏检查：UI 文案中未出现 pi、TypeBox、schema、nvs、素材名、指令、行内标签等内部词。✓（settings 的"上下文长度"、"采样参数"是模型配置术语，属于 Creator 面向的功能性词汇，可接受；"工作流"只在代码注释里。）

### G. 其他散点

- work-format.md:70「指令全集在 M1a 定稿」——M1a 实现者必须自己写全集，docs 只给参数集；这是已知待定不是缺陷，但要在报告里点名（M1 猜测项 #1）。
- work-format.md:92「句子 ID 写在行尾…模型改写已有的行时保留原 ID」「模型输出的新行在保存时补上 ID」——补 ID 是应用做的，模型输出不带 ID；那"剧本检查查句子 ID"（work-format.md:88）查什么？查重/查格式？unclear（小）。
- work-format.md:84「cont（在句子 ID 前）」——语法 `lin-xiao: … cont #a3f9`？示例里没有 cont 用例，unclear（小）。
- creation-pipeline.md:7 说 TXT 章识别规则参考 legado（GPL）"只作数据参考、用自己的规则"——已注 license 处理。✓
- player.md:11 WebGAL 两态舞台 MPL-2.0"按文件级 copyleft 重写不拷"——license 已注。✓
- bible.md:32 说 evidence[].quote 到 M2 才加——但忠实度检查（M1b）要求"每条问题必须引用原文段落、由代码核对引文确实在原文里"（creation-pipeline.md:55），审稿的引文从哪来？答：审稿引的是**原文**不是设定集 evidence 字段，不矛盾但容易误读——建议 creation-pipeline.md:55 写清"审稿引原文段落，与 bible 的 evidence[].quote 无关"。unclear（小）。
- ux.md:71「API Key 在设置页只显示掩码（••••）…保存时掩码或留空表示沿用旧值」+ architecture.md:9「配置查询返回掩码哨兵」一致。✓
- architecture.md:69 事件 envelope + ring buffer + events.list：docs 级已够，实现细节留 spec。✓
- product.md:46 M0 说"接通 pi 1.x"——决定用 pi-agent-core 1.6.x，docs 写 1.x 偏宽但不算错；建议写 1.6.x 锁住。unclear（小）。
- ux.md:18「原文没有分卷时，整理角色在这一步按剧情段落建议分卷」vs product.md:47「M1a 没有界面：…整理角色的分卷建议直接写进工程，核对向导（含分卷修改）在 M1b」——一致（M1a 自动写建议、M1b 才可改）。✓
- prototype/src/pages/work/WorkPage.tsx:297「已记录：下次制作前会再问一遍预设（演示）」——"调整"改编强度/密度是演示 stub；docs 没说制作中能否改预设，也没说改了何时生效（新规则只影响未开始任务——预设同理？）。unclear。
- prototype App.tsx：无 `/work/:id/chat` 路由——面板在 AppShell 内嵌（正确，docs 说盖在右侧）。✓

## 3. 对照现有设计

| 发现 | 状态 | 引用 |
| --- | --- | --- |
| A1 "已发布"与"需要处理"关系 | **缺口**：两文档各自陈述但没定义状态叠加关系；应在 ux.md:24 或 DESIGN.md 状态词处补定义 | ux.md:24,30 / creation-pipeline.md:59 |
| A2 preview 期全局状态词 | **缺口**：ux.md 全局制作状态一节 | ux.md:12 / DESIGN.md:53 |
| A3 "等待"进入条件 | **缺口**：ux.md 章状态段 | ux.md:24 |
| A4 章失败→整部作品暂停 | **缺口**（决定有、docs 没有）：creation-pipeline.md §4.2 | decisions.md:582 |
| A5 崩溃=已停止语义 | **缺口**：ux.md §托盘、退出与崩溃恢复 | ux.md:86 |
| B1 ux 重试描述过时 | **冲突**：ux.md:30 vs creation-pipeline.md:64（后者与 decisions.md:636-642 一致） | ux.md:30 |
| B2 通知第三种 vs 四种 | **冲突**：creation-pipeline.md:69 vs ux.md:32/player.md:89 | creation-pipeline.md:69 |
| B3 审稿两档进原型 | **冲突**（原型侧）：mock/types.ts:70、WorkPage.tsx:317、ProductionPage.tsx:52 vs ux.md:72/creation-pipeline.md:55 | decisions.md:644-650 |
| B4 撤销会话级/文件关联/回收站/放大模型约束 | **缺口**：分别进 ux.md:49、ux.md:77-78、visuals.md:55 | decisions.md:582 |
| C 术语未定义（红线/降敏/槽位/占位图/主视觉/工作流/生成预览流） | **缺口**：glossary.md | glossary.md:16-62 |
| D 数字一致性 | **已覆盖**：8/3/q90/2K/16:9 全部一致 | 见 2.D |
| E1 导入向导改编设置步/加入已有系列 | **缺口**（docs 缺）或**冲突**（原型超前）：ux.md:18 | ImportPage.tsx |
| E1 播放器"只跳过已读"开关 | **冲突**：player.md:71「不做跳过未读」 | PlayerPage.tsx:1142 |
| E2 拒绝理由 | **冲突**（原型漏）：ux.md:40 | MessageView.tsx:201 |
| F 状态词与命名 | **已覆盖**：四+四词、Novelive Agent 一致 | DESIGN.md:53-55 |
| 剧本指令全集 | **缺口**（已知待定）：work-format.md:70 | work-format.md:70 |
| 用量阶段词 vs 步骤显示词 | **冲突**（小）：mock/usage.ts:23"写剧本"vs glossary:37 步骤词"写" | mock/usage.ts:23 |

## 4. 可拷资产

本轮审查不产出可拷资产。可复用结论：
- `prototype/src` 控件库和 tokens 是正式代码复用源（decisions.md:319 已定）；其中 `components/lucideMap.ts` 的"Material 命名→lucide 图标"映射是为旧图标名兼容的 shim，正式实现时应直接用 lucide 名、不要把这个映射带过去（lucideMap.ts:16 注释自承"名字沿用原型早期的 Material 命名"）。
- `prototype/src/mock/types.ts` 的 `WorkPhase`/`ChapterStatus`/`GlobalStatus` 枚举可当 spec 初稿，但 WorkPhase.preview 的状态词归属（A2）和 attention vs published 关系（A1）要先定。

## 5. M1 实现者要猜的 Top 10

1. **剧本指令全集**：只给了参数集（转场/缓动/粒子/滤镜名单），`@show/@move/@cg/@caption` 等的参数签名、默认值表、非法参数处理全部要在 M1a 自己定（work-format.md:70 明说"指令全集在 M1a 定稿"）。
2. **project.db 的表结构**：work-format.md:106 列了存什么（任务状态、用量、对话树、提议、修改历史、运行记录），没有 schema；任务的状态机（每章写/审稿/演出/出图四步的持久化粒度、中断恢复点）要设计。
3. **"已发布" vs "需要处理"的状态模型**（A1）：占位图章算什么状态，影响 DB、IPC 事件、UI 三处。
4. **`novelive://` 协议 URL 形态**：包内资源如何寻址（`novelive://<workId>/assets/...`？）、加载时编译产物是否缓存、工程文件夹和 .novelive 包两种源的统一层。
5. **pi 之上的会话/子 Agent/压缩脚手架**：决定指向 `.workflow/research/agent-orchestration.md` 和 `pi-scaffolding.md`，但 Novelive Agent 的编排循环（一章内写手→审稿→美术导演→画师的调用协议、工具集、上下文切片组装）要从零设计——"每次现拼上下文、不留对话"（decisions.md:591）意味着每步都是一次性 prompt 组装，组装函数是最大的设计量。
6. **预览切段与"按剧情段落建议分卷"的具体做法**：超长章按段落边界切段预览（creation-pipeline.md:7）——段落怎么界定、预览 JSON 的 pi-schema 字段、整理角色建议分卷的 prompt 输入输出格式。
7. **导入管线净化与章识别规则的代码形态**：`{name, pattern, kind, example, enable}` 规则表有了思路，但 legado 规则集的具体内容、净化正则清单、EPUB nav→NCX→h1/h2→spine 兜底链每一步的数据结构要现写。
8. **"全书预览"与"按卷综合"的边界**：第一卷预览完→综合→开做，但综合产出剧情骨架/设定集/术语表的输入是"本卷各章预览 JSON"，输出 schema、冲突检测规则（和已确认设定冲突的判定）未定。
9. **两个确认点的任务模型**：确认点 1 的候选（3 版设定图+参考图筛选）是同步生成还是入出图队列、候选数据结构存哪（candidates/）、确认后如何转成 bible 角色条目 + 造型基准图任务。
10. **IPC 契约面**：commands/events 清单（启动/停止/继续制作、队列查询、章状态、确认点数据、运行记录流、编辑器命令）——architecture.md:65-72 只给了信封和机制，消息全集要在 M0/M1a spec 里定。

## 6. 需要所有者取舍的事

1. **"需要处理"是状态还是标记**（A1）：建议定义为"章保持已发布 + 挂需要处理标记"，理由：占位图章本来就能玩，把它踢出"已发布"会让"全部章节已发布"的完成态永远达不到；标记可独立清除。若选互斥状态，要补第五个词或改 DESIGN.md。
2. **忠实度检查能不能关**（B3 附带）：docs 语气是"默认开"暗示可关；建议明确"可关，默认开"——给所有者一个压质量的开关但默认保住质量底线。
3. **改编强度/演出密度何时可改**（G 末条）：建议"作品设置随时可改，只影响还没开始的任务"（与规则同理），一句话进 ux.md:72 或 creation-pipeline.md §3。
4. **"加入已有系列"要不要留**（E1）：建议第一版砍掉（导入即新建系列），M4 做系列功能时再定追加语义；现在要砍的话改原型 ImportPage。
5. **"只跳过已读"开关**（E1）：建议删掉，跳过固定只跳过已读（与 player.md:71 一致），省得暗示有"跳过未读"。
6. **"生成预览流"**（C9）：architecture.md:55 这个词要么解释（是 OpenAI images 的 partial image streaming 吗？）要么删掉——实现者看到会以为有未说明的需求。
