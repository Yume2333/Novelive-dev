# 05: 完成菜单、控制与章末等待

**Effort:** m3-playback
**Blocked by:** 01
**Covers:** W2
**Files:** packages/ui/src/pages/player/controls/, tests/e2e/m3-controls.spec.ts
**Read first:** `.workflow/specs/m3-playback.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M3 player controls'` → 真实窗口导航至 Esc/右键系统菜单，控制与章末状态按契约变化。

- [ ] 加入自动播放速度、跳过已读、隐藏、窗口与对话框设置、目录回看、回编辑器；后台通知接宿主接口，系统托盘及完整通知在 M4。
