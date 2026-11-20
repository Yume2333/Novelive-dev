# Research: Novelive Agent 内部设计

设计 Novelive Agent 各阶段的内部结构：模型角色、调用形态、上下文组装、输出契约、校验修复、持久化与停止恢复。依据 `docs/` 与 `decisions.md`；pi API 依据 1.5.2 包内 `.d.ts`（见附录）。

> 角色划分、模型槽位、一章的制作流程（写手一章一次并自己分场、美术导演补演出和出图、可选审稿）、写手预设和对话面板以 `agent-orchestration.md` 为准。本文下面的“分场”“逐场写剧本”“图片提示词与出图”“作品级对话面板”几节写于编排讨论之前，和它冲突的地方作废；各阶段的输入、输出契约和校验修复仍作参考。

## Settled & ruled out

- Agent 底座用 pi（`@earendil-works/pi-ai`、`@earendil-works/pi-agent-core` 1.5.x），作为库嵌在创作端 utility process 里。Schema 用 TypeBox，同一份定义给代码、校验和模型。幕后数据（任务、用量、对话记录）进 `project.db`，作品内容是普通文件。
- 三个模型角色：快速模型（全书预览）、创作模型、图片模型。文本模型按接口格式（OpenAI Chat Completions / OpenAI Responses / Anthropic Messages）+ 地址 + 模型名 + Key 配置；图片模型只接 OpenAI 兼容图片接口。
- 只有两个确认点：角色设定/主视觉、第一章成品。候选设定不冲突直接用、冲突不覆盖已确认。剧本是 `.nvs` 文本，ID 由应用分配，模型不写。
- 停止只有立即停止：中断正在跑的请求，重跑被中断的任务。临时错误只靠 SDK/底座自带重试。审核拒绝改提示词再试一次。不做防御性设计：不设并发上限、超时、阈值、自写重试。
- 对话面板修改一律先列为待确认提议；聊天记录存工程；修改立即生效可撤销，Agent 重写场景先给差异列表。
- 不在本设计内的：联网搜图、先整本翻译再制作、作品包安全模型。

## 总体结构

- 一个 `createModels()` 持有按接口格式建的 `Provider`（`createProvider`），文本模型走 `provider.streamSimple`；图片模型绕开 pi，用旧仓库 `integrations/openai-images` 的调用路径直接 `fetch` OpenAI 兼容接口。
- 调用形态分两类：
  - **结构化调用**：一个 `Agent` 实例跑一个 `prompt()`，系统提示给输出契约（TypeBox 定义原样序列化成 JSON Schema 进提示词），模型用纯文本回答 JSON；解析失败时 `prompt()` 再补一轮把错误还给模型。适合单输入单输出的阶段。
  - **工具循环**：`Agent` 挂一组 `AgentTool`，模型多轮读写工程。只给对话面板用：那里操作面宽（查设定、读剧本、提提议），硬编码成一问一答会丢上下文。
- `Agent` 实例随任务创建和销毁，不跨任务复用；停止时 `agent.abort()`，pi 的 `streamFn` 透传 `AbortSignal` 到 provider。被中断的任务在 `project.db` 里保持未完成状态，继续时整个任务重跑。
- 用量：`subscribe` 里按 `turn_end`/`message_end` 收到的 `AssistantMessage.usage` 记一条 `usage` 记录，字段 `作品 ID、阶段、任务 ID、模型角色、模型名、input/output/cacheRead/cacheWrite/totalTokens、cost.total、时间戳`。图片调用按次记一条。

## 提示词组织

- 内部提示词（系统提示、阶段指令、工具描述）用英文写，放进 `creator` 包常量。设定集/术语表/改编要求/剧本等作品数据按 `bible.md` 用作品语言；提示词里只写一句“用作品语言输出描述性文字”。
- 改编控制的注入位置：每个写剧本或改剧本的调用在系统提示末尾拼一段“改编设置”：改编强度、演出密度、改编要求原文、本章规则、本作品规则。规则只列对当前章生效的；新规则在任务启动时快照进任务记录，做到“只影响还没开始的任务”。
- 场景级调用不重复注入全书预览和卷级设定全集；只给本章相关切片（见各阶段）。

## 上下文与长书

- `source/preview/<章节ID>.json` 是长期记忆。写第 N 章时模型拿到的“书”是：卷剧情骨架 + 截至第 N 章的设定集切片 + 术语表（全量，条目短）+ 本章预览条目 + 前一章结尾的场景摘要。
- 设定集切片按 `bible.md` 规则过滤：首次出场在 N 之后的条目不给、“变化”只应用到 N、时间线和伏笔截到 N。过滤在组装上下文时由代码做，不交给模型判断。
- 数百上千章靠两点留在上下文内：预览逐章只存 JSON 文件按需读；综合产物（骨架、设定集）本身就是压缩形态，每章调用只带切片不带原始摘要全集。上一章场景的引用只到“上一场最后几行剧本”，不带整章剧本。

## 全书预览

- **角色/形态**：快速模型，结构化调用。逐章一次调用，不用工具。
- **输入**：作品语言 + 本章正文。超长章节按段落切段，段间带上一段末尾若干句做衔接；每段输出同一份 schema，代码把各段结果合并成一章的条目（拼接列表、拼接摘要为分段摘要）。
- **输出契约**：`ChapterPreview`（TypeBox）：`chapterId`（代码填）、`summary`、`characters`、`locations`、`timelineNotes`、`foreshadowingHints`。ID 由应用从导入时的章节划分来，模型不写。
- **校验/修复**：JSON 解析或 TypeBox 校验失败 → 把错误文本追加为下一轮 user 消息再跑一次。
- **持久化**：写 `source/preview/<章节ID>.json`。一章一个文件，写成功即任务完成；中断的章重跑。

## 按卷综合

- **角色/形态**：创作模型，结构化调用。一卷一次或分块调用（见待定），输出结构化条目，不逐章对话。
- **输入**：本卷各章的 `ChapterPreview` 全文（摘要级，不是原文）、上一级（系列/卷）已有的设定集和术语表、作品语言、改编要求。
- **输出契约**：三个产物。
  - `VolumeSkeleton`：本卷主线概要文本 + 分章一句话进度。
  - `BiblePatch`：角色/关系/地点/时间线/伏笔/风格的条目列表；每条带 `status: "candidate" | "confirmed"`（模型建议）、`firstSeenChapter`、字段内容、`changes` 列表。
  - `GlossaryPatch`：术语条目列表（原文写法、作品写法、注音、类别、备注）。
- **校验/修复**：TypeBox 校验；`firstSeenChapter` 必须是本卷章节 ID，引用关系（变化指向的条目 ID）由代码核对，不存在的引用当错误还给模型。
- **冲突规则在代码里**：应用侧合并时，候选条目和已确认条目同 ID 且字段冲突 → 保留已确认版本，冲突条目仍写进文件标 `candidate` 加冲突说明；不冲突的候选直接可用。模型只负责提条目，合并逻辑不在模型侧。
- **持久化**：骨架写 `volumes/<卷>/bible/skeleton.json`；条目按层级写进 `bible/`、`glossary.json` 文件。任务粒度到卷，中断整卷重跑（产物是幂等覆盖）。

## 确认点 1：角色设定候选

- **EPUB 插图筛选**：创作模型（多模态），结构化调用。输入是 EPUB 抽出的插图二进制 + 角色条目（名字、外貌描述），输出 `IllustrationPick[]`：每张图给 `characterId`、`lookHint`（哪套造型）、`reason`。模型只看图和文字，不改写设定。
- **无参考生成设定**：创作模型，结构化调用。输入是角色条目中外貌、身份字段；输出 `CharacterVariantProposal[]`，每个角色出几版（数量见待定）不同的外貌描写和造型建议。确认后选中的版本写回 `bible/characters/<角色>.json` 的外貌和造型字段。
- **持久化**：筛选出的插图复制到 `candidates/`；提议存 `project.db` 的提议表（见对话面板），确认后落文件。确认点本身只是“等创作者处理”，不在 Agent 内阻塞；Agent 任务到产出候选就结束。

## 分场景

- **角色/形态**：创作模型，结构化调用。一章一次。
- **输入**：本章正文（分段时给全文或分段拼接）、本章 `ChapterPreview`、截至本章的设定集切片、改编设置（强度/密度影响每场粒度的指令）。
- **输出契约**：`ScenePlan`：`scenes[]`，每场 `title`、`sourceRange`（`fromParagraph`/`toParagraph`，用原文段落编号）、`summary`、`stagingNotes`、`characters[]`、`locationHint`、`cgHint`。场景 ID 应用分配，模型输出里的顺序就是 `chapter.json` 的顺序。
- **校验/修复**：段落编号越界、`sourceRange` 重叠或留空 → 错误还给模型。角色名/地点名不在设定集里 → 提示模型用已登记素材名或新登记的写法。
- **持久化**：写 `chapters/<章>/chapter.json`（场景顺序、本章 CG 描述）；场景文件先不写，逐场写剧本时才落 `<场景ID>.nvs`。

## 逐场写剧本

- **角色/形态**：创作模型，结构化调用。一场一次。
- **输入**：本场 `ScenePlan` 条目、本场对应的原文段落（按 `sourceRange` 取）、截至本章设定集切片、本场涉及的素材名清单（角色/造型/已登记表情、地点/变体、本章 CG）、术语表、改编设置、上一场结尾若干行剧本（衔接）。
- **输出契约**：`.nvs` 剧本文本（不带行尾句子 ID，应用保存时补 `#xxxx`；场景头 `scene`/`source` 由应用生成，模型只写正文）。模型也可以输出新表情登记（写法：在 `@show` 里直接用未登记表情名，应用解析后补登记）。
- **校验/修复**：`.nvs` 解析器报错带行号列号 → 拼成下一轮消息还给模型（“第 X 行：错误信息”），模型改完整场重写。素材名不存在 → 同样当解析级错误还回去。这是 `work-format.md` 里“解析不通过时把错误位置交回模型修改”的落地。
- **持久化**：写 `chapters/<章>/<场景ID>.nvs`。任务到场景粒度，中断重跑该场。

## 图片提示词与出图

- **提示词组织**：创作模型，结构化调用。按素材类型分开：
  - 立绘/造型基准图：角色外貌 + 造型描述 + 风格 + 构图约束（膝上/半身、头顶/腰线对齐、竖版透明底）。
  - 背景：地点描述 + 变体描述 + 16:9。
  - CG：`chapter.json` 里的 CG 描述 + 风格。
  - 输出 `ImagePromptSpec`：`prompt`、`negativePrompt`（接口不支持就并到 prompt）、`size`、参考图列表（派生图用）。
- **出图**：应用直接调图片接口（不经文本模型）。生成后本地处理（转 WebP、缩放、技术检查）。
- **审核拒绝**：错误分类为内容审核拒绝后，用同一个提示词生成调用再跑一次，输入是上次 `ImagePromptSpec` + 拒绝信息，要求“改得含蓄一点但保留场景内容”；第二次还被拒 → 占位图 + “需要处理”。重试这一次走新任务，不沿用旧任务状态。
- **主体完整判断**：技术检查四项里“主体是否完整”需要看图判断，用创作模型（多模态）做一次结构化调用：输入生成的图 + 素材类型 + 期望描述，输出 `{ complete: boolean, issue?: string }`。其余三项（解码、尺寸、透明底）是本地检查不经过模型。
- **持久化**：通过的图写 `assets/...`；`ImagePromptSpec` 存在 `project.db` 任务结果里（供重生成和改写时参考），不进作品文件。

## 编辑器：Agent 重写单场景（差异列表）

- **角色/形态**：创作模型，结构化调用。
- **输入**：当前 `.nvs` 全文（带行尾句子 ID）、创作者指令、本场 `sourceRange` 原文、设定集切片、改编设置、本场涉及素材名清单。
- **输出契约**：整场 `.nvs` 新文本（不是 patch）。按 `decisions.md`「剧本 ID 与素材命名」，模型改写已有行时保留原行尾 ID，新写的行不带 ID。应用按句子 ID 比对新旧两版生成差异列表（ID 相同的标“修改”，旧 ID 消失的标“删除”，没有 ID 的标“新增”），给创作者勾选；勾选的行写入文件，新增行保存时补 ID。
- **校验/修复**：新文本解析失败，或出现原场景里没有的 ID、重复 ID → 错误还给模型，同逐场写剧本。
- **持久化**：直接写 `.nvs`；修改历史记到 `project.db`（原文快照 + 新内容），撤销按历史回放。

## 编辑器：按选中原文修改

- **角色/形态**：创作模型，结构化调用。和重写场景同形态，指令换成“按这段原文改这个场景/这几句”，额外给选中段落和它在场景里的位置。
- **输出契约**：整场 `.nvs` 新文本，同样走差异列表勾选。

## 作品级对话面板

- **角色/形态**：创作模型，工具循环 `Agent`。这是唯一常驻多轮的调用形态，因为创作者会连续讨论、翻设定、跨多轮攒提议。
- **上下文**：系统提示（作品信息、改编设置摘要、可用工具列表、当前位置：编辑器/设定集页传进来的章节或条目）+ 持久化的历史消息。工具按需取数据，不把整个工程塞进上下文。
- **工具**（每个都是 `AgentTool`，`parameters` 用 TypeBox）：
  - `read_chapter_preview` `{ chapterId }` → `ChapterPreview`
  - `read_bible` `{ scope?: "series"|"volume"|"work", chapterId?: string }` → 设定集切片（`chapterId` 用来截“截至本章”）
  - `read_glossary` `{}` → 术语表
  - `read_scene` `{ chapterId, sceneId }` → `.nvs` 文本 + 段落对照
  - `read_source_range` `{ chapterId, fromParagraph, toParagraph }` → 原文段落
  - `list_chapters` `{ workId }` → 章节列表和状态
  - `propose` `{ kind, target, patch, reason }` → 登记一条提议，返回提议 ID。`kind` 覆盖：`update_bible_entry`（条目 ID + 字段变更）、`add_bible_entry`、`update_glossary_entry`、`add_glossary_entry`、`update_adaptation_notes`（改改编要求）、`redo_chapter`（章节 ID）。`patch` 是该 kind 对应的 TypeBox 结构。
  - `list_proposals` `{ status?: "pending"|"confirmed"|"rejected" }`
- **提议模型**：提议存 `project.db`，字段：`id、作品、kind、target（条目 ID/章节 ID/字段路径）、patch JSON、reason、状态、对话消息 ID、创建时间`。确认时才把 patch 应用到对应文件；`redo_chapter` 确认后该章进制作队列。提议和修改历史挂钩：应用一条提议 = 一次可撤销的修改记录。
- **聊天持久化**：消息（user/assistant/tool 调用摘要）逐条写 `project.db`；Agent 启动时回放最近若干条进上下文，更早的用 `read_*` 工具按需取，不整表回放。
- **停止/恢复**：面板消息不进制作队列的停止语义；创作者中途关面板，下次打开从 `project.db` 重建 `Agent` 状态接着聊。

## 附录：依赖的 pi API

- `@earendil-works/pi-agent-core`：`Agent`（`constructor`/`prompt`/`subscribe`/`abort`/`state`/`waitForIdle`）、`AgentTool`、`AgentToolResult`、`AgentEvent`（`turn_end`/`message_end`/`tool_execution_*`）、`AgentMessage`、`AgentState` — `dist/agent.d.ts`、`dist/types.d.ts`
- `@earendil-works/pi-ai`：`createModels`/`createProvider`/`Models`/`Provider`/`Model`、`streamSimple`/`completeSimple`、`Usage`、`AssistantMessage`、`UserMessage`/`SystemMessage`/`ToolResultMessage`、`ImageContent`、`Context`、`SimpleStreamOptions`、`AssistantMessageEventStream`、`contentText` — `dist/models.d.ts`、`dist/types.d.ts`、`dist/compat.d.ts`、`dist/utils/text.d.ts`
- `@earendil-works/pi-schema`：TypeBox 兼容 `parameters`（`AgentToolParams` 用 `Static<TParameters>`）；校验可用 pi-schema 的 `compile`/`Validator`/`ValidationError` 或 TypeBox 自带校验 — `pi-schema/dist/index.d.ts`、`validator.d.ts`、`types.d.ts`（TypeBox 1.3.27 是依赖）

## Open questions

- [ ] 按卷综合的具体做法（卷太长放不下时怎么分块），落到 M1 设计。
- [x] 对话面板的会话：条目树存 `project.db`，接近上下文上限时压缩成摘要，支持分支（见 `agent-orchestration.md`）。
- [x] 编排方式：见 `agent-orchestration.md`。
- [x] 无参考时每个角色出 3 版设定。
- [x] 场景由模型按“一段完整情景”自己切，演出密度预设调粗细，不定死规则。
- [x] 结构化输出：提示词写清格式 + 不合格退回修改；接口支持时开 `constrainedSampling` 的 `strict: "prefer"`。
- [x] 重写场景时模型看到句子 ID 并保留，写错的 ID 当错误退回（遵守「剧本 ID 与素材命名」）。
