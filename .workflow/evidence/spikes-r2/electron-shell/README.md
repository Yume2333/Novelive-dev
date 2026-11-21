# electron-shell（R2 Electron 骨架试验）

验证内容：pnpm workspace + electron-vite 6 多入口（main 同时产出 `index.mjs`+`creator.mjs` utility process 入口）+ MessagePort 握手 + `extraResources` 带 Python + `electron-builder.yml` 打包 + `pnpm.overrides` 把 sharp 换成 `@janhapke/sharp-electron` 修 Electron/Linux 段错误。支撑报告 `.workflow/research/refs/ext-2026-11-r2-electron-shell.md`；gap-ledger D 表第 5-7 行。

文件：`trial/` 完整骨架源码（`apps/desktop` + `packages/creator` + `python/trial_sidecar.py`），未拷 `out/`、`release/`、`node_modules/`、`pnpm-lock.yaml`、打出的 `desktop-0.1.0.tgz`。`tools-pnpm-pkg.json` 是装 pnpm 本体的小工具目录。

重跑：`cd trial && pnpm install && pnpm dev`（开发模式跑通冒烟）；`pnpm --filter desktop pack` 出 linux-unpacked/AppImage/deb。冒烟结果经 renderer `SMOKE:<json>` console 行写到 `$TRIAL_LOG_DIR/main.log`+`smoke-result.json`。

第三方依赖（见 `trial/apps/desktop/package.json`）：electron 45.4.1、electron-builder ^26.18、electron-vite ^6、vite ^7、react 19、`@janhapke/sharp-electron@0.35.4-electron.1`（Apache-2.0，`sharp` 的 overrides）。Python sidecar 走系统 `python3`（试验用；正式版见 gap-ledger C21）。
