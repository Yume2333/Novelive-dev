# M0 骨架

**Status:** proposed
**Priority:** high

## What this is for

M1 要在应用里用一本真书走完整条链路。在那之前，桌面外壳、后台进程、进程通信、资源协议、模型接入、界面基础这些每个里程碑都要用的底座必须先能跑、能测。M0 把它们一次接通，并在界面上直接看得到：填好模型，点“测试”，真的调通。

## What it does

- **启动**：`pnpm dev` 打开 Electron 窗口，界面是原型的侧边栏外壳：全局导航（书库、用量、设置）、底部主题切换。书库和用量显示空状态；没有作品，所以侧边栏不显示作品分区和制作状态。
- **设置页**，按原型布局：
  - **快速、主模型、写作、视觉**：接口格式（OpenAI Chat Completions / OpenAI Responses / Anthropic Messages）、接口地址（选格式时预填官方地址，可改）、模型名、上下文长度（pi 内置模型目录里查得到就自动填）、API Key。四个文本模型可以复用同一套地址和 Key，只换模型名。
  - **图片模型**：接口地址、模型名、API Key（OpenAI 兼容图片接口）。
  - **测试**：文本模型通过 pi 发一次最短请求，收到回复就算成功；视觉模型额外带一张小图，要求描述图片内容；图片模型生成一张小图，成功后在卡片里显示缩略图，缩略图经 `novelive://` 协议读取。失败时显示原因和该检查什么（地址、Key、模型名）。
  - Agent 角色的模型对应和写手预设属于 M1，M0 不做。
  - **界面**：界面语言、主题（亮 / 暗 / 跟随系统）；**工程**：默认工程位置，“更改”打开系统选文件夹对话框。
  - 所有设置写入应用配置文件，重启后保留。
- **后台进程崩溃时**：窗口照常可用，顶部出现提示横幅；宿主自动重新拉起创作端，界面重新连上后横幅消失，设置页可以继续测试。如果创作端还没启动好就退出，横幅显示错误信息和“重新启动”按钮，不自动重试。
- **浏览器开发模式**：`pnpm dev:web` 在普通浏览器里打开同一套界面，连接同一份创作端代码，设置测试同样可用。
- **质量工具**：`pnpm check` 一条命令跑完类型检查、Biome、Stylelint 和单元测试；`pnpm test:e2e` 用 Playwright 启动 Electron 跑冒烟用例。推到 `Yume2333/Novelive-dev` 后 GitHub Actions 跑 `pnpm check`。

## How it is built

**目录**（pnpm workspaces，Node 24，全部 ESM，TypeScript 严格模式）：

| 包 | M0 内容 |
| --- | --- |
| `packages/ui` | Tokens、整套控件库（从原型搬过来，行内样式改为 CSS Modules，接口和外观不变）、侧边栏外壳、书库 / 用量空状态、设置页；i18next，先只有简体中文文案 |
| `packages/creator` | 创作端进程入口、配置读写、文本和视觉模型测试（pi）、图片模型测试（`openai` SDK）；`contract` 子路径导出命令和事件的 TypeBox 定义 |
| `apps/desktop` | Electron 主进程、预加载、utility process 管理、MessagePort 通道、`novelive://` 协议、选文件夹对话框；electron-vite 构建 |
| `tools/dev-bridge` | 浏览器开发模式：在 Node 里跑创作端，WebSocket 转发命令和事件，HTTP 提供资源 |

`packages/format`、`packages/player` 和 `python/` 在 M1 有实际内容时再建。

**通信**

- 主进程创建 MessageChannel，一端交给创作端（utility process），一端经预加载交给界面。之后命令和事件直连，不经主进程转发。
- 预加载用 `contextBridge` 暴露 `window.novelive`：`call(command, payload)`、`on(event, handler)`、`resourceUrl(path)`、`pickFolder()`。界面只依赖这个接口；浏览器开发模式下由 dev-bridge 的客户端实现同一接口。
- 命令（请求 → 响应）和事件（创作端主动推送）都由 `@novelive/creator/contract` 里的 TypeBox 定义。开发模式下两端在收到消息时都做校验，不合法的消息记日志并返回错误。
- M0 的命令：`config.get`、`config.update`、`model.testText`、`model.testImage`。事件：`creator.ready`（启动和重连后发一次）。

**配置**

- 放在 Electron `userData` 下的 `config.json`，结构由 TypeBox 定义，只由创作端读写。API Key 用写在程序里的固定密钥简单加密后存入。写入时先写临时文件再改名，避免写一半断电。
- 配置文件读不出来时，界面显示文件位置和错误信息，不覆盖原文件。

**模型接入**

- 文本：按接口格式构造 pi 的 `Model`（`openai-completions` / `openai-responses` / `anthropic-messages`），`baseUrl` 用用户填的地址，Key 直接传入。测试进行中可以取消。
- 图片：用 `openai` 官方 SDK 的 `images.generate`，`baseURL` 用用户填的地址。图片存到应用缓存目录，界面经 `novelive://cache/...` 读取。

**资源协议**

- 主进程注册 `novelive://`，M0 只映射应用缓存目录（`novelive://cache/<相对路径>`）。工程文件夹和作品包在 M1 加入。

**崩溃恢复**

- 主进程监听 utility process 退出：已经发过 `creator.ready` 的进程退出就立即重启；启动阶段就退出的，不自动重启，交给横幅里的“重新启动”按钮。

**SQLite 核实**

- 在 utility process 里用 `node:sqlite` 建库、写入、读回，作为端到端冒烟用例的一部分。不可用就改用 better-sqlite3，并在 `docs/architecture.md` 和 `decisions.md` 记下结果。M0 的业务功能不使用数据库。

**测试**

- 单元测试（Vitest）：配置读写、契约校验、三种文本格式和图片接口各对一个本地假服务的成功 / 失败。
- 端到端（Playwright Electron）：启动应用，设置页对假服务完成三种文本格式和图片测试，缩略图经协议加载；结束创作端进程后界面恢复；SQLite 冒烟。
- 测试不访问真实模型。

## What it must not do

- 不做工程、作品、导入和任何创作功能，那些属于 M1。
- 不做打包和安装包，M5 再做；M0 只在开发模式下跑，只测 Linux。
- 不起本地 HTTP 服务，dev-bridge 只用于浏览器开发模式，不进正式包。
- 不建空包：`format`、`player`、`python/` 有内容时再建。
- 不内置供应商和模型清单，模型名由用户填写。

## What was considered and rejected

- **用 pi 内置的供应商目录做下拉选择。** 填起来更省事，但覆盖不了中转和兼容服务；三种接口格式加自定义地址能覆盖全部情况，内置预设以后可以加在格式之上。
- **M0 就建齐五个包。** 能更早看到依赖边界，但 `format` 和 `player` 在 M0 没有代码，空包只是占位。
- **配置存 SQLite。** 已决定 API Key 存配置文件，方便备份和迁移；数据库只用于工程里的幕后数据。

## How we will know it works

- **W1.** 全新克隆后执行 `pnpm install && pnpm check`：类型检查、Biome、Stylelint、单元测试全部通过。
- **W2.** `pnpm test:e2e`：Electron 启动，设置页对本地假服务完成三种文本格式和图片测试，缩略图经 `novelive://` 显示；结束创作端进程后横幅出现，随后消失，再测试仍然成功；`node:sqlite` 冒烟通过。
- **W3.** `pnpm dev`，在设置页填真实的 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages 接口和图片接口，逐个点“测试”都显示连接成功，图片缩略图显示；退出重开后配置还在。截图存到 `.workflow/evidence/m0/`。
- **W4.** `pnpm dev:web` 后在浏览器打开，设置页对假服务的测试成功，缩略图显示。
- **W5.** 同一视口下分别截取正式界面和 `prototype/` 的书库空状态与设置页，并排对比：除了已决定的模型配置变化（五个模型、接口格式字段），布局、控件、配色一致。
- **W6.** 在 `packages/ui` 的组件 CSS 里写一个颜色字面量，`pnpm check` 失败并指出位置；去掉后通过。
- **W7.** 推送到 `Yume2333/Novelive-dev` 后，GitHub Actions 的 `pnpm check` 通过。
