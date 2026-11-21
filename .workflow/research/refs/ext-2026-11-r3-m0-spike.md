## R3 M0 Spike 报告（slug: m0-spike，代码在 `.workflow/evidence/spikes-r3/m0-skeleton/`）

### 结论（按重要性）
1. **M0 骨架能跑通**：Electron 45.4.1 窗口+侧边栏外壳+设置页渲染正常（截图证据 `.workflow/evidence/spikes-r3/m0-skeleton/{library,settings,after-reconnect}.png`），utility process 经 MessagePort 完成 `config.get` 调用，日志 `<proc>-<date>.log` 落在 `userData/logs/`。
2. **spec「sqlite 可用」证实**：Electron 45.4.1 内嵌 Node 24.22.3，`node:sqlite` 在 utility process 无 flag 建库/WAL/读写通过（日志 `smoke.sqlite ok wal`）。
3. **spec 三个坑已排掉**：①主进程必须 fork 后立即 `postMessage connect+port`（先等 `ready` 再发 port 会死锁，实测握手超时）；②**sharp 不能被打包进 creator.mjs**——libvips-cpp.so 找不到崩进程，必须把 sharp 写进 `apps/desktop` dependencies 让 externalizeDepsPlugin 排除它；③杀 utility process 用 `pgrep -f utility-sub-type=node.mojom.NodeService`，serviceName 不进 cmdline。
4. **崩溃恢复按 spec 工作**：`ready` 后 SIGKILL → `creator.down` + 自动重启 gen1→gen2（日志证据）。**断路器语义要注意**：`ready` 成功即清零，所以「反复杀已就绪进程」永远到不了 3 次——spec「连续 3 次」实际是「连续未握手成功 3 次」。
5. **模型测试走 pi 三通**：`pi-ai/compat` 的 `complete()` + 手工构造 `Model{api: openai-completions|openai-responses|anthropic-messages, baseUrl, apiKey}`，三种格式对本地假服务全过（latencyMs 8-94）。**未测真实中转**：本会话没有 `NL_IMAGE_*` 环境变量，公网端点 401；按 spec 退路用了本地假服务 `tools/fake-llm.mjs`（含 SSE 流，pi 的 stream 层要求流式事件，纯 JSON 会报 "stream ended without stop reason"）。
6. **图片测试三项语义对**：t2i ok、透明底在无 alpha 的 PNG 上正确判 `unsupported`、edit 不阻塞；缩略图落 `cache/model-test/*.png`。**坑：`novelive://` 只支持 `<img src>`，renderer `fetch()` 会 TypeError**（`supportFetchAPI:true` 也不够）；写文件前必须 `mkdirSync` 子目录。
7. **pnpm 12 改行为**：`package.json` 的 `pnpm` 字段（onlyBuiltDependencies/overrides）被忽略，必须挪进 `pnpm-workspace.yaml`；另有 minimumReleaseAge 供应链策略拦截当天新包（pi-ai 1.6.0/lucide 1.77.0），需 `minimumReleaseAgeExclude`。
8. **sharp 决策有偏差**：decisions 明确拒用 `@janhapke/sharp-electron` 要自打补丁；spike 为验证运行时路径用了它（`sharp: npm:@janhapke/sharp-electron@0.35.4-electron.1` 覆盖 + 补丁版 decode/webp 在 utility process 实测通过）。M0 需按决策写自己的 patch 脚本。
9. **W6 达标**：stylelint `color-no-hex`+`color-named` 对组件 CSS 报 `file:line`（tokens.css 用 ignoreFiles 豁免）。
10. **单测 5/5**：掩码哨兵往返、掩码/空串保留旧 Key、重启持久化、events.list 补漏、非法帧拒绝（`tests/config.test.ts`）。

### 版本表（doc pin → 今日最新 → spike 采用/建议）
| 包 | 文档 | 最新 | 建议 pin |
|---|---|---|---|
| electron | 45.x exact | 45.4.1（同日最新稳定，46.0.0-alpha.x） | 45.4.1（Node 24.22.3, Chrome 156, sqlite 3.54.1） |
| electron-vite | 6 | 6.0.0 | 6.0.0（rolldown 基座，rollupOptions→rolldownOptions） |
| vite | 未指 | 8.3.8 | **7.2.7**（plugin-react 6.3.0 强制 vite8，会破坏；用 plugin-react 5.1.1 配 vite7） |
| typescript | 未指 | 7.0.2 | **5.9.3**（TS7 原生重写太新） |
| react/dom | 19 | 19.3.1 | 19.3.1 |
| pnpm | 未指 | 12.21.0 | 12.21.0（注意配置迁移） |
| pi-ai/pi-agent-core/pi-schema | 1.6.x | 1.6.0 | 1.6.0（pi-ai 依赖 pi-telemetry 1.6.0 + openai 7.59.0） |
| sharp | 0.35.x | 0.35.5 | 按决策自补丁；spike 用 janhapke 0.35.4-electron.1 |
| openai | 未指 | 7.62.0 | 7.62.0（`toFile` 可用） |
| electron-builder/updater | 未指 | 26.18.0 / 6.8.11 | M3/M5 才用 |
| @vitejs/plugin-react | 未指 | 6.3.0 | **5.1.1**（6.x 要求 vite8） |
| 其余 | — | vitest 5.1.1, playwright 1.65.1（`_electron` 可用）, @biomejs/biome 2.6.8, stylelint 18.1.0, i18next 27.2.2, react-i18next 18.0.3, lucide-react 1.77.0, react-router-dom 7.18.6, zustand 5.1.0, ws 8.23.0, @types/node 24.10.4 | 同左 |
| M0 不用 | — | pixi.js 8.23.0, pixi-filters 6.1.5, @assistant-ui/react 0.15.37, streamdown 2.8.0, codemirror 6.0.2 (@codemirror/* 6.43/6.7/6.13), electron-updater 6.8.11 | 记录即可 |

### Per-W 判定
- **W1 部分**：各件单独过（4 包 tsc clean、biome clean、stylelint clean、vitest 5/5）；`pnpm check` 单命令未跑通——`tsc --noEmit -p tsconfig.check.json`（project references）语义错误，建议改 `pnpm -r run check`（每包已有 check script）。
- **W2 未做**：cassette 录制回放体系未建（工作量最大缺口）；取消路径存在但只在假服务上测了「调用前 cancel」语义，`call().cancel()` 发送 cancel 帧+本地 reject 代码就绪；杀 creator→重连→再调通在裸 Electron 下验证过（pgrep 坑见上）。
- **W3 部分**：真实接口不可达（无中转 env、公网 401），用本地 fake 验了三文本格式+图片三项；重启后配置在（image model/concurrency/defaultDir 持久化实测）；截图在 `.workflow/evidence/spikes-r3/m0-skeleton/` 未进 `.workflow/evidence/`。
- **W4 未验**：`tools/dev-bridge` 写完（WS 8765/HTTP 8766/客户端挂 window.novelive）未启动。
- **W5 部分**：有设置页/书库截图，未与 prototype 并排比对。
- **W6 通过**（实测注入 `#ff0000` 报错带行号，删除后通过）。
- **W7 未做**：throwaway 未推仓库；`.github/workflows/ci.yml` 未写。

### Spec 缺陷与建议措辞
1. `m0-skeleton.md:42`「call 返回 Promise 和一个 cancel() 句柄」形状不定 → 建议写明「返回 `{ promise, cancel }`，`promise` resolve 为命令 result、reject 为 `{code,message}`」。
2. `.npmrc`/package.json 依据已过时 → 建议架构文档「打包注意」补一句「pnpm ≥12 时 onlyBuiltDependencies/overrides 移到 pnpm-workspace.yaml」。
3. `pnpm check` 的 `tsc --noEmit -p tsconfig.check.json` → 改为「`pnpm -r run check`（每包 tsc --noEmit）+ biome check + stylelint + vitest run」。
4. `novelive://` 补一句「M0 只保证 `<img>`/CSS 引用可读，renderer 侧 `fetch()` 不支持」。
5. `model.testText` 补「`slot: visual` 时请求附带内置小测试图」。
6. 断路器措辞「基础设施失败连续 3 次」→「连续 3 次未能完成 ready 握手（ready 后清零）」。
7. `dev:web` 脚本 `pnpm run dev:bridge & pnpm run dev:ui` 只在 POSIX shell 下可用，spec 只说 Linux 测试可接受，跨平台需 concurrently。

### 需要所有者取舍
- **sharp**：spike 用了决策拒掉的 `@janhapke/sharp-electron` 包（只为验证路径）。建议 M0 按决策写 `tools/patch-sharp.mjs`（patchelf `$ORIGIN`+隐藏 glib 符号），但 spike 证明补丁版 runtime 行为正确。**我选：照决策自打补丁。**
- **vite 7+plugin-react 5 vs vite 8+plugin-react 6**：我选 vite 7.2.7+plugin-react 5.1.1（electron-vite 6 已是 rolldown 变体，vite8 没实测价值）。
- **`fetch()` on `novelive://`**：M0 只读缩略图，`<img>` 够；若要 fetch 需研究 `standard:true`+CORP，建议 M0 不做。
- **call() 形状**：`{promise,cancel}` 已建，建议定稿。

### 可复用产物
- `.workflow/evidence/spikes-r3/m0-skeleton/` 完整 workspace（`pnpm i --no-frozen-lockfile && pnpm --filter @novelive/desktop build`，`xvfb-run electron apps/desktop/out/main/index.mjs`）：
  - `packages/creator/src/contract.ts`（pi-schema 全契约：命令/事件/帧/配置/掩码）✅ 直接可搬
  - `packages/creator/src/{config,service,models,entry,log,sqlite-smoke,sharp-smoke}.ts`
  - `apps/desktop/src/{main/index.ts,preload/index.ts,main/creator-entry.ts}` + `electron.vite.config.ts`（sharp externalize 的正确姿势）
  - `packages/ui/`（tokens.css、CSS Modules 控件库、AppShell+崩溃横幅、SettingsPage 全功能、i18next）
  - `tools/dev-bridge/`、`tools/fake-llm.mjs`（SSE 假服务，三文本格式+图片）
  - `tests/config.test.ts`（5 个契约单测）、`biome.json`、`stylelint.config.mjs`、`.npmrc`、`pnpm-workspace.yaml`（pnpm12 正确配置形态）
- 截图：`.workflow/evidence/spikes-r3/m0-skeleton/*.png`；运行日志：`/tmp/nl-r3/xdg*/Electron/logs/` (未归档)

**最大遗留缺口**：cassette 录制回放、W2/W4 e2e、CI yml、sharp 自补丁脚本。工具已停，报告内联于此。

## 第二轮补测（R3M0Spike2，整理者据其交付与复核补写）

代码在 `.workflow/evidence/spikes-r3/m0-skeleton/`，截图 `.workflow/evidence/spikes-r3/m0-skeleton/m0b/`。

| 项 | 结果 | 证据 |
|---|---|---|
| sharp 自补丁 | 通过 | `tools/patch-sharp.mjs`（406 行）：libvips-cpp.so 拷到 .node 同目录并把 RPATH 改成 `$ORIGIN`；.dynsym 里 g_*/nsgif_*/lzw_*/glib_* 改 LOCAL；sharp 插件的 7 个 g_* UND 引用改名 vips_g_*；gnu.hash 重建为 sysv hash。未补丁：utility process `creator.exit code=139`（解码即崩）；补丁后 `sharpSmoke {ok:true}`。依赖 patchelf + objcopy |
| 补丁幂等 | **失败** | 对已补丁的 node_modules 再跑一次抛 `没找到 DT_GNU_HASH 动态项`、退出 1（整理者复跑两次确认）。挂 postinstall 时，任何不重装 sharp 的 `pnpm install` 都会失败。要先检测已补丁再跳过 |
| 崩溃横幅 | 通过 | `crash-banner-down.png`（运行中被杀、自动重启前）、`circuit-open-banner.png`（连续 3 次未就绪，横幅带日志路径、日志、重新启动）、`after-recovery.png`。注入 env：`NOVELIVE_READY_TIMEOUT_MS`、`NOVELIVE_CREATOR_NOREADY`、`RESTART_DELAY_MS`。横幅文案在 1120 宽窗口被截断（"连续 3 …"），长日志路径挤掉了说明 |
| 断路器语义 | 确认 | 连续 3 次没完成 ready 握手才开横幅；ready 成功清零；手动"重新启动"清零后重试 |
| 录制回放 | 通过 | `tests/cassette.mjs`（271 行），record/replay/strict；cancel、disconnect、http500、离线 strict 4 个测试通过；e2e kill→自动重启→再调成功；文本经 pi + fake-llm 先录后 strict 回放 |
| 录制文件泄露 | 无 Key、无接口域名（整理者 grep 确认） | 但**响应头原样录下**：中转程序回传的 trace-id / expose-headers 等自定义头能识别出所用中转程序（归档 fixture 已剥，只留 `content-type`/`retry-after`）。录制要改为响应头白名单（`content-type`、`retry-after` 等少数几个） |
| 真实图片测试 | 生成 2 次 200，编辑 1 次 400 | 400 的 body 是 `{"error":{"type":"api_error","code":"service_unavailable",...}}`：中转把临时故障报成 400。**错误分类不能只看状态码**，`service_unavailable`/`overloaded` 等 code 在 4xx 里也要算临时错误 |
| dev-bridge | 通过 | `dev-bridge-settings.png`；Node strip-types 不改 `.js→.ts` 导入后缀，用 esbuild 先打包 bridge 绕开 |
| `pnpm check` | 通过，约 14s | 包内脚本改名 `check:types`，pnpm 需 `ignoreWorkspaceCycles` |
| CI | actionlint 0 错 | `.github/workflows/ci.yml`（57 行）3-OS 矩阵 + Linux xvfb Electron smoke；Linux 步骤先跑 patch-sharp |

W1-W7 现状：W1、W2、W3（用假服务 + 3 次真实图片调用）、W4、W6、W7 通过；W5 有截图，未与原型并排比对。
