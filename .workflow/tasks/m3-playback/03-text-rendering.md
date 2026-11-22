# 03: 实现 CJK 文本和句内分页

**Effort:** m3-playback
**Blocked by:** 01
**Covers:** W1
**Files:** packages/player/src/text/, tests/e2e/m3-text.spec.ts
**Read first:** `.workflow/specs/m3-playback.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M3 text typography'` → 真实 DOM 显示禁则、ruby、停顿、分速、标签和三行分页。

- [ ] 双层布局稳定换行，提升显示层不重排；无句长硬限制及自动播放/跳过兼容。
