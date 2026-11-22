# 02: 完成 Pixi 场面演出与素材窗口

**Effort:** m3-playback
**Blocked by:** 01
**Covers:** W1
**Files:** packages/player/src/stage/, tests/e2e/m3-stage.spec.ts
**Read first:** `.workflow/specs/m3-playback.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M3 stage directions'` → 真实舞台支持演出全集及四种横屏裁切。

- [ ] 覆盖演出幂等、相对动画、预载与引用计数卸载，作品 CSS 不改变默认 UI。
