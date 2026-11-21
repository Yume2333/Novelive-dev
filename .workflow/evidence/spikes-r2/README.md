# spikes-r2 — round-2 试验资产归档

`/tmp/nl-r2/` 下 round-2 一次性试验中**自写**的脚本/配置/小夹具/测量数据的归档（2026-11-21 拷入）。只拷我方产物；第三方 repo（`aui-repo`、webgal、renpy、monogatari、new-api、legado/MyBookshelf、upscayl 源码）、二进制与模型权重（ncnn/upscayl-bin）、`node_modules`/`.venv`、构建产物、>200KB lockfile 一律不拷。每个子目录的 README 写明测了什么、怎么重跑、要哪些第三方依赖、支撑哪份 `.workflow/research/refs/ext-2026-11-r2-*.md` 报告。

| 子目录 | 试验 | 支撑报告 |
|---|---|---|
| `electron-shell/` | Electron 骨架：electron-vite 多入口+MessagePort+utility process+sharp 修复+electron-builder | r2-electron-shell |
| `script-editor/` | `.nvs` 编辑器选型（CodeMirror 6 行 ID/merge/chip） | r2-script-editor |
| `chat-panel/` | 对话面板（assistant-ui ExternalStore+approval+分支） | r2-chat-panel |
| `zh-tokens/` | 11 分词器中文 token/字实测 → 分档 k 表 | r2-zh-tokens |
| `cjk-text/` | CJK DOM 覆盖层渲染 vs Pixi | r2-cjk-text |
| `upscale/` | 放大第一轮（ncnn 三 CLI 计时/alpha/sidecar） | r2-upscale |
| `upscale-sidecar/` | 放大追加轮（upscayl-bin/许可核对/盲测网格） | r2-upscale 附录 |
| `work-package/` | `.novelive` 包 2 万条目 ZIP 读写基准 | r2-work-package |

以下 `/tmp/nl-r2/` 目录**无自写产物可拷**（内容全是第三方资料）：`ImageApiCompat`（只解 new-api `nafiles` 源码片段+空 notes）、`LicenseAudit`（全是第三方 repo/tarball/Electron 文件）、`R2Ledger`（openai npm 包解包+官方文档 HTML）、`TextProviders`（官方文档 HTML+pi tarball）、`VnRuntime`（monogatari/renpy clone）。这些报告的结论在 `gap-ledger-r2.md` 与各 refs 文档里，资产本身不需要归档。
