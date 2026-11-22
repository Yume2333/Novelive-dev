# 08: 建立可回放的质量评测集

**Effort:** m1b-production
**Blocked by:** 02
**Covers:** W3
**Files:** tools/quality/, tests/fixtures/quality/, .workflow/evidence/m1b/quality/, tests/unit/m1b-quality.test.ts
**Read first:** `.workflow/specs/m1b-production.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m1b-quality.test.ts` → 离线评测产出结构化评分与失败分类，可重跑。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。

- [ ] 按 handoff 做评分、机械检查和独立 judge；仓库只存自编或可分发标注，不存私有原文。
