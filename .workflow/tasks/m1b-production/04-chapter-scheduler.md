# 04: 实现单作品调度和两次停点

**Effort:** m1b-production
**Blocked by:** 01
**Covers:** W2
**Files:** packages/creator/src/scheduler/chapter/, tests/fixtures/scheduler/m1b/, tests/unit/m1b-scheduler.test.ts
**Read first:** `.workflow/specs/m1b-production.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m1b-scheduler.test.ts` → 实际 SQLite 中写图并行、去重、优先级、停止、暂停/重试与两次确认均通过。

- [ ] 基础图先于差分，失败恢复不改已确认内容；运行记录可回放；区分不支持能力与普通图片失败。
