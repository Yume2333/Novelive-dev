# script-editor（R2 `.nvs` 编辑器选型与行 ID 试验）

验证内容：CodeMirror 6 行 ID `StateField`（seed/assign/death-check/re-anchor/dedupe）、speaker chip widget、ID gutter、`unifiedMergeView` 逐块接受/拒绝、IME 组合与撤销合并。27 个 ID 跟踪场景 + 12 项 Playwright 冒烟全过。支撑报告 `.workflow/research/refs/ext-2026-11-r2-script-editor.md`；结论同 `report.md`（本次实测的原始报告，一并归档）。

文件：`idtrack.mjs`→`idtrack5.mjs` 是 5 轮迭代的 StateField（最终版 `idtrack5.mjs`，L40-84 是可直接移植的 ~45 行）；`app.mjs`/`index.html` 是编辑器试验页源码；`unified-app.mjs`/`unified.html` 是 merge 视图页源码；`test.mjs`/`unified-test.mjs`/`perf.mjs` 是 Playwright/性能脚本。`bundle.js`/`unified-bundle.js` 是 esbuild 产物，未拷（重跑时重新生成）。

重跑：`npm install`（依赖见 `package.json`：`@codemirror/state|view|merge|language|commands`、`diff`、esbuild、playwright 1.65）→ `npx esbuild app.mjs --bundle --format=esm --outfile=bundle.js`（merge 版同理产 `unified-bundle.js`）→ `python3 -m http.server` 或静态伺服本目录 → `node test.mjs`、`node unified-test.mjs`、`node perf.mjs`（后两者内置 http server，无需手动起）。

第三方依赖：CodeMirror 6 全家 MIT（Marijn Haverbeke），`diff` jsdiff（BSD-3），playwright（Apache-2.0）。浏览器实测用 headless Chromium。
