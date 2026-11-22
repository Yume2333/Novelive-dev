# 06: 实现系列覆盖、多卷和跨语言

**Effort:** m4-longform
**Blocked by:** 01
**Covers:** W2
**Files:** packages/creator/src/project/series/, packages/creator/src/synthesis/incremental/, packages/creator/src/pipeline/writing/locale/, packages/format/src/model/inheritance/, tests/integration/m4-series.test.ts
**Read first:** `.workflow/specs/m4-longform.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/integration/m4-series.test.ts` → 实际工程复用角色素材；下级同 ID 整条覆盖， join-series 不删既有条目。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。

- [ ] 续卷逐步综合、首卷不等后续卷、直接生成目标语言，使用术语表和原书一致的命名。
