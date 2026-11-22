# 04: 全书预览与卷摘要

**Effort:** m1a-project
**Blocked by:** 01
**Covers:** W3
**Files:** packages/creator/src/preview/, tests/fixtures/cassettes/m1a-preview/, tests/unit/m1a-preview.test.ts
**Read first:** `.workflow/specs/m1a-project.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m1a-preview.test.ts` → 严格回放覆盖拆段、不截断、汇总与重启恢复。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。

- [ ] 每章读完，按卷生成 digest，并保留人物、地点、时间线和伏笔。
