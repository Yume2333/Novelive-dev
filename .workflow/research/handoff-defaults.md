# Handoff defaults

本文件汇总 2026-11-21 交接时定下的实现默认值。写里程碑规格时把对应条目抄进规格；规格作出不同决定时，把新决定记进 `decisions.md`。

## M0

- **call 取消**：`AbortSignal` 不能跨 contextBridge。preload 侧暴露 `call(cmd, payload)` 返回 promise + `cancel()`，内部维护 cancel id 映射并通知创作端。（`docs/architecture.md`、contract 包）
- **novelive:// 协议**：`novelive://cache/<相对路径>` 要 URL-decode，`path.normalize` 后拒绝 `..` 越界，MIME 按扩展名映射（webp/png/jpg/svg）。dev-bridge 下 `resourceUrl(path)` 返回 `http://localhost:8766/cache/...`，正式模式返回 `novelive://`。（`docs/architecture.md`、contract 包）
- **dev-bridge 端口**：默认 WebSocket 8765、HTTP 资源 8766。（`tools/dev-bridge` README 或 contract）
- **creator.ready**：由主进程代发，与 `creator.down` 对称；主进程最清楚 utility process 何时就绪。（contract 包）
- **端口重建（试验）**：creator 崩溃重启后 MessagePort 失效，重连要重新建 channel。验收：W2 e2e 覆盖「杀掉 creator → 自动重启 → UI 恢复调用」。（`.workflow/specs/m0-skeleton.md` W2）
- **图片录制格式（试验）**：回放服务对 `images.generate` 录完整 `b64_json` 响应，支持注入 `moderation_blocked`、断线等错误。验收：定义出录制文件 schema，回放能复现成功和两类失败。（`.workflow/specs/m0-skeleton.md` 录制回放、character-consistency 试验记录）
- **录制文件**：M0 先用开发期中转录制，再写回放测试；录制文件放 `tests/fixtures/` 进仓库，缺了就算测试失败，不跳过。（`.workflow/specs/m0-skeleton.md`、`pnpm check`）
- **CI 范围**：CI 只跑 `pnpm check`；e2e 只本地跑 `pnpm test:e2e`，不在 CI 加 xvfb。（`.github/workflows`、package.json scripts）
- **e2e 脚本**：`test:e2e` 先跑 `pnpm build` 再启 Electron。（package.json scripts）
- **崩溃横幅**：用 DESIGN.md 的 warning banner 全局置顶，文案「创作端已停止，日志在 <路径>」+ 重新启动按钮；原型没有这个形态，按新增写。（`docs/ux.md`、DESIGN.md）
- **日志**：`<process>-<YYYY-MM-DD>.log` 纯文本行，当日单文件不 rotate；横幅点击用 `shell.openPath` 打开 `userData/logs/`。（`docs/ux.md`）
- **config.json**：存 `app.getPath('userData')/config.json`；API Key 用 AES-256-GCM 加密，密钥是源码常量（只防扫一眼）；备份迁移=用户自己拷文件，不做导入导出 UI。（`.workflow/specs/m0-skeleton.md`、`decisions.md` 2026-11-20）
- **模型配置继承**：「沿用快速模型的地址和 Key」整组继承接口格式+地址+Key，模型名和上下文长度自己填；五个槽位都可独立改。（`docs/ux.md`、prototype settings）
- **上下文长度**：整数、单位 tokens、最小 4096；填不了时 placeholder 提示填模型上下文窗口 tokens。（`.workflow/specs/m0-skeleton.md`、`docs/ux.md`）
- **图片测试三项独立**：编辑测试用内置小测试图做输入，文生图失败不阻塞编辑项。（`.workflow/specs/m0-skeleton.md` W 检查）

## M1a

- **剧本语法定稿**：指令全集、行级语法、行内标签语法、诊断错误码列表在 M1a 定稿，写进 `docs/work-format.md`。指令名沿用示例和演出能力清单：`@bg` `@fg` `@show` `@hide` `@move` `@face` `@costume` `@cg` `@camera` `@shake` `@zoom` `@particle` `@mask` `@filter` `@caption` `@wait`；参数 `key value` 空格分隔，可选参数在前，默认值写进文档。（`docs/work-format.md`、`docs/player.md`）
- **句子 ID**：4 位小写十六进制（`[0-9a-f]{4}`），场景内冲突重摇；场景 ID 8 位。模型不写 ID，保存时按「行位置+前缀匹配」判定新旧行，新行补 ID、旧行保留。（`docs/work-format.md`）
- **剧本检查**：BOM、代码块围栏、CRLF→LF 等格式问题自动修；未登记素材名退回写手不自动改；诊断格式 `{code, line, col, message, hint}`，错误码列表随语法表定。（`docs/work-format.md`）
- **source/ 布局**：`source/original.<ext>` 存原始文件，`source/chapters/<章节ID>.txt` 存纯文本分段；段落编号 `pNNNN`（章内 1 起、四位零填充）由导入器分配写进章节 JSON；EPUB 插图另存 `source/images/`。（`docs/work-format.md`、`docs/bible.md`）
- **project.db schema**：按六类数据（任务状态、用量、会话条目树、提议、修改历史、运行记录）一次设计全量表结构，后续 milestone 只填数据不改表；不选 per-milestone ALTER 迁移。（`docs/work-format.md`、`.workflow/specs/m1a-*`）
- **整理角色契约**：`ImportCheckResult`（作品信息+章节划分核对意见）、`VolumeSuggestion[]`（卷名+起止章节 ID）；规则总结、会话标题、压缩摘要为自由文本不建模。（`.workflow/research/novelive-agent.md`、prototype mock）
- **两套摘要**：卷预览齐后整理跑一次 `VolumeDigest` 存 `volumes/<卷>/bible/digest.json`；全书梗概=各卷 digest 现拼不单独存；`VolumeSkeleton` 是主控产出的结构化骨架，用途不同（衔接用 digest、埋伏笔用 skeleton）。（`.workflow/research/agent-orchestration.md`、`novelive-agent.md`）
- **TXT 导入**：M1a 的 TXT 默认整本一卷；整理角色的「建议分卷」属向导交互放 M1b。（`docs/product.md`、`docs/ux.md`）
- **分块综合（试验，等测试用书）**：分块输入=前块已确认+candidate 条目摘要+本块各章 preview，边界按 token 估到 contextWindow ~60% 切。验收：同一真卷整跑 vs 分块跑，BiblePatch 条目一致率达标。（`.workflow/research/agent-orchestration.md`、`novelive-agent.md` open question）

## M1b

- **审稿形态**：审稿走工具循环 Agent（工具：`read_source_range`、`read_chapter_preview`、`read_glossary`/`read_scene`），输出有把握的问题列表。（`.workflow/research/novelive-agent.md`）
- **章节失败语义**：某章生成失败整部作品暂停（写手串行依赖上一章结尾），行内重试把该章排回队列头部，成功后恢复。（`docs/creation-pipeline.md`、`docs/ux.md`）
- **重跑范围**：`redo_chapter`=写/审/演出三步全跑，出图按素材名跳过已存在文件；`rewrite_scene`（面板发起）=重写+差异列表确认卡二次确认后应用；`redraw_image`=单图重生成直接替换，旧文件进修改历史；`redo_volume_synthesis`=重跑走候选合并规则，不覆盖已确认条目。（`.workflow/research/novelive-agent.md`、`docs/ux.md`）
- **主视觉**：由场景画师出图（横版 16:9），提示词由主控按风格描述组织；确认点 1 给 3 版候选必选，选中存 `assets/style/main-visual.webp` 写回 `bible/style.json` 参考图字段。（`docs/bible.md`、prototype ConfirmVisualPage）
- **质量评测集**：由 agent 自动标注，作回归对比基线；标注候选存仓库，所有者回归后抽查。（`decisions.md` 2026-11-21、`.workflow/standards.md`）
- **确认点 1**：默认停；「已有参考图」仅指创作者在向导里提供的图，EPUB 插图筛出的候选永远要人挑；角色每套造型候选默认 3 版。（`decisions.md` 2026-11-21、`docs/ux.md`）
- **主要角色名单**：BiblePatch 角色条目加 `major: boolean`（主控综合时判断）；确认点 1 只列第一卷 `firstSeenChapter` 在本卷且 `major` 的角色。（`.workflow/research/novelive-agent.md`）
- **CG 描述**：由美术导演在图清单 CG 项的「一句描述」产出，代码聚合写进 `chapter.json`；写手不出 CG 描述。（`docs/bible.md`、`.workflow/research/novelive-agent.md`）
- **作品 phase 枚举**：`preview / confirm-visual / confirm-first / producing / done / imported`；「第一卷综合完、后续卷还在预览」归 producing，制作面板显示「第 N 卷综合中」。（prototype types、`docs/ux.md`）
- **第一章状态**：过确认点 2 前第一章按「已发布」显示（能玩），作品级 `confirm-first` 表达停顿；确认点信息由作品状态承担。（prototype、`docs/ux.md`）
- **占位图**：程序生成三张（sharp 画 SVG→WebP，灰底+图标+「需要处理」）：背景 1920×1080、立绘 1024×1536 竖版透明、CG 1920×1080；资源随 creator 包进仓库。（`docs/creation-pipeline.md`、`docs/visuals.md`）
- **场景头归属**：`scene` 标题和 `source` 段落范围由模型写，代码核对范围合法性不生成。（`docs/creation-pipeline.md`、`.workflow/research/novelive-agent.md`）
- **长章分段（试验）**：写手分段约束「每段以场边界结束」，提示词写明，违规按剧本检查退回；美术导演分批时每批带本批场景+前后各一场衔接+全章图清单累积。验收：分段/分批产物无场景截断、无重复背景图。（`.workflow/research/agent-orchestration.md`、`novelive-agent.md`）
- **对话面板数据模型（试验）**：查 `agent-orchestration.md`/`novelive-agent.md` 是否已覆盖会话条目树、确认卡、压缩策略的字段级定义；没有就以原型 `mock/chat.ts` 的 ChatNode 树 + ConfirmPart + compressedSummary 为草案补进规格。验收：project.db 会话表能存分支和压缩摘要。（`.workflow/research/`、`docs/ux.md`）
- **运行记录持久化（试验）**：以原型 `runRecordMock`（章→步→parts/groups）为 TypeBox 草案；验证「写」步骤流式输出存原始流还是渲染后 parts、pi-agent-core 会话存储能否复用。验收：重跑后运行记录能完整回放。（`docs/ux.md`、prototype mock）
- **propose kind 补 `add_text_marker`**：patch 装标记名+CSS+逐字开关；主控工具补 `list_assets`、`read_chapter_manifest`、`read_task_result`（查素材名、图清单、失败原因）。（`.workflow/research/novelive-agent.md`、`decisions.md` 2026-11-20）
- **标记提议落点**：模型提议新自定义标记进编辑器顶部横幅确认，不进对话面板确认卡；`ConfirmKind` 不加 mark。（`docs/ux.md`、prototype EditorPage）

## M2

- **过期传播映射**：角色.外貌→该角色全部造型基准图及表情差分；造型.描述→该造型基准图+表情差分；地点.描述→基准图+变体；CG 无上游；风格→不自动过期只提示。（`docs/visuals.md`）
- **规则存储**：本章规则可删可改、无停用位；「改编要求」是独立自由文本字段，不作为规则存储。（`docs/ux.md`、prototype SettingsDrawer）
- **修改历史**：持久保存条目清单（何时改了哪句改成什么）进 `project.db`，用于审计；撤销只在本次打开内按逆操作回放，不持久快照。（`docs/ux.md`、`docs/work-format.md`）
- **重写场景双入口**：编辑器内发起走差异列表勾选，对话面板发起走确认卡；同一后端工作流，差异列表=场景级确认卡的编辑器形态。（`docs/ux.md`、`docs/creation-pipeline.md`）

## M3

- **放大模型选型**：Real-ESRGAN `x4plus-anime-6B` + ncnn-vulkan（BSD-3，权重可再分发，Vulkan 不依赖 NVIDIA）；降噪由超分模型内置 denoise 强度承担，不立单独模型。硬性条件：许可允许随包分发、不依赖 NVIDIA、安装包体积可接受。（`docs/architecture.md`、`docs/visuals.md`、`decisions.md` 2026-11-21）
- **alpha 通道（试验）**：透明 PNG 拆 alpha 单独双三次放大再合成。验收：放大后 alpha 边缘不带色边。（`docs/visuals.md`、`.workflow/evidence/spike-consistency`）
- **stdio 协议**：行分隔 JSON；图片传临时文件路径不传 base64。（`docs/architecture.md`）
- **体积与耗时（试验）**：M3 试打包时实测权重+venv 安装包体积和单图放大耗时。验收：安装包体积和 CPU 放大单图时间在 spec 写的限值内（RealESRGAN_x4plus ≈64MB 权重起步）。（`docs/architecture.md`）
- **存量图回填**：素材另存成品+保留生成原图（或记放大状态字段）；M3 起新图走「转 WebP+放大」，旧工程存量图标「待放大」后台逐张回填，失败不阻塞。（`.workflow/research/novelive-agent.md`、`docs/visuals.md`）
- **存档位数**：快存 1 槽、普通存档 60 槽；已读按句子 ID 集合存，主线进度记「章节 ID + 句子 ID」。（`docs/player.md`、prototype PlayerPage）
- **播放器设置全集**：文字速度、自动播放速度、字号、对话框不透明度、只跳过已读、全屏、对话框样式全收。（`docs/player.md`、prototype）

## M4

- **PDF 范围**：四种格式全做；PDF 只支持能提取文字的文件，扫描件提示不支持。（`docs/product.md`、`decisions.md` 2026-11-21）
- **EPUB 插图筛选（试验）**：提取 `OEBPS/images` 插图，按章节位置关联附近文本，让视觉模型按设定集描述打「角色/场景/无关」标签。验收：筛出的候选进确认点 1 可用，再定候选生成方式。（`docs/ux.md`、`docs/visuals.md`）
- **托盘行为**：三平台都走系统托盘；无托盘环境（部分 Wayland）关窗等价最小化；真正退出从托盘菜单或应用菜单发起并询问。（`docs/ux.md`）
- **系统通知**：标题=事件，正文=作品名+章/阶段；点击打开窗口并跳转（待确认→确认点页、需要处理→制作面板、做完→作品页、新章→播放器）。（`docs/ux.md`）
- **作品包关联**：注册 `.novelive` 文件关联，双击直接导入；新版本替换旧版时旧包进回收站。（`docs/ux.md`、`docs/work-format.md`）
- **测试文件来源**：EPUB/Markdown/DOCX 用工具从文本合成（pandoc/Calibre），PDF 用合成文件验证解析链。（`docs/product.md`）

## M5

- **安装包格式**：Linux=AppImage、Windows=nsis、macOS=dmg（附 zip 供自动更新）。（`docs/architecture.md`、electron-builder）
- **work.json 字段**：`workId`（UUID 不可变）、`version`（int 每次导出+1）、`derivedFrom`（来源 workId+version，可选）；版本提示规则=「version > 已安装 version 才提示」；对不上的旧存档在存档界面以「旧版本存档」分组可见可删。（`docs/work-format.md`、`docs/ux.md`）
- **界面翻译**：agent 跑机器翻译（繁中/英/日）并标注「未经人工抽查」，人工抽查留 `owner-review.md`。（`docs/architecture.md`、`.workflow/owner-review.md`）
- **许可清单**：主依赖均为 MIT/Apache/ISC，无 copyleft 运行时依赖；M5 在应用「关于」页放第三方开源许可列表。（`docs/architecture.md`、LICENSE）
