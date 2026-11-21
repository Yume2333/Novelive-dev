# m0-skeleton（R3 M0 骨架两轮 spike，最终版 R3M0Spike2）

验证内容：Electron 45.4.1 + electron-vite 6 多入口骨架（main/preload/renderer/utility creator 进程）、`node:sqlite` 在 utility process 无 flag 建库、sharp 自补丁（`tools/patch-sharp.mjs`，patchelf `$ORIGIN`+隐藏 glib 符号，**对已补丁目录二次运行会失败**）、崩溃横幅+断路器（ready 握手连续 3 次失败才开）、pi-ai 三通模型测试、cassette 录制回放（`tests/cassette.mjs` record/replay/strict + 故障注入）、dev-bridge（WS 8765/HTTP 8766）。支撑报告 `.workflow/research/refs/ext-2026-11-r3-m0-spike.md`。

文件：`apps/desktop`（electron-vite 工程，`out/` 构建产物未拷）、`packages/{creator,ui}`、`tools/{dev-bridge,fake-llm.mjs,patch-sharp.mjs}`、`tests/`（契约单测 + cassette）、`.github/workflows/ci.yml`（3-OS 矩阵+xvfb smoke）、根目录 8 个驱动脚本（截图/杀进程/持久化用，路径已改 env 覆盖：`ELECTRON_BIN`/`XDG_DIR`/`SHOTS_DIR`）、`creator-2026-11-21.log`、`shots/`（崩溃/断路器/dev-bridge 截图 JPEG 化）。`tests/fixtures/image-real.jsonl` 已剥中转程序识别头等非白名单响应头（只留 `content-type`/`retry-after`）、>50KB base64 图像体删（`bodyFile`/`body` 置空+`bodyNote`），`cassette-files/` 未拷——cassette-replay 的大 body 断言需重新录制。`pnpm-lock.yaml`（>200KB）、`node_modules/` 未拷。

重跑：`pnpm i --no-frozen-lockfile`（pnpm 12.21.0，配置在 `pnpm-workspace.yaml`）→ `pnpm --filter @novelive/desktop build` → `xvfb-run electron apps/desktop/out/main/index.mjs`；单测 `pnpm test`（cassette strict 回放需重录 fixture）；sharp 补丁 `node tools/patch-sharp.mjs`（需 patchelf+objcopy）；驱动脚本 `ELECTRON_BIN=<electron 路径> XDG_DIR=<临时目录> node crash-banner.mjs`。

第三方依赖：electron 45.4.1（Node 24.22.3）、electron-vite 6.0.0、vite 7.2.7+plugin-react 5.1.1、react 19.3.1、pi-ai/pi-agent-core/pi-schema 1.6.0、sharp 0.35.x（自补丁，不用 janhapke 包）、openai 7.62.0、vitest 5.1.1、playwright 1.65.1、biome 2.6.8、stylelint 18.1.0、patchelf+objcopy（系统工具）。
