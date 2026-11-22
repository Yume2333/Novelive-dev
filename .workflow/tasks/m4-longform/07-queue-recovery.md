# 07: 实现多作品调度、崩溃暂停与队列重排

**Effort:** m4-longform
**Blocked by:** 01
**Covers:** W2
**Files:** packages/creator/src/scheduler/work-queue/, packages/ui/src/pages/production/queue/, tests/integration/m4-queue.test.ts
**Read first:** `.workflow/specs/m4-longform.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/integration/m4-queue.test.ts` → 队列两部作品暂停/让槽/重排/续跑与 crash 恢复通过。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。

- [ ] 优先章、确认回头部而不抢占、系统真实重开状态恢复，关联主控已有运行记录。
