# 05: 完成菜单、控制与章末等待

**Effort:** m3-playback
**Blocked by:** 01
**Covers:** W2
**Files:** packages/ui/src/pages/player/controls/, tests/e2e/m3-controls.spec.ts
**Read first:** `.workflow/specs/m3-playback.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M3 player controls'` → 真实窗口导航至 Esc/右键系统菜单，控制与章末状态按契约变化。
**Base commit:** f08f8b74548b807333aaa9db2cefc7fb348421d1

## Progress

- Scope amended with owner approval: extend chapter selection/metadata through creator contract and loader, eligibility tests, and minimal host notification interface; mount controls in PlayerPage.
- Check plan amended: exercise range controls with keyboard events and await asynchronous fullscreen transitions rather than synchronous checkbox state; inspect real Electron menu evidence before completion.
- Integration amended: M4/08 owns desktop notification delivery; emit `novelive:player-waiting` with work ID on entry and null on exit/unmount, without adding preload/main IPC.
- Preserve compiler-assigned sentence IDs across chapter reloads using the compiler's existing `previous` option, so raw scripts without explicit IDs retain their read-set references.
- Check after: strict real Electron M3 controls 3 passed (8.1s); M1b regression 2 passed (3.8s); loader unit tests 5 passed; typecheck and lint exit 0 (one existing fixture lint info). Receipts: `.workflow/evidence/m3-playback/05-controls-checks.md`, `.workflow/evidence/m3-playback/05-controls-menu.png`.
- Review: skipped — no reviewer/subagent spawning tool is available in this session; independent workflow/security review remains for effort close.
- Settings and read/mainline state remain in memory pending the parallel progress/save-data integration; no existing settings host/config persistence API was available.

- [x] 加入自动播放速度、跳过已读、隐藏、窗口与对话框设置、目录回看、回编辑器；后台通知接宿主接口，系统托盘及完整通知在 M4。
