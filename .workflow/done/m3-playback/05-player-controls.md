# 05: 完成菜单、控制与章末等待

**Effort:** m3-playback
**Blocked by:** 01
**Covers:** W2
**Files:** packages/ui/src/pages/player/controls/, tests/e2e/m3-controls.spec.ts
**Read first:** `.workflow/specs/m3-playback.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M3 player controls'` → 真实窗口导航至 Esc/右键系统菜单，控制与章末状态按契约变化。
**Base commit:** 82c71a7007dd505746dda360a4b118a9d5c67ecd

## Progress

- Scope amended with owner approval: extend chapter selection/metadata through creator contract and loader, eligibility tests, and minimal host notification interface; mount controls in PlayerPage.
- Check plan amended: exercise range controls with keyboard events and await asynchronous fullscreen transitions rather than synchronous checkbox state; inspect real Electron menu evidence before completion.
- Integration amended: M4/08 owns desktop notification delivery; emit `novelive:player-waiting` with work ID on entry and null on exit/unmount, without adding preload/main IPC.
- Preserve compiler-assigned sentence IDs across chapter reloads using the compiler's existing `previous` option, so raw scripts without explicit IDs retain their read-set references.
- Check after: strict real Electron M3 controls 3 passed (8.1s); M1b regression 2 passed (3.8s); loader unit tests 5 passed; typecheck and lint exit 0 (one existing fixture lint info). Receipts: `.workflow/evidence/m3-playback/05-controls-checks.md`, `.workflow/evidence/m3-playback/05-controls-menu.png`.
- Review: skipped — no reviewer/subagent spawning tool is available in this session; independent workflow/security review remains for effort close.
- Rebased onto M3/04 and connected `PlaybackProgress` and the desktop progress store through validated main-frame IPC. Quick/manual saves, 60-slot thumbnail grids, sentence-first-page restore and cross-chapter history now use the shared progress implementation; read/mainline and saves persist across restart. Settings and the session history cursor remain in memory.
- Refreshed the rebase after M4/08 landed during verification; preserved its tray/lifecycle and notification startup alongside progress IPC initialization.
- The minimal snapshot renderer restores background, sprites and dialogue text; full CG/foreground, camera, particles, masks/filters, music and interrupted animations remain the responsibility of the Pixi stage. No edits to `stage/`, `text/`, `progress/` or `save-data/` were needed.
- Review corrections: direct beat notifications include textless beats; publication handoff waits for a click; editor navigation requires a binding; successor mode follows read state; metadata-only polling remains tied to the immediate successor; focus wrapping skips disabled buttons.
- Check after persistence integration and refreshed rebase: strict real Electron M3 controls 5 passed (17.1s); M1b regression 2 passed (4.0s); save integration and loader/IPC validation 16 passed, affected loader/IPC validation rerun 6 passed; typecheck and lint exit 0 (one existing fixture lint info). Restart coverage uses the same user-data directory. Evidence includes `05-controls-saves.png`.
- Further Devin Review corrections on `91e7841`: stale resume fallback, target-aware history mode, prevalidated non-destructive save/history restores, capturing the displayed saved text after script edits, enabled initial focus and grid-only cached thumbnail reads. Check after: M3 controls 5 passed (19.0s), M1b regression 2 passed (4.0s), save integration plus loader/IPC validation 20 passed; typecheck/lint exit 0 (existing fixture lint info retained). Separate commit receipts are in `05-controls-checks.md`.

- [x] 加入自动播放速度、跳过已读、隐藏、窗口与对话框设置、目录回看、回编辑器；后台通知接宿主接口，系统托盘及完整通知在 M4。
