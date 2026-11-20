<!-- workflow:start -->
# Decisions

Append-only log of hard-to-reverse choices where a real alternative was rejected
(CONVENTIONS §1). Skip routine implementation details and choices already stated
in a spec, `standards.md`, or module contract. Git union-merges concurrent
additions, so entries may interleave out of date order; cite by
`decisions.md: <date> - <title>`.

## Format

Add `## <YYYY-MM-DD> - <title>` entries under `## Entries`. Every entry requires three
non-empty English field names (values may be in any language):

- **Decided:** what was chosen
- **Instead of:** the strongest alternative that lost
- **Because:** why it lost here

Optional: **Effort** (the `<slug>` the decision belongs to), **Decided by** (`user` or
`agent`; on parallel branches include the task ref, e.g. `agent (core/04)`, so
concurrent entries never share identical trailing lines under union merge),
**Revisit when** (condition that reopens the decision as a question for `flow-grill`,
and that `flow-architect` consults), and **Supersedes** (`<YYYY-MM-DD> - <old title>`;
leave the older entry untouched so the file stays strictly append-only).

User waivers of a `Check` or a review finding are recorded in the task file
(`Check waived` / `Review: waived`), not here.

```markdown
## 2026-01-31 - Retries capped at 3, no backoff

- **Decided:** three immediate retries, then fail.
- **Instead of:** exponential backoff with jitter.
- **Because:** the only caller retries within a single user request; a 30-second
  backoff would outlive the request it is serving.
- **Effort:** demo
- **Decided by:** user
- **Revisit when:** a background job starts calling this.
```
<!-- workflow:end -->

## Entries

## 2026-11-20 - 新仓库重建，旧仓库只读封存

- **Decided:** 旧实现封存到 `Novelive-legacy`（分支 `archive/mvp1-10-legacy`），在新仓库从头开始；旧代码的取用见“旧仓库代码按需取用”。
- **Instead of:** 在旧仓库上修补。
- **Because:** 旧仓库约 22 万行，生产路径没有接通（没有 Agent 处理器、没有凭据存储、没有真实 Prompt），大量冻结契约和门禁让修改成本高于重写。
- **Decided by:** user

## 2026-11-20 - 首要用户是创作者

- **Decided:** 首要用户是创作者/搬运者：把小说做成视觉小说、打磨后导出分享；玩家用同一应用免配置游玩。
- **Instead of:** 以普通读者为首要用户、零门槛自动制作。
- **Because:** 自备 API 的门槛决定了早期用户就是创作者；成品质量依赖创作者修改，所以第一版就带编辑器。
- **Decided by:** user

## 2026-11-20 - 只做 Electron 桌面应用，不做本地 HTTP 服务

- **Decided:** Windows/macOS/Linux 三平台 Electron 应用；界面与后台用 IPC，资源走自定义协议。不做网页播放器。
- **Instead of:** 浏览器界面 + 本地 Companion HTTP/WebSocket 服务，后期再包 Electron。
- **Because:** 本机通信不需要令牌、CORS、WS ticket、幂等键那一层；旧仓库这部分约 5 万行。
- **Decided by:** user
- **Revisit when:** 需要网页播放器或移动端。

## 2026-11-20 - 作品格式只有一种，作品包可再编辑

- **Decided:** 作品包存语义化剧本 + 设定集 + 术语表 + 分层素材，播放器加载时编译；作品包可导入为新工程继续编辑；原文可选带入，默认不带。
- **Instead of:** 创作格式与运行格式两层，包内只放编译后的运行格式。
- **Because:** 所有者要求作品包可二次编辑；包里既然要带创作数据，再维护一层运行格式只增加兼容负担。
- **Decided by:** user

## 2026-11-20 - 不做防御性设计

- **Decided:** 文档和代码都不预设防御性策略：不设并发上限、重试次数与退避、超时、TTL、保留期、阈值；不为作品包设计安全模型（安全底线、沙箱、体积/数量上限、校验流程）。真遇到问题再随实现处理。文档不设冻结状态、不写 ADR。
- **Instead of:** 旧方案把这些写成冻结契约；以及“作品包只保留不含可执行代码、路径不越界的安全底线，取消自定义 CSS 改为主题参数”这类收缩版防御方案。
- **Because:** 所有者明确不要这类设计；它们没有真实使用数据支撑，只增加实现和修改成本。
- **Decided by:** user

## 2026-11-20 - 长篇按卷理解、按卷制作

- **Decided:** 全书逐章预览（可用快速模型），按卷综合，第一卷理解完即可开始制作。
- **Instead of:** 整本书预览与综合全部完成后才开始制作。
- **Because:** 长篇网文（数百上千章）整本先行的等待时间和花费过高。
- **Decided by:** user

## 2026-11-20 - 花费只做统计参考

- **Decided:** 用量统计面板，按作品、阶段、模型、时间汇总，能拿到单价时显示参考金额。
- **Instead of:** 开工前估算 + 预算上限自动暂停。
- **Because:** 所有者只要参考数据，不要额度管控。
- **Decided by:** user

## 2026-11-20 - 第一版不做联网搜图、只做直接跨语言改编

- **Decided:** 角色参考来自创作者参考图、EPUB 插图和 AI 生成的候选；跨语言只走直接生成目标语言剧本。
- **Instead of:** 联网搜索视觉资料候选包；先整本翻译再制作的第二条路径。
- **Because:** 两者代码量大、收益不确定，第一版先保证主路径。
- **Decided by:** user
- **Revisit when:** 创作者普遍缺少参考图，或需要忠实全文翻译。

## 2026-11-20 - 同一时间只制作一部作品

- **Decided:** 一部作品在制作，其余排队，可调整顺序。
- **Instead of:** 多部作品并行、按权重分配并发。
- **Because:** 并行调度带来权重、预备窗口等复杂度，创作者通常一次专注一部。
- **Decided by:** user

## 2026-11-20 - 不再使用 AstraLoom 品牌

- **Decided:** 应用只叫 Novelive；创作 Agent 另起名（待定）。
- **Instead of:** Novelive（播放）+ AstraLoom（创作）双品牌。
- **Because:** 创作和游玩在同一个应用里，双品牌没有必要。
- **Decided by:** user

## 2026-11-20 - 创作 Agent 直接叫 Novelive Agent

- **Decided:** 创作 Agent 不单独起名，中英文界面都叫 Novelive Agent，界面上下文明确时简称 Agent。
- **Instead of:** 单独起名（考虑过 跃然/Elan、栩栩、走马、画外/Offscreen、格外、意澜/Elan、Saelin 等）。
- **Because:** 现成的词和短造词在 AI 领域大多已有同名产品；中英文名配对总有一边别扭。直接沿用产品名不用查重，也不用解释。
- **Decided by:** user
- **Revisit when:** 需要给 Agent 一个独立的角色形象或对外品牌。

## 2026-11-20 - 透明立绘由图片模型直出，不做色键抠图

- **Decided:** 立绘直接请求透明底 PNG，不做纯色背景提示和本地色键抠图；生成后可能需要放大、降噪等处理。
- **Instead of:** 纯色背景 + 本地色键抠图（旧 ADR-0007 和 `workers/image-worker`）。
- **Because:** 现在的图片模型能直接输出透明底。
- **Decided by:** user

## 2026-11-20 - 第一版图片模型只接 OpenAI 兼容接口

- **Decided:** 图片模型只实现 OpenAI 兼容的图片接口，可填自定义地址；文本模型交给 Agent 底座接入。
- **Instead of:** 同时为 Gemini、Seedream 等写原生适配。
- **Because:** 一个适配加上自定义地址就能覆盖大多数服务，第一版不维护多套适配。
- **Decided by:** user
- **Revisit when:** 需要的图片模型没有 OpenAI 兼容接口。

## 2026-11-20 - 作品级 Agent 对话面板

- **Decided:** 每部作品有一个和 Novelive Agent 对话的面板，可以讨论、让 Agent 修改设定集/术语表/改编要求或重做指定章节；Agent 提出的修改一律经创作者确认后才生效，重做的章节进入制作队列；聊天记录保存在工程里。
- **Instead of:** 只在编辑器里对单个场景下指令。
- **Because:** 创作者需要在作品层面调整方向，只靠改编要求和规则不够直接。
- **Decided by:** user

## 2026-11-20 - 只有两个确认点

- **Decided:** 确认点只有“角色设定/主视觉”和“第一章成品”。已有参考图时是否在“角色设定/主视觉”停下，由作品设置决定。导入后核对作品信息和章节划分是向导里可跳过的一步，不算确认点。
- **Instead of:** 把导入核对也做成必须停下的确认点。
- **Because:** 所有者只要这两处停顿。
- **Decided by:** user

## 2026-11-20 - 只有“立即停止”，临时错误交给 SDK 重试

- **Decided:** 制作只有“立即停止”一种停法，下次继续时重新执行被中断的任务；网络、限流这类临时错误只用 SDK 或 Agent 底座自带的重试，失败就标“需要处理”。
- **Instead of:** 普通暂停加立即停止两档；自己实现自动重试。
- **Because:** 重新执行被中断的任务就能接着做，不需要“等在途请求跑完”的暂停；自己写重试属于防御性设计。
- **Decided by:** user

## 2026-11-20 - 编辑立即生效，靠撤销兜底

- **Decided:** 编辑器的修改立即生效，有撤销和修改历史；Agent 重写场景先给差异列表，勾选后应用。
- **Instead of:** 草稿副本 + “应用修改”。
- **Because:** 所有者选择直接生效。
- **Decided by:** user

## 2026-11-20 - 立绘画膝上或半身，素材层级简化

- **Decided:** 立绘画膝上或半身，按头顶或腰线对齐；素材层级为 角色 → 造型 → 表情、地点 → 变体，CG 单独一类。
- **Instead of:** 全身立绘按脚底对齐；角色 → 造型 → 姿态 → 表情、地点 → 视角 → 变体。
- **Because:** 所有者的选择；层级少一层，生成和管理的素材也少。
- **Decided by:** user

## 2026-11-20 - 同一系列共享设定和素材

- **Decided:** 同一系列的作品可以共享设定集、术语表和素材，下级的卷或作品可以覆盖。
- **Instead of:** 每部作品完全独立，或者只复制一份当起点。
- **Because:** 所有者的选择。
- **Decided by:** user

## 2026-11-20 - API Key 存在应用配置文件

- **Decided:** API Key 存在应用配置文件里，明文或简单加密都可以。
- **Instead of:** 系统安全存储（钥匙串 / 凭据管理器 / Secret Service）。
- **Because:** 方便备份和迁移。
- **Decided by:** user

## 2026-11-20 - 保留 Python 进程做放大和降噪

- **Decided:** 保留一个 Python 进程，专门负责放大、降噪这类模型处理。
- **Instead of:** 全部在 Node 里做（sharp + ONNX Runtime）；或者交给 API、本地不跑模型。
- **Because:** 所有者的选择；超分、降噪模型在 Python 生态里最成熟。
- **Decided by:** user

## 2026-11-20 - 代码分五块，播放器不依赖创作端

- **Decided:** 分为作品格式与编译器、播放器、创作端、界面、Electron 宿主五块；播放器不依赖创作端。
- **Instead of:** 先做成一个应用、内部按目录分层；或者像旧仓库那样拆成十几个包。
- **Because:** 所有者的选择。
- **Decided by:** user

## 2026-11-20 - 界面先行

- **Decided:** 一开始就做带界面的完整流程，边用边调质量。里程碑见“里程碑顺序”。
- **Instead of:** 先用命令行跑通一本真书、质量过关后再做界面。
- **Because:** 所有者的选择。
- **Decided by:** user

## 2026-11-20 - 以 AGPL-3.0 开源

- **Decided:** 仓库以 AGPL-3.0 开源。
- **Instead of:** GPL-3.0；MIT / Apache-2.0。
- **Because:** 所有者要传染性协议，并且要防止别人拿去做在线服务却不开源。
- **Decided by:** user

## 2026-11-20 - 创作端单独开后台进程，Python 走标准输入输出

- **Decided:** 创作端运行在 Electron utility process；Python 放大降噪进程由创作端启动，通过标准输入输出通信。
- **Instead of:** 创作端放进 Electron 主进程；Python 进程开本地端口。
- **Because:** 长时间的模型请求和图片处理不能卡住窗口和托盘；创作端崩溃时应用不跟着退出。标准输入输出不占端口，也不需要鉴权。所有者把这项选择交给了 agent。
- **Decided by:** agent

## 2026-11-20 - Agent 底座用 pi

- **Decided:** 文本模型和工具调用通过 pi（`@earendil-works/pi-ai`、`@earendil-works/pi-agent-core`）接入，作为库直接嵌在创作端进程里。
- **Instead of:** dsh（DeepSeek Harness）；或两个都试接后再选。
- **Because:** pi 是可以直接嵌入的库，能单独取消某个请求，Key 可以在代码里直接传入。dsh 官方的嵌入方式是另起子进程，协议里没有取消请求，自带数据目录，处于开发者预览阶段，而且它的多家模型支持本身就是包了一层 pi-ai。
- **Decided by:** user
- **Revisit when:** pi 停止维护，或出现不能接受的破坏性改动。

## 2026-11-20 - Schema 用 TypeBox

- **Decided:** 全项目只用 TypeBox 定义数据格式，同一份定义用于作品包检查、代码类型和模型输出格式与工具参数。剧本例外，见“剧本用文本语言，一个场景一个文件”。
- **Instead of:** Zod；手写 JSON Schema 再转换（旧仓库的做法）。
- **Because:** pi 直接使用 TypeBox，不需要转换；TypeBox 定义本身就是标准 JSON Schema，可以直接对外发布。
- **Decided by:** user

## 2026-11-20 - 工程幕后数据用 SQLite

- **Decided:** 任务状态、用量记录和对话记录存在工程里的一个 SQLite 数据库文件中；作品内容仍然是普通文件。
- **Instead of:** 全部用 JSON 文件。
- **Because:** 一部上千章的书会有几万条任务和用量记录。SQLite 更新单条快、崩溃时不会写坏，用量汇总一条查询就能得出。
- **Decided by:** user

## 2026-11-20 - 文本类型与文本标记

- **Decided:** 文本分对白、内心独白、旁白、字幕四种；每句话可以单独指定显示名。文本标记内置强调、加粗、弱化、小声、大喊、扭曲、高亮七种，作品可以自定义标记，样式写法不加限制；模型可以提议新标记，创作者确认后生效。支持注音，模型改编时可以加，创作者在编辑器里可以加、改、删。允许句中停顿和变速：点击直接补完整句，自动播放照常执行，跳过已读忽略；模型改编时可以加，创作者在编辑器里可以加、改、删。
- **Instead of:** 两三种文本类型；少量标记或不要标记；自定义标记只能从固定属性组合；句中不允许停顿和变速（旧仓库的做法）。
- **Because:** 小说里内心独白、身份未揭晓的角色、日文注音都很常见；所有者要更丰富的演出效果，自定义标记的样式不需要考虑安全限制。
- **Decided by:** user

## 2026-11-20 - 旧仓库代码按需取用

- **Decided:** 做到哪块再取哪块，取的时候删掉多余的层。分三类：
  - 改写后搬过来：`source-import` 的 TXT 编码识别、章节识别和 EPUB 解析（删掉 `SourceSecurityLimits` 和混在 `src/` 里的测试样本）；`integrations/openai-images` 的调用路径（补自定义地址）；`save-system` 的存档按 ID 迁移逻辑；`publisher` 的确定性 ZIP 写入和按单部/整卷/整个系列组装导出内容；`package-kit` 的 ZIP 读取。
  - 只作参考：`runtime`（点击、跳过已读、存档指针的思路）、`compiler`（时间线展开）、`authoring` 的 Schema（作品格式从头设计）、`integrations/pi-agent`（在 pi 1.x 上重写薄适配，参考错误分类和用量累加）、`workers/image-worker`（通信协议和 `checks.py`）、`library`/`workspace`（分步提交和崩溃恢复）。
  - 忽略：`packages/orchestration`、`services/companion`、`hosts/native-helper`、`packages/contracts`、`packages/domain`、门禁脚本、色键抠图。
  - 界面（`apps/web`、`prototype`、tokens、控件库）和图标先不取，等界面重新评估。
- **Instead of:** 一行都不搬；能搬的尽量搬；先一次性搬完再开始做。
- **Because:** 原文导入、导出、存档迁移这几块逻辑扎实，并且和新设计一致；调度引擎、本地服务、契约层实现的正是新设计不要的东西。作品格式是核心，所有者要求从头设计。
- **Decided by:** user

## 2026-11-20 - 剧本用文本语言，一个场景一个文件

- **Decided:** 剧本用文本剧本语言写，一个场景一个 `.nvs` 文件；TypeBox 定义解析后的结构，播放器、编辑器、编译器共用。模型直接输出剧本文本，解析错误交回模型修改。设定集、术语表、作品信息仍用 JSON + TypeBox。指令词、行内标签、角色和素材名用英文。演出写意图，参数可选，默认值由编译器给。每句对白、内心独白、旁白等一次点击，前面的指令与它同时生效；纯演出段落用 `@wait`，字幕默认不等。
- **Instead of:** 剧本用 JSON；一章一个文件；行内效果拆成片段数组；只写意图不允许参数；每条指令各等一次点击；指令词用中文。
- **Because:** 所有者的选择：文本剧本人好读好写，模型输出省 token。
- **Decided by:** user

## 2026-11-20 - 剧本 ID 与素材命名

- **Decided:** 场景和句子由应用分配随机短 ID，模型不写；场景 ID 是文件名，句子 ID 写在行尾，模型改写已有行时保留原 ID。角色、造型、表情、地点、变体、CG 用可读英文名，创建后不改。
- **Instead of:** 全部用随机 ID；句子按位置编号；ID 另存对照表。
- **Because:** 存档、已读、修改历史要在内容修改后仍能对上；可读名让模型写剧本时不用查表；行尾 ID 在应用外改过文件也不会错位。
- **Decided by:** user

## 2026-11-20 - 作品包结构、版本与覆盖

- **Decided:** 一个工程对应一个系列，单部作品是只有一卷一部的系列。系列、卷、作品三层各有设定集、术语表、标记样式和素材，下级同 ID 条目整条替换上级。每部作品有固定 ID，每次导出版本号自动加一，作品包记录来源作品。原文对照记到场景。自定义标记样式直接写 CSS，带“逐字”开关。图片统一存无损 WebP。
- **Instead of:** 按字段合并覆盖；创作者手填版本号；原文对照记到每一句；只写 CSS 不做逐字；存 PNG 或保留模型原格式。
- **Because:** 整条替换看条目时不用把几层合起来；自动版本号省事且玩家端按作品 ID 判断更新；场景级原文范围模型不容易写错；WebP 让上千章作品的包小很多。
- **Decided by:** user

## 2026-11-20 - 设定集与术语表的字段

- **Decided:** 设定集包括角色、角色关系、地点、剧情骨架、时间线、伏笔、风格；CG 描述跟着章节走。角色、关系、地点带“变化”列表，模型写第 N 章时只拿到截至第 N 章的设定。表情先登记一套基础表情，模型用到新表情直接登记，第一次用到才画。角色名、地名只记在设定集里，术语表管其余专名，记原文写法、作品里的写法、注音、类别、备注。不冲突的候选直接用于制作，冲突的继续用已确认版本、不阻塞。描述文字用作品语言。全书预览结果存在 `source/preview/` 的普通文件里，跟原文一起导出。
- **Instead of:** 只记最新状态或只靠卷级覆盖；每个角色单独列表情或预先定死表情；专名全部进术语表；制作只用已确认条目；预览结果存 SQLite 或并进设定集。
- **Because:** 按章节生效的设定不会剧透，也不会画错时期；名字只记一处就不会两边不一致；只有两个确认点，候选不能阻塞制作；预览结果每章只写一次，又是从原文来的。
- **Decided by:** user

## 2026-11-20 - 剧情里的外貌变化开新造型

- **Decided:** 外貌在某一章变化时，从这一章起开一个新造型；旧造型的图在之前的章节照用，已画好的图不标过期。
- **Instead of:** 沿用原造型名，靠“过期”标记提醒重画。
- **Because:** 素材名里不带时间，沿用原名会把旧外貌的图用到后面的章节；标过期又会把前面本来正确的图一起标上。
- **Decided by:** user

## 2026-11-20 - 里程碑顺序

- **Decided:** 界面设计 → M0 骨架 → M1 最薄的完整链路 → M2 编辑器与 Agent 对话 → M3 播放器补全 → M4 长篇与调度补全 → M5 分享与发布。角色长相一致的试验放在 M1 出图时；安装包放在 M5，之前只在开发模式下跑、只测 Linux。
- **Instead of:** 先做完整播放器再接创作链路；界面设计与 M0、M1 并行或放到最后；M0 就做试验；M0 就搭三平台打包。
- **Because:** 最早碰到风险最大的环节（模型能否稳定写出合格剧本、图能否画得一致）；所有者要求界面设计先定。
- **Decided by:** user

## 2026-11-20 - 界面风格保留，导航改侧边栏

- **Decided:** 保留暖灰纸 + 玻璃 + 轻浮雕的风格；全局导航改为左侧边栏，进入作品后侧边栏出现该作品的分区。
- **Instead of:** 旧原型的底部胶囊导航；换一套新风格。
- **Because:** 所有者的选择。
- **Decided by:** user

## 2026-11-20 - Agent 面板盖在右侧，播放器做成游戏界面

- **Decided:** Agent 入口从侧边栏导航项改成作品分区下的单独按钮（Ctrl/⌘+J），面板盖在主区域右侧、不挤压页面、可以全屏，并带上当前位置。播放器做成独立的游戏内界面（参考柚子社），直接从上次进度进入、不做标题画面，一套默认皮肤按作品主色着色；创作调试用编辑器里的预览，播放器里只多一项“在编辑器中打开这里”。
- **Instead of:** 侧边栏开关一块挤压页面的面板；“对话”做成整页；播放器带标题画面；每部作品单独生成皮肤；播放器里放调试浮层。
- **Because:** 侧边栏只做跳转，行为一致，面板不打乱编辑器布局；游玩要像真的进入游戏；按作品主色着色第一版可控。
- **Decided by:** user

## 2026-11-20 - 原型只作参考，控件库和 Tokens 复用

- **Decided:** `prototype/` 只作视觉和交互参考；正式代码复用其中的控件库和 Tokens，页面接真实数据层重写。
- **Instead of:** 把原型页面直接改造成正式页面。
- **Because:** 原型页面全是假数据和行内样式，搬过去比重写更费事。
- **Decided by:** user

## 2026-11-20 - 技术选型

- **Decided:** 一块一个包，用 pnpm workspaces；electron-vite 负责构建、electron-builder 负责打包；React 19 + React Router + Zustand；CSS Modules 加 Tokens；i18next；TypeBox、`node:sqlite`、sharp、yauzl/yazl；Vitest + Playwright；Biome。完整清单见 `docs/architecture.md`。
- **Instead of:** Electron Forge（Vite 插件仍是实验性）；一个包分目录、靠 lint 规则守边界；vanilla-extract 或 Tailwind；Lingui；ESLint + Prettier。
- **Because:** 依赖方向由包声明自然约束，不再重蹈旧仓库自写架构检查脚本的覆辙；选的都是不碰构建或有官方支持的稳妥方案；sharp 接走非模型图片处理，Python 只管放大和降噪。
- **Decided by:** user

## 2026-11-20 - 界面图标换成 lucide

- **Decided:** 界面和播放器统一用 lucide 细线图标（线宽 1.8），去掉 Material Symbols。
- **Instead of:** 界面沿用 Material Symbols、播放器用 lucide 的两套并存。
- **Because:** 并排对比后 lucide 线条统一、更安静，和纸感玻璃风格更搭；Material 图标字体约 4 MB，lucide 只打包用到的 SVG。
- **Decided by:** user

## 2026-11-20 - 文本模型按接口格式配置

- **Decided:** 文本模型配置为接口格式（OpenAI Chat Completions / OpenAI Responses / Anthropic Messages）+ 接口地址 + 模型名 + API Key，三种格式都要支持，地址可以自定义。
- **Instead of:** 原型里的“服务 + 模型”下拉，只能选内置的几家供应商。
- **Because:** 三种格式覆盖官方接口和绝大多数中转、兼容服务；pi 对三种格式都有实现，填自定义地址即可。
- **Decided by:** user

## 2026-11-20 - 开发期远程仓库

- **Decided:** 开发期间使用 `https://github.com/Yume2333/Novelive-dev` 作为远程仓库，CI 用这个仓库的 GitHub Actions，M0 就配好。
- **Instead of:** 等正式仓库建好再配远程和 CI。
- **Because:** 有了远程仓库，CI 从 M0 起就能对每次推送跑检查。
- **Decided by:** user

## 2026-11-20 - API Key 简单加密

- **Decided:** API Key 用写在程序里的固定密钥简单加密后存进应用配置文件。
- **Instead of:** 明文存储。
- **Because:** 防止别人扫一眼配置文件就看到 Key；密钥在开源代码里，挡不住有意读取的人。
- **Decided by:** user

## 2026-11-20 - 导入的作品和存档放哪

- **Decided:** 导入的 `.novelive` 复制一份到默认工程位置旁的「导入的作品」文件夹（默认 `文档/Novelive/导入的作品`）；存档和已读记录统一放应用数据目录，按作品 ID 分开，自己工程的作品也一样。
- **Instead of:** 作品复制到应用数据目录或原地读取；存档跟着作品或工程走。
- **Because:** 作品图片多、体积大，不该塞进系统盘的应用数据；存档集中放，导出不会带出去，更新时只迁移一处。
- **Decided by:** user

## 2026-11-20 - 画面 16:9，图片模型能力不做检测

- **Decided:** 舞台以 16:9（1920×1080）为基准，窗口比例不同时背景铺满裁切；背景和 CG 直接按 16:9 生成，立绘竖版透明底。默认图片模型支持文生图、透明底和图片编辑，不支持时由创作者自己换模型，应用不检测、不兜底。
- **Instead of:** 按 3:2 生成再裁切；设置页测试时检查透明底和编辑能力并提示；本地抠图兜底。
- **Because:** 现在的图片模型都支持 16:9、透明底和图片编辑。
- **Decided by:** user

## 2026-11-20 - 图片被审核拒绝时改写提示词再试一次

- **Decided:** 图片被内容审核拒绝不算临时错误；让模型把提示词改得含蓄一点再试一次，还被拒才用占位图并标“需要处理”。
- **Instead of:** 直接用占位图。
- **Because:** 小说里打斗、伤亡、亲密场面常见，被拒的图换个写法多半能过，否则一章里可能有好几张占位图。
- **Decided by:** user

## 2026-11-20 - 品牌图标发布前重新设计

- **Decided:** 品牌图标在发布前重新设计；原型里沿用旧仓库的那套只作占位。
- **Instead of:** 沿用旧仓库的墨色书页加陶土色播放头。
- **Decided by:** user
- **Because:** 所有者的选择。

## 2026-11-20 - 角色一致性试验和 Agent 设计稿与 M0 并行

- **Decided:** 角色长相一致的两种做法用真实图片接口做对比试验，看图选定；Novelive Agent 内部设计先写设计稿，确认后 M1 照做。两项都和 M0 并行。
- **Instead of:** M1 里边做边定。
- **Because:** 这两项是 M1 风险最大的部分，提前定下来 M1 不会卡。
- **Decided by:** user

## 2026-11-20 - 界面翻译 M5 前做，应用从 GitHub Releases 自动更新

- **Decided:** 开发期界面只写简体中文，M5 发布前用模型翻译成繁体中文、英文、日文再人工抽查；应用用 electron-builder 的自动更新，从 GitHub Releases 检查下载，用户确认后重启安装。
- **Instead of:** 每个里程碑同步翻译；只提示新版本、手动下载。
- **Because:** 开发中文案一直在变，太早翻译要反复改；自动更新不需要自建服务器。
- **Decided by:** user

## 2026-11-20 - Novelive Agent 的角色与编排

- **Decided:** 五个模型（快速、主模型、写作、视觉、图片），角色（整理、主控、写手、美术导演、视觉审核、审稿）有默认对应、可单独换。整体顺序由代码调度；一章最多三步：写手一章写一次并自己分场 → 美术导演补演出并通过生图工具出图（工具内含技术检查和视觉审核）→ 可选审稿（作品开关，默认关，改一轮不复审）。写手不用工具，走写手预设（文风、输出约束、采样参数、输出替换规则；全局默认 + 作品选用），其他角色提示词内置不开放。对话面板按会话组织、支持分支，发起工作流先出确认卡。会话、压缩、子 Agent、按角色选模型在 pi-ai 和 pi-agent-core 之上自己做，不依赖 pi-coding-agent；生图用 `openai` SDK；对话界面用 assistant-ui + streamdown。详见 `.workflow/research/agent-orchestration.md`。
- **Instead of:** 三个模型；一章拆成分场、逐场写、审稿、返修、演出、出图、视觉审核七步并由主控在中间判断；主控自由调度；完整照搬酒馆预设（提示块排序、深度注入、世界书、导入酒馆预设）。
- **Because:** 七步流程实际跑起来复杂冗余；三步每步可存可续，花费可预期；同一卷内写手提示前缀稳定，能命中提示缓存；pi 跑不出酒馆那套，随意插入也会破坏缓存。
- **Decided by:** user

## 2026-11-20 - 造型基准图重画，表情编辑派生

- **Decided:** 造型基准图参考角色设定图或上一套造型重新画；表情从造型基准图用图片编辑派生，只改脸部。派生出的坏图（没透明通道、画成别人）交给技术检查和视觉审核拦下。
- **Instead of:** 全部编辑派生；全部带参考图重画。
- **Because:** 用测试接口各出 10 张对比：编辑派生姿势位置稳定，换表情不跳，但 10 张坏 2 张；参考重画脸都一致，但每张姿势不同，人物宽度差 100 到 200 像素。见 `.workflow/research/character-consistency.md`。
- **Decided by:** user
