# 07: 接通重写场景、单图重画与重跑

**Effort:** m2-editor
**Blocked by:** 02, 03
**Covers:** W3
**Files:** packages/creator/src/editor/revisions/, tests/fixtures/cassettes/m2-revisions/, tests/unit/m2-revisions.test.ts
**Read first:** `.workflow/specs/m2-editor.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m2-revisions.test.ts` → 实际工程只应用勾选的重写，重画保留旧版本历史，重跑范围正确。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。

- [ ] 复用写手、出图与综合管线。设置、重写、重图和重做章节都按输入版本在写前再次校验。
