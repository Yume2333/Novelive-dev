# 07: 接通文本和视觉模型测试

**Effort:** m0-skeleton
**Blocked by:** 02, 03
**Covers:** W2, W3, W4
**Files:** packages/creator/src/models/text/, tests/unit/m0-text.test.ts, tests/fixtures/text-models/
**Read first:** `.workflow/specs/m0-skeleton.md`、`.workflow/research/handoff-defaults.md` M0、`docs/architecture.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m0-text.test.ts` → 三种协议及带图视觉测试的成功、错误、重试、取消路径回放通过。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。

- [ ] pi Model 格式与 compat、上下文校验、三协议 L3 fetch；按规格区分看门狗、中止和网络错误。
- [ ] 用 L1 假模型覆盖工具循环中的取消。
