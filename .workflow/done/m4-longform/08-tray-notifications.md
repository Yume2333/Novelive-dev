# 08: 接通托盘、系统通知和退出流程

**Effort:** m4-longform
**Blocked by:** 01
**Covers:** W2, W3
**Files:** apps/desktop/src/main/tray/, apps/desktop/src/main/notifications/, tests/e2e/m4-tray.spec.ts
**Read first:** `.workflow/specs/m4-longform.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M4 desktop lifecycle'` → 真实宿主关窗后台运行、无托盘最小化、退出询问、点击通知定位。
**Base commit:** bb12fa20a21b5fb537757a0b3b9e4005adebd6ff

- [x] 按文档处理正在执行的制作和进程清理，通知仅事件与短正文、去标签并限长。

## Progress

Check after: `NL_REPLAY=strict xvfb-run -a pnpm test:e2e --grep 'M4 desktop lifecycle'` → 3 passed (3.0s)。独立 D-Bus 下的真实 Linux 托盘与通知用例另有 2 项通过，无托盘最小化另有 1 项通过。[验收凭据](../../evidence/m4-longform/08-desktop-lifecycle.txt)含原生截图、通知动作及覆盖范围。

Review: skipped — 当前会话无可启动独立 reviewer 的工具；未自行审查。

重规划：退出对话框用例在 Electron ESM 上需通过 `process.getBuiltinModule('module').createRequire` 加载隔离模块，而非全局 require；已修正测试宿主。主进程最小接线在 index.ts，preload 只转发制作快照、通知定位与播放器等待状态。Linux 用 gdbus 查询 StatusNotifierWatcher；缺失工具、服务或超时时最小化，不采用仅 macOS/Windows 支持的 Tray.getBounds。

原生宿主验收：已安装 patchelf、Dunst、libnotify 和 LXQt Panel。实际 StatusNotifier 激活可重开窗口；无 watcher 会话最小化；系统新章/完成通知去掉正文标签，激活后分别前往播放页和概览。原生通知用例注入制作快照，不调用模型；M4/10 另覆盖实际 creator 退出恢复和播放器等待事件。
