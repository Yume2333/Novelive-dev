# 02: 实现写手、审稿及演出脚本

**Effort:** m1b-production
**Blocked by:** 01
**Covers:** W2, W3
**Files:** packages/creator/src/pipeline/writing/, tests/fixtures/cassettes/m1b-writer/, tests/unit/m1b-writer.test.ts
**Read first:** `.workflow/specs/m1b-production.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m1b-writer.test.ts` → 源文检查、修订、分段、优先章衔接与脚本诊断通过。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。

- [ ] 忠实默认开且核验真实引文、文风可选，每次只修一轮；覆盖改编/演出密度、红线和源段范围。
