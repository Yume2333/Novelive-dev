# 07: 实现多作品调度、崩溃暂停与队列重排

**Effort:** m4-longform
**Blocked by:** 01
**Covers:** W2
**Files:** packages/creator/src/scheduler/work-queue/, packages/ui/src/pages/production/queue/, tests/integration/m4-queue.test.ts, packages/creator/src/project/production.ts, packages/creator/src/scheduler/chapter/index.ts
**Read first:** `.workflow/specs/m4-longform.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/integration/m4-queue.test.ts` → 队列两部作品暂停/让槽/重排/续跑与 crash 恢复通过。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。
**Base commit:** 8c3fc4b9b649a8e754e0d294163a22682970364f
**Status:** active

- [ ] 优先章、确认回头部而不抢占、系统真实重开状态恢复，关联主控已有运行记录。

## Progress

- Check after: `NL_REPLAY=strict pnpm exec vitest run tests/integration/m4-queue.test.ts` — 3 passed；包括同一工程的两部作品、独立工程重排、子进程被强杀后重开和显式续跑。
- M4/10 接线：将现有 `productionQueueSchema` 用于队列查询 `createProduction.getQueue()`、相邻重排 `createProduction.moveQueueWork(workId, direction)`（`-1` 提前、`1` 延后）与 app scope 的 `production.queue` 快照事件。制作页挂载 `ProductionQueuePanel`，继续和停止复用现有作品命令。此任务不改 M4/01 契约或桌面注册。
- 调度只为章节和章内出图分配制作槽；预览、综合和确认素材准备独立于该队列。重开项目时以原工程工作状态、任务检查点、`run`/`run_step` 为准；重排只影响当次运行中的待排作品，不会在重开后自动续跑。
- 离线验收只替换模型侧 worker；主控、SQLite 和异常退出后重开均走真实实现，无缺失 cassette。
