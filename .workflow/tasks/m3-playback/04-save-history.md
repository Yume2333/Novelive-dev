# 04: 实现持久存档、已读与回滚

**Effort:** m3-playback
**Blocked by:** 01
**Covers:** W2
**Files:** packages/player/src/progress/, apps/desktop/src/save-data/, tests/integration/m3-save.test.ts
**Read first:** `.workflow/specs/m3-playback.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/integration/m3-save.test.ts` → 应用数据目录存档可重开，60+1 槽、200 条快照及主线/重看语义正确。

- [ ] 含 WebP 缩略图、跨章回滚和 forward 指针，方案按手册保存未结束演出并按类型恢复。
