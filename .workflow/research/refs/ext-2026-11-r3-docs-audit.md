# Novelive 文档可实现性审计（M0 / M1a / M1b）

审计视角：下周只能凭文档开工的实现工程师。范围：`docs/*.md`、`.workflow/specs/m0-skeleton.md`、`.workflow/decisions.md`、`.workflow/glossary.md`、`.workflow/research/*.md`（不含 refs/）、`DESIGN.md`、`prototype/src/pages/`。

## 一、缺陷表（按 severity 排序）

| id | severity | type | 位置 A | 位置 B | 问题 | 建议替换措辞 |
|---|---|---|---|---|---|---|
| D01 | blocks-M0 | 过时（superseded 未同步） | `.workflow/specs/m0-skeleton.md:14` | `docs/ux.md:73`、`docs/creation-pipeline.md:108`、`.workflow/decisions.md:727` | M0 spec 文本模型配置缺「兼容哪家」下拉。该下拉是 2026-11-21 决策新增，spec 未跟进；M0 就写配置文件，结构少了这个字段后面还得迁移。 | 在 `m0-skeleton.md:14` 的字段清单末尾加「、『兼容哪家』下拉（自动 / OpenAI / DeepSeek / 通义千问 / 智谱 / OpenRouter / 兼容 Anthropic），自定义地址时把对应 compat 写进 pi 的 Model」。 |
| D02 | blocks-M0 | 过时（superseded 未同步） | `.workflow/specs/m0-skeleton.md:15` | `docs/creation-pipeline.md:107`、`docs/visuals.md:69`、`.workflow/decisions.md:728` | M0 spec 图片模型只列地址/模型名/Key/两个数字，缺 2026-11-21 决策定的「接口形状、能否编辑、能否出透明底、尺寸规则」四项声明；config schema 在 M0 定稿，少了就要迁移。 | 在 `m0-skeleton.md:15` 加「另按 `docs/visuals.md:69` 存四项用户声明（接口形状 / 能否编辑 / 能否出透明底 / 尺寸规则），填地址时按域名自动套预设；M0 只存不用」。 |
| D03 | blocks-M0 | 遗漏错误路径 | `.workflow/specs/m0-skeleton.md:46-47` | `docs/creation-pipeline.md:68`、`.workflow/decisions.md:638` | M0 命令错误码枚举 `network/auth/not_found/invalid_config/cancelled/creator_down/internal` 没有 `moderation`（内容审核拒绝）。M0 的图片测试调真实接口，审核拒绝会被错归成 `internal` 或 `network`，测试页提示「检查地址、Key」误导排障。 | `m0-skeleton.md:46` 的错误码枚举加 `moderation`（图片三项测试的拒绝归类用），或在 `model.testImage` 的结果里为每项能力单列错误码字段。 |
| D04 | blocks-M0 | 缺少数值 | `.workflow/specs/m0-skeleton.md:73` | `.workflow/research/pi-scaffolding.md:116` | cassette schema 两边不一致：spec 版有 `recordedAt` 和 `tags`，scaffolding 版只有 `{key, method, path, reqHash, status, headers, body(b64), case}`，没有 `recordedAt`/`tags`。M0 就录真实文件，格式两边不统一会写出两套。 | 以 `m0-skeleton.md:73` 的为准（含 `recordedAt`、`tags`），把 `pi-scaffolding.md:116` 的 JSONL 字段列补齐为同一形状。 |
| D05 | blocks-M0 | 缺少数值 | `.workflow/specs/m0-skeleton.md:73` | `.workflow/research/handoff-defaults.md:15` | spec 没写 `record/replay/strict` 三模式和 `bad-image` 注入名；handoff 有。回放模式名不定，`pnpm check` 该跑哪个模式就没法定（CI 用 strict 还是 replay 未写）。 | `m0-skeleton.md:73` 补「回放有 `record`/`replay`/`strict` 三模式，单测与 CI 跑 `strict`，注入故障名 `midcut`/`disconnect`/`cancel`/`http500`/`bad-image`」。 |
| D06 | blocks-M0 | 缺失状态转移 | `.workflow/specs/m0-skeleton.md:65` | `.workflow/research/handoff-defaults.md:13` | 「断路器连续 3 次失败转横幅手动重启」没有写手动点了「重新启动」后失败计数是否清零、横幅消失的条件；也没写 `creator.down` 后正在排队的命令如何收场（`m0-skeleton.md:47` 只说界面把在途调用以 `creator_down` 结束，创作端侧语义未写）。 | `m0-skeleton.md:65` 补「手动点『重新启动』即清零失败计数并重试拉起；`creator.down` 发出时创作端丢弃该端口全部在途请求，拉起后经新 port 接收调用」。 |
| D07 | blocks-M0 | 矛盾 | `.workflow/specs/m0-skeleton.md:73-75` | `.workflow/research/handoff-defaults.md:15` | spec 说「本地假服务保留给端到端」「e2e 对假服务回放」，handoff 说「本地假服务保留给 e2e」但 pi-scaffolding 把回放分成 L1 faux provider / L2 工具 cassette / L3 HTTP cassette 三层，e2e 到底用「本地假服务」还是「fetch 注入回放」没统一。W2 写「对假服务回放」，词义含糊，验收时可被两头解释。 | `m0-skeleton.md:75`、`W2` 改为「端到端用 `registerFauxProvider` 包装的假模型 + fetch 注入式 HTTP cassette 回放」，与 `pi-scaffolding.md:113-117` 的 L1/L3 对齐；删掉「本地假服务」这个歧义词。 |
| D08 | blocks-M0 | 缺少数值 | `.workflow/specs/m0-skeleton.md:42` | `.workflow/research/handoff-defaults.md:11` | dev-bridge 的 WebSocket / HTTP 端口（8765/8766）只在 handoff 出现，spec 的 dev-bridge 条目（`:35`）和「How it is built」没写。M0 验收 W4 要从浏览器开界面，端口未定实现只能现编。 | `m0-skeleton.md:35` 的 dev-bridge 行补「默认 WebSocket 8765、HTTP 资源 8766」。 |
| D09 | blocks-M0 | 缺少数值 | `.workflow/specs/m0-skeleton.md:56` | `.workflow/research/handoff-defaults.md:22` | 上下文长度没有最小值和单位说明（handoff 定的是整数 tokens、最小 4096），M0 spec 只说「自动填/手填」。配置 schema 在 M0 定，少了校验下限。 | `m0-skeleton.md:14` 补「上下文长度为整数 tokens、最小 4096」。 |
| D10 | blocks-M0 | 缺失错误路径 | `.workflow/specs/m0-skeleton.md:52` | `docs/architecture.md:9` | spec 只写「配置文件读不出来时显示文件位置和错误，不覆盖原文件」，没写「Key 解密失败」「字段校验不过」时界面显示什么、`config.get` 返回什么。`••••` 哨兵 vs 真实密文损坏两种情况会混淆。 | `m0-skeleton.md:52` 补「`config.json` 校验失败或 Key 解密失败时，`config.get` 返回 `{configError: {path, reason}}`，界面在设置页顶部显示文件位置和错误，不用哨兵顶替」。 |
| D11 | blocks-M1a | 缺少数值 | `docs/work-format.md:94` | `.workflow/research/handoff-defaults.md:28` | 「随机短 ID」没给长度和字符集；handoff 定的是句子 ID 4 位小写十六进制 `[0-9a-f]{4}`、场景 ID 8 位。`docs/work-format.md` 是 M1a 要定稿语法的地方，本身缺这两个数。 | `docs/work-format.md:94` 补「句子 ID 为 4 位小写十六进制（`[0-9a-f]{4}`），场景内冲突重摇；场景 ID 为 8 位」。 |
| D12 | blocks-M1a | 缺失术语 | `docs/work-format.md:25` | `.workflow/research/handoff-defaults.md:30` | `source p0012-p0018` 的段落编号格式没在任何 doc 里定义（`pNNNN`、章内 1 起、四位零填充只在 handoff）；`source/original.<ext>`、`source/chapters/<章节ID>.txt`、`source/images/` 三层原文布局在 `docs/work-format.md:111` 的目录树里完全没有。M1a 的导入器没法照 doc 落盘。 | `docs/work-format.md` 目录树补 `source/original.<ext>`、`source/chapters/<章节ID>.txt`、`source/preview/`、`source/images/`，并在 `:37` 或 `:25` 注明「段落编号 `pNNNN`，章内从 1 起、四位零填充，由导入器分配写进 `chapter.json`」。 |
| D13 | blocks-M1a | 缺少数值 | `docs/bible.md:128` | `.workflow/research/handoff-defaults.md:33` | `volumes/<卷>/bible/digest.json`（`VolumeDigest`）在 doc 目录树和 bible.md 文件布局里都没有；「全书梗概=各卷 digest 现拼」这层存储在 doc 里悬空，M1a 的综合产物落盘路径缺一块。 | `docs/bible.md:128` 后补一行「卷摘要（digest）存 `volumes/<卷 ID>/bible/digest.json`，全书梗概由各卷 digest 现拼、不单独存」。 |
| D14 | blocks-M1a | 矛盾 | `docs/product.md:47` | `.workflow/research/handoff-defaults.md:34` | product 说「原文没有分卷时整理角色的分卷建议直接写进工程」，handoff 说「M1a 的 TXT 默认整本一卷；建议分卷属向导交互放 M1b」。两句冲突：M1a 到底跑不跑整理角色的分卷建议？若跑，产物写哪、谁确认；若不跑，product:47 写错。 | `docs/product.md:47` 改为「M1a 没有界面：导入 TXT 时原文没有分卷先按整本一卷建工程，核对向导（含整理角色分卷建议与修改）在 M1b」。handoff:34 保持。 |
| D15 | blocks-M1a | 缺失状态转移 | `docs/creation-pipeline.md:57-61` | `.workflow/research/novelive-agent.md:50`、`docs/product.md:15` | 「每章三步加出图」的状态机没说一章在「审稿」步被打回后回到哪里：写手改一遍后是重跑忠实度检查还是直接进演出（`:59` 说「不再复审」但没写步骤状态回到哪个词）；也没说「优先章节上一章还没写」时这章在制作面板显示什么状态词（等待？制作中？）。 | `docs/creation-pipeline.md:59` 末补「返修后该章直接进演出步，步骤状态记为『演出』；等待优先章节的上一章写完的章，状态词为『等待』并在面板上注明『等上一章』」。 |
| D16 | blocks-M1a | 缺失错误路径 | `docs/work-format.md:90` | `.workflow/research/handoff-defaults.md:29` | 剧本检查「只把出错的场景退回写手改」，没说一个场景退回几轮仍不过怎么办（整章标需要处理？继续下一章？）；也没说 `source` 段落范围越界、`#id` 重复这两类「查了不通过」的错误是自动修还是退回。 | `docs/work-format.md:90` 末补「同一场景连续 3 次退回仍不过时整章标『需要处理』；素材名未登记、`source` 范围越界、句子 ID 重复都退回写手，不自动改」。 |
| D17 | blocks-M1a | 里程碑范围错配 | `docs/ux.md:18` | `docs/product.md:47`、`.workflow/decisions.md:574` | ux.md 的导入向导（核对作品信息和章节划分、含分卷修改）是界面功能，product:47 把它放在 M1b；但 M1a 的「导入 TXT」产出要被验收就需要这条核对数据落在工程里——M1a 无界面时「核对」由谁做、结果存哪没写。 | `docs/product.md:47` 或 `docs/ux.md:18` 补「M1a 无界面时核对结果由整理角色直接写进 `source/` 下的导入报告文件；M1b 起向导界面读这份报告给创作者改」。 |
| D18 | blocks-M1b | 矛盾 | `docs/product.md:17`、`docs/ux.md:21` | `docs/product.md:49`、`.workflow/decisions.md:471` | product/ux 说确认点 2「可以进编辑器修改」，但编辑器整体在 M2（product:49），M1b（decisions:471）没有编辑器。「进编辑器修改」在 M1b 是不可实现的承诺，验收时会被打回。 | `docs/product.md:17`、`docs/ux.md:21` 改为「可以试玩；M1b 修改只能改 `work.json` 里的作品设置或让 Agent 重做该章，编辑器在 M2」。 |
| D19 | blocks-M1b | 矛盾 | `docs/creation-pipeline.md:59`、`docs/creation-pipeline.md:90` | `docs/product.md:48`、`.workflow/decisions.md:646` | product:48 把「审稿」列在 M1b 链路上但没写默认开；creation-pipeline:59 说忠实度检查「默认开、可以关」——M1b 规格若照 product 只写「审稿」会漏掉忠实度检查默认开这一关键默认。 | `docs/product.md:48` 的「审稿」后补「（忠实度检查默认开，文风审稿作品开关默认关）」。 |
| D20 | blocks-M1b | 缺少数值 | `docs/creation-pipeline.md:61`、`docs/visuals.md:36` | `.workflow/decisions.md:638`、`docs/creation-pipeline.md:68` | 「流式输出加空闲超时」没有阈值；pi 的 `timeoutMs` 是整个 HTTP 请求超时（默认 10 分钟），看门狗的事件间隔阈值文档里没数（pi-scaffolding:67 也只写「超阈值」）。M1b 调真实长章，没有数就没法写死看门狗。 | `docs/creation-pipeline.md:68` 补「空闲超时默认 90 秒，可在高级设置改」或在 `pi-scaffolding.md:67` 给一个默认秒数。 |
| D21 | blocks-M1b | 缺少数值 | `.workflow/decisions.md:620` | `.workflow/research/pi-scaffolding.md:70`、`docs/creation-pipeline.md`（无） | 工具循环软预算的「数值在角色定义里，用测试用书校准」——测试用书未到（decisions:574 标 blocked），M1b 的预算值悬着；文档没有任何默认区间可先用。 | `docs/creation-pipeline.md` §5 或 `pi-scaffolding.md` 补「书到之前预算先用占位默认：美术导演 30、审稿 20、主控 40、子 Agent 15，真书校准后再改」。 |
| D22 | blocks-M1b | 缺失状态转移 | `docs/ux.md:25` | `docs/creation-pipeline.md:69` | 「一章最终失败→整部作品暂停」后，这部作品在全局制作状态里显示什么（`空闲/制作中/已停止/待确认` 四词里没有「暂停」）；行内重试成功后「恢复」是自动恢复还是等创作者点继续，两处说法不一致（pipeline:69 写「成功后恢复」像自动，ux:31 写「行内重试排回队首」未说是否自动）。 | `docs/ux.md:25` 补「整部作品暂停时全局制作状态显示『待确认』，章保持原状态加『需要处理』标记；行内重试排回队首后自动继续制作」。 |
| D23 | blocks-M1b | 缺失错误路径 | `docs/creation-pipeline.md:61` | `docs/visuals.md:106` | 「一章要用的图都齐了这章就发布」——如果图清单里某张图重画 3 次仍失败，是等创作者处理（章卡着不发）还是直接用占位图发布？两处都写「用完用占位图并标需要处理」，但「章什么时候算图齐」的边界（含占位图）只在 ux.md:25 说清，pipeline:61 没写「占位图也算齐」。 | `docs/creation-pipeline.md:61` 末补「某张图重画次数用完即换占位图，占位图也算图齐，该章以『已发布+需要处理标记』发布」。 |
| D24 | blocks-M1b | 缺少数值 | `docs/work-format.md:83` | `docs/player.md`（无） | 「字幕默认不等点击，加 `wait` 才等」——`@caption` 怎么「加 wait」语法没写（`@caption ... wait`？`{wait}` 标签？还是单独一行 `@wait`？）。例子 `work-format.md:32` 的 `@caption` 也没带 ID，和 `:94`「每一句文字和每个 `@wait` 都带（句子 ID）」冲突——字幕是不是「句子」要不要带 `#id` 不明确。 | `docs/work-format.md:83` 补「字幕要等点击时在 `@caption` 行尾加 `wait` 参数」，并在 `:32` 示例给 `@caption` 补行尾 `#id`（如 `@caption 七月十四日 傍晚 #e5a1`）。 |
| D25 | blocks-M1b | 缺少数值 | `docs/work-format.md:68` | `.workflow/research/handoff-defaults.md:27` | 「指令全集在 M1a 定稿」——doc 里指令名只零散出现 `@bg/@show/@move/@shake/@caption/@wait`，handoff 列了 16 个名字（含 `@fg/@hide/@face/@costume/@cg/@camera/@zoom/@particle/@mask/@filter`），docs 没有这张表，M1b 的美术导演和播放器实现没有全集可对。 | `docs/work-format.md:70` 后补一张指令名全集表（按 handoff:27 的 16 个名字，每条注意图、常用参数、生效类型）。 |
| D26 | blocks-M1b | 缺失术语 | `docs/player.md`（无） | `.workflow/glossary.md:61` | 「槽位」枚举 `left/center/right` 只在 glossary 定义，`docs/player.md` 与 `docs/work-format.md` 都没写槽位词表，`@show lin-xiao/uniform/angry left` 的 `left` 合法值集合在 doc 里不可查。 | `docs/work-format.md:76` 槽位规则补「槽位枚举为 `left`/`center`/`right`」。 |
| D27 | blocks-M1b | 矛盾 | `docs/creation-pipeline.md:57` | `.workflow/glossary.md:37`、`docs/creation-pipeline.md:59` | pipeline:57 步骤词写死「写 / 审稿 / 演出 / 出图」四步，但忠实度检查默认开+文风默认关意味着「审稿」步在文风关时只剩忠实度检查——glossary:37 写「审稿（可关）」暗示整步可关，与两档拆分矛盾：忠实度档开时这步到底显示「审稿」还是「忠实度检查」？ | `docs/creation-pipeline.md:57`、`glossary.md:37` 改为「步骤显示词固定为 写 / 审稿 / 演出 / 出图；『审稿』步含忠实度检查（默认开）与文风审稿（默认关）两档，两档都关时该步显示为跳过」。 |
| D28 | blocks-M1b | 缺少数值 | `docs/visuals.md:36`、`docs/creation-pipeline.md:61` | `.workflow/research/handoff-defaults.md:44` | 「角色每套造型候选默认 3 版」「无参考时每个主要角色出 3 版设定」只在 handoff/novelive-agent，docs（visuals/ux/creation-pipeline）只写「几版」，确认点 1 的候选数量 doc 里无数。 | `docs/visuals.md:32` 或 `docs/ux.md:20` 补「无参考时每个主要角色的造型候选默认出 3 版」。 |
| D29 | blocks-M1b | 缺少数值 | `docs/visuals.md:106` | `.workflow/research/handoff-defaults.md:49` | 三类占位图的生成方式（sharp 画 SVG→WebP、灰底+图标+「需要处理」字样）和尺寸（背景 1920×1080、立绘 1024×1536 竖版透明、CG 1920×1080）只在 handoff，docs 只说「内置三类占位图」。 | `docs/visuals.md:106` 补「占位图由代码生成（灰底+图标+『需要处理』）：背景与 CG 1920×1080、立绘 1024×1536 竖版透明」。 |
| D30 | blocks-M1b | 缺少数值 | `docs/work-format.md:70-76` | `.workflow/research/handoff-defaults.md:27` | 转场枚举 `wipe` 四个方向、`slide`、`push`、`iris`、`zoom` 的方向参数（`slide`/`push`/`iris`/`zoom` 要不要方向、什么取值）在 doc 里没写；`@shake strong 0.4` 的强度枚举（`strong` 之外还有什么）没写。 | `docs/work-format.md:72-75` 在 M1a 定稿时把每个转场的方向参数枚举和 `@shake` 强度枚举补全。 |
| D31 | blocks-M1b | 缺失错误路径 | `docs/creation-pipeline.md:71` | `.workflow/decisions.md:654` | 「输入已改不写入」之后任务怎么收场没写：是自动重跑？标需要处理等人点？`run.status=needs_attention+input_changed` 之后由谁触发重跑、重跑用新输入还是旧输入，doc 没有。 | `docs/creation-pipeline.md:71` 末补「标『输入已改，需要重跑』的任务由创作者在制作面板点重跑（按当前最新输入跑），或随下一次继续制作自动重跑」。 |
| D32 | blocks-M1b | 里程碑范围错配 | `docs/product.md:48` | `docs/ux.md:13`、`DESIGN.md:19-20` | M1b 交付「制作面板」，但 ux:13/DESIGN:19 的制作入口在「作品详情页 → 制作面板」，且 DESIGN 要求侧边栏有作品分区——M1b 的「最小」制作面板是否包含作品详情页、书库作品卡、侧边栏分区这些承载外壳，doc 没写边界。 | `docs/product.md:48` 补「M1b 的制作面板含作品详情页与侧边栏作品分区（概览/游玩/制作），编辑器与设定集页 M2 再做」。 |
| D33 | later | 矛盾 | `docs/product.md:9`、`docs/ux.md:9`、DESIGN.md:51 | `.workflow/decisions.md:398`、`docs/architecture.md:51` | product/ux/DESIGN 都写「界面语言支持简中/繁中/英/日」，ux:9 还让首次打开就选语言；但决策和 architecture 说开发期只写简中、M5 才翻译。M0–M4 的应用里「界面语言」设置项和引导页语言选择是死选项，文档没说开发期怎么处理。 | `docs/ux.md:9`、`:73` 补「开发期界面语言只有简体中文，繁中/英/日选项在 M5 翻译后启用；引导页语言选择在开发期只显示简体中文」。 |
| D34 | later | 缺少数值 | `docs/player.md:74-75` | `.workflow/research/handoff-defaults.md:72` | 快存/普通存档的槽位数（快存 1、普通 60）只在 handoff，player.md 只写「快速存档/读档」「普通存档位」没有数。 | `docs/player.md:74-75` 补「快存 1 槽、普通存档 60 槽」。 |
| D35 | later | 缺失术语 | `docs/player.md`（无） | `.workflow/research/handoff-defaults.md:73` | 播放器设置全集（文字速度、自动播放速度、字号、对话框不透明度、只跳过已读、全屏、对话框样式）只在 handoff；player.md 控制项清单（`:67-77`）漏「对话框不透明度」「全屏」「对话框样式」。 | `docs/player.md:67-77` 控制项补「字号与对话框不透明度、全屏、对话框样式选择」。 |
| D36 | later | 矛盾 | `.workflow/research/gap-ledger-r2.md:32` | `.workflow/decisions.md:737` | gap-ledger-r2 A2 推荐「默认 Real-CUGAN」，decisions:737（同日更晚）最终定「默认 `realesrgan-x4plus-anime`，快速档 `realesr-animevideov3`」。gap-ledger 是研究档案不用改，但 A2 的推荐与最终决策相反，后来读者易误读；且 handoff:67 已按决策更新，gap-ledger 未加一行指向最终决策。 | `gap-ledger-r2.md` A2 末尾加一行「**已定**：按 `decisions.md` 2026-11-21『放大默认用 Real-ESRGAN 动漫模型』，默认 x4plus-anime、快速档 animevideov3」。 |
| D37 | later | 矛盾 | `docs/creation-pipeline.md:7`、`docs/ux.md:17` | `docs/product.md:47`、`.workflow/research/handoff-defaults.md:34` | creation-pipeline:7/ux:17 的导入流程把「整理角色建议分卷」写在导入向导里（属 M1b）；但 M1a 已要「按卷综合」，M1a 无向导时综合按什么卷切？handoff 说整本一卷，docs 没写，M1a 的多卷语义在 doc 层面悬空。 | `docs/creation-pipeline.md:7` 补「M1a 导入 TXT 时原文没有分卷先按整本一卷；有卷标题（`kind:"volume"`）时按卷标题分卷」。 |
| D38 | later | 缺失错误路径 | `docs/work-format.md:168-169` | （无） | 「`formatVersion` 高于本端提示升级应用」「读旧包 `obj(...,{open:true})`」之外，没说「同一 `formatVersion` 但 schema 校验失败」「`minReaderVersion` 高于本端」分别怎么提示、是否拒绝导入。 | `docs/work-format.md:168` 后补「`minReaderVersion` 高于本端时拒绝导入并提示升级；同 `formatVersion` 下 schema 校验失败按普通解析错误提示文件损坏」。 |
| D39 | later | 缺少数值 | `docs/visuals.md:104` | `.workflow/research/novelive-agent.md:108` | 视觉审核 `failedChecks` 枚举（`identity/framing/description/style/artifacts`）在 docs/visuals.md:104 和 novelive-agent:108 一致，但「锚点特征」`anchorFeatures` 的数量（2-3 个）只在 bible.md:49 和 handoff，visuals.md 没写。 | `docs/visuals.md` 2.1 或 4 节补「`anchorFeatures` 为 2–3 个锚点特征」。 |
| D40 | later | 里程碑范围错配 | `docs/visuals.md:29` | `docs/product.md:51` | 「EPUB 插图由模型筛选后作候选」写在通用参考来源里，但 EPUB 导入在 M4；M1b 的确认点 1 在只有 TXT 时拿不到 EPUB 候选——docs 没写「EPUB 插图候选仅 M4 起可用」。 | `docs/visuals.md:29` 补「（EPUB 导入在 M4，此前该来源不可用）」。 |
| D41 | later | 矛盾 | `docs/creation-pipeline.md:50` | `.workflow/decisions.md:94-100`、docs/product.md:36 | 「跨语言制作只走直接生成目标语言剧本」写在正文主流程里，但它在 product:51 属 M4，M1b 的写手提示词若按此写会引入尚不存在的目标语言维度；docs 没标跨语言是 M4 才有。 | `docs/creation-pipeline.md:50` 补「（跨语言制作在 M4）」。 |
| D42 | later | 缺少数值 | `docs/architecture.md:73` | `.workflow/research/handoff-defaults.md:80` | 系统通知「标题和正文在主进程侧校验类型与长度」的 1000 字符上限、剥 HTML 规则只在 handoff:80；architecture:73 只写「校验类型与长度并剥掉 HTML」没有数。 | `docs/architecture.md:73` 补「标题=事件、正文=作品名+章/阶段；正文长度上限 1000 字符，剥掉 HTML 标签」。 |
| D43 | later | 缺少数值 | `docs/work-format.md:166` | `.workflow/research/handoff-defaults.md:87` | `work.json` 的 `workId`（UUID）、`version`、`derivedFrom`、`minReaderVersion`、`appVersion` 五个字段名在 docs 里只有「作品 ID、版本号、来源作品、作品设置」一句（work-format:119）；M5 的 work.json schema 在 doc 里没有字段级定义。 | `docs/work-format.md:119` 补字段清单「`workId`（UUID 不可变）、`version`（每次导出+1）、`derivedFrom`（来源 workId+version，可选）、`minReaderVersion`、`appVersion`、作品设置」。 |
| D44 | later | 缺失状态转移 | `docs/creation-pipeline.md:63` | `docs/player.md:120-124` | 「第一章要先过确认点 2」——确认点 2 期间第一章在章状态上是「已发布」还是「制作中」？handoff:48 说按「已发布」显示、作品级 `confirm-first` 承担停顿，docs 没写这套分工，实现容易做成第一章卡在「制作中」不可玩。 | `docs/creation-pipeline.md:63` 补「过确认点 2 前第一章按『已发布』显示（能玩），停顿由作品级状态 `confirm-first` 表达」。 |
| D45 | later | 缺失术语 | `.workflow/glossary.md`（无） | `docs/creation-pipeline.md:39`、`.workflow/decisions.md:582` | 「红线」（违反即整章作废的可检查断言）在 creation-pipeline:39 和 decisions 使用，glossary 未收（gap-ledger-r2 B48 已点名要补但仍缺）。 | `glossary.md` 补「- **红线**：写在改编要求里的可检查断言，违反即整章作废，内容人工必审。」 |
| D46 | later | 里程碑范围错配 | `docs/ux.md:19` | `docs/product.md:51`、`.workflow/decisions.md:713-718` | 「加入已有系列」放在 ux 导入向导里无里程碑标注；product:51 把「系列/卷/作品三层与覆盖」放 M4，decisions:715 虽定了语义但没写哪个里程碑做——M1b 的导入若带这个选项会提前拉入系列合并复杂度。 | `docs/ux.md:19` 补「（加入已有系列在 M4）」或在 product 里程碑表 M4 行点名此项。 |
| D47 | later | 缺少数值 | `docs/bible.md:86` | `.workflow/decisions.md:665`、`docs/creation-pipeline.md:82` | 「单章最多收约 2 条伏笔」「常驻最多给 12 条」「超 30 章标该收了」三个数只在 bible.md:86；`docs/creation-pipeline.md` 的主控职责和 decisions:665 没提，伏笔台账规则单源在 bible.md 是合理的但 creation-pipeline 没指过去。 | `docs/creation-pipeline.md:82` 主控行末补「（伏笔登记与渲染规则见 `docs/bible.md`）」。 |
| D48 | later | 缺少数值 | `docs/player.md:26` | （无） | 「约 200ms 的淡入淡出混合」用「约」，同尺寸换表情的混合时长不是定值；作为编译器默认参数表的一部分应给确定默认。 | `docs/player.md:26` 把「约 200ms」改为「200ms（默认值，编译器参数可调）」。 |
| D49 | later | 矛盾 | `.workflow/research/agent-orchestration.md:110` | `docs/creation-pipeline.md:86-88`、`.workflow/decisions.md:486` | orchestration:110 仍写「风格与主视觉：主控 + 场景画师」（已按 B44 改对），但同表 `:109`「确认点 1：没有参考图时…3 版设定」与 handoff:44「每套造型候选默认 3 版」口径不同——一个是「设定 3 版」一个是「每套造型 3 版」，哪个为准不统一。 | `agent-orchestration.md:109` 改为「没有参考图时第一卷每个主要角色每套造型候选默认 3 版（主控写文字，立绘画师出图）」，与 handoff:44 对齐。 |
| D50 | later | 缺少数值 | `docs/work-format.md:160` | （无） | 「2 万条约 0.5 秒」的中央目录索引成本是实测备注，但「条目数」没有上限或预期量级说明；「不写逐条目哈希清单」之外没有说包损坏时的用户可见提示是什么。 | `docs/work-format.md:160` 补「索引缓存为一次性内存结构，包损坏在打开时报『文件损坏或不是 Novelive 作品包』」。 |
| D51 | later | 缺失错误路径 | `docs/ux.md:81-82` | `docs/work-format.md:174` | 「导入的 .novelive 复制到『导入的作品』文件夹」——复制时磁盘满、同名作品 ID 已存在两个场景没有路径；work-format:174「导入为工程」也没写同名 workId 冲突。 | `docs/ux.md:81` 补「同名作品 ID 已存在时按『版本更新』流程处理；目标目录写入失败时提示检查磁盘空间」。 |
| D52 | later | 缺少数值 | `docs/player.md:103` | （无） | 「向前看 20～32 句预载」是个区间不是定值（实现要一个数）；「2K/4K 下一幕纹理 100～300MB」的预载内存预算没有上限值。 | `docs/player.md:103` 把「20～32 句」定为确定默认（如 32 句），或说明按剩余显存/内存在该区间取。 |
| D53 | later | 缺少数值 | `docs/architecture.md:70` | `.workflow/specs/m0-skeleton.md:44` | 「ring 溢出时返回 `gap` 加最新快照」——`app` scope 快照内容（是否就绪、generation）只在 spec:44，architecture:70 没写快照形状；`events.list` 的响应字段全集两处都没列。 | `docs/architecture.md:70` 补「`events.list` 响应为 `{events[], latestSeq, gap, snapshot?}`，`app` scope 快照含 `{ready, generation}`」。 |
| D54 | later | 缺失术语 | `.workflow/glossary.md`（无） | `docs/creation-pipeline.md:95-99`、`.workflow/research/novelive-agent.md:147` | 「提议（proposal）」这一概念（确认卡背后的数据条目，`propose_*` 工具产生）在 docs 里反复出现但 glossary 无条目，与「确认卡」（glossary:36，UI 形态）未区分。 | `glossary.md` 补「- **提议（proposal）**：Agent 提出的待确认修改或工作流，存 `project.db` 提议表，界面上以确认卡展示。」 |
| D55 | later | 矛盾 | `docs/bible.md:24` | `.workflow/research/novelive-agent.md:58`、`docs/bible.md:54` | bible.md:24 说「`revealedChapter` 没填时按首次出场算」，bible.md:54 的字段表把「首次出场」列为独立字段、:55 又列「知道什么（knows）」；但 novelive-agent:58 的 BiblePatch 字段清单没有 `knows` 子字段（decisions:665 加了 knows，novelive-agent 未同步字段定义）。 | `novelive-agent.md:58` BiblePatch 字段列补「`knows`（角色第几章知道了什么）」。 |

## 二、按类型计数

| type | count |
|---|---|
| 缺少数值 missing number | 20（D04、D05、D08、D09、D11、D12、D20、D21、D24、D25、D28、D29、D30、D34、D39、D42、D43、D47、D50、D52） |
| 矛盾 contradiction | 11（D07、D14、D18、D19、D22、D27、D33、D36、D37、D41、D49、D55 —— 其中 D22 同时是缺失状态转移，按主类计） |
| 缺失错误路径 missing error path | 7（D03、D10、D16、D23、D31、D38、D51） |
| 缺失状态转移 missing state transition | 5（D06、D15、D22、D44、D53 中 D53 也含缺少数值） |
| 里程碑范围错配 milestone-scope | 5（D17、D32、D40、D41、D46） |
| 过时 stale-after-supersede | 3（D01、D02、D36；D36 是研究档案未加指针） |
| 缺失术语 undefined term | 4（D12、D26、D45、D54） |
| 原型与文档不一致 prototype-vs-doc | 0（原型已按 F 表更新到位：fidelityCheck/styleReview 两开关、固定四步、Ctrl/⌘+J、拒绝理由框、四项声明、兼容下拉均已在 `prototype/src/` 落地） |

## 三、开工前必改的 Top 10

1. **D01 + D02**（M0 spec 补「兼容哪家」下拉和图片模型四项声明）——config schema 在 M0 定稿，漏了就要迁移用户配置。
2. **D18**（确认点 2「进编辑器修改」在 M1b 不可实现）——里程碑承诺与 M2 的编辑器直接冲突。
3. **D14**（M1a 到底跑不跑分卷建议）——product 与 handoff 直接矛盾，影响 M1a 验收口径。
4. **D12**（`source/` 目录布局和段落编号 `pNNNN` 没进 docs）——M1a 导入器落盘格式缺定义。
5. **D11**（句子/场景 ID 长度没进 docs）——M1a 语法定稿的硬缺项。
6. **D25 + D30**（指令全集和参数枚举不在 docs）——M1a 要在 work-format 定稿，当前表是空的。
7. **D20**（流式空闲超时没阈值）——两层重试里唯一没数的硬参数。
8. **D24**（`@caption` 的 `wait` 语法和是否带 `#id`）——语法歧义会传染解析器、检查器和示例。
9. **D06 + D03**（M0 断路器收尾语义和 `moderation` 错误码）——M0 验收 W2/W3 会真碰到这两条路。
10. **D19 + D27**（「审稿」步在 product/glossary 的默认态表述）——忠实度检查默认开是后期决策，步骤词和默认态表述没跟上，M1b 规格会照错抄。

## 四、只能所有者定 vs 可用默认值

### 只能所有者回来定（`owner-review.md` 已列 + 新增）

- 测试用书：M1a 的真书相关任务（分块综合做法、提示词调优、质量评测集标注、真书验收）都卡在 `~/novelive-testbooks/`；合成样本只能顶解析和导入的单测。
- 工具循环软预算的具体数值（D21）：文档写「用测试用书校准」，书没到数值就是定的占位；可以给临时默认但正式值要等书。
- `gpt-image` 开发期模型选型与图片接口最终默认值（visuals.md:93 只说不写死）。

### agent 可用合理默认值收掉

- D04/D05/D08/D09/D11/D24/D25/D26/D28/D29/D30/D34/D39/D42/D43/D47/D48/D50/D52/D53：都是「数或枚举缺定义」，handoff、decisions、gap-ledger 里多数已有值，照抄进 docs 即可。
- D03/D06/D10/D15/D16/D22/D23/D31/D38/D44/D51：错误路径和状态转移，按「标需要处理 / 回到队首 / 显示待确认」的既有语义补齐。
- D14/D17/D32/D40/D41/D46：里程碑归属按「M1a 无界面→界面交互统一放 M1b；EPUB/系列合并/跨语言统一放 M4」的既有口径补标注。
- D33：开发期语言选项置灰、引导页只显示简中。
- D36：gap-ledger 加注最终决策指针。
- D55：novelive-agent 字段表补 `knows`。

## 五、结论

文档整体一致性已经很高——2026-11-21 的 Supersedes 链大部分落进了 docs 和 spec（pi-schema、ncnn 放大、有损 WebP、审稿两档、三画师分工、占位图标记、两层重试都已传播）。主要残余问题集中在：

- **config schema 的晚到字段**（兼容下拉、图片四项声明）没回写进 M0 spec——这是 M0 唯一会在用户机器上留下迁移负担的缺口；
- **`docs/work-format.md` 和 `docs/bible.md` 缺字段级定义**（ID 长度、段落编号、source 布局、digest.json、指令全集）——M1a 要把这些定稿进 docs，目前 docs 是半成品；
- **M1b 的「进编辑器修改」和「审稿」步骤词**还停留在拆分前的表述；
- **少数硬参数没数**（空闲超时阈值、循环预算值）——预算值明确在等测试用书。

没有发现 `docs/*.md` 与 decisions 仍存活的旧决策正面打架的条目（除 D33 界面语言和 D18 编辑器两处里程碑口径问题）。原型 `prototype/src/` 已按 r2 的 F 表更新到位，与 docs 无实质冲突。
