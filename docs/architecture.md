# 系统架构

说明 Novelive 桌面应用的架构边界、进程通信、模块依赖、开发模式与技术选型。

## 运行形态与通信

- **桌面宿主**：Novelive 是基于 Electron 的桌面应用，支持 Windows、macOS、Linux。正式版只提供 Electron 桌面应用，不做网页播放器。
- **IPC 与自定义资源协议**：界面与后台之间通过 IPC 传递命令和事件；图片等资源通过自定义协议直接从 `.novelive` 作品包或工程文件夹读取。**不起本地 HTTP 服务。**
- **模型接入与凭据**：文本模型通过 Agent 底座 pi（`@earendil-works/pi-ai`、`@earendil-works/pi-agent-core`）接入，pi 作为库直接嵌在创作端进程里；会话存储、上下文维护、子 Agent 和按角色选模型由我们在 pi 之上实现（见 `.workflow/research/agent-orchestration.md` 和 `.workflow/research/pi-scaffolding.md`）。图片模型只接 OpenAI 兼容的图片接口，支持自定义地址，用 `openai` 官方 SDK 调用。API Key 简单加密后存在应用的配置文件里，方便备份和迁移；加密密钥写在程序里，只防止别人扫一眼配置文件就看到 Key。界面不持有明文 Key：配置查询返回掩码哨兵，发回哨兵或空串时保留旧值。
- **工程数据**：每个创作工程是一个独立文件夹，新建作品时由创作者选择位置（默认在 `文档/Novelive` 下），里面保存解包后的作品及创作专用数据（原文、任务记录、候选图、对话记录、用量记录）。作品内容是普通文件；任务状态、用量记录和对话记录存在工程里的一个 SQLite 数据库文件中，用 `node:sqlite` 在创作端 utility process 里读写（在 Electron 45.4.1 的 utility process 中 WAL 正常）。
- **Schema**：数据格式统一用 `@earendil-works/pi-schema`（pi-schema）定义，同一份定义用于加载作品包时的检查、代码类型和交给模型的输出格式与工具参数。剧本例外：剧本用文本剧本语言写，pi-schema 定义它解析后的结构（见[作品格式与工程](./work-format.md)）。

## 五块模块与依赖方向

系统按职责分为五块，保持播放器侧与创作侧解耦：

1. **作品格式与编译器**：定义单一语义化作品格式与读写能力，并在加载时将剧本现场编译为可执行演出数据。
2. **播放器**：负责播放推进、存档、回滚、已读与目录控制，**不依赖创作端**。不配置模型时也可独立导入 `.novelive` 作品包游玩。
3. **创作端**：负责原文导入、全书预览、按卷综合、改编与规则、Novelive Agent 编排、调度队列与出图队列、模型调用与导出。
4. **界面**：承载引导页、书库、导入向导、制作面板、对话面板、编辑器、播放器界面、设置与用量统计。
5. **Electron 宿主**：提供 Electron 桌面应用外壳，负责桌面窗口、托盘、系统通知、IPC 与自定义资源协议。

## 进程划分

- **创作端**单独运行在一个后台进程（Electron utility process）里。创作端卡住或崩溃时，窗口和托盘照常可用，创作端可以重新拉起。
- **放大与降噪**由一个放大程序（ncnn-vulkan 可执行文件 `upscayl-bin`，不依赖 CUDA，三平台都有预编译版）负责，由创作端启动；输入输出走临时文件，进度和结果通过标准输入输出传，不开网络端口。后处理开关默认开启，背景和 CG 默认放大到 2560×1440（2K）并同时降噪，作品设置可选 4K；立绘放大到宽约 2048 像素（见[视觉管线](./visuals.md)），差分和它的基准图用同一个放大模型和后处理状态；透明立绘带透明通道整图送进模型，不拆通道。关闭后处理开关时，不启动放大程序，直接由创作端用 sharp（Lanczos）缩放到目标尺寸、不做降噪。
- **其他图片处理**（缩放、转 WebP（有损或无损）、缩略图、技术检查，以及关闭后处理时的目标尺寸缩放）在创作端进程里用 sharp 完成。

## 代码组织

用 pnpm workspaces，一块一个包。依赖方向由各包的 `package.json` 约束，不另写架构检查脚本。

| 目录 | 内容 | 可以依赖 |
| --- | --- | --- |
| `packages/format` | 作品格式与编译器：pi-schema 结构、剧本解析、作品包读写 | 无 |
| `packages/player` | 播放器 | `format` |
| `packages/creator` | 创作端 | `format` |
| `packages/ui` | 界面：页面、控件库、Tokens | `player`；`creator` 只能引用 `@novelive/creator/contract` 里的命令和事件类型 |
| `apps/desktop` | Electron 宿主：主进程、预加载、托盘、通知、自定义协议 | `ui`、`creator` |
| `bin/upscale/` | 放大程序：ncnn-vulkan 可执行文件和模型权重 | 无 |

## 技术选型

| 层 | 选型 |
| --- | --- |
| 运行时 | Electron 稳定版（当前 45.x，内置 Node 24）；全部 ESM；TypeScript 严格模式；开发机 Node 24 |
| 构建与打包 | electron-vite 构建主进程、预加载、界面和创作端入口（创作端入口 = main build 的第二个 rollup input，electron-vite 6 没有 `utility` 配置段）；electron-builder 打安装包，放大程序作为附带资源放进去 |
| 包管理 | pnpm |
| 界面 | React 19；React Router（hash 路由）；Zustand 管全局状态，其余用组件状态 |
| 样式 | CSS Modules 加 `tokens.css`；Stylelint 检查硬编码颜色（`tokens.css` 与播放器舞台除外） |
| 国际化 | i18next + react-i18next，简体中文为源语言，文案按页面分命名空间；开发期只写简体中文，M5 发布前用模型翻译成繁体中文、英文、日文，再人工抽查 |
| 字体 | fontsource 本地打包，离线可用 |
| Schema | `@earendil-works/pi-schema` |
| 数据库 | `node:sqlite`（Node 24 内置，在 utility process 中可用） |
| 图片处理 | sharp（libvips LGPL-3.0 动态加载，进 THIRD_PARTY_NOTICES；Electron/Linux 下解码会崩，见下「打包注意」）；图片模型用 `openai` 官方 SDK（多参考图编辑、透明底、生成预览流、识别审核拒绝） |
| 对话界面 | `assistant-ui`（无样式组件，接自己的数据源）加 `streamdown`（流式 Markdown） |
| 作品包 | yauzl 读、yazl 写，按条目流式读取 |
| 播放器舞台 | PixiJS 8，代码直接控制舞台（不用 `@pixi/react`）；对白等文本用 DOM 覆盖层显示 |
| 剧本编辑器 | CodeMirror 6 |
| 剧本解析 | `format` 里手写解析器 |
| 测试 | Vitest；Playwright 的 Electron 支持做少量冒烟用例；`registerFauxProvider` 假模型与 fetch 注入按录制文件回放流式响应和错误 |
| Lint 与格式化 | Biome；类型检查用 `tsc --noEmit` |
| CI | GitHub Actions，Linux 上跑类型检查、lint、单元测试；三平台打包到 M5 再加（M3 先在 Linux 上手动试打一次安装包） |
| 应用更新 | electron-builder 的自动更新，从 GitHub Releases 检查（M5）；Windows（NSIS）和 Linux AppImage 自动下载安装，macOS 未签名包和 Linux deb 只检查新版本、提示手动下载（未签名的 macOS 包 Squirrel.Mac 验签会静默失败） |

**进程通信细节**

- 主进程建好 MessagePort 通道后，把两端分别交给界面和创作端，之后消息直连，不经主进程转发。fork 创作端时主进程注入单调递增的 generation，命令和事件帧都带上，重连后界面丢弃 generation 不匹配的帧。
- 预加载脚本用 `contextBridge` 只暴露一个有类型的 `window.novelive`，界面拿不到 Node 能力。
- 消息分两类：命令（请求和响应）和事件（创作端主动推送），都用 pi-schema 定义，开发模式下在边界上校验。事件用统一 envelope `{seq, scope, scopeId, at, event}`，seq 在 scope 内单调；scope 词表最小集 `app`/`work`（M0 先用 `app`）。创作端为每个 scope 保留最近约 500 条内存 ring buffer，`events.list` 命令让界面断线后补漏，响应为 `{events[], latestSeq, gap, snapshot?}`；ring 溢出时返回 `gap` 加最新快照（`app` scope 快照含 `{ready, generation}`）。
- 创作端给对话面板推送时，载荷是投影后的整条 assistant 消息快照加 headId，每 30–50ms 合一批；界面不自攒 delta，断线重放就是重放最近的快照帧。
- 主进程注册 `novelive://` 协议，读取应用缓存目录（M0 起）、工程文件夹（M1a 起）和作品包（M5 起）里的资源。
- 创作端基础设施失败（进程退出、端口握手失败）连续 3 次后不再自动拉起，转崩溃横幅加手动重启；业务命令的错误不计入。制作长跑期间宿主按“有活跃 run”启停 `powerSaveBlocker` 防系统休眠，退出时清理。系统通知的标题和正文在主进程侧校验类型与长度并剥掉 HTML——通知文本来自模型输出；标题=事件，正文=作品名+章/阶段，正文长度上限 1000 字符。
- 浏览器开发模式下由一个开发脚本把同一套命令和事件通过 WebSocket 暴露给界面，不进正式包。

界面和播放器统一用 lucide 图标，按需打包。

**打包注意**

- Electron 版本在 `package.json` 里写死（不带 `^`）；pnpm 用 `node-linker=hoisted` + `shamefully-hoist`，`onlyBuiltDependencies` 列 electron、esbuild、sharp。pnpm ≥12 时 `onlyBuiltDependencies` 和 `overrides` 写在 `pnpm-workspace.yaml` 里（`package.json` 的 `pnpm` 字段被忽略）。
- `sandbox:false` + `contextIsolation:true`：`sandbox:true` 下 preload 不能是 ESM（报 `Cannot use import statement`）；隔离靠 contextBridge 只暴露 `window.novelive`。
- `asarUnpack` 必须同时覆盖 `**/*.node` 和 `**/*.so*`（libvips-cpp.so 留在 asar 里 dlopen 失败），sharp 相关目录一并 unpack。
- sharp 在 Electron 的 Linux 版里一解码就崩（Electron#46323，glib 符号冲突，上游未修）：Linux 版用仓库里的补丁脚本（`tools/patch-sharp.mjs`）自己打——链接层隐藏 libvips 内嵌 glib 符号并强制加载同目录 `.so`；脚本是幂等的，已打过补丁就跳过，需要 patchelf 和 objcopy。sharp 每次升级重新打，跟踪 Electron#46323，上游修好后换回官方 sharp；其他平台用官方 sharp。CI 的 Linux 冒烟测试要实际启动 Electron 解码一张图，守住补丁和 sharp 升级。
- 打包产物自带 Electron `LICENSE` 和 `LICENSES.chromium.html`（含 FFmpeg LGPL-2.1 等组件通知），不删；`THIRD_PARTY_NOTICES` 由构建脚本生成。从上游拷贝或改写的文件，文件头保留版权行和原许可并指向 THIRD_PARTY_NOTICES（规则见 `.workflow/research/refs/ext-2026-11-r2-licenses.md`）。

**版本锁定**（2026-11-21 定稿）：

| 包 | 版本 |
| --- | --- |
| electron | 45.4.1（内置 Node 24.22.3，`node:sqlite` 不需要开关） |
| electron-vite | 6.0.0 |
| vite | 7.2.7 |
| @vitejs/plugin-react | 5.1.1 |
| typescript | 5.9.3 |
| react | 19.3.1 |
| pnpm | 12.21.0 |
| pi-ai / pi-agent-core / pi-schema | 1.6.0 |
| sharp | 0.35.5 |
| openai | 7.62.0 |
| vitest | 5.1.1 |
| playwright | 1.65.1 |
| biome | 2.6.8 |
| stylelint | 18.1.0 |

不上 vite 8 和 plugin-react 6：plugin-react 6 强制要求 vite 8，electron-vite 6 还没在 vite 8 上验证过；TypeScript 7 发布过新，暂不升级。


## 开发模式与开发顺序

- **浏览器开发模式**：开发时可以在普通浏览器里通过开发桥接调试界面；正式分发只包含 Electron 应用。
- **开发顺序**：采用**界面先行**路线，先做界面设计，再从骨架开始搭建带界面的完整流程，边使用边调整质量。里程碑见[Novelive 产品概述](./product.md)。

相关文档：[Novelive 产品概述](./product.md)、[作品格式与工程](./work-format.md)、[播放器](./player.md)、[视觉管线](./visuals.md)。
