# cjk-text（R2 CJK 文本渲染试验：DOM 覆盖层 + Pixi 对照）

验证内容：四种文本用 DOM 覆盖层（不进 Pixi 舞台）的可行性——`line-break:strict` 禁则、`text-spacing-trim`/`text-autospace` 间距、`<ruby>` 注音、逐字打字机（占位居 `visibility:hidden` 撑排版 + 显现层逐字 opacity，零漂移）、`text-shadow` 描边。Playwright 截图对比 DOM vs Pixi 逐字排版。支撑报告 `.workflow/research/refs/ext-2026-11-r2-cjk-text.md`；落进 `player.md` B15 与 gap-ledger C2/C4 字体决策。

文件：`app/test.html`（DOM+Pixi 并排对照页）、`test2.html`（纯 DOM 打字机）、`outline.html`（描边试验）；`app/*.mjs` 是 Playwright 驱动脚本：`kinsoku.mjs`（禁则行首标点检查）、`compare.mjs`（DOM vs Pixi 行断对比）、`shot*.mjs`（截图）、`pixi2-10.mjs`（Pixi Text 逐版参数试验）、`grapheme_ruby.mjs`（grapheme 切分验证）。`shots/dom_4k_crop.png` 是 4K DOM 渲染裁切证据。三个 `.woff2` 字体子集（NotoSerifSC-4k/NotoSansSC-6k/NotoSerifSC-novel-6k）与全尺寸 PNG 未拷——字体从 `@fontsource/noto-serif-sc`/`noto-sans-sc`（OFL-1.1）子集重生成，大图可重跑脚本得到。

重跑：`cd app && npm install`（pixi.js ^8.23、playwright 1.65）→ `python3 -m http.server 8777`（脚本硬编码 `http://localhost:8777`）→ `npx playwright install chromium` → `node kinsoku.mjs`/`node compare.mjs`/`node shot.mjs 1920 1080 typewriter 60`。脚本里 `../shots/` 输出截图。

第三方依赖：pixi.js（MIT）、playwright（Apache-2.0）、系统 Noto CJK 字体或 fontsource 子集（OFL-1.1）。
