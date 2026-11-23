# 08: 接通托盘、系统通知和退出流程

**Effort:** m4-longform
**Blocked by:** 01
**Covers:** W2, W3
**Files:** apps/desktop/src/main/tray/, apps/desktop/src/main/notifications/, tests/e2e/m4-tray.spec.ts
**Read first:** `.workflow/specs/m4-longform.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M4 desktop lifecycle'` → 真实宿主关窗后台运行、无托盘最小化、退出询问、点击通知定位。
**Base commit:** bb12fa20a21b5fb537757a0b3b9e4005adebd6ff
**Status:** blocked

- [ ] 按文档处理正在执行的制作和进程清理，通知仅事件与短正文、去标签并限长。

## Progress

Check after: `NL_REPLAY=strict xvfb-run -a pnpm test:e2e --grep 'M4 desktop lifecycle'` → 3 passed (2.0s)。真实 Electron 与 creator 已运行；托盘可用性、通知展示和退出对话框使用替身，不能据此宣称 W3 原生桌面验收完成。[验收凭据](../../evidence/m4-longform/08-desktop-lifecycle.txt)。相关 M0 宿主回归 4 项、制作单测 14 项、typecheck 与改动文件 Biome 检查通过。

Review: skipped — 当前工具目录无可创建独立审查会话的工具，待主会话安排 workflow-reviewer / security-reviewer；未自行标记通过或归档。

重规划：退出对话框用例在 Electron ESM 上需通过 `process.getBuiltinModule('module').createRequire` 加载隔离模块，而非全局 require；已修正测试宿主。主进程最小接线在 index.ts，preload 只转发制作快照、通知定位与播放器等待状态。Linux 用 gdbus 查询 StatusNotifierWatcher；缺失工具、服务或超时时最小化，不采用仅 macOS/Windows 支持的 Tray.getBounds。

## Blocked

本分支基线的 PlayerPage / 播放器没有“等待本机新章”事件（该能力由并行 M3 实现）。通知端已提供入口：等待时 `window.dispatchEvent(new CustomEvent('novelive:player-waiting', { detail: workId }))`，离开等待状态时 detail 传 null；hash 跳转自动清除。需 M3 接上这两个调用后验收真实后台新章通知。为避免跨任务修改未触碰播放器文件。

还需有系统托盘与通知服务的图形宿主实测图标、原生通知点击及制作中退出 / 休眠阻止器清理；当前只有 Electron 回调级验证，界面未做视觉验收。复选框保持未完成，暂不归档。
