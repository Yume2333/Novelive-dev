# Research: 第二轮 13 份调研与现有设计对账

2026-11-21。输入：13 份 R2 调研/审查报告（`local://r2-*.md`）+ `docs/*.md`、`DESIGN.md`、`.workflow/decisions.md`（含 Supersedes 链，最新 wins）、`.workflow/glossary.md`、`.workflow/research/*.md`（含 round-1 `gap-ledger.md`）、`.workflow/specs/m0-skeleton.md`、`.workflow/owner-review.md`、`prototype/src/`。

核实方法：每条先回读所引文档原文（path:line）判 `已覆盖`/`误读`/`属实`；6 项争议声明另用一手来源独立复核——`openai@7.62.0` npm tarball `images.d.ts`、OpenAI deprecations 页、Electron#46323 issue、electron-updater v26 官方文档、各 ncnn-vulkan 仓 LICENSE、pi-ai 1.6.0 `dist/providers/data/*.json`（43 个 provider、~1000 模型）逐字段查。round-1 `gap-ledger.md` 已列条目不重复列，除非 round 2 改了它。

分类：A 与已定决策冲突（需所有者拍板）｜B 确定缺口直接补（按目标文件分组）｜C 需要取舍的新设计（选项+推荐）｜D 可拷资产｜E 不要（附理由）｜F 原型要改的地方。

---

## 核实结果（6 项争议声明独立复核）

1. **OpenAI 图片线**：`属实`。`openai@7.62.0` `resources/images.d.ts:321-326` 注释明写「`gpt-image-1` was shut down on October 23, 2026」，`ImageModel` 枚举含 `gpt-image-2.5-{sunburst,flare}`、`gpt-image-2.6-{sunburst,flare}`；OpenAI deprecations 页（2026-11-21 读）列出 `gpt-image-1` 已 Shutdown、`gpt-image-1-mini`/`gpt-image-1.5`/`chatgpt-image-latest` Deprecated（2026-12-01 停）、2.6 系列为推荐替代。第三方报道（fixmation、s5labs、apihiver）一致佐证 10-23 关停。
2. **sharp 在 Electron/Linux 解码必崩**：`属实`（本机复现 exit 139）。根因=Electron Linux 二进制动态链系统 glib + sharp/libvips 内嵌私有 glib 符号冲突；Electron#46323 2025-03 报、至今 **Open** 标签 `34-x-y`/`platform/linux`/`crash`，无上游修复、无官方 workaround，sharp 官方在 `sharp.mjs:92-96` 主动 emitWarning「Electron…Linux…incompatible」。`@janhapke/sharp-electron` Apache-2.0 单仓 fork（9 commits、0 star、linux-x64 only、arm64 throw），机制=linker 层隐藏 libvips 内嵌 glib 符号+7 个 `vips_g_*` wrapper+DT_RPATH 强制 colocated `.so`。替代：纯 Node 子进程跑 sharp（要随包带 node 运行时 ~40MB）、自编译 sharp（每升级重打）、`@napi-rs/image`（无 libvips 但功能集不同）、`wasm-vips`（体积大）。**推荐 pnpm.overrides → `@janhapke/sharp-electron`，linux-arm64 目标不支持时另行处理**。
3. **Linux 自动更新**：`部分误读`。报告说「Linux 没有内建更新」对 Electron `autoUpdater` API 成立（官方只 macOS+Windows），但 electron-builder 的 `electron-updater` v26 文档明确支持 Linux `AppImage`、`rpm`、`deb`（AppImageUpdater/DebUpdater/RpmUpdater/PacmanUpdater 类）——所以「AppImage 走 electron-updater」是对的，「deb 只能手动/仓库」措辞过重（DebUpdater 存在但依赖 GPG/仓库约定，实际常用是 AppImage 自更新）。`decisions.md:398` 只写「electron-builder 自动更新 GitHub Releases」未限定平台——**决策本身可成立，Linux 落 AppImage 路径即可，macOS 未签名静默失败才是真缺口**。
4. **ncnn-vulkan 许可**：`属实`且全部干净。`nihui/realcugan-ncnn-vulkan` MIT（LICENSE 文件）、上游 `bilibili/ailab Real-CUGAN` MIT；`nihui/waifu2x-ncnn-vulkan` MIT（release 至 2025-09-15 仍在更）；`xinntao/Real-ESRGAN-ncnn-vulkan` MIT、权重 `x4plus-anime-6B` BSD-3（HF `license:bsd-3-clause`）；`Tencent/ncnn` BSD-3。三平台 win/mac/linux 预编译二进制均有官方 release（realcugan 最新 2022-07-28 已停更但稳定可用，waifu2x 2025-09-15 活跃）。**与 AGPL-3.0 兼容，二进制+权重可再分发**。
5. **pi 内置模型目录**：`属实`（main 已复核，`audit-agent` 的「无证据」=`误读`）。pi-ai 1.6.0 `dist/providers/data/*.json` 43 个 provider JSON、每模型带 `cost{input,output,cacheRead,cacheWrite}`/`contextWindow`/`maxTokens`/`compat.thinkingFormat`；`models.js` `createModels`/`getModel(provider,id)`、`providers/all.js` `getBuiltinModel`/`MODELS` 均为公开 API。m0「pi 内置模型目录查得到就自动填上下文长度」**可行**（`deepseek.json` deepseek-flash=1M ctx/$0.3-in/$0.006-cacheRead 实测可查）。
6. **zh-tokens 默认 k=0.9**：`属实`偏保守。实测网文：deepseek-v3 0.64、qwen2.5/kimi 0.71、glm4 0.69、o200k 0.86、cl100k 1.29、llama3 0.88、gemma3 0.77 token/字。k=0.9 对国产（0.64-0.71）**高估 10-25%**（安全方向）、对 Claude（~1.04-1.05）**低估 ~15%**、对 cl100k **低估 ~30%**。规则建议：**按 pi 目录 provider 分档 k**（`CJK字数×k + 非CJK字节÷4`）：`anthropic→1.0`、`openai→0.91`（o200k）/`1.35`（cl100k 老模型）、`deepseek→0.69`、`zai→0.73`、`qwen→0.76`、`moonshotai→0.76`、`google→0.81`（gemma 代理）、`openrouter`→按上游模型名再映射、**未知 provider→0.95（宁高估）**。目录 provider 字段可直接 key（`deepseek`/`zai`/`qwen-token-plan*`→qwen/`moonshotai*`/`google`/`anthropic`/`openai`），与「compat 预设」同一检测点。

---

## A. 与已定决策冲突（需所有者拍板）

- **A1. Python sidecar vs 直接 spawn ncnn 二进制**
  - 冲突双方：`decisions.md:188`「保留 Python 进程做放大降噪」+ `architecture.md:26-27`/`visuals.md:55`「放大和降噪由一个 Python 进程负责」vs r2-upscale §1.7/§5.A：ncnn-vulkan 二进制本身是独立可执行文件，Node `child_process.spawn` + 临时文件即可驱动，零 Python 依赖。
  - 取舍：(a) 去 Python，creator 直接 spawn `realcugan-ncnn-vulkan` 等二进制（省 22-105MB、省解释器、少一层进程，stdio JSON 协议不变）；(b) 保留 Python 薄包装（PyInstaller ~22MB 或 embedded ~30MB，为未来 torch 模型留门）；(c) 维持 Python 全量。
  - **推荐 (a)**：本里程碑需求（动漫图、无 NVIDIA、可分发、2K/4K、alpha 直通）ncnn 已全覆盖且实测达标；Python 只为未来 PyTorch/spandrel 模型留门属投机。要改的是 `decisions.md:188`、`architecture.md:26-27`、`visuals.md:55`、`handoff-defaults.md` M3 段的「Python 进程」表述（改为「放大降噪子进程=ncnn-vulkan 二进制，由创作端 spawn，协议同」）。

- **A2. 放大默认选型 Real-ESRGAN `x4plus-anime` vs Real-CUGAN**
  - 冲突双方：`handoff-defaults.md:67`「Real-ESRGAN `x4plus-anime-6B` + ncnn-vulkan」vs r2-upscale §1.2/§5.B：CUGAN 实测核显快 3-4×（2.7-3.1s vs 8.6s）、权重小 3×（2.5-2.7MB vs 8.9MB）、照片/真实内容更自然、自带 n0-n3 降噪档；ESRGAN 仅在高对比细碎细节（星空）更锐。
  - 取舍：(a) 默认 Real-CUGAN（models-se），作品设置加「锐利优先」开关切 ESRGAN-anime 备选；(b) 维持 ESRGAN-anime 默认；(c) 两者都装、默认 CUGAN。
  - **推荐 (a) 或 (c)**：CUGAN 在速度/体积/照片自然度全面占优，细碎细节差距只对 CG 星空类敏感；若只带一个带 CUGAN（~15MB），带两个 ~35MB 也在 50MB 预算内。`handoff-defaults.md:67` 选型应改为「默认 Real-CUGAN models-se，ESRGAN-anime 备选」。

- **A3. alpha 放大路径：拆通道 vs 整图 RGBA 直通**
  - 冲突双方：`handoff-defaults.md:68`「透明 PNG 拆 alpha 单独双三次放大再合成」vs r2-upscale §1.4/§5.D：实测整图 RGBA 直通模型，alpha 边缘 MAE 0.04/255、无白边/串色，模型对四通道同处理。
  - 取舍：(a) 改整图 RGBA 直通（更简单、实测无串色）；(b) 维持拆通道（保险）。
  - **推荐 (a)**：拆通道是「未试验的预防性设计」，实测证明多余；若个别模型 alpha 色偏再退回（本次未观察到）。

- **A4. Linux 自动更新机制**
  - 冲突双方：`decisions.md:398`「electron-builder 自动更新 GitHub Releases」未限定平台 vs r2-electron-shell §1.9/§3：Electron `autoUpdater` API 只 macOS+Windows，macOS 未签名静默失败（Squirrel.Mac 强验签），Linux 无内建但 electron-updater 的 AppImageUpdater 可行（zsync 差量）。
  - 取舍：(a) Win=NSIS 自更新、Linux=AppImage 自更新、macOS 未签名只「提示新版+手动下载」（推荐）；(b) 三平台都只做提示+手动下载；(c) deb 也走 DebUpdater（GPG/仓库约定复杂）。
  - **推荐 (a)**：决策本身仍可成立（electron-builder 的自动更新确实覆盖三平台，只是各平台形态不同），需补的是 `owner-review.md:9` 已暗示的「macOS 未签名包自动更新不可用」事实写明；`decisions.md:398` 补一句「Win=NSIS 自更新、Linux=AppImage 自更新、macOS 未签名只检查不下载」。

- **A5. sharp 选型在 Electron/Linux 不可用**
  - 冲突双方：`decisions.md:330`/`architecture.md:55` 技术选型 `sharp` vs r2-electron-shell §1.2：sharp 0.35.x 在 Electron 45.4.1/Linux 解码任何真实压缩图必 SIGSEGV（exit 139，本机复现），上游 Electron#46323 未修。
  - 取舍：(a) `pnpm.overrides` → `@janhapke/sharp-electron`（Apache-2.0，linux-x64 修复版，其他平台透传真 sharp；arm64 throw）；(b) 自重建同款补丁（patchelf RPATH+符号隐藏，可复现但每升级重打）；(c) 解码搬进独立 Node 子进程（要随包带 node 运行时）；(d) 换 `@napi-rs/image`（功能集不同）。
  - **推荐 (a)**：一行 override、Apache-2.0、只服务 linux-x64（M3 目标）；跟踪 Electron#46323 修复后回退官方 sharp。linux-arm64 若做需要 (b) 或 (c)。

- **A6. 「已发布」与「需要处理」状态关系**
  - 冲突双方：`ux.md:24`/`creation-pipeline.md:59`「图都齐=已发布」+「占位图章标需要处理」并列 vs `prototype/src/mock/types.ts:4` `ChapterStatus` 四选一互斥、`PlayerPage.tsx:1100` 把 attention 当可玩——占位图章同时是「已发布」还是「需要处理」未定义，「全部章节已发布」在含占位图章时成不成立未知。
  - 取舍：(a)「需要处理」=叠加在已发布上的标记（已发布=可玩、需要处理=可玩+待处理任务，标记独立清除）；(b) 互斥枚举（要补第五词或改 DESIGN.md 状态词）。
  - **推荐 (a)**：占位图章本来就能玩，踢出「已发布」会让完成态永远达不到；audit-product 已给同向建议。

---

## B. 确定缺口，证据充分，直接补

### `docs/ux.md`

- **B1**（§需要处理行）：「自动重试两次」改「自动重试，重试都失败标需要处理」不展开层数——与 `creation-pipeline.md:64` 两层重试（`maxRetries:2`+外层消息重发×2）一致；`ux.md:30` 现行文案过时且漏第二层。（源：audit-product B1、audit-agent A11）
- **B2**（§章状态）：补「等待=未开始（未写剧本或排期未到）」一句定义进入条件。（源：audit-product A3）
- **B3**（§编辑器）：补「撤销只在本次打开内有效、修改历史持久保存进 project.db」——`decisions.md:582`/`handoff-defaults.md:62` 已定，docs 缺。（源：audit-product B4）
- **B4**（§播放器界面控制）：删或改「只跳过已读」开关表述——`player.md:71` 已定「不做跳过未读」，开关固定只跳已读。（源：audit-product E1，见 F）
- **B5**（§设置页）：图片模型配置补 4 个用户声明字段（协议形状=OpenAI images/其他；编辑=支持/仅文生/不确定；透明底=支持/不支持/不确定；尺寸=任意WxH/档位/固定枚举）+与三项测试关系（测试核对声明、矛盾提示不阻止保存）。（源：r2-image-api §6.1）
- **B6**（§用量面板或新行）：会话/运行记录用量含 `cacheRead`/`cacheWrite`（Anthropic 另有 `cacheWrite1h`）——`novelive-agent.md:25` 已有字段，docs 未提。（源：r2-text-providers §3）

### `docs/creation-pipeline.md`

- **B7**（§4.2）：补「一章最终失败→整部作品暂停（写手依赖上一章结尾），行内重试排回队首，成功后恢复」——`decisions.md:582`/`handoff-defaults.md:40` 已定，docs 缺状态转移。（源：audit-product A4、audit-agent A10）
- **B8**（§系统通知行）：补第四种「播放器在后台等待本机连载新章」——`ux.md:32`/`player.md:89` 已有、`creation-pipeline.md:69` 漏。（源：audit-product B2）
- **B9**（§审稿行）：补「审稿引的是**原文段落**，与 bible `evidence[].quote`（M2 才加）无关」一句防误读。（源：audit-product G 末段、bible.md:32）
- **B10**（§4.2 或新行）：章失败时「输入已改需要重跑」状态映射 `run.status=needs_attention + error_type='input_changed'`——`pi-scaffolding.md:90` 枚举无该值。（源：audit-agent A16）

### `docs/work-format.md`

- **B11**（§导出/包内约定新小节）：写「第一条目 `mimetype` STORED 内容 `application/vnd.novelive+zip`；`.webp` STORE、其余 DEFLATE；UTF-8 文件名；读端按中央目录建一次索引缓存（2 万条 ~0.5s 一次性）；yauzl 路径校验兜底（拒 `..`/绝对路径/盘符/反斜杠）」约 6 行。（源：r2-work-package F6/F12，EPUB/ODF 惯例）
- **B12**（`work.json` 字段列）：加 `formatVersion:1`、`minReaderVersion:1`、`appVersion:"<app版本>"` 三行；`series/volume/chapter/bible/glossary` 各 json 共用 `formatVersion`。（源：r2-work-package F7，Sketch `meta.json` 先例）
- **B13**（§导入为工程或新行）：补「旧 `formatVersion` 迁移链——导入端按 `formatVersion` 顺序跑 1→2→3… 每步纯函数升单 json；`formatVersion > 本端` 提示升级应用；读旧包用 pi-schema `obj(...,{open:true})` 容忍未知字段」。（源：r2-work-package F8、pi-schema 实测）
- **B14**（§目录结构或导出）：补「导出时若作品 `styles.css` 引用自定义字体（`assets/fonts/*.woff2`），按 `source/`+剧本文本并集字符自动子集成 woff2 随包」——`work-format.md:97` 已允许 `@font-face` 但没说字体文件哪来、是否随包。（源：r2-cjk-text §3 末行/取舍 2）

### `docs/player.md`

- **B15**（§文本或新行）：补「四种文本与对话框均用 DOM 覆盖层渲染、不进 Pixi 舞台」+实现要点（`line-break:strict`+`text-spacing-trim:space-first`+`text-autospace:normal`+`text-shadow` 描边，禁则靠 Chromium 不自实现；`<ruby>` 注音=DOM `<ruby><rt>`；逐字打字机=占位居 `visibility:hidden` 撑排版+显现层逐字 opacity 零漂移）。（源：r2-cjk-text §1.1-1.4、§3）
- **B16**（§回滚/历史）：补「快照含 PerformList（活动演出清单）；恢复快照后选择性重放——意图型状态写指令（@bg/@show/@camera/@filter/@particle）幂等可重跑、文本句只重建文本演出不重跑、累积型/相对动画跳过」三态规则。（源：r2-vn-runtime §2.4，WebGAL `restorePerform` 先例）
- **B17**（§快照）：补快照字段表（等价 WebGAL `IStageState`：背景/各槽位立绘/CG/前景/变换/文本/PerformList/章内进度，砍 BGM/变量/Live2D）。（源：r2-vn-runtime §2.1）
- **B18**（§自动播放/文字速度）：补「自动延迟=`base + rate×句长`（Ren'Py/Tyrano 线性，建议默认 1.2s+0.08s×字符数，滑块调倍率）；文字速度 ms/字滑块 3~153ms + 瞬间档」。（源：r2-vn-runtime §2.6）
- **B19**（§存档）：补存档缩略图（WebGAL 480×270 webp q0.5，`canvas.toDataURL`/`app.renderer.extract`）+「存档迁移对不上保留、字段缺新给默认、越界收敛」兜底。（源：r2-vn-runtime §2.1 存档结构/§4.9，Monogatari step 收敛先例）
- **B20**（§跳过已读）：补「跳过已读时舞台指令照常瞬时生效（转场跳终态、立绘换图立即到位），只文字秒出+不停顿」——Ren'Py 语义，player.md:71 未写跳过中演出怎么办。（源：r2-vn-runtime §2.7）
- **B21**（新行或 §演出）：补「预载窗口=前看 20~32 句 + 舞台引用计数卸载（`Assets.unload`+`texture.destroy(true)`，2K/4K 单场景 ~100-300MB 必须写时机）」——Ren'Py predict=32/WebGAL lookahead=20 对齐。（源：r2-vn-runtime §2.11）
- **B22**（§指令或 work-format）：补「指令属性表——设置型（@bg/@particle/@filter 等）默认随行生效不等点击、文本型停点击」——`work-format.md:78-84` 隐含未显式，WebGAL `ADD_NEXT_ARG_LIST` 先例。（源：r2-vn-runtime §2.12）

### `docs/visuals.md`

- **B23**（§3.1 或新「图片接口适配」小节）：写精简兼容矩阵——OpenAI（multipart edits/任意WxH/恒b64/moderation_blocked）/Seedream（generations+image、无edits、档位或WxH、url默认24h、`watermark:false`必传）/Qwen（generations+image、无edits、WxH、b64仅3.0）/Gemini-compat（无edits无transparent、extra_body.aspect_ratio）/SiliconFlow（`image_size`枚举、`images[].url`非data[]）/中转（透传上游形状）；用户声明 4 项 + host 匹配预设（不做主动探测）。（源：r2-image-api §3/§6.2）
- **B24**（§生成规则）：补「`draw_image` 适配层归一化——`negativePrompt` 默认拼进 prompt 尾部（`Avoid:…`）而非传参（OpenAI/Seedream/Gemini 无此参）；edits 对无 `/edits` 端点的 provider 降级为 generations+`image` 字段；返回 url→下载字节归一（Seedream/Qwen/Together 默认 url 24h、SiliconFlow `images[].url` 1h）；缺 alpha→技术检查拦下；流式仅 OpenAI/OpenRouter/Seedream-lite 支持，不支持同步回落」。（源：r2-image-api §4 缺口行/§6.2）
- **B25**（§审核拒绝行）：错误分类从 `moderation_blocked` 单值扩为集合——`{moderation_blocked}`∪`{Input|Output}{Text|Image}SensitiveContentDetected.*`（火山）∪`{invalid_request_error+InvalidParameter&message 含敏感/审核}`（Qwen）∪`422`（Together/SiliconFlow safety）∪`{code:int&message 匹配}`（OpenRouter/SF）；审核拒绝不耗 SDK 重试（400 本就只重试 5xx/429）。（源：r2-image-api §4 审核行/§2B/C/E/G）

### `docs/architecture.md`

- **B26**（§技术选型 sharp 行）：补「libvips LGPL-3.0 动态加载，NOTICES 声明」+「Electron/Linux 下用 `@janhapke/sharp-electron`（overrides）」（若 A5 采纳）。（源：r2-licenses §3、r2-electron-shell §3）
- **B27**（§进程划分/构建）：补「utility process 入口=main build 第二 rollup input（electron-vite 6 无 `utility` key）」+「asarUnpack 须含 `**/*.so*` 不只 `*.node`（libvips-cpp.so 留 asar 里 dlopen 失败）」。（源：r2-electron-shell §1.4/§1.5）
- **B28**（§构建打包行）：补「electron-builder 打包产物自带 Electron `LICENSE`+`LICENSES.chromium.html`（含 FFmpeg LGPL-2.1 等 ~90 组件通知），不删；THIRD_PARTY_NOTICES 由构建脚本生成」。（源：r2-licenses §3/§4 计划）
- **B29**（§事件 envelope 行）：补「scope 词表最小集 `app`/`work`（M0 先用 `app` 补漏测）」+「ring N 建议值（YN 用 500）」。（源：audit-agent C3/A17）
- **B30**（§事件推送行）：补「创作端→UI 事件载荷=投影后的整条 assistant 消息快照+headId，~30-50ms 批处理，UI 不自攒 delta」——assistant-ui ExternalStore 快照模式。（源：r2-chat-panel §1.5/§3）
- **B31**（§更新行或 M5 注）：补「macOS 未签名自动更新挂起（Squirrel.Mac 强验签静默失败），只检查+手动下载；Linux=AppImage 自更新」。（源：r2-electron-shell §3，A4 落地）

### `.workflow/specs/m0-skeleton.md`

- **B32**（§通信 `call`）：`call(command, payload, signal?)` 改 handoff 版「`call(cmd,payload)` 返回 promise + `cancel()` 句柄」——AbortSignal 不可 structured-clone 跨 contextBridge。（源：audit-agent C1，同日 handoff 正确）
- **B33**（§图片测试三项）：「图片编辑（用刚生成的图加一次编辑）」改「用内置小测试图做输入，文生图失败不阻塞编辑项」——`handoff-defaults.md:23` 正确。（源：audit-agent C2）
- **B34**（§事件）：补 scope 词表 `app`/`work` + ring N 默认；`webContents.destroyed` 改「port 销毁时创作端 abort 在途」（preload 拿不到 webContents 事件）。（源：audit-agent C3/C4）
- **B35**（§配置/崩溃）：cassette schema 补 `tags` 字段（handoff 有、spec 无）；断路器补「`creator.ready` 成功握手后失败计数清零」；`creator.ready` 发送方写明「主进程代发」；`NL_IMAGE_*` 注明文本测试同读；`config.update` 写「按字段合并」；`gap:true` 快照形状定义。（源：audit-agent C6-C11）
- **B36**（§模型接入）：「pi 内置模型目录查得到就自动填」——经复核**可行**（pi-ai 43 provider JSON 有 contextWindow），措辞保留；spec 注明「目录查不到则手填，目录命中优先级高于手填默认值」。（源：核实结果 5、audit-agent C5 降级为非阻塞）

### `.workflow/research/pi-scaffolding.md`（通用层）

- **B37**（通用层 1）：补「`sessionId=work-<workId>-<role>`（OpenRouter sticky routing+OpenAI prompt_cache_key 生效）、`cacheRetention` 默认 `short`（长间隔任务可选 `long`，但 Kimi/OpenAI GPT-5.6+ 1h/24h 写加价）；自定义地址 compat 缺失解法——模型设置加「兼容预设」下拉（自动/openai/deepseek/qwen/zai/openrouter/anthropic-compat），把 `compat.thinkingFormat`/`cacheControlFormat` 写到 pi `Model.compat`（约 80 行映射）」。（源：r2-text-providers §2.2/§3 缺口、取舍 2）
- **B38**（通用层 1 `onResponse`）：改「`afterToolCall` 钩子与 `subscribe` 事件（`turn_end`/`message_end`）里写」——pi 1.6.0 无 `onResponse` 钩子。（源：audit-agent A2）
- **B39**（通用层 3 run_step）：补 `prompt_version` 列（M1b 评测基线）+ `run.kind` 枚举补 `preview`/`synthesis`/`redo`/`resynthesize`/`chat-side`。（源：audit-agent A15/A14）
- **B40**（通用层 6 计量）：「UTF-8 字节÷4」改「`CJK字数×k_provider + 非CJK字节÷4`，k 按 pi 目录 provider 分档（见核实结果 6），未知 provider 默认 0.95」——`pi-scaffolding.md:105` 一句措辞。（源：r2-zh-tokens §3/取舍 A、核实结果 6）
- **B41**（通用层 4 park）：补 park 三态——park 中新消息排队到唤醒后注入；park 中退出→提议保持 pending、重开不出卡、会话把「等待已确认/已拒绝」补成工具结果；park 视同「停」→子 Agent 停。（源：audit-agent A6）
- **B42**（通用层 5 工具表）：主控工具表补 `spawn_agent` + `list_assets`/`read_chapter_manifest`/`read_task_result`（`handoff-defaults.md:55` 有、`novelive-agent.md:130-144` 漏）；审稿工具清单统一为 `read_source_range`/`find_term`/`read_chapter_preview`/`read_bible`/`submit_review`（两份不一致且都缺 `read_bible`）。（源：audit-agent A13/A5）

### `.workflow/research/novelive-agent.md` / `agent-orchestration.md` / `handoff-defaults.md`

- **B43**（novelive-agent 图清单行 or agent-orchestration:50）：「每张图标出已有还是要新画」改为「已有/新画由代码按素材名+已登记素材判定，模型不填」——`novelive-agent.md:90` 已正确，`decisions.md:486`/`creation-pipeline.md:56` 措辞需对齐（模型不填代码能算的）。（源：audit-agent A1）
- **B44**（agent-orchestration:110）：「风格与主视觉=主控+美术导演」改「主控+场景画师」——美术导演不再出图（decisions:486）。（源：audit-agent A7）
- **B45**（novelive-agent:63）：「中断整卷重跑」改「中断后从已落盘进度续跑，不重头」——与 `handoff-defaults.md:35` 一致。（源：audit-agent A8）
- **B46**（novelive-agent:118 修改历史）：「原文快照+新内容」改「持久条目清单（何时改了哪句改成什么），不持久快照」——`handoff-defaults.md:62` 为准。（源：audit-agent A9）
- **B47**（novelive-agent:145 提议表）：`chat_message_id` 可空 + kind 加 `pick_character_design`/`pick_main_visual`——确认点 1 候选借用提议表。（源：audit-agent A4）

### `.workflow/glossary.md`

- **B48**：补术语「红线（违反即整章作废的可检查断言，人工必审）」「降敏（审核拒绝后去具象词改写一次的规则）」「槽位（立绘位置槽，left/center/right 枚举）」「占位图（三类内置图：角色/背景/CG）」「主视觉（一张风格基准图+关联设定描述，存 `assets/style/main-visual.webp`）」「工作流（确认卡发起的后台任务）」「生成预览流（OpenAI images partial image streaming，v1 默认不开）」。（源：audit-product C1-C9）

### `docs/creation-pipeline.md` §6 / 模型配置

- **B49**：补「文本模型配置含「兼容预设」下拉（自动检测/openai/deepseek/qwen/zai/openrouter/anthropic-compat），自定义地址时把 `compat.thinkingFormat`/`cacheControlFormat` 写入 pi `Model.compat`——否则推理 off 与显式缓存标记对 DashScope/中转静默失效」。（源：r2-text-providers §3 缺口、取舍 2）

---

## C. 需要取舍的新设计（给选项+推荐）

- **C1. Pixi 舞台命令式 vs @pixi/react**：(a) 命令式 stage（WebGAL/pixi-vn 两家 VN 引擎均如此，舞台状态=纯 JSON 快照按字段 diff 写 Pixi 对象，React 只管 DOM UI）；(b) @pixi/react 8（React 19 兼容但要多维护 快照→JSX 映射层）。**推荐 (a)**——与「DOM 覆盖层文本+命令式 Pixi 舞台」一致，不写 @pixi/react。（源：r2-vn-runtime §2.10）
- **C2. 默认正文字体**：(a) Noto Serif SC 思源宋体（galgame 对白主流衬线感，~5MB 子集/~8MB fontsource woff2）；(b) Noto Sans SC（UI 统一省一套）；(c) 两者都装皮肤给创作者。**推荐 (a)**：正文/对白 Serif、UI 用已有 Sans。（源：r2-cjk-text 取舍 1）
- **C3. `.novelive` 包内嵌字体**：(a) 不带字体、作品只能用应用内置 2-3 套；(b) 带字体——作品 `styles.css` `@font-face` 引 `assets/fonts/*.woff2`，导出按文本并集自动子集（`subset-font` MIT wasm，~5MB 子集）；(c) 完整字体直拷（20+MB 不可）。**推荐 (b)**——作品自定义标记已是开放面，字体是同逻辑延伸，子集成本可忽略。（源：r2-cjk-text 取舍 2、B14 落点）
- **C4. 应用内置字体装全字符还是核心子集**：(a) fontsource 全字符 woff2 Regular 字重（~8-10MB，任何生僻字不豆腐）；(b) 预切常用 3500+GB2312 子集（~2MB）+系统回退。**推荐 (a)**：Electron 本地加载无延迟，多 6MB 换完整覆盖。（源：r2-cjk-text 取舍 3）
- **C5. 移动行的句子 ID 归属**：(a) cut→ID 死、粘贴→新 ID（Git/Ren'Py 惯例，粘贴文本本身无 `#` 标记，实现零成本）；(b) 移动检测让 ID 跟内容走（要相似度匹配）。**推荐 (a)**——work-format.md:92「模型改行保留 ID」只约束模型不约束编辑器移动。（源：r2-script-editor §5.1）
- **C6. M2 `.nvs` 语法高亮/chips**：(a) 一期做 `@指令`/行内标签/`#id` 高亮 + speaker chip（CodeMirror 6 Decoration widget，已在试验中摊平）；(b) 二期再做。**推荐 (a)**——编辑器核心体验，`unifiedMergeView`+chip 已实测。（源：r2-script-editor §3 缺口/§5.4）
- **C7. 对话面板 attachments（贴图）**：(a) 做——`AttachmentAdapter`+`pi.prompt(input,images)` 现成，给主控/美术导演看参考图有真实场景（确认点 1 参考图讨论）；(b) 不做。**建议列入可做可不做**——ux.md 未写，成本~1 天；若做走 `novelive://` 资源或 base64。（源：r2-chat-panel §3 attachments 缺口/§5.4）
- **C8. 文本模型「兼容预设」下拉**：(a) 做——自定义地址（DashScope/中转）时把 `compat.thinkingFormat`/`cacheControlFormat` 写 pi `Model.compat`（~80 行映射+文档一行），否则推理 off/显式缓存静默失效；(b) 不做（隐式缓存仍可命中、推理控制失效）。**推荐 (a)**——自定义中转是主用法（NL_* 就是中转），失效面大。（源：r2-text-providers 取舍 2、B49）
- **C9. `sessionId`/`cacheRetention` 策略**：(a) `sessionId=work-<id>-<role>` 同角色跨章同 key、`cacheRetention` 默认 `short`、不暴露调优 UI（推荐写进通用层 1 角色运行器）；(b) 全由 pi 默认。**推荐 (a)**——OpenRouter/OpenAI 粘路由+缓存命中靠它，对话面板空闲>5min 若想省 1h 写费再开放「高级可选 cacheRetention」。（源：r2-text-providers 取舍 4、B37）
- **C10. 图片模型设置 4 项声明+预设**：(a) 用户声明 4 项（协议/编辑/透明底/尺寸）+host 匹配预设（openai/seedream/qwen/gemini/siliconflow/together/通用），三项测试核对声明；(b) 全部手填不预设。**推荐 (a)**——能力因 provider 而异且不做探测，声明+测试正好对应「不兜底只提示」决策。（源：r2-image-api §6.1/§7）
- **C11. `negativePrompt` 字段去留**：(a) 保留 tool schema 字段、适配层默认拼进 prompt（`Avoid:…`）、声明支持 `negative_prompt` 的 provider 才传参；(b) 删字段。**推荐 (a)**——OpenAI/Seedream/Gemini 都不接受，只有 Qwen3.0/SF部分/Together部分接受；模型不用知道差异。（源：r2-image-api 取舍 2、B24）
- **C12. 流式预览（partial images）**：(a) v1 默认不开（`stream:false`），适配层保留流接口不暴露 UI；(b) 开。**推荐 (a)**——只有 OpenAI/OpenRouter/Seedream-lite 稳，美术导演看图清单时边生成边显价值有限。（源：r2-image-api 取舍 3）
- **C13. OpenRouter 图片端点**：(a) v1 不接（`/api/v1/images` 非 `/v1/images/*` 形状，要第二条协议链）；(b) 接。**推荐 (a)**——国内主用 new-api/one-api 中转+官方端点，收益不抵复杂度。（源：r2-image-api 取舍 1）
- **C14. Gemini compat 地位**：(a) 设置页允许填、文档明示「不支持编辑/透明底，不能做差分/立绘画师模型」（用户可画背景/CG）；(b) 不接。**建议 (a) 但标记限制**——Nano Banana 质量对二次元立绘不差但缺 edits+transparent，设置页第三项测试会红。（源：r2-image-api 取舍 4）
- **C15. Batch API（全书逐章预览 50% 折扣）**：(a) 第一版不做，记 M4 评估项（自写 JSONL 提交/轮询/回放 ~200 行/厂，pi-ai 无 hook，24h 窗口对启动路径不友好）；(b) 做。**推荐 (a)**——预览绝对省额小（DeepSeek $0.11→$0.05），且预览是启动路径等不起 24h。（源：r2-text-providers 取舍 3）
- **C16. 文本模型「推荐组合」写不写文档**：(a) 只给「示例组合」（A1/A2/A3 国产低成本任一档 ~$5.2-6.5、C Anthropic 质量档 ~$11.2）不绑定，所有者 M1b 真书实测后定开发期推荐；(b) 写死默认。**推荐 (a)**——成本表见 r2-text-providers §5，实际浮动 ±50%。（源：r2-text-providers 取舍 1）
- **C17. 快照粒度**：(a) 每句 say 落点存全量 stageState（WebGAL，~15KB×200=3MB）；(b) diff 增量（pixi-vn）；(c) 语句指针+场景头重演（Narrat）。**推荐 (a)**——纯 JSON、回滚瞬时、跨章天然支持；200 上限对齐两家。（源：r2-vn-runtime §5.1）
- **C18. 确认卡 UI 落点**：(a) `tool-call.approval`（assistant-ui 0.15 原生 HITL，`propose_*` part 挂 approval、`onRespondToToolApproval` 回 reason）；(b) `data` part 自渲染。**推荐 (a)**——与 B1 提议表 feedback 语义严丝合缝，`pi-scaffolding.md:95` 的 omp 帧形改写建议换成此。（源：r2-chat-panel §1.4/§3 确认卡）
- **C19. 事件帧推快照还是 delta**：(a) 推整条 assistant 消息快照+headId、30-50ms 批（UI 不自攒、断线重放=重放最近 N 帧）；(b) 推 delta+contentIndex。**推荐 (a)**——react-pi 成熟做法，MessagePort 结构克隆成本可忽略。（源：r2-chat-panel §5.1、B30）
- **C20. MyBookshelf/legado 章节目则 26 条**：(a) 语义重写成 `ChapterRule[]` 正则自写（推荐，与「GPL 只参考」一致，legado 仓库已下线）；(b) 逐字搬（GPL 数据版权灰区）；(c) 完全自写不参考。**推荐 (a)**——`creation-pipeline.md:7` 已写「规则内容参考 legado、用自己的规则」，方向一致。（源：r2-licenses 取舍 1）
- **C21. PyInstaller vs 嵌入 Python**：(a) embedded Python + site-packages（最干净 ~30MB）；(b) uv 装系统 Python spawn（依赖用户环境）；(c) PyInstaller onedir（~22-80MB，GPL+exception 合规）。（**与 A1 联动**：若采纳 A1 去 Python 则本项失效；若保留 Python，**推荐 (a)** 或 M3 先 (b) 试跑。）（源：r2-licenses 取舍 2、r2-electron-shell §5.5）
- **C22. 存档迁移兜底规则**：(a) 「对不上保留+字段缺新给默认+越界收敛」写明（Monogatari step 收敛先例）；(b) 只写「对不上保留」。**推荐 (a)**——`player.md:97` 现只说对不上保留，新版包格式演进时旧快照缺字段/素材删了怎么办没写。（源：r2-vn-runtime §4 迁移兜底、r2-work-package §1.6）
- **C23. 「加入已有系列」导入**：(a) 第一版砍掉（导入即新建系列，一个工程=一个系列），M4 系列功能再定追加语义；(b) 保留（未定义追加的是新卷还是新作品）。**推荐 (a)**——prototype ImportPage 超前功能，docs 未定义语义。（源：audit-product E1/取舍 4）
- **C24. 改编强度/密度何时可改**：(a) 作品设置随时可改、只影响还没开始的任务（与规则同理）；(b) 制作中锁定。**推荐 (a)**——一句话进 ux.md:72 或 creation-pipeline §3；现 docs 未说预设改了何时生效。（源：audit-product G 末条）
- **C25. 忠实度检查能否关**：(a) 可关、默认开（与文风审稿同为开关但默认不同）；(b) 恒开不可关。**推荐 (a)**——`ux.md:72`/`creation-pipeline.md:55` 语气是「默认开」暗示可关，给所有者压质量的开关但默认保住底线。（源：audit-product 取舍 2）

---

## D. 可拷资产

| 资产 | 位置 | 许可 | 大小 | 目标 |
|---|---|---|---|---|
| `@janhapke/sharp-electron@0.35.4-electron.1` | npm | Apache-2.0 | ~20MB（重打 libvips） | `pnpm.overrides` 直接依赖（A5），不拷代码 |
| `realcugan-ncnn-vulkan` 可执行+`models-se`（up2x/3x/4x×n0/n3/cons） | `bin/realcugan/…20220728-ubuntu/` | MIT | 二进制 9.7MB+每档~2.5MB | 放大子进程默认模型（A1/A2），随包 |
| `realesrgan-ncnn-vulkan`+`realesrgan-x4plus-anime` | `bin/realesrgan/` | MIT（权重 BSD-3） | 二进制 11.4MB+anime 8.9MB | 锐利优先备选档（A2） |
| `waifu2x-ncnn-vulkan`+`models-cunet` | `bin/waifu2x/…20250915-linux/` | MIT | 二进制 8.3MB+cunet ~24MB | 可选第三模型（A2 若不选可不拷） |
| trial 骨架（pnpm workspace+electron-vite 多入口+MessagePort+extraResources python+electron-builder.yml） | `/tmp/nl-r2/R2ElectronShell/trial` | 自写 | ~400 行 | `apps/desktop` M0 照抄配置，utility-index.ts 握手样板 |
| `electron-builder.yml`：`extraResources`+`asarUnpack["**/*.node","**/*.so*","node_modules/sharp/**","node_modules/@img/**"]` | trial | 自写 | — | M3/M5 打包配置 |
| `.npmrc`：`node-linker=hoisted`、`shamefully-hoist=true` | trial | 自写 | — | M0 pnpm 配置 |
| 行 ID `StateField`（seed/assign/death-check/re-anchor/dedupe，~45 行） | `/tmp/nl-r2/script-editor/idtrack5.mjs` | 自写 | — | M2 `.nvs` 编辑器行 ID 跟踪 |
| `parseScript`（剥 `#id`→区间集）+speaker chip widget+ID gutter+`unifiedMergeView` 配置 | `script-editor/{idtrack5,app,unified-app}.mjs` | 自写 | ~100 行 | M2 编辑器 |
| `@assistant-ui/react-pi` 的 `messageProjection.ts`（~920 行取 ~300-400 思路）+`hostUi.ts`（170 行 approval 双向映射）+`threadState.ts`（442 行 reducer） | `aui-repo/packages/react-pi/src/runtime/` | MIT | ~1500 行 | 对话面板 transcript→ThreadMessageLike 投影、propose_*↔approval 映射 |
| `thread.aui.tsx`/`tool-fallback.aui.tsx` minimal 模板 | `aui-repo/templates/minimal/` | MIT | ~1000 行 | 面板组件组装参考（剥 Tailwind 改 CSS Modules） |
| FakeCreatorBackend（id/parentId 树+park 语义+ExternalStoreRuntime 接线+ProposalCard，~400 行） | `/tmp/nl-r2/ChatPanel/trial/` | 我方 | ~400 行 | `packages/ui` 面板骨架演化起点 |
| pi-ai 分档 k 表 `{default:0.95, anthropic:1.0, openai_o200k:0.91, openai_cl100k:1.35, qwen:0.76, kimi:0.76, deepseek:0.69, glm:0.73, llama:0.93, gemini_proxy:0.81}` | r2-zh-tokens §4 | 自产数据 | — | `packages/creator/src/agent/context/tokens.ts`（B40） |
| zh-tokens 测试夹具 `{nvs_sample.nvs, bible_big.json, prompt_en.txt, chapter_3k.txt}` | `/tmp/nl-r2/zh-tokens/` | 自写/公有领域 | ~小 | 估算器单测输入 |
| `normalizePackagePath`（83 行 NFC/越界校验） | `Novelive-legacy/packages/package-kit/src/path.ts` | 自家 MIT→AGPL | 83 行 | 导出端写路径断言（yauzl 已挡，此管 NFC/空段） |
| `MEDIA_STORE_EXTENSIONS`+`isStoreEntry`+确定性 ZIP（排序+固定 mtime） | `Novelive-legacy/packages/publisher/src/export/zip-writer.ts` | 同上 | — | 导出器，扩展名集换 `{webp}` |
| `ArchiveFingerprint`（size+中央目录 sha256+buildId+mtime） | `Novelive-legacy/packages/package-kit/src/fingerprint.ts` | 同上 | — | M5 导入列表「库→包」绑定 |
| WebGAL `IStageState`/`restorePerform`/`IPerform`/三粒子数学/`FILTER_CONFIGS`/`readHistory` 位图 | `webgal/src/Core/**` | MPL-2.0 | 各 ~50-200 行 | 只参考重写（文件级 copyleft 不拷；B16/B17 字段语义借鉴） |
| Ren'Py `afm` 公式+`_seen_ever`/`forward` 语义+`persistent._update()` 模式 | `renpy/` | MIT | — | 移植改写自动播放公式/读档迁移回调思想 |
| Monogatari 粒子注册表概念/AutoPlaySpeed | `monogatari/` | MIT | — | 移植改写 |
| pixi-filters 6.1.5（GlitchFilter/AdjustmentFilter/KawaseBlurFilter 等） | npm | MIT | 包 | 直接依赖（滤镜首批 blur/brightness/sepia/glitch 全覆盖） |
| `subset-font@2.9.0`（harfbuzz wasm 纯 JS） | npm | MIT | 包 | 导出时字体子集（C3/B14） |
| fontsource woff2：`@fontsource/noto-serif-sc` Regular（+可选 Bold）、`noto-sans-sc` Regular、`lxgw-wenkai` | npm | OFL-1.1 | 各 ~6-10MB 字重 | 应用内置字体（C2/C4，只拷 woff2+LICENSE 不整包） |
| pi-schema `obj(...,{open:true})` | npm（已依赖） | MIT | — | 旧包版本迁移读未知字段（B13） |
| new-api `volcengine/adaptor.go`（edits→generations 判断）+`gemini/adaptor.go`（size→aspectRatio 表）+`siliconflow/adaptor.go`（size→image_size）+`service/error.go` 错误体解析顺序 | new-api@8542c9d | AGPL-3.0 | ~170 行相关段 | 移植改写 `draw_image` 适配层（AGPL 兼容可改写，不逐字拷） |
| OpenRouter `supported_parameters` capability-descriptor 形状 | openrouter 文档 | 文档参考 | — | 只参考「用户声明能力」思路（不拷） |
| python-build-standalone 发行版 | astral-sh | MIT（Python PSFL） | ~30MB | M3 自包含 Python 用（若 A1 不采纳去 Python） |
| LiteLLM `model_prices_and_context_window.json` 精简表 | litellm | MIT 数据 | ~50KB | 兜底上下文长度/计价（pi 目录已覆盖主用，作自定义地址模型名命中补充） |

## E. 不要（附理由）

- **E1. `@pixi/particle-emitter` 装包**：peerDeps 写死 pixi `>=6.0.4 <8.0.0`，与 Pixi 8 不兼容；WebGAL 三粒子手写 ParticleContainer 各 ~150-200 行可移植，第三方 v8 重写包（`@spd789562`/`pixi-v8-particles`）维护度低。（源：r2-vn-runtime §2.8）
- **E2. `@pixi/react` 装包**：见 C1，舞台状态=纯 JSON 快照不适合声明式 React 树。（源：r2-vn-runtime §2.10）
- **E3. Monaco/ProseMirror-Tiptap/Lexical 编辑器**：Monaco 是大块头 code editor 与行 ID+差异列表模型不匹配；Tiptap Tracked Changes 是付费 Pro；Lexical 是块富文本 CJK IME 问题不断（#6377/#7779/#8098/#9235）且块模型不符行式剧本。**已选定 CodeMirror 6**（MIT，行式 CJK+装饰+IME+merge 全实测通过）。（源：r2-script-editor §1）
- **E4. `assistant-ui` LocalRuntime/AssistantTransport/useRemoteThreadListRuntime**：LocalRuntime 是「一问一答生成器」表达不了 park 等确认卡+后端改历史；AssistantTransport 要 HTTP/SSE 语义强套 MessagePort 只是搬家；remote thread list 假设 HTTP 资源语义。**选定 ExternalStoreRuntime+messageRepository+自管 thread store**。（源：r2-chat-panel §1.1/§1.7）
- **E5. streamdown 启用 KaTeX/mermaid plugin**：默认未启用省 ~100KB gzip 懒块；剧本/讨论面板用不上公式和图，保留 `plugins.cjk` 槽位备用。（源：r2-chat-panel §5.5）
- **E6. OpenRouter 图片端点**：`/api/v1/images` 非 OpenAI images 形状，第二条协议链+新错误形状收益不抵。（源：r2-image-api 取舍 1，C13）
- **E7. fal.ai 图片端点**：无 OpenAI 兼容端点，v1 不接。（源：r2-image-api §2.I）
- **E8. onnxruntime-node / PyTorch / spandrel / PyInstaller 全量**：onnxruntime-node 一个包 307MB、PyInstaller ~22-105MB、torch 方案远超 ncnn 15MB；ncnn 已全覆盖本里程碑需求。（源：r2-upscale §2.5，A1 联动）
- **E9. Python sidecar 保留**（**若 A1 采纳**）：ncnn 二进制独立可执行，套 Python 只增解释器零收益；A1 未采纳则此条不成立。（源：r2-upscale §5.A）
- **E10. Batch API 第一版**：收益小（预览绝对额省 <$0.2）、24h 窗口对启动路径不友好、pi-ai 无 hook 要自写 ~200 行/厂；记 M4 评估项。（源：r2-text-providers 取舍 3，C15）
- **E11. 连载更新 delta/跨包素材去重**：整包替换最简单，「系列级 assets 本来一份」已天然去重；增量要处理「玩家没装旧版」。（源：r2-work-package F9/取舍 3）
- **E12. 导出 CRC/manifest 校验清单**：yauzl 不校验 CRC 但坏包在 JSON.parse/schema 校验时自然报错；CRC32 弱校验挡不住有意篡改，真校验要签名超出第一版。归入普通解析错误。（源：r2-work-package F10/取舍 2）
- **E13. 作品包安全模型/体积条目上限**：`decisions.md:75` 已定不设；yauzl 自带路径校验挡 zip-slip 已够，包里无可执行内容。（源：r2-work-package §1.9/F11）
- **E14. `.novelive` 包内嵌完整字体/版权署名**：完整字体 20+MB 不可接受（走子集）；「不记录不展示版权」`work-format.md:145` 已定，作品归创作者非 AGPL 衍生。（源：r2-cjk-text 取舍 2、r2-licenses §2.6）
- **E15. `safeStorage` 存 API Key**：Linux 无 keyring 时回落 `basic_text` 明文且按 `XDG_CURRENT_DESKTOP` 认桌面（i3/sway/Hyprland 一律明文），对备份迁移无增量；维持「固定密钥 AES-256-GCM 源码常量」决策。（源：r2-electron-shell §1.7，印证 decisions:354-359）
- **E16. legado/MyBookshelf 正则逐字搬**：legado 仓库已清空只剩侵权公告（GPL 无法确认）、MyBookshelf JSON 是 GPL 项目内数据文件版权灰区；语义重写成 `ChapterRule[]`。（源：r2-licenses §2.4/取舍 1，C20）
- **E17. WebGAL/pixi-vn/Monogatari/Tyrano/Naninovel 文件拷贝**：MPL-2.0/LGPL/自定义许可/闭源，数学与思路不受版权保护但文件不拷。（源：r2-vn-runtime §4，与 gap-ledger C7/E14 一致）
- **E18. 向量相似度身份阈值（SigLIP embedding）**：`decisions.md:671` 已定暂不做；视觉模型单独审核已够，阈值要重标定且要 Python torch。（源：gap-ledger C15、r2-upscale A1 联动）
- **E19. `mimetype` 首条目以外的格式检测**：EPUB/ODF/Sketch 惯例已采纳 mimetype（一行）；玩家端不看 mtime/文件头嗅探，靠 `.novelive` 扩展名+双击关联。（源：r2-work-package F12）

## F. 原型要改的地方

`prototype/src/`（源：audit-product §2.E/§5、r2-script-editor、r2-chat-panel）：

| 文件 | 改动 |
|---|---|
| `mock/types.ts:70-71` | `reviewEnabled` 单开关 → `fidelityCheck`（恒真/可关默认开）+`styleReview`（默认关）两字段；`WorkPhase`/`ChapterStatus`/`GlobalStatus` 枚举可作 spec 初稿但 attention vs published 关系（A6）要先定 |
| `pages/work/WorkPage.tsx:255,317-320` | 「审稿」单 Toggle → 两个开关（忠实度检查/文风审稿） |
| `pages/production/ProductionPage.tsx:52` | steps 按 `reviewEnabled` 二选一 → 固定四步「写/审稿/演出/出图」，文风审稿关时「审稿」档显示但标跳过（待定义显示形态） |
| `pages/player/PlayerPage.tsx:1142` | 「只跳过已读」开关删（`player.md:71` 不做跳过未读，固定只跳已读） |
| `pages/chat/MessageView.tsx:201` | 拒绝按钮直接置 rejected → 加「拒绝理由」输入框（`ux.md:40` 要求） |
| `shell/AppShell.tsx:155` | 「Ctrl J」→「Ctrl/⌘+J」（docs 写 Ctrl/⌘+J） |
| `pages/import/ImportPage.tsx:139-171,357-426` | 「加入已有系列」选项第一版砍掉（C23，docs 未定义追加语义）；「改编设置」向导步 docs 未写——要么保留原型超前要么删（`ux.md:18` 向导只核对作品信息和章节划分） |
| `components/lucideMap.ts:16` | Material 命名→lucide 映射 shim，正式实现直接用 lucide 名不带过去（注释自承「沿用原型早期 Material 命名」） |
| `pages/settings/SettingsPage.tsx` | 图片模型配置加 4 个声明字段（B5）+「兼容预设」下拉（B49）；API Key 掩码哨兵语义（`architecture.md:9` 返回掩码、发回掩码/空串保留旧值）与普通密码框不同——实现语义按 architecture，原型可忽略 |
| `mock/usage.ts:23` | 用量阶段「写剧本」与制作步骤显示词「写」不统一——小，统一命名 |
| 新增 | 对话面板：streamdown 渲染（CJK 流式 markdown）、tool-call part `approval` 确认卡、BranchPicker 分支切换、`unstable_onBranchChange`、reasoning 可折叠、attachments（若 C7 做）、运行中 steer/followUp 输入（`ExternalThreadQueueAdapter`）——现 ChatPanel 是简化 mock 无这些 |
| 新增 | `.nvs` 编辑器：CodeMirror 6 行 ID gutter、`@指令`/行内标签/`#id` 高亮、speaker chip、`unifiedMergeView` 差异列表勾选（现 EditorPage 是 mock 无真编辑器） |

---

## 附：与 round-1 gap-ledger 的关系（不重复列，仅说明变化）

- round-1 **A1 工具循环预算墙** → 已被 `decisions.md:618-623` 采纳（软预算+1.5× 硬停）；round-2 无新增冲突。
- round-1 **A6 两层重试** → 已被 `decisions.md:636-642` 采纳；ux.md:30 文案未跟进见 B1。
- round-1 **B14b chars/3.5** → round-2 zh-tokens 确认「属实但偏保守」（cl100k 实测 3.7×）；估算器从「bytes÷4」升级为「CJK×k+非CJK÷4 分档」见 B40。
- round-1 **C7 Pixi 舞台** → 已被 `decisions.md:666` 采纳（PixiJS 8）；round-2 补舞台实现细节（命令式 vs react、DOM 文本覆盖层、粒子不装库、滤镜装 pixi-filters）。
- round-1 **D 区 LiteLLM 数据** → round-2 核实 pi-ai 1.6.0 自带 43 provider 目录含 contextWindow/cost，`m0`「pi 内置目录自动填」**可行**，LiteLLM 降级为自定义地址模型名命中补充。
- round-1 **E13 legado** → round-2 licenses 复核：legado 仓库已清空只剩侵权公告，GPL 正则建议语义重写不逐字搬（E16/C20）。
