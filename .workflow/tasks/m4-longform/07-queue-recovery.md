# 07: 实现多作品调度、崩溃暂停与队列重排

**Effort:** m4-longform
**Blocked by:** 01
**Covers:** W2
**Files:** packages/creator/src/scheduler/work-queue/, packages/ui/src/pages/production/queue/, tests/integration/m4-queue.test.ts
**Read first:** `.workflow/specs/m4-longform.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/integration/m4-queue.test.ts` → 队列两部作品暂停/让槽/重排/续跑与 crash 恢复通过。

- [ ] 优先章、确认回头部而不抢占、系统真实重开状态恢复，关联主控已有运行记录。
