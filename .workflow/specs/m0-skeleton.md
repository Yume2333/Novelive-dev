# M0 骨架

**Status:** in progress
**Priority:** high

## What this is for

M1 要在应用里用一本真书走完整条链路。在那之前，桌面外壳、后台进程、进程通信、资源协议、模型接入、界面基础这些每个里程碑都要用的底座必须先能跑、能测。M0 把它们一次接通，并在界面上直接看得到：填好模型，点“测试”，真的调通。

## What it does

- **启动**：`pnpm dev` 打开 Electron 窗口，界面是原型的侧边栏外壳：全局导航（书库、用量、设置）、底部主题切换。书库和用量显示空状态；M0 没有作品与导入流程，因此侧边栏不显示最近作品分区和全局制作状态，书库空状态不显示「我的工程 / 导入的作品」标签页及新建、导入、重看首次引导按钮。崩溃横幅把说明文字放前面（长日志路径会挤掉「连续 3 次」的说明），提供「日志」按钮（打开 `userData/logs/`）和「重新启动」按钮。
- **设置页**，按原型布局：
  - **快速、主模型、写作、视觉**：接口格式（OpenAI Chat Completions / OpenAI Responses / Anthropic Messages）、「兼容哪家」下拉（自动 / OpenAI / DeepSeek / 通义千问 / 智谱 / OpenRouter / 兼容 Anthropic）、接口地址（切换格式或将「兼容哪家」切到非「自动」预设时预填对应官方地址，可改）、「同快速模型」开关（除快速槽外可用；开启时整组继承快速模型的接口格式、兼容哪家、接口地址和 API Key 四项，模型名与上下文长度按槽位各自填写，五个槽位均可独立修改）、模型名（默认空串）、上下文长度（整数 tokens、最小 4096；从 pi 内置模型目录按 compat/format 对应 vendor 优先匹配，目录命中自动填入但保持可编辑，查不到时手填，placeholder 提示填写模型上下文窗口 tokens）、API Key。自定义地址时把对应 compat 写进 pi 的 `Model`。
  - **图片模型**：接口地址、模型名（默认空串）、API Key、同时出图数（默认 8）、生图失败重试次数（默认 3）、生图质量（高 / 中 / 低，默认高；按 `quality: high | medium | low` 发送，适配层认出接口没有这个字段时不发）、原生长边上限（档位 `1536`「Codex 渠道」默认 / `2048` / `2560`「OpenAI 官方 API」/ `2816`「Seedream 5.x」/ `3840`「4K（OpenAI 实验 / Seedream 4.5）」；请求尺寸长边不超过它，超出部分由本地放大）、后处理（关 / 放大降噪（默认）/ 双重放大降噪）与放大档位（动漫 `realesrgan-x4plus-anime` 默认 / 快速 `realesr-animevideov3-x4`，标注「低性能机用，画质下降」/ 保留细节 `4x-NMKD-YandereNeo`，标注「少改原画，保留纹理细节」；后处理为关时禁用）。不设能力声明：编辑、透明底、尺寸是否支持由测试和实际调用的结果判断。M0 的图片测试使用生图质量和原生长边上限；后处理在 M0 只写入配置，出图管线从 M1b 使用，放大程序在 M3 加入（见 `decisions.md` 2026-11-22「图片能力不声明，用到不支持时报错；长边档位和双重后处理」、2026-11-22「放大档位三选一：动漫 / 快速 / 保留细节」）。
  - **测试**：文本模型通过 pi 发一次最短请求，收到回复就算成功；视觉模型额外带一张小图，要求描述图片内容；图片模型依次试文生图（`images.generate`，尺寸取原生长边上限档位下的 16:9）、透明底（`images.generate` 带 `background: transparent` 后用 `sharp` 检查存在 alpha 通道且全透明像素占比 ≥ 0.5%）、图片编辑（`images.edit`，用内置小测试图输入，文生图失败不阻塞编辑项），三项分别显示结果和各自成功项的缩略图，缩略图经 `novelive://` 协议读取。失败时显示原因和该检查什么：鉴权、网络类失败指向地址、Key、模型名；接口不支持某项（`unsupported`）写明哪项能力不支持，建议换模型或调低原生长边上限。
  - 高级设置（角色模型、写手预设）和图片保存格式属于 M1b，M0 不做。
  - **界面**：界面语言（M5 翻译前只提供「简体中文」选项）、主题（亮 / 暗 / 跟随系统）；**工程**：默认工程位置，“更改”打开系统选文件夹对话框；末段**关于**区：显示应用名、版本号、AGPL-3.0 声明及第三方许可 / 源代码入口占位。
  - 所有设置写入应用配置文件，重启后保留。
- **后台进程崩溃时**：窗口照常可用，顶部出现提示横幅；宿主自动重新拉起创作端，界面重新连上后横幅消失，设置页可以继续测试。如果创作端还没启动好就退出，或连续失败触发断路器，横幅显示错误信息、「日志」按钮和「重新启动」按钮，不再自动重试。
- **浏览器开发模式**：`pnpm dev:web` 在普通浏览器里打开同一套界面，连接同一份创作端代码，设置测试同样可用。
- **质量工具**：`pnpm check` 一条命令跑完各包类型检查、Biome、Stylelint 和 Vitest 单元测试；`pnpm test:e2e` 先执行 `pnpm build`，再用 Playwright 启动 Electron 跑冒烟用例。推到 `Yume2333/Novelive-dev` 后 GitHub Actions 跑 `pnpm check` 与 Linux sharp 冒烟。
- **pnpm 配置**：根目录 `.npmrc` 记录 `node-linker=hoisted` 和 `shamefully-hoist=true`；锁定的 pnpm 12.21.0 从 `pnpm-workspace.yaml` 读取对应设置。构建脚本用 `allowBuilds` 明确批准 `electron`、`esbuild`、`sharp`；`overrides` 同样放在工作区配置。
- **日志**：创作端和主进程各自写 `userData/logs/<process>-<YYYY-MM-DD>.log`（纯文本行，当日单文件不 rotate）；创作端崩溃时横幅提供「日志」按钮打开 `userData/logs/`。
- **CI**：交付物包含 `.github/workflows/ci.yml`：ubuntu、Node 24、pnpm 12，apt 安装 `patchelf`、`binutils`、Electron 运行库和 `xvfb`，跑 `pnpm install --frozen-lockfile && pnpm check`，再在 `xvfb-run` 下启动真实 Electron 解码一张图完成 sharp 冒烟（`postinstall` 已运行幂等的 `tools/patch-sharp.mjs`）。完整 `pnpm test:e2e` 仅在本地运行。

## How it is built

**目录**（pnpm workspaces，Node 24，全部 ESM，TypeScript 严格模式）：

| 包 | 包名 | M0 内容 |
| --- | --- | --- |
| `packages/ui` | `@novelive/ui` | Tokens、整套控件库（从原型搬过来，行内样式改为 CSS Modules，接口和外观不变）、侧边栏外壳、书库 / 用量空状态、设置页（含关于区，仅简体中文）；依赖 `react-router`（`HashRouter`）、`zustand`、`lucide-react`、`i18next`（含 `react-i18next`）与本地打包的 `@fontsource/noto-sans-sc` |
| `packages/creator` | `@novelive/creator` | 创作端进程入口、配置读写、文本和视觉模型测试（pi）、图片模型测试（`openai` SDK）；`contract` 子路径导出命令和事件的 pi-schema 定义；`peerDependencies` 声明 `sharp` 供类型与导入解析 |
| `apps/desktop` | `@novelive/desktop` | Electron 主进程、预加载、utility process 管理、MessagePort 通道、`novelive://` 协议、选文件夹对话框；electron-vite 构建；`dependencies` 声明 `sharp` 并挂 `postinstall` |
| `tools/dev-bridge` | `@novelive/dev-bridge` | 浏览器开发模式：在 Node 里跑创作端，WebSocket 转发命令和事件（默认端口 8765），HTTP 提供资源（默认端口 8766）；`pickFolder()` 用输入框填绝对路径，`host.openLogDir()` 打印日志目录，`host.restartCreator()` 重启 Node 内创作端，`resourceUrl()` 返回 `http://localhost:8766/cache/...` |

`sharp` 写在 `apps/desktop` 的 `dependencies` 并挂 `postinstall` 运行 `tools/patch-sharp.mjs`；`packages/creator` 在 `peerDependencies` 声明 `sharp` 满足 workspace 类型检查；`electron-vite` main 构建（含创作端入口）将 `sharp` 设为 external，不打进 bundle（libvips 动态库被打进 bundle 会找不到、进程直接崩）。

`packages/format` 在 M1a、`packages/player` 在 M1b、`bin/upscale/`（放大程序）在 M3 有实际内容时再建。

**通信**

- 主进程创建 MessageChannel，fork 创作端后**立刻**把一端 `postMessage` 发过去（先等 ready 再发会互相等死），另一端经预加载交给界面。之后命令和事件直连，不经主进程转发。
- 预加载用 `contextBridge` 暴露 `window.novelive`：
  - `call(command, payload)`：返回 `{ promise, cancel }`，`promise` 成功时 resolve 为命令结果，失败时 reject 为 `{ code, message }`；`cancel()` 是取消句柄（`AbortSignal` 不能跨 `contextBridge` 传递），取消时预加载发一条取消消息到创作端，创作端中止对应请求。预加载维护 `requestId` → 取消映射；port 随窗口销毁关闭时，创作端中止该端口上的全部在途请求（`webContents.destroyed` 是主进程事件，预加载拿不到）。
  - `on(event, handler)`：返回取消订阅函数。
  - `resourceUrl(path)`：正式模式返回 `novelive://cache/<相对路径>`；`dev-bridge` 返回 `http://localhost:8766/cache/<相对路径>`。
  - `pickFolder()`：打开系统选文件夹对话框（`dev-bridge` 用输入框）。
  - `host.openLogDir()`：主进程调用 `shell.openPath` 打开 `userData/logs/`（`dev-bridge` 打印日志路径）。
  - `host.restartCreator()`：手动拉起创作端并重置断路器失败计数（`dev-bridge` 重启 Node 内创作端）。
  - `host.appState()`：返回 `{ creator: 'starting' | 'ready' | 'down' | 'failed', generation, breakerOpen, logDir }`，供界面挂载和重连后读取宿主当前状态。
  界面只依赖 `window.novelive`；浏览器开发模式下由 `@novelive/dev-bridge` 客户端实现同一接口。
- **帧身份与双通道事件**：fork 创作端时主进程注入单调递增的 `generation`，命令、创作端事件和宿主事件帧都带上；重连后界面丢弃 `generation` 不匹配的帧——“重连后旧请求的结果不再生效”由换 port + `generation` 双重实现。
  - **宿主生命周期事件**（`creator.ready`、`creator.down`）：由主进程通过独立宿主 IPC 通道直发界面（不经过创作端 MessagePort，不带创作端 `seq`、不进创作端 ring buffer），携带 `generation`；界面挂起或重连后通过 `host.appState()` 获取当前就绪态。界面收到 `creator.down` 后把所有在途调用以 `creator_down` 结束；`creator.down` 发出时创作端丢弃该端口全部在途请求，拉起后经新 port 接收调用。
  - **创作端事件**：统一 envelope `{ seq, scope, scopeId, at, event }`，`seq` 在 scope 内单调；scope 词表最小集 `app`/`work`，M0 先用 `app`。创作端为每个 scope 保留最近约 500 条内存 ring buffer，经 `events.list { scope, scopeId, afterSeq }` 供界面断线补漏；ring 溢出时响应带 `gap: true` 和该 scope 的最新快照（`app` scope 快照含 `{ ready, generation }`），界面整体刷新该 scope。
- 命令（请求 → 响应）和事件（创作端主动推送）都由 `@novelive/creator/contract` 里的 pi-schema 定义。编解码放在 contract 里，MessagePort 和 dev-bridge 的 WebSocket 共用。开发模式下两端在收到消息时都做校验，不合法的消息记日志并返回错误。
- 命令失败返回 `{ code, message }`，界面按 code 显示该检查什么。M0 的 9 个 error code 与映射规则：
  - `auth`：HTTP `401` / `403` 等鉴权失败。
  - `not_found`：模型不存在（如 `model_not_found`），或文生图、文本请求返回 `404`（地址或模型名不对）。
  - `unsupported`：图片接口不支持某项能力：编辑端点 `404` / `405`；`400` 且错误指向 `size`、`background`、`quality` 等参数；要求透明底却返回没有 alpha 通道的图。`message` 写明哪项能力。
  - `network`：HTTP `429` / `5xx`、响应体临时错误码（`service_unavailable`、`overloaded`、`rate_limit` 等）、请求或流式看门狗超时、连接断开（两层重试耗尽后）。
  - `moderation`：内容审核拒绝（响应体或 pi-ai `stopReason` / `rawStopReason` 拒审标记）。
  - `invalid_config`：配置缺失、参数校验失败，或处于 `configError` 未重置状态发起 `config.update`。
  - `cancelled`：用户主动调用 `cancel()` 取消。
  - `creator_down`：创作端进程退出导致的在途调用中断。
  - `internal`：其余未归类异常。
- M0 业务命令：`config.get`、`config.update`、`config.reset`、`model.testText`、`model.testImage`、`events.list`。调试命令 `debug.sqliteSmoke` 和 `debug.sharpSmoke` 仅在环境变量 `NL_E2E=1` 时注册，正式运行不暴露。

**配置**

- 放在 Electron `userData` 下的 `config.json`，结构由 pi-schema 定义（包含各模型槽位、图片生图质量、原生长边上限档位、后处理档与放大档位、界面主题/语言、默认工程目录），只由创作端读写。API Key 用 **AES-256-GCM** 加密后存入（密钥为源码常量，只防扫一眼）；未设置 Key 时 `config.get` 返回空串 `""`（避免界面误判「已配置」），已设置 Key 时返回 `apiKeyMasked`（`••••` 哨兵），界面不持有明文 Key；`config.update` 按字段合并，收到哨兵或空串时保留旧值。写入时先写临时文件再改名，避免写一半断电。开发期验收和录制用所有者的中转，地址和 Key 读环境变量 `NL_IMAGE_BASE_URL`、`NL_IMAGE_API_KEY`（文本和图片共用）；开发默认文本模型见 `decisions.md` 2026-11-21「开发期接口和模型用所有者的中转」（主模型和写作模型 `devin-swe-2`，快速模型 `deepseek-v4.1-flash`，视觉模型 `gemini-3.8-flash`），默认图片模型为 `gpt-image-2.6-sunburst`。
- 配置文件读不出来、校验失败或 Key 解密失败时，`config.get` 返回 `{ configError: { path, reason } }`，界面在设置页顶部显示文件位置、错误信息和「重置配置」按钮，不覆盖原文件，不用哨兵顶替。`configError` 存在期间 `config.update` 拒绝写入并返回 `invalid_config`，直到用户点击「重置配置」（调用 `config.reset` 将坏文件备份为 `config.json.bak-<timestamp>` 后写回默认空配置）。

**模型接入**

- 文本：按接口格式构造 pi 的 `Model`（`openai-completions` / `openai-responses` / `anthropic-messages`），`baseUrl` 用用户填的地址，Key 直接传入，按「兼容哪家」写入 `compat`。上下文长度：从 pi-ai 内置模型目录（`dist/providers/data/*.json`，43 个 provider）按当前 `compat` / `format` 对应 vendor 优先匹配模型名，命中即自动填入但保留可编辑性，查不到由用户手填（最小 4096）。M0 在创作端实现 pi `streamFn` 包装层（对齐 `decisions.md` 2026-11-21「模型调用两层重试，审核拒绝单独处理」）：第一层传 SDK `maxRetries: 2` 处理响应头前的失败；第二层外包整条消息重发，处理流中途断开、空回复、200 后掉线（未产生工具副作用时最多重发 2 次）；流式空闲看门狗（默认 90 秒无事件触发 abort）；abort 归因区分用户取消（直转 `cancelled`、绝不重试）与看门狗（标 `watchdog` 走重试、耗尽转 `network`）；错误分类先检查响应体错误代码（如 4xx 带 `service_unavailable` / `overloaded` / `rate_limit` 按临时错误处理）与审核拒绝字段。测试进行中可以取消。
- 图片：用 `openai` 官方 SDK（Seedream 等走同一 SDK 的 generations，带参考图时用 `image` 字段代替 `images.edit`，按地址识别），传 `quality`（来自设置项 `生图质量`，默认 `high`；Seedream 不传），尺寸按原生长边上限档位计算，再按接口的像素范围吸附（两边 16 的倍数；OpenAI 总像素不超过 3840×2160；Seedream 按 `docs/visuals.md` 3.2 的各型号范围，低于下限向上取）。Seedream 的固定参数（`watermark:false`、`response_format:b64_json`、透明底时 `output_format:png`）和错误码归类见 `docs/visuals.md` 3.2。测试依次跑三项独立能力：文生图（`images.generate`）、透明底（`images.generate` 后用 `sharp` 检查存在 alpha 通道且全透明像素占比 ≥ 0.5%）、图片编辑（`images.edit`，用内置小测试图输入，文生图失败不阻塞编辑项）；`model.testImage` 返回三项各自的结果（通过 / 错误码与原因）和成功项缓存路径；审核拒绝归 `moderation`，接口不支持归 `unsupported`。图片存到应用缓存目录，界面经 `novelive://cache/...` 读取。

**资源协议**

- 主进程注册 `novelive://`，M0 只映射应用缓存目录（`novelive://cache/<相对路径>`），处理时先做 URL-decode，`path.normalize` 后拒绝 `..` 越界，按扩展名映射 MIME（`webp` / `png` / `jpg` / `svg`），只保证 `<img>` 和 CSS 引用可读；界面里的 `fetch()` 不支持。工程文件夹在 M1a 加入，作品包在 M5 加入。

**崩溃恢复**

- 主进程监听 utility process 退出：已经发过 `creator.ready` 的进程退出就向界面发 `creator.down` 并立即重启；启动阶段就退出的，不自动重启，交给横幅里的「日志」和「重新启动」按钮。**断路器**：基础设施失败（进程退出、端口握手失败）连续 3 次没能完成 ready 握手才打开，不再自动拉起，转横幅加「日志」和手动「重新启动」；`creator.ready` 成功握手一次失败计数就清零；手动点「重新启动」（`host.restartCreator()`）也清零并重试拉起；业务 handler 返回的错误不计入。

- **sharp 补丁（Linux）**：`apps/desktop` 安装后跑 `tools/patch-sharp.mjs`（挂 `postinstall`），已打过补丁就跳过（幂等）；需要 `patchelf` 和 `objcopy`。CI 的 Linux 冒烟测试在 `xvfb-run` 下实际启动 Electron 解码一张图。

**SQLite**

- `node:sqlite` 在 Electron 45.4.1（Node 24.22.3）的 utility process 里可用，不带 flag，WAL 正常。M0 业务功能不使用数据库，仅在 `NL_E2E=1` 时注册 `debug.sqliteSmoke`（utility process 内建库、写入、读回）与 `debug.sharpSmoke`（解码内置测试图），供 e2e 冒烟调用。

**测试**

- **回放开关与模式**：回放由环境变量 `NL_REPLAY=record|replay|strict`（未设置时走真实网络）和 `NL_CASSETTE_DIR`（默认 `tests/fixtures/cassettes/`）控制，`pnpm dev`、`pnpm dev:web`、`pnpm test:e2e` 与单测均识别；单测、CI 和 W2/W4 运行在 `NL_REPLAY=strict`（缺失对应 cassette 直接失败）。
- **L3 fetch 注入式 HTTP cassette 回放**：三种文本格式和图片测试（含单测与 e2e）全部走 L3——`openai`/Anthropic SDK 通过 `fetch` 选项注入，pi 侧在 `streamFn` 包装层注入。使用 JSONL cassette：一行一交互 `{ key, method, path, reqHash, status, headers, body(b64), recordedAt, case, tags }`，`key = sha256(method + path + canonicalBody)` 前 16 hex；录制时剥 `authorization` 头、baseURL 重写为占位符，响应头只录白名单（`content-type`、`retry-after`）；`body` 超 256KB 外置 `cassette-files/<sha>`；回放层按参数注入 `midcut`/`disconnect`/`cancel`/`http500`/`bad-image`/`delayMs`（支持慢流取消用例），注入故障不录进 cassette。
- **目录与来源**：07/08 的执行者以各自的 `NL_CASSETTE_DIR` 录制脱敏 smoke，分别提交到 `tests/fixtures/text-models/smoke/`、`tests/fixtures/image-models/smoke/`；纯离线单测和故障用例分别使用同级 `synthetic/`。W2/W4 按文本、图片和成功、故障用例分别启动，将 `NL_CASSETTE_DIR` 显式指向对应的单一目录（应用进程使用从仓库根解析的绝对路径），不回退到默认目录。10 的完整 W3 录制仍使用默认的 `tests/fixtures/cassettes/`，不作为 W2/W4 前置。
- **连接测试请求一致性**：07/08 的 smoke 入口和设置页的 `model.testText`/`model.testImage` 调用同一适配器连接测试入口，由适配器生成固定的探测提示词、媒体/编辑测试图及默认请求参数；设置页不另写探测载荷。录制和回放使用同一个已提交的非秘密 smoke 配置（协议、端点路径、模型名、尺寸、质量及格式等）；回放可替换中转主机和凭据，但必须生成相同 method、path（含查询参数）和 canonicalBody。W2 实际点击设置页按钮以严格命中 smoke；JSON 空白/键序和 multipart boundary 的规范化不改变键。
- **L1 `registerFauxProvider`**：仅用于需要驱动 Agent 工具循环的单元/集成测试（如 W2 的“工具执行中取消”用例），不用于替代三种文本协议的 HTTP 格式测试。
- 单元测试（Vitest）：配置读写与加密/掩码/`configError`、契约校验、三种文本格式和图片接口的 L3 cassette 回放（成功/重试/失败与 error code 映射）、L1 工具循环取消。
- 端到端（Playwright Electron）：`pnpm test:e2e` 先运行 `pnpm build`，再以 `NL_E2E=1 NL_REPLAY=strict` 启动 Electron，验证设置页用 L3 cassette 回放完成三种文本格式和图片三项能力测试、缩略图经 `novelive://` 加载、杀掉创作端进程后横幅与重启恢复、`debug.sqliteSmoke` 和 `debug.sharpSmoke`。
- 测试不访问真实模型。

## What it must not do

- 不做工程、作品、导入和任何创作功能，那些从 M1a 开始。
- M0 不做打包和安装包；M3 在 Linux 上试打一次安装包（见 `decisions.md` 2026-11-21「M3 在 Linux 上试打一次安装包」），三平台安装包在 M5。M0 只在开发模式下跑，只测 Linux。
- 不起本地 HTTP 服务，dev-bridge 只用于浏览器开发模式，不进正式包。
- 不建空包：`format`、`player`、`bin/upscale/` 有内容时再建。
- 不内置供应商和模型清单，槽位模型名默认为空串，由用户填写。

## What was considered and rejected

- **用 pi 内置的供应商目录做下拉选择。** 填起来更省事，但覆盖不了中转和兼容服务；三种接口格式加自定义地址能覆盖全部情况，内置预设以后可以加在格式之上。
- **M0 就建齐五个包。** 能更早看到依赖边界，但 `format` 和 `player` 在 M0 没有代码，空包只是占位。
- **配置存 SQLite。** 已决定 API Key 存配置文件，方便备份和迁移；数据库只用于工程里的幕后数据。

## How we will know it works

- **W1.** 全新克隆后执行 `pnpm install && pnpm check`：类型检查、Biome、Stylelint、单元测试全部通过。
- **W2.** `NL_REPLAY=strict pnpm test:e2e`（内部先执行 `pnpm build`，以 `NL_E2E=1` 启动 Electron）：设置页通过 L3 fetch 注入式 HTTP cassette 回放完成三种文本格式和图片三项能力测试，缩略图经 `novelive://` 显示；回放注入取消时这次测试被中止；回放注入断线时重试耗尽并以 `network` 错误结束；另一次测试进行中结束创作端进程，界面显示崩溃横幅、在途测试以 `creator_down` 结束，自动重启或点「重新启动」重连后再测成功；`debug.sqliteSmoke` 和 `debug.sharpSmoke` 通过。单测覆盖：未设 Key 时 `config.get` 返回 `""`、已设 Key 返回掩码且 `config.update` 发回掩码/空串保留旧值、`configError` 期间 `config.update` 拒绝并返回 `invalid_config`、「重置配置」备份 `config.json.bak-<timestamp>`；`events.list` 在 `afterSeq` 后补回遗漏事件及 ring 溢出返回 `gap: true`；取消覆盖三时序（请求发出前、L1 `registerFauxProvider` 工具执行中、L3 `delayMs` 慢流中途）；`streamFn` 两层重试、看门狗 abort 归因及 error code 映射；图片编辑端点 `404`、尺寸参数 `400`、透明底返回无 alpha、Seedream `InvalidParameter.UnsupportedParameter` 四种回放各自以 `unsupported` 结束且 `message` 写明能力；五个原生长边档位在 OpenAI、Seedream 5.5、Seedream 4.5 规则下算出的 16:9 和立绘尺寸都是 16 的倍数且落在各自像素范围内（OpenAI 不超过 3840×2160；Seedream 5.5 为 921600–4624220；Seedream 4.5 为 3686400–16777216，低档位向上吸附）。
- **W3.** `NL_REPLAY=record pnpm dev`（带 `NL_IMAGE_BASE_URL`/`NL_IMAGE_API_KEY`）：在设置页填开发默认模型（图片用 `gpt-image-2.6-sunburst`），测试 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages 和图片接口，逐个点“测试”都显示连接成功，图片三项能力分别显示结果与缩略图；另刻意用错误 Key 录一条 `auth` 错误 cassette，用触发审核拦截的提示词录一条 `moderation` 错误 cassette（若中转未拦截则注入等价 `moderation` cassette）；所有录制文件剥离 Key 和中转地址后进仓库 `tests/fixtures/cassettes/`；退出重开后配置保留。截图存到 `.workflow/evidence/m0/`。本条由 agent 用开发期中转验收。
- **W4.** 按上面的目录约定设置 `NL_CASSETTE_DIR`，分别以 `NL_REPLAY=strict pnpm dev:web` 启动文本与图片回放；浏览器设置页用与 W2 相同的 L3 cassette 测试成功，缩略图经 dev-bridge 资源地址显示，`host.openLogDir()` 与 `host.restartCreator()` 可用。
- **W5.** 同一视口下分别截取正式界面和 `prototype/` 的书库空状态与设置页，并排对比（原型图片模型卡已含生图质量、原生长边上限档位、后处理三档与放大档位，没有能力声明）。M0 相对原型的刻意差异为：侧边栏无最近作品分区和全局制作状态；书库空状态不显示「我的工程 / 导入的作品」标签页与新建、导入、重看首次引导按钮；界面语言只有「简体中文」；不渲染 M1b 的高级设置和图片保存格式。除上述差异外，布局、控件、配色一致。本条由未参与编写的审查 agent 对照截图验收。
- **W6.** 在 `packages/ui` 的组件 CSS 里写一个颜色字面量，`pnpm check` 失败并指出位置；去掉后通过。
- **W7.** 推送到 `Yume2333/Novelive-dev` 后，GitHub Actions（`.github/workflows/ci.yml`）安装依赖与系统工具后跑通 `pnpm check` 和 `xvfb-run` Electron sharp 解码冒烟。

**版本锁定**见 `docs/architecture.md`「版本锁定」（2026-11-21）。
