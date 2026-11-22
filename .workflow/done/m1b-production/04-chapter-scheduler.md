# 04: 实现单作品调度和两次停点

**Effort:** m1b-production
**Blocked by:** 01
**Covers:** W2
**Files:** packages/creator/src/scheduler/chapter/, tests/fixtures/scheduler/m1b/, tests/unit/m1b-scheduler.test.ts
**Read first:** `.workflow/specs/m1b-production.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m1b-scheduler.test.ts` → 实际 SQLite 中写图并行、去重、优先级、停止、暂停/重试与两次确认均通过。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。
**Base commit:** f1a0090eba860b4f86937b57b09c7ab9f246b4ac

- [x] 基础图先于差分，失败恢复不改已确认内容；运行记录可回放；区分不支持能力与普通图片失败。

## Progress

- Check after: 严格回放调度检查 8 项通过；完整检查 CI 通过（本地 `m0-image` 因 sharp 的 Electron 补丁在纯 Node 下段错误，与本任务无关）。
- Real path: 调度器暂无界面或命令入口（`production.*` 接线归后续任务）；测试用 `Project.create` 建出的真实 `project.db` 跑完两次确认、写图并行、停止、重试、崩溃恢复与运行记录回放。
- Evidence: [检查](../../evidence/m1b-production/04-chapter-scheduler.txt)。无付费调用，无需录制。
- Review: pass — Devin Review 第一轮 6 项已修，第二轮（90a18a4）0 项。
