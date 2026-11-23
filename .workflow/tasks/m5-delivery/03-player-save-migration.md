# 03: 实现更新时存档与已读迁移

**Effort:** m5-delivery
**Blocked by:** 01
**Covers:** W2
**Files:** packages/player/src/progress/migrations/, apps/desktop/src/save-data/index.ts, tests/integration/m5-saves.test.ts
**Read first:** `.workflow/specs/m5-delivery.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/integration/m5-saves.test.ts` → 现有数据目录真实迁移、缺句子和章节时旧槽保留且可删；迁移后写入新槽触发清理时，旧槽的缩略图仍可读取，无引用的缩略图被清除。

- [ ] 保持作品 ID、场景/句子 ID 与已读；老快照字段补默认，不把存档写入包。
- [ ] 桌面存档清理同时保留当前槽和旧版本存档组引用的缩略图，只清除没有存档引用的缩略图。
