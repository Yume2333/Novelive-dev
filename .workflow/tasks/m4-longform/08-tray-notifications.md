# 08: 接通托盘、系统通知和退出流程

**Effort:** m4-longform
**Blocked by:** 01
**Covers:** W2, W3
**Files:** apps/desktop/src/main/tray/, apps/desktop/src/main/notifications/, tests/e2e/m4-tray.spec.ts
**Read first:** `.workflow/specs/m4-longform.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M4 desktop lifecycle'` → 真实宿主关窗后台运行、无托盘最小化、退出询问、点击通知定位。

- [ ] 按文档处理正在执行的制作和进程清理，通知仅事件与短正文、去标签并限长。
