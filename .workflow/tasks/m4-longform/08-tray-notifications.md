# 08: 接通托盘、系统通知和退出流程

**Effort:** m4-longform
**Blocked by:** 01
**Covers:** W2, W3
**Files:** apps/desktop/src/main/tray/, apps/desktop/src/main/notifications/, tests/e2e/m4-tray.spec.ts
**Read first:** `.workflow/specs/m4-longform.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M4 desktop lifecycle'` → 真实宿主关窗后台运行、无托盘最小化、退出询问、点击通知定位。
**Base commit:** bb12fa20a21b5fb537757a0b3b9e4005adebd6ff
**Status:** active

- [ ] 按文档处理正在执行的制作和进程清理，通知仅事件与短正文、去标签并限长。

## Progress

Check after: `NL_REPLAY=strict xvfb-run -a pnpm test:e2e --grep 'M4 desktop lifecycle'` → 3 passed (2.0s)。真实 Electron 与 creator 已运行；托盘可用性、通知展示和退出对话框使用替身，不能据此宣称 W3 原生桌面验收完成。[验收凭据](../../evidence/m4-longform/08-desktop-lifecycle.txt)。相关 M0 宿主回归 4 项、制作单测 14 项、typecheck 与改动文件 Biome 检查通过。

Review: skipped — 当前工具目录无可创建独立审查会话的工具，待主会话安排 workflow-reviewer / security-reviewer；未自行标记通过或归档。

重规划：退出对话框用例在 Electron ESM 上需通过 `process.getBuiltinModule('module').createRequire` 加载隔离模块，而非全局 require；已修正测试宿主。主进程最小接线在 index.ts，preload 只转发制作快照、通知定位与播放器等待状态。Linux 用 gdbus 查询 StatusNotifierWatcher；缺失工具、服务或超时时最小化，不采用仅 macOS/Windows 支持的 Tray.getBounds。

并行 M3/05 从播放器的章末等待状态提供 `novelive:player-waiting` 事件，payload 沿用 workId / null；M4/10 集成门验收后台新章通知全链路，不阻塞本任务。主会话稍后补充原生宿主验收结果；复选框保持未完成，暂不归档。

原生宿主验收（主会话提供）：真实 KDE Plasma（:0，`pnpm dev`，`NL_REPLAY=strict`，无付费调用）中，制作中关窗隐藏到托盘且 creator 存活，托盘菜单可重开；退出确认选「继续制作」取消退出且 creator 存活，选「停止并退出」后 Electron 与 creator 进程均消失（ps 确认）。标题含 `<b>` 的作品通知正文去标签，点击通知前台打开「确认角色与主视觉」页。主机需用户级 libnotify 运行时才能显示原生通知。未覆盖：无托盘最小化仅 e2e；完成通知因 strict replay 第二章模型连接错误未到完成；新章通知由 M3/05 提供事件、M4/10 验收。
